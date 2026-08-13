import { randomUUID } from "node:crypto";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import type {
  AgentTimelineCommittedFetchOptions,
  AgentTimelineCoverage,
  AgentTimelineFetchOptions,
  AgentTimelineFetchResult,
  AgentTimelineRow,
  AgentTimelineStageInput,
  AgentTimelineStagedRowUpdate,
  AgentTimelineStore,
  CommittedAgentTimelineGeneration,
  WorkingAgentTimelineGeneration,
} from "./agent-timeline-store-types.js";

export interface SeedAgentTimelineOptions {
  items?: readonly AgentTimelineItem[];
  rows?: readonly AgentTimelineRow[];
  epoch?: string;
  nextSeq?: number;
  timestamp?: string;
}

interface AgentTimelineState {
  epoch: string;
  rows: AgentTimelineRow[];
  nextSeq: number;
}

const DEFAULT_TIMELINE_FETCH_LIMIT = 200;

function cloneRow(row: AgentTimelineRow): AgentTimelineRow {
  return { ...row };
}

interface FetchContext {
  state: AgentTimelineState;
  direction: NonNullable<AgentTimelineFetchOptions["direction"]>;
  limit: number;
  selectAll: boolean;
  cursor: AgentTimelineFetchOptions["cursor"];
  minSeq: number;
  maxSeq: number;
  window: { minSeq: number; maxSeq: number; nextSeq: number };
}

function fetchTail(ctx: FetchContext): AgentTimelineFetchResult {
  const { state, direction, limit, selectAll, minSeq, window } = ctx;
  const selected =
    selectAll || limit >= state.rows.length
      ? state.rows
      : state.rows.slice(state.rows.length - limit);
  return {
    epoch: state.epoch,
    direction,
    reset: false,
    staleCursor: false,
    gap: false,
    window,
    hasOlder: selected.length > 0 && selected[0].seq > minSeq,
    hasNewer: false,
    rows: selected.map(cloneRow),
  };
}

function fetchAfter(ctx: FetchContext): AgentTimelineFetchResult {
  const { state, direction, limit, selectAll, cursor, minSeq, maxSeq, window } = ctx;
  const baseSeq = cursor?.seq ?? 0;
  const startIdx = state.rows.findIndex((row) => row.seq > baseSeq);
  if (startIdx < 0) {
    return {
      epoch: state.epoch,
      direction,
      reset: false,
      staleCursor: false,
      gap: false,
      window,
      hasOlder: baseSeq >= minSeq,
      hasNewer: false,
      rows: [],
    };
  }

  const selected = selectAll
    ? state.rows.slice(startIdx)
    : state.rows.slice(startIdx, startIdx + limit);
  const lastSelected = selected[selected.length - 1];
  return {
    epoch: state.epoch,
    direction,
    reset: false,
    staleCursor: false,
    gap: false,
    window,
    hasOlder: selected[0].seq > minSeq,
    hasNewer: lastSelected !== null && lastSelected !== undefined && lastSelected.seq < maxSeq,
    rows: selected.map(cloneRow),
  };
}

function fetchBefore(ctx: FetchContext): AgentTimelineFetchResult {
  const { state, direction, limit, selectAll, cursor, minSeq, window } = ctx;
  const beforeSeq = cursor?.seq ?? state.nextSeq;
  const endExclusive = state.rows.findIndex((row) => row.seq >= beforeSeq);
  const boundedRows = endExclusive < 0 ? state.rows : state.rows.slice(0, endExclusive);
  const selected =
    selectAll || limit >= boundedRows.length
      ? boundedRows
      : boundedRows.slice(boundedRows.length - limit);
  return {
    epoch: state.epoch,
    direction,
    reset: false,
    staleCursor: false,
    gap: false,
    window,
    hasOlder: selected.length > 0 && selected[0].seq > minSeq,
    hasNewer: endExclusive >= 0,
    rows: selected.map(cloneRow),
  };
}

function fetchReset(
  ctx: FetchContext,
  flags: { staleCursor: boolean; gap: boolean },
): AgentTimelineFetchResult {
  const { state, direction, limit, selectAll, minSeq, window } = ctx;
  const rows =
    selectAll || limit >= state.rows.length
      ? state.rows.map(cloneRow)
      : state.rows.slice(state.rows.length - limit).map(cloneRow);
  return {
    epoch: state.epoch,
    direction,
    reset: true,
    staleCursor: flags.staleCursor,
    gap: flags.gap,
    window,
    hasOlder: rows.length > 0 && rows[0].seq > minSeq,
    hasNewer: false,
    rows,
  };
}

export class InMemoryAgentTimelineStore {
  private readonly states = new Map<string, AgentTimelineState>();

  has(agentId: string): boolean {
    return this.states.has(agentId);
  }

  initialize(agentId: string, options?: SeedAgentTimelineOptions): void {
    const timestamp = options?.timestamp ?? new Date().toISOString();
    const rows = options?.rows?.length
      ? options.rows.map(cloneRow)
      : this.buildRowsFromItems(options?.items ?? [], options?.nextSeq ?? 1, timestamp);
    const nextSeq = options?.nextSeq ?? (rows.length ? rows[rows.length - 1].seq + 1 : 1);
    this.states.set(agentId, {
      epoch: options?.epoch ?? randomUUID(),
      rows,
      nextSeq,
    });
  }

  delete(agentId: string): void {
    this.states.delete(agentId);
  }

  getItems(agentId: string): AgentTimelineItem[] {
    return this.requireState(agentId).rows.map((row) => row.item);
  }

  getRows(agentId: string): AgentTimelineRow[] {
    return this.requireState(agentId).rows.map(cloneRow);
  }

  getSubmittedUserMessage(agentId: string, clientMessageId: string): AgentTimelineRow | null {
    const row = this.requireState(agentId).rows.find(
      (candidate) =>
        candidate.item.type === "user_message" &&
        candidate.item.clientMessageId === clientMessageId,
    );
    return row ? cloneRow(row) : null;
  }

  enrichSubmittedUserMessage(
    agentId: string,
    clientMessageId: string,
    providerMessageId: string,
  ): AgentTimelineRow | null {
    const state = this.requireState(agentId);
    const index = state.rows.findIndex(
      (candidate) =>
        candidate.item.type === "user_message" &&
        candidate.item.clientMessageId === clientMessageId,
    );
    const row = state.rows[index];
    if (!row || row.item.type !== "user_message") {
      return null;
    }
    const enriched: AgentTimelineRow = { ...row, providerMessageId };
    state.rows[index] = enriched;
    return cloneRow(enriched);
  }

  getEpoch(agentId: string): string {
    return this.requireState(agentId).epoch;
  }

  fetch(agentId: string, options?: AgentTimelineFetchOptions): AgentTimelineFetchResult {
    const state = this.requireState(agentId);
    const direction = options?.direction ?? "tail";
    const requestedLimit = options?.limit;
    const limit =
      requestedLimit === undefined
        ? DEFAULT_TIMELINE_FETCH_LIMIT
        : Math.max(0, Math.floor(requestedLimit));
    const cursor = options?.cursor;
    const minSeq = state.rows.length ? state.rows[0].seq : 0;
    const maxSeq = state.rows.length ? state.rows[state.rows.length - 1].seq : 0;
    const selectAll = limit === 0;

    const window = {
      minSeq,
      maxSeq,
      nextSeq: state.nextSeq,
    };

    const ctx: FetchContext = {
      state,
      direction,
      limit,
      selectAll,
      cursor,
      minSeq,
      maxSeq,
      window,
    };

    if (cursor && typeof cursor.epoch === "string" && cursor.epoch !== state.epoch) {
      return fetchReset(ctx, { staleCursor: true, gap: false });
    }

    if (direction === "after" && cursor && state.rows.length > 0 && cursor.seq < minSeq - 1) {
      return fetchReset(ctx, { staleCursor: false, gap: true });
    }

    if (state.rows.length === 0) {
      return {
        epoch: state.epoch,
        direction,
        reset: false,
        staleCursor: false,
        gap: false,
        window,
        hasOlder: false,
        hasNewer: false,
        rows: [],
      };
    }

    if (direction === "tail") {
      return fetchTail(ctx);
    }
    if (direction === "after") {
      return fetchAfter(ctx);
    }
    return fetchBefore(ctx);
  }

  append(
    agentId: string,
    item: AgentTimelineItem,
    options?: { timestamp?: string; providerMessageId?: string },
  ): AgentTimelineRow {
    const state = this.requireState(agentId);
    const row: AgentTimelineRow = {
      seq: state.nextSeq,
      timestamp: options?.timestamp ?? new Date().toISOString(),
      item,
      ...(options?.providerMessageId ? { providerMessageId: options.providerMessageId } : {}),
    };
    state.nextSeq += 1;
    state.rows.push(row);
    return cloneRow(row);
  }

  getLastItem(agentId: string): AgentTimelineItem | null {
    const state = this.requireState(agentId);
    return state.rows[state.rows.length - 1]?.item ?? null;
  }

  getLastAssistantMessage(agentId: string): string | null {
    const rows = this.requireState(agentId).rows;
    const chunks: string[] = [];
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const item = rows[i].item;
      if (item.type !== "assistant_message") {
        if (chunks.length > 0) {
          break;
        }
        continue;
      }
      chunks.push(item.text);
    }

    if (chunks.length === 0) {
      return null;
    }

    return chunks.toReversed().join("");
  }

  private requireState(agentId: string): AgentTimelineState {
    const state = this.states.get(agentId);
    if (!state) {
      throw new Error(`Unknown agent '${agentId}'`);
    }
    return state;
  }

  private buildRowsFromItems(
    items: readonly AgentTimelineItem[],
    startSeq: number,
    timestamp: string,
  ): AgentTimelineRow[] {
    let nextSeq = startSeq;
    return items.map((item) => {
      const row: AgentTimelineRow = {
        seq: nextSeq,
        timestamp,
        item,
      };
      nextSeq += 1;
      return row;
    });
  }
}

interface InMemoryDurableGeneration {
  generationId: string;
  timelineRevision: string;
  epoch: string;
  rows: AgentTimelineRow[];
  nextSeq: number;
  status: "building" | "incomplete" | "complete";
  valid: boolean;
}

interface InMemoryDurableState {
  active: InMemoryDurableGeneration | null;
  working: InMemoryDurableGeneration | null;
}

/** In-memory implementation of the durable generation state machine used by tests. */
export class InMemoryDurableAgentTimelineStore implements AgentTimelineStore {
  private readonly states = new Map<string, InMemoryDurableState>();

  async stageRows(agentId: string, input: AgentTimelineStageInput): Promise<void> {
    const state = this.getOrCreateState(agentId);
    let working = state.working;
    if (input.mode === "replace") {
      working = this.createGeneration(input.epoch);
      state.working = working;
    } else if (!working) {
      if (state.active) {
        if (!state.active.valid || state.active.epoch !== input.epoch) {
          throw new Error(`Timeline append for '${agentId}' requires a replacement generation`);
        }
        working = {
          ...state.active,
          generationId: randomUUID(),
          timelineRevision: randomUUID(),
          rows: state.active.rows.map(cloneRow),
          status: "building",
        };
      } else {
        working = this.createGeneration(input.epoch);
      }
      state.working = working;
    }

    if (working.epoch !== input.epoch) {
      throw new Error(`Timeline epoch mismatch for '${agentId}'`);
    }
    if (working.status === "incomplete") {
      throw new Error(`Timeline generation for '${agentId}' is incomplete`);
    }
    try {
      this.appendRows(agentId, working, input.rows);
    } catch (error) {
      working.status = "incomplete";
      throw error;
    }
  }

  async updateStagedRow(agentId: string, input: AgentTimelineStagedRowUpdate): Promise<void> {
    const working = this.states.get(agentId)?.working;
    if (!working || working.epoch !== input.epoch) {
      if (working) working.status = "incomplete";
      throw new Error(`No matching working timeline generation for '${agentId}'`);
    }
    if (working.status === "incomplete") {
      throw new Error(`Timeline generation for '${agentId}' is incomplete`);
    }
    const index = working.rows.findIndex((row) => row.seq === input.row.seq);
    if (index < 0) {
      working.status = "incomplete";
      throw new Error(`Timeline row ${input.row.seq} is not staged for '${agentId}'`);
    }
    if (input.row.seq !== working.rows[index]?.seq) {
      working.status = "incomplete";
      throw new Error(`Timeline row ${input.row.seq} sequence mismatch for '${agentId}'`);
    }
    working.rows[index] = cloneRow(input.row);
    working.status = "building";
  }

  async commit(agentId: string): Promise<CommittedAgentTimelineGeneration> {
    const state = this.states.get(agentId);
    if (!state) {
      throw new Error(`No timeline generation exists for '${agentId}'`);
    }
    if (!state.working) {
      if (!state.active) {
        throw new Error(`No working timeline generation exists for '${agentId}'`);
      }
      return this.toCommittedCoverage(state.active);
    }
    if (state.working.status === "incomplete") {
      throw new Error(`Timeline generation for '${agentId}' is incomplete`);
    }
    try {
      assertDurableRows(state.working.rows, 1);
      if (state.working.nextSeq !== (state.working.rows.at(-1)?.seq ?? 0) + 1) {
        throw new Error(`Timeline generation for '${agentId}' has an invalid nextSeq`);
      }
    } catch (error) {
      state.working.status = "incomplete";
      throw error;
    }
    state.working.status = "complete";
    state.working.valid = true;
    state.active = state.working;
    state.working = null;
    return this.toCommittedCoverage(state.active);
  }

  async markIncomplete(agentId: string): Promise<void> {
    const working = this.states.get(agentId)?.working;
    if (working) {
      working.status = "incomplete";
    }
  }

  async getCoverage(
    agentId: string,
    options?: { expectedRevision?: string },
  ): Promise<AgentTimelineCoverage> {
    const state = this.states.get(agentId);
    const active = state?.active ? this.toCommittedCoverage(state.active) : null;
    const working = state?.working ? this.toWorkingCoverage(state.working) : null;
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
    const active = this.states.get(agentId)?.active;
    if (!active) {
      return null;
    }
    if (!active.valid) {
      throw new Error(`Committed timeline generation for '${agentId}' is invalid`);
    }
    const limit = normalizeCommittedLimit(options.limit);
    const rows = active.rows;
    const minSeq = rows[0]?.seq ?? 0;
    const maxSeq = rows.at(-1)?.seq ?? 0;
    const ctx: FetchContext = {
      state: { epoch: active.epoch, rows, nextSeq: active.nextSeq },
      direction: options.direction ?? "tail",
      limit,
      selectAll: false,
      cursor: options.cursor,
      minSeq,
      maxSeq,
      window: { minSeq, maxSeq, nextSeq: active.nextSeq },
    };
    if (ctx.cursor?.epoch !== undefined && ctx.cursor.epoch !== active.epoch) {
      return fetchReset(ctx, { staleCursor: true, gap: false });
    }
    if (ctx.direction === "after" && ctx.cursor && rows.length > 0 && ctx.cursor.seq < minSeq - 1) {
      return fetchReset(ctx, { staleCursor: false, gap: true });
    }
    if (rows.length === 0) {
      return {
        epoch: active.epoch,
        direction: ctx.direction,
        reset: false,
        staleCursor: false,
        gap: false,
        window: ctx.window,
        hasOlder: false,
        hasNewer: false,
        rows: [],
      };
    }
    if (ctx.direction === "tail") return fetchTail(ctx);
    if (ctx.direction === "after") return fetchAfter(ctx);
    return fetchBefore(ctx);
  }

  async flush(_agentId?: string): Promise<void> {}

  async cleanup(_agentId: string): Promise<void> {}

  async deleteAgent(agentId: string): Promise<void> {
    this.states.delete(agentId);
  }

  private getOrCreateState(agentId: string): InMemoryDurableState {
    const existing = this.states.get(agentId);
    if (existing) return existing;
    const state: InMemoryDurableState = { active: null, working: null };
    this.states.set(agentId, state);
    return state;
  }

  private createGeneration(epoch: string): InMemoryDurableGeneration {
    return {
      generationId: randomUUID(),
      timelineRevision: randomUUID(),
      epoch,
      rows: [],
      nextSeq: 1,
      status: "building",
      valid: true,
    };
  }

  private appendRows(
    agentId: string,
    generation: InMemoryDurableGeneration,
    rows: readonly AgentTimelineRow[],
  ): void {
    let expectedSeq = generation.nextSeq;
    for (const row of rows) {
      if (row.seq !== expectedSeq) {
        throw new Error(
          `Timeline row sequence mismatch for '${agentId}': expected ${expectedSeq}, got ${row.seq}`,
        );
      }
      expectedSeq += 1;
    }
    for (const row of rows) {
      generation.rows.push(cloneRow(row));
    }
    generation.nextSeq = expectedSeq;
    generation.status = "building";
  }

  private toCommittedCoverage(
    generation: InMemoryDurableGeneration,
  ): CommittedAgentTimelineGeneration {
    return {
      generationId: generation.generationId,
      timelineRevision: generation.timelineRevision,
      epoch: generation.epoch,
      window: {
        minSeq: generation.rows[0]?.seq ?? 0,
        maxSeq: generation.rows.at(-1)?.seq ?? 0,
        nextSeq: generation.nextSeq,
      },
      valid: generation.valid,
    };
  }

  private toWorkingCoverage(generation: InMemoryDurableGeneration): WorkingAgentTimelineGeneration {
    return {
      generationId: generation.generationId,
      epoch: generation.epoch,
      status: generation.status === "incomplete" ? "incomplete" : "building",
    };
  }
}

function normalizeCommittedLimit(limit: number): number {
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit <= 0) {
    throw new Error("Durable timeline fetch limit must be a positive integer");
  }
  return limit;
}

function assertDurableRows(rows: readonly AgentTimelineRow[], firstSeq: number): void {
  let expectedSeq = firstSeq;
  for (const row of rows) {
    if (!Number.isInteger(row.seq) || row.seq !== expectedSeq) {
      throw new Error("Durable timeline rows must be contiguous");
    }
    expectedSeq += 1;
  }
}
