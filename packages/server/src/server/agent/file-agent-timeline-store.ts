import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

import { writeFileAtomic, writeJsonFileAtomic } from "../atomic-file.js";
import { AgentTimelineItemPayloadSchema } from "../messages.js";
import type {
  AgentTimelineCommittedFetchOptions,
  AgentTimelineCoverage,
  AgentTimelineFetchDirection,
  AgentTimelineFetchResult,
  AgentTimelineRow,
  AgentTimelineStageInput,
  AgentTimelineStagedRowUpdate,
  AgentTimelineStore,
  CommittedAgentTimelineGeneration,
  WorkingAgentTimelineGeneration,
} from "./agent-timeline-store-types.js";

const STORE_VERSION = 1;
const DEFAULT_SEGMENT_ROW_LIMIT = 256;
const SHA256_RE = /^[a-f0-9]{64}$/;

const TimelineRowSchema: z.ZodType<AgentTimelineRow> = z.object({
  seq: z.number().int().positive(),
  timestamp: z.string(),
  item: AgentTimelineItemPayloadSchema,
  providerMessageId: z.string().optional(),
});

const SegmentDescriptorSchema = z.object({
  file: z.string(),
  minSeq: z.number().int().positive(),
  maxSeq: z.number().int().positive(),
  rowCount: z.number().int().positive(),
  byteLength: z.number().int().positive(),
  checksum: z.string().regex(SHA256_RE),
});

const GenerationManifestSchema = z.object({
  version: z.literal(STORE_VERSION),
  agentId: z.string(),
  generationId: z.string().uuid(),
  timelineRevision: z.string().uuid(),
  epoch: z.string().min(1),
  status: z.enum(["building", "incomplete", "complete"]),
  nextSeq: z.number().int().positive(),
  segments: z.array(SegmentDescriptorSchema),
});

const AgentStateSchema = z.object({
  version: z.literal(STORE_VERSION),
  agentId: z.string(),
  activeGenerationId: z.string().uuid().nullable(),
  workingGenerationId: z.string().uuid().nullable(),
  invalidGenerationIds: z.array(z.string().uuid()).default([]),
});

type SegmentDescriptor = z.infer<typeof SegmentDescriptorSchema>;
type GenerationManifest = z.infer<typeof GenerationManifestSchema>;
type AgentState = z.infer<typeof AgentStateSchema>;

export type FileAgentTimelineStoreFaultPoint =
  | "segment"
  | "working_manifest"
  | "working_pointer"
  | "complete_manifest"
  | "active_pointer"
  | "invalidate_pointer";

export interface FileAgentTimelineStoreOptions {
  segmentRowLimit?: number;
  faultInjector?: (point: FileAgentTimelineStoreFaultPoint) => void | Promise<void>;
}

/** File-backed durable canonical timeline store. */
export class FileAgentTimelineStore implements AgentTimelineStore {
  private readonly baseDir: string;
  private readonly segmentRowLimit: number;
  private readonly faultInjector?: FileAgentTimelineStoreOptions["faultInjector"];
  private readonly pendingMutations = new Map<string, Promise<void>>();

  constructor(baseDir: string, options: FileAgentTimelineStoreOptions = {}) {
    const segmentRowLimit = options.segmentRowLimit ?? DEFAULT_SEGMENT_ROW_LIMIT;
    if (!Number.isInteger(segmentRowLimit) || segmentRowLimit <= 0) {
      throw new Error("Timeline segment row limit must be a positive integer");
    }
    this.baseDir = path.resolve(baseDir);
    this.segmentRowLimit = segmentRowLimit;
    this.faultInjector = options.faultInjector;
  }

  async stageRows(agentId: string, input: AgentTimelineStageInput): Promise<void> {
    await this.enqueueMutation(agentId, async () => {
      const parsedRows = TimelineRowSchema.array().parse(input.rows);
      let state = (await this.readState(agentId)) ?? this.createState(agentId);
      let manifest: GenerationManifest | undefined;

      if (input.mode === "replace" || !state.workingGenerationId) {
        const pendingGenerationId = randomUUID();
        try {
          manifest = await this.createWorkingGeneration(agentId, state, input, pendingGenerationId);
          state = {
            ...state,
            workingGenerationId: manifest.generationId,
          };
          await this.injectFault("working_pointer");
          await this.writeState(agentId, state);
        } catch (error) {
          // Keep a durable working marker even when creation or pointer publication fails.
          // A missing manifest is intentionally reported as incomplete on the next read.
          await this.writeIncompleteBestEffort(
            agentId,
            manifest?.generationId ?? pendingGenerationId,
          );
          await this.writeStateBestEffort(agentId, {
            ...state,
            workingGenerationId: manifest?.generationId ?? pendingGenerationId,
          });
          throw error;
        }
      } else {
        manifest = await this.readGeneration(agentId, state.workingGenerationId);
        if (manifest.epoch !== input.epoch) {
          await this.writeIncompleteBestEffort(agentId, manifest.generationId);
          throw new Error(`Timeline epoch mismatch for '${agentId}'`);
        }
        if (manifest.status === "incomplete") {
          throw new Error(`Timeline generation for '${agentId}' is incomplete`);
        }
      }

      if (!manifest) {
        throw new Error(`Timeline generation for '${agentId}' was not created`);
      }

      try {
        const nextManifest = await this.appendRows(agentId, manifest, parsedRows);
        await this.injectFault("working_manifest");
        await this.writeGeneration(agentId, { ...nextManifest, status: "building" });
      } catch (error) {
        await this.writeIncompleteBestEffort(agentId, manifest.generationId);
        throw error;
      }
    });
  }

  async updateStagedRow(agentId: string, input: AgentTimelineStagedRowUpdate): Promise<void> {
    await this.enqueueMutation(agentId, async () => {
      const state = await this.requireState(agentId);
      if (!state.workingGenerationId) {
        throw new Error(`No working timeline generation exists for '${agentId}'`);
      }
      const manifest = await this.readGeneration(agentId, state.workingGenerationId);
      if (manifest.epoch !== input.epoch) {
        await this.writeIncompleteBestEffort(agentId, manifest.generationId);
        throw new Error(`Timeline epoch mismatch for '${agentId}'`);
      }
      if (manifest.status === "incomplete") {
        throw new Error(`Timeline generation for '${agentId}' is incomplete`);
      }
      try {
        const row = TimelineRowSchema.parse(input.row);
        const segmentIndex = manifest.segments.findIndex(
          (segment) => row.seq >= segment.minSeq && row.seq <= segment.maxSeq,
        );
        if (segmentIndex < 0) {
          throw new Error(`Timeline row ${row.seq} is not staged for '${agentId}'`);
        }
        const existingRows = await this.readSegment(agentId, manifest.segments[segmentIndex]);
        const rowIndex = existingRows.findIndex((candidate) => candidate.seq === row.seq);
        if (rowIndex < 0) {
          throw new Error(`Timeline row ${row.seq} is missing for '${agentId}'`);
        }
        existingRows[rowIndex] = cloneRow(row);
        const replacement = await this.writeSegment(agentId, existingRows);
        const segments = [...manifest.segments];
        segments[segmentIndex] = replacement;
        await this.injectFault("working_manifest");
        await this.writeGeneration(agentId, { ...manifest, status: "building", segments });
      } catch (error) {
        await this.writeIncompleteBestEffort(agentId, manifest.generationId);
        throw error;
      }
    });
  }

  async commit(agentId: string): Promise<CommittedAgentTimelineGeneration> {
    return await this.enqueueMutation(agentId, async () => {
      const state = await this.requireState(agentId);
      if (!state.workingGenerationId) {
        if (!state.activeGenerationId) {
          throw new Error(`No working timeline generation exists for '${agentId}'`);
        }
        const active = await this.readGeneration(agentId, state.activeGenerationId);
        if (active.status !== "complete" || this.isInvalid(state, active.generationId)) {
          throw new Error(`Committed timeline generation for '${agentId}' is invalid`);
        }
        this.validateManifestRanges(active);
        await this.validateSegmentFiles(agentId, active.segments);
        return this.toCommittedCoverage(active, true);
      }

      const working = await this.readGeneration(agentId, state.workingGenerationId);
      if (working.status === "incomplete") {
        throw new Error(`Timeline generation for '${agentId}' is incomplete`);
      }
      try {
        this.validateManifestRanges(working);
        await this.validateSegmentFiles(agentId, working.segments);

        const complete: GenerationManifest = { ...working, status: "complete" };
        await this.injectFault("complete_manifest");
        await this.writeGeneration(agentId, complete);
        const nextState: AgentState = {
          ...state,
          activeGenerationId: complete.generationId,
          workingGenerationId: null,
          invalidGenerationIds: [],
        };
        await this.injectFault("active_pointer");
        await this.writeState(agentId, nextState);
        return this.toCommittedCoverage(complete, true);
      } catch (error) {
        await this.writeIncompleteBestEffort(agentId, working.generationId);
        throw error;
      }
    });
  }

  async markIncomplete(agentId: string): Promise<void> {
    await this.enqueueMutation(agentId, async () => {
      const state = await this.readState(agentId);
      if (!state?.workingGenerationId) return;
      await this.writeIncompleteBestEffort(agentId, state.workingGenerationId);
    });
  }

  async getCoverage(
    agentId: string,
    options?: { expectedRevision?: string },
  ): Promise<AgentTimelineCoverage> {
    let state: AgentState | null;
    try {
      state = await this.readState(agentId);
    } catch {
      // Coverage is an eligibility probe; malformed state must fail closed.
      return { active: null, working: null, eligible: false };
    }
    if (!state) {
      return { active: null, working: null, eligible: false };
    }

    let active: CommittedAgentTimelineGeneration | null = null;
    if (state.activeGenerationId) {
      let manifest: GenerationManifest | null = null;
      try {
        manifest = await this.readGeneration(agentId, state.activeGenerationId);
        if (manifest.status !== "complete") {
          throw new Error(`Active timeline generation for '${agentId}' is not complete`);
        }
        this.validateManifestRanges(manifest);
        await this.validateSegmentFiles(agentId, manifest.segments);
        const valid = !this.isInvalid(state, manifest.generationId);
        active = this.toCommittedCoverage(manifest, valid);
      } catch {
        await this.invalidateActiveGeneration(agentId, state.activeGenerationId).catch(
          () => undefined,
        );
        if (manifest) {
          active = this.toCommittedCoverage(manifest, false);
        }
      }
    }

    const working = await this.readWorkingCoverage(agentId, state);
    return {
      active,
      working,
      eligible:
        active !== null &&
        active.valid &&
        working === null &&
        options?.expectedRevision !== undefined &&
        options.expectedRevision === active.timelineRevision,
    };
  }

  async fetchCommittedPage(
    agentId: string,
    options: AgentTimelineCommittedFetchOptions,
  ): Promise<AgentTimelineFetchResult | null> {
    const limit = normalizeCommittedLimit(options.limit);
    const state = await this.readState(agentId);
    if (!state?.activeGenerationId) {
      return null;
    }
    if (this.isInvalid(state, state.activeGenerationId)) {
      throw new Error(`Committed timeline generation for '${agentId}' is invalid`);
    }
    try {
      const manifest = await this.readGeneration(agentId, state.activeGenerationId);
      if (manifest.status !== "complete") {
        throw new Error(`Active timeline generation for '${agentId}' is not complete`);
      }
      return await this.fetchFromManifest(agentId, manifest, { ...options, limit });
    } catch (error) {
      await this.invalidateActiveGeneration(agentId, state.activeGenerationId).catch(
        () => undefined,
      );
      throw error;
    }
  }

  async flush(agentId?: string): Promise<void> {
    if (agentId) {
      await (this.pendingMutations.get(agentId) ?? Promise.resolve());
      return;
    }
    await Promise.all(Array.from(this.pendingMutations.values()));
  }

  async cleanup(agentId: string): Promise<void> {
    await this.enqueueMutation(agentId, async () => {
      const state = await this.readState(agentId);
      if (!state) return;
      const retainedGenerationIds = new Set(
        [state.activeGenerationId, state.workingGenerationId].filter(
          (generationId): generationId is string => generationId !== null,
        ),
      );
      const retainedSegments = new Set<string>();
      for (const generationId of retainedGenerationIds) {
        const manifest = await this.readGeneration(agentId, generationId);
        for (const segment of manifest.segments) retainedSegments.add(segment.file);
      }

      await this.removeUnreferencedFiles(this.generationsDir(agentId), (name) =>
        retainedGenerationIds.has(path.basename(name, ".json")),
      );
      await this.removeUnreferencedFiles(this.segmentsDir(agentId), (name) =>
        retainedSegments.has(name),
      );
    });
  }

  async deleteAgent(agentId: string): Promise<void> {
    await this.enqueueMutation(agentId, async () => {
      await fs.rm(this.agentDir(agentId), { recursive: true, force: true });
    });
  }

  private async createWorkingGeneration(
    agentId: string,
    state: AgentState,
    input: AgentTimelineStageInput,
    generationId: string,
  ): Promise<GenerationManifest> {
    let segments: SegmentDescriptor[] = [];
    let nextSeq = 1;
    if (input.mode === "append" && state.activeGenerationId) {
      if (this.isInvalid(state, state.activeGenerationId)) {
        throw new Error(`Timeline append for '${agentId}' requires a replacement generation`);
      }
      const active = await this.readGeneration(agentId, state.activeGenerationId);
      if (active.status !== "complete" || active.epoch !== input.epoch) {
        throw new Error(`Timeline append for '${agentId}' requires a replacement generation`);
      }
      segments = active.segments.map((segment) => ({ ...segment }));
      nextSeq = active.nextSeq;
    }

    const manifest: GenerationManifest = {
      version: STORE_VERSION,
      agentId,
      generationId,
      timelineRevision: randomUUID(),
      epoch: input.epoch,
      status: "building",
      nextSeq,
      segments,
    };
    await this.injectFault("working_manifest");
    await this.writeGeneration(agentId, manifest);
    return manifest;
  }

  private async appendRows(
    agentId: string,
    manifest: GenerationManifest,
    rows: readonly AgentTimelineRow[],
  ): Promise<GenerationManifest> {
    if (rows.length === 0) return manifest;
    let expectedSeq = manifest.nextSeq;
    for (const row of rows) {
      if (row.seq !== expectedSeq) {
        throw new Error(
          `Timeline row sequence mismatch for '${agentId}': expected ${expectedSeq}, got ${row.seq}`,
        );
      }
      expectedSeq += 1;
    }

    const segments = manifest.segments.map((segment) => ({ ...segment }));
    let remaining = rows.map(cloneRow);
    const tail = segments.at(-1);
    if (tail && tail.rowCount < this.segmentRowLimit) {
      const existingRows = await this.readSegment(agentId, tail);
      const take = Math.min(this.segmentRowLimit - existingRows.length, remaining.length);
      const combined = [...existingRows, ...remaining.slice(0, take)];
      segments[segments.length - 1] = await this.writeSegment(agentId, combined);
      remaining = remaining.slice(take);
    }
    while (remaining.length > 0) {
      const chunk = remaining.slice(0, this.segmentRowLimit);
      segments.push(await this.writeSegment(agentId, chunk));
      remaining = remaining.slice(chunk.length);
    }
    return { ...manifest, segments, nextSeq: expectedSeq, status: "building" };
  }

  private async writeSegment(
    agentId: string,
    rows: readonly AgentTimelineRow[],
  ): Promise<SegmentDescriptor> {
    const parsedRows = TimelineRowSchema.array().parse(rows);
    assertContiguousRows(parsedRows);
    const content = JSON.stringify(parsedRows, null, 2);
    const checksum = sha256(content);
    const descriptor: SegmentDescriptor = {
      file: `${checksum}.json`,
      minSeq: parsedRows[0].seq,
      maxSeq: parsedRows.at(-1)!.seq,
      rowCount: parsedRows.length,
      byteLength: Buffer.byteLength(content, "utf8"),
      checksum,
    };
    const filePath = this.segmentPath(agentId, descriptor);
    let shouldWrite = true;
    try {
      const existing = await fs.readFile(filePath, "utf8");
      shouldWrite = sha256(existing) !== checksum;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (shouldWrite) {
      await this.injectFault("segment");
      await writeFileAtomic(filePath, content);
    }
    return descriptor;
  }

  private async readSegment(
    agentId: string,
    descriptor: SegmentDescriptor,
  ): Promise<AgentTimelineRow[]> {
    this.validateSegmentDescriptor(descriptor);
    const content = await fs.readFile(this.segmentPath(agentId, descriptor), "utf8");
    if (sha256(content) !== descriptor.checksum) {
      throw new Error(`Timeline segment checksum mismatch: ${descriptor.file}`);
    }
    const rows = TimelineRowSchema.array().parse(JSON.parse(content));
    assertContiguousRows(rows);
    if (
      rows.length !== descriptor.rowCount ||
      rows[0]?.seq !== descriptor.minSeq ||
      rows.at(-1)?.seq !== descriptor.maxSeq
    ) {
      throw new Error(`Timeline segment range mismatch: ${descriptor.file}`);
    }
    return rows.map(cloneRow);
  }

  // Cursor reset, gap detection, and segment selection form one bounded read state machine.
  // eslint-disable-next-line complexity
  private async fetchFromManifest(
    agentId: string,
    manifest: GenerationManifest,
    options: AgentTimelineCommittedFetchOptions,
  ): Promise<AgentTimelineFetchResult> {
    this.validateManifestRanges(manifest);
    const direction = options.direction ?? "tail";
    const cursor = options.cursor;
    const minSeq = manifest.segments[0]?.minSeq ?? 0;
    const maxSeq = manifest.segments.at(-1)?.maxSeq ?? 0;
    const window = { minSeq, maxSeq, nextSeq: manifest.nextSeq };
    const staleCursor = cursor !== undefined && cursor.epoch !== manifest.epoch;
    const gap =
      !staleCursor &&
      direction === "after" &&
      cursor !== undefined &&
      minSeq > 0 &&
      cursor.seq < minSeq - 1;
    const reset = staleCursor || gap;

    if (manifest.segments.length === 0) {
      return {
        epoch: manifest.epoch,
        direction,
        reset,
        staleCursor,
        gap,
        window,
        hasOlder: false,
        hasNewer: false,
        rows: [],
      };
    }

    const effectiveDirection = reset ? "tail" : direction;
    const descriptors = this.selectSegments(
      manifest.segments,
      effectiveDirection,
      reset ? undefined : cursor?.seq,
      options.limit,
    );
    const candidateRows = (
      await Promise.all(descriptors.map((segment) => this.readSegment(agentId, segment)))
    ).flat();
    const rows = selectRows(
      candidateRows,
      effectiveDirection,
      reset ? undefined : cursor?.seq,
      options.limit,
    );
    const first = rows[0];
    const last = rows.at(-1);
    const baseSeq = cursor?.seq ?? 0;
    let hasNewer = false;
    if (!reset && direction === "after") {
      hasNewer = last !== undefined && last.seq < maxSeq;
    } else if (!reset && direction === "before") {
      hasNewer = (cursor?.seq ?? manifest.nextSeq) <= maxSeq;
    }
    return {
      epoch: manifest.epoch,
      direction,
      reset,
      staleCursor,
      gap,
      window,
      hasOlder:
        first !== undefined ? first.seq > minSeq : direction === "after" && baseSeq >= minSeq,
      hasNewer,
      rows,
    };
  }

  private selectSegments(
    segments: readonly SegmentDescriptor[],
    direction: AgentTimelineFetchDirection,
    cursorSeq: number | undefined,
    limit: number,
  ): SegmentDescriptor[] {
    if (direction === "after") {
      const baseSeq = cursorSeq ?? 0;
      const selected: SegmentDescriptor[] = [];
      let count = 0;
      for (const segment of segments) {
        const firstSeq = Math.max(segment.minSeq, baseSeq + 1);
        if (firstSeq > segment.maxSeq) continue;
        selected.push(segment);
        count += segment.maxSeq - firstSeq + 1;
        if (count >= limit) break;
      }
      return selected;
    }

    const beforeSeq = direction === "before" ? (cursorSeq ?? Number.POSITIVE_INFINITY) : Infinity;
    const selected: SegmentDescriptor[] = [];
    let count = 0;
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const segment = segments[index];
      const lastSeq = Math.min(segment.maxSeq, beforeSeq - 1);
      if (lastSeq < segment.minSeq) continue;
      selected.unshift(segment);
      count += lastSeq - segment.minSeq + 1;
      if (count >= limit) break;
    }
    return selected;
  }

  private async readWorkingCoverage(
    agentId: string,
    state: AgentState,
  ): Promise<WorkingAgentTimelineGeneration | null> {
    if (!state.workingGenerationId) return null;
    try {
      const manifest = await this.readGeneration(agentId, state.workingGenerationId);
      return {
        generationId: manifest.generationId,
        epoch: manifest.epoch,
        status: manifest.status === "incomplete" ? "incomplete" : "building",
      };
    } catch {
      return {
        generationId: state.workingGenerationId,
        epoch: "",
        status: "incomplete",
      };
    }
  }

  private toCommittedCoverage(
    manifest: GenerationManifest,
    valid: boolean,
  ): CommittedAgentTimelineGeneration {
    return {
      generationId: manifest.generationId,
      timelineRevision: manifest.timelineRevision,
      epoch: manifest.epoch,
      window: {
        minSeq: manifest.segments[0]?.minSeq ?? 0,
        maxSeq: manifest.segments.at(-1)?.maxSeq ?? 0,
        nextSeq: manifest.nextSeq,
      },
      valid,
    };
  }

  private validateManifestRanges(manifest: GenerationManifest): void {
    let expectedSeq = 1;
    for (const segment of manifest.segments) {
      this.validateSegmentDescriptor(segment);
      if (
        segment.minSeq !== expectedSeq ||
        segment.rowCount !== segment.maxSeq - segment.minSeq + 1
      ) {
        throw new Error(`Timeline generation '${manifest.generationId}' has non-contiguous ranges`);
      }
      expectedSeq = segment.maxSeq + 1;
    }
    if (manifest.nextSeq !== expectedSeq) {
      throw new Error(`Timeline generation '${manifest.generationId}' has an invalid nextSeq`);
    }
  }

  private validateSegmentDescriptor(descriptor: SegmentDescriptor): void {
    if (!SHA256_RE.test(descriptor.checksum) || descriptor.file !== `${descriptor.checksum}.json`) {
      throw new Error("Timeline segment descriptor contains an unsafe file name");
    }
  }

  private async validateSegmentFiles(
    agentId: string,
    descriptors: readonly SegmentDescriptor[],
  ): Promise<void> {
    await Promise.all(
      descriptors.map(async (descriptor) => {
        const stat = await fs.stat(this.segmentPath(agentId, descriptor));
        if (!stat.isFile() || stat.size !== descriptor.byteLength) {
          throw new Error(`Timeline segment size mismatch: ${descriptor.file}`);
        }
        await this.readSegment(agentId, descriptor);
      }),
    );
  }

  private async writeStateBestEffort(agentId: string, state: AgentState): Promise<void> {
    try {
      await this.writeState(agentId, state);
    } catch {
      // The original failure remains authoritative; reads still fail closed without this marker.
    }
  }

  private async invalidateActiveGeneration(agentId: string, generationId: string): Promise<void> {
    await this.enqueueMutation(agentId, async () => {
      const state = await this.readState(agentId);
      if (
        !state ||
        state.activeGenerationId !== generationId ||
        this.isInvalid(state, generationId)
      ) {
        return;
      }
      await this.injectFault("invalidate_pointer");
      await this.writeState(agentId, {
        ...state,
        invalidGenerationIds: [...state.invalidGenerationIds, generationId],
      });
    });
  }

  private async writeIncompleteBestEffort(agentId: string, generationId: string): Promise<void> {
    try {
      const manifest = await this.readGeneration(agentId, generationId);
      await this.writeGeneration(agentId, { ...manifest, status: "incomplete" });
    } catch {
      // The working pointer itself is enough to keep eligibility fail closed.
    }
  }

  private async removeUnreferencedFiles(
    directory: string,
    retain: (name: string) => boolean,
  ): Promise<void> {
    let names: string[];
    try {
      names = await fs.readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    await Promise.all(
      names
        .filter((name) => name.endsWith(".json") && !retain(name))
        .map((name) => fs.rm(path.join(directory, name), { force: true })),
    );
  }

  private async readState(agentId: string): Promise<AgentState | null> {
    try {
      const value = JSON.parse(await fs.readFile(this.statePath(agentId), "utf8"));
      const state = AgentStateSchema.parse(value);
      if (state.agentId !== agentId) throw new Error("Timeline state agent id mismatch");
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async requireState(agentId: string): Promise<AgentState> {
    const state = await this.readState(agentId);
    if (!state) throw new Error(`No timeline state exists for '${agentId}'`);
    return state;
  }

  private createState(agentId: string): AgentState {
    return {
      version: STORE_VERSION,
      agentId,
      activeGenerationId: null,
      workingGenerationId: null,
      invalidGenerationIds: [],
    };
  }

  private async writeState(agentId: string, state: AgentState): Promise<void> {
    await writeJsonFileAtomic(this.statePath(agentId), AgentStateSchema.parse(state));
  }

  private async readGeneration(agentId: string, generationId: string): Promise<GenerationManifest> {
    const parsedId = z.string().uuid().parse(generationId);
    const value = JSON.parse(
      await fs.readFile(path.join(this.generationsDir(agentId), `${parsedId}.json`), "utf8"),
    );
    const manifest = GenerationManifestSchema.parse(value);
    if (manifest.agentId !== agentId || manifest.generationId !== parsedId) {
      throw new Error("Timeline generation identity mismatch");
    }
    return manifest;
  }

  private async writeGeneration(agentId: string, manifest: GenerationManifest): Promise<void> {
    const parsed = GenerationManifestSchema.parse(manifest);
    if (parsed.agentId !== agentId) throw new Error("Timeline generation agent id mismatch");
    await writeJsonFileAtomic(
      path.join(this.generationsDir(agentId), `${parsed.generationId}.json`),
      parsed,
    );
  }

  private isInvalid(state: AgentState, generationId: string): boolean {
    return state.invalidGenerationIds.includes(generationId);
  }

  private statePath(agentId: string): string {
    return path.join(this.agentDir(agentId), "state.json");
  }

  private generationsDir(agentId: string): string {
    return path.join(this.agentDir(agentId), "generations");
  }

  private segmentsDir(agentId: string): string {
    return path.join(this.agentDir(agentId), "segments");
  }

  private segmentPath(agentId: string, descriptor: SegmentDescriptor): string {
    this.validateSegmentDescriptor(descriptor);
    return path.join(this.segmentsDir(agentId), descriptor.file);
  }

  private agentDir(agentId: string): string {
    const key = sha256(agentId);
    if (!SHA256_RE.test(key)) throw new Error("Invalid timeline agent directory key");
    const directory = path.resolve(this.baseDir, key);
    if (path.dirname(directory) !== this.baseDir) {
      throw new Error("Timeline agent directory escaped the store root");
    }
    return directory;
  }

  private async injectFault(point: FileAgentTimelineStoreFaultPoint): Promise<void> {
    await this.faultInjector?.(point);
  }

  private enqueueMutation<T>(agentId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pendingMutations.get(agentId) ?? Promise.resolve();
    const run = previous.then(operation);
    const tracked = run.then(
      () => undefined,
      () => undefined,
    );
    this.pendingMutations.set(agentId, tracked);
    void tracked.finally(() => {
      if (this.pendingMutations.get(agentId) === tracked) {
        this.pendingMutations.delete(agentId);
      }
    });
    return run;
  }
}

function selectRows(
  rows: readonly AgentTimelineRow[],
  direction: AgentTimelineFetchDirection,
  cursorSeq: number | undefined,
  limit: number,
): AgentTimelineRow[] {
  if (direction === "after") {
    const baseSeq = cursorSeq ?? 0;
    return rows
      .filter((row) => row.seq > baseSeq)
      .slice(0, limit)
      .map(cloneRow);
  }
  if (direction === "before") {
    const beforeSeq = cursorSeq ?? Number.POSITIVE_INFINITY;
    return rows
      .filter((row) => row.seq < beforeSeq)
      .slice(-limit)
      .map(cloneRow);
  }
  return rows.slice(-limit).map(cloneRow);
}

function normalizeCommittedLimit(limit: number): number {
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit <= 0) {
    throw new Error("Durable timeline fetch limit must be a positive integer");
  }
  return limit;
}

function assertContiguousRows(rows: readonly AgentTimelineRow[]): void {
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index].seq !== rows[index - 1].seq + 1) {
      throw new Error("Timeline segment rows must be contiguous");
    }
  }
}

function cloneRow(row: AgentTimelineRow): AgentTimelineRow {
  return { ...row };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
