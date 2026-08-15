import { createHash, randomUUID } from "node:crypto";
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import { getAgentStatusPriority } from "@getpaseo/protocol/agent-state-bucket";
import { z } from "zod";
import type { Logger } from "pino";

import { writeFileAtomic, writeJsonFileAtomic } from "../atomic-file.js";
import { AgentFeatureSchema, AgentStatusSchema } from "../messages.js";
import { resolveEffectiveThinkingOptionId, toStoredAgentRecord } from "./agent-projections.js";
import type { ManagedAgent } from "./agent-manager.js";
import type { AgentSessionConfig } from "./agent-sdk-types.js";
import { AgentOwnerSchema, daemonExecutionKey, type DaemonAgentOwner } from "./agent-owner.js";
import { HubExecutionContractError, type HubExecutionContract } from "./agent-config-compat.js";

const HUB_EXECUTION_CONTRACT_SCHEMA = z
  .object({
    protocolVersion: z.literal(1),
    executionFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    policyFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    applicationState: z.enum(["prepared", "applied"]),
  })
  .strict();

const CATALOG_VERSION = 1 as const;
const CONTROL_DIR_NAME = ".paseo-agent-storage";
const CATALOG_FILE_NAME = "catalog.json";
const MUTATION_FILE_NAME = "mutation.json";
const STAGING_DIR_NAME = "staging";
const QUARANTINE_DIR_NAME = "quarantine";

const SERIALIZABLE_CONFIG_SCHEMA = z
  .object({
    modeId: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    thinkingOptionId: z.string().nullable().optional(),
    featureValues: z.record(z.string(), z.unknown()).nullable().optional(),
    // COMPAT(agentSessionConfigV1): retain beta.5 legacy fields through 2027-08-10.
    approvalPolicy: z.string().nullable().optional(),
    sandboxMode: z.string().nullable().optional(),
    networkAccess: z.boolean().nullable().optional(),
    webSearch: z.boolean().nullable().optional(),
    extra: z.record(z.string(), z.any()).nullable().optional(),
    providerOptions: z.record(z.string(), z.json()).nullable().optional(),
    toolPolicy: z
      .object({
        preapproved: z.array(
          z.object({ kind: z.literal("mcp"), server: z.string(), tool: z.string() }).strict(),
        ),
      })
      .strict()
      .nullable()
      .optional(),
    systemPrompt: z.string().nullable().optional(),
    mcpServers: z.record(z.string(), z.any()).nullable().optional(),
  })
  .nullable()
  .optional();

const PERSISTENCE_HANDLE_SCHEMA = z
  .object({
    provider: z.string(),
    sessionId: z.string(),
    nativeHandle: z.any().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  })
  .nullable()
  .optional();

const STORED_AGENT_SCHEMA = z.object({
  id: z.string(),
  provider: z.string(),
  cwd: z.string(),
  workspaceId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastActivityAt: z.string().optional(),
  lastUserMessageAt: z.string().nullable().optional(),
  lastMessageAt: z.string().nullable().optional(),
  lastReplayableUserMessageId: z.string().min(1).optional(),
  title: z.string().nullable().optional(),
  labels: z.record(z.string(), z.string()).default({}),
  lastStatus: AgentStatusSchema.default("closed"),
  lastModeId: z.string().nullable().optional(),
  config: SERIALIZABLE_CONFIG_SCHEMA,
  runtimeInfo: z
    .object({
      provider: z.string(),
      sessionId: z.string().nullable(),
      model: z.string().nullable().optional(),
      thinkingOptionId: z.string().nullable().optional(),
      modeId: z.string().nullable().optional(),
      extra: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  features: z.array(AgentFeatureSchema).optional(),
  persistence: PERSISTENCE_HANDLE_SCHEMA,
  lastError: z.string().nullable().optional(),
  requiresAttention: z.boolean().optional(),
  attentionReason: z.enum(["finished", "error", "permission"]).nullable().optional(),
  attentionTimestamp: z.string().nullable().optional(),
  internal: z.boolean().optional(),
  archivedAt: z.string().nullable().optional(),
  timelineRevision: z.string().uuid().optional(),
  owner: AgentOwnerSchema.optional(),
  // Keep malformed values visible so load/replay can isolate them fail-closed.
  hubExecutionContract: z.unknown().optional(),
});

const RECORD_REVISION_SCHEMA = z.string().regex(/^[a-f0-9]{64}$/);

const PERSISTENCE_IDENTITY_SCHEMA = z.object({
  provider: z.string(),
  sessionId: z.string(),
  nativeHandle: z.string().optional(),
});

const AGENT_METADATA_ENTRY_SCHEMA = z.object({
  id: z.string(),
  recordPath: z.string().min(1),
  recordRevision: RECORD_REVISION_SCHEMA,
  provider: z.string(),
  cwd: z.string(),
  workspaceId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastActivityAt: z.string().optional(),
  lastUserMessageAt: z.string().nullable().default(null),
  lastMessageAt: z.string().nullable().default(null),
  title: z.string().nullable().default(null),
  labels: z.record(z.string(), z.string()).default({}),
  lastStatus: AgentStatusSchema.default("closed"),
  lastModeId: z.string().nullable().default(null),
  effectiveThinkingOptionId: z.string().nullable().default(null),
  requiresAttention: z.boolean().default(false),
  attentionReason: z.enum(["finished", "error", "permission"]).nullable().default(null),
  attentionTimestamp: z.string().nullable().default(null),
  internal: z.boolean().default(false),
  archivedAt: z.string().nullable().default(null),
  timelineRevision: z.string().uuid().optional(),
  owner: AgentOwnerSchema.optional(),
  persistenceIdentity: PERSISTENCE_IDENTITY_SCHEMA.optional(),
  preparedCommitId: z.string().uuid().optional(),
});

const AGENT_METADATA_CATALOG_SCHEMA = z.object({
  version: z.literal(CATALOG_VERSION),
  generation: z.number().int().nonnegative(),
  entries: z.array(AGENT_METADATA_ENTRY_SCHEMA),
});

const AGENT_STORAGE_MUTATION_SCHEMA = z.object({
  version: z.literal(CATALOG_VERSION),
  operationId: z.string().uuid(),
  operation: z.enum(["upsert", "remove", "prepared_commit", "rebuild"]),
  baseGeneration: z.number().int().nonnegative(),
  nextGeneration: z.number().int().nonnegative(),
  affectedIds: z.array(z.string()),
  oldPaths: z.array(z.string()),
  newPaths: z.array(z.string()),
  recordRevision: RECORD_REVISION_SCHEMA.optional(),
  preparedId: z.string().uuid().optional(),
  createdAt: z.string(),
});

const PREPARED_EXPECTATION_SCHEMA = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("absent") }),
  z.object({ kind: z.literal("revision"), recordRevision: RECORD_REVISION_SCHEMA }),
]);

const PREPARED_RECORD_SCHEMA = z.object({
  version: z.literal(CATALOG_VERSION),
  preparedId: z.string().uuid(),
  recordRevision: RECORD_REVISION_SCHEMA,
  expectation: PREPARED_EXPECTATION_SCHEMA,
  record: STORED_AGENT_SCHEMA,
});

const METADATA_SORT_SCHEMA = z.object({
  key: z.enum(["status_priority", "created_at", "updated_at", "title"]),
  direction: z.enum(["asc", "desc"]),
});

const METADATA_CURSOR_SCHEMA = z.object({
  version: z.literal(CATALOG_VERSION),
  generation: z.number().int().nonnegative(),
  sort: z.array(METADATA_SORT_SCHEMA),
  values: z.array(z.union([z.string(), z.number(), z.null()])),
  id: z.string(),
});

export type SerializableAgentConfig = Pick<
  AgentSessionConfig,
  | "modeId"
  | "model"
  | "thinkingOptionId"
  | "featureValues"
  | "approvalPolicy"
  | "sandboxMode"
  | "networkAccess"
  | "webSearch"
  | "extra"
  | "providerOptions"
  | "toolPolicy"
  | "systemPrompt"
  | "mcpServers"
>;

export type StoredAgentRecord = z.infer<typeof STORED_AGENT_SCHEMA>;
export type AgentMetadataEntry = z.infer<typeof AGENT_METADATA_ENTRY_SCHEMA>;
export type AgentMetadataSort = z.infer<typeof METADATA_SORT_SCHEMA>;
export type PreparedRecordExpectation = z.infer<typeof PREPARED_EXPECTATION_SCHEMA>;

export interface AgentMetadataFilter {
  includeArchived?: boolean;
  includeInternal?: boolean;
  labels?: Record<string, string>;
  workspaceId?: string;
  statuses?: StoredAgentRecord["lastStatus"][];
  requiresAttention?: boolean;
  thinkingOptionId?: string | null;
}

export interface AgentMetadataPage {
  entries: AgentMetadataEntry[];
  generation: number;
  nextCursor: string | null;
  hasMore: boolean;
}

export interface AgentMetadataSnapshot {
  entries: AgentMetadataEntry[];
  generation: number;
}

export interface MaterializedAgentRecords {
  records: Array<StoredAgentRecord | null>;
  generation: number;
  retryRequired: boolean;
}

export interface PreparedAgentRecord {
  preparedId: string;
  agentId: string;
  recordRevision: string;
}

export type AgentStorageFaultPoint =
  | "mutation_marker"
  | "record_write"
  | "catalog_write"
  | "committed_cleanup";

export interface AgentStorageOptions {
  faultInjector?: (point: AgentStorageFaultPoint) => void | Promise<void>;
}

export interface AgentStorageUpsertOptions {
  expectedRecordRevision?: string;
}

interface AgentMetadataCatalog {
  version: typeof CATALOG_VERSION;
  generation: number;
  entries: AgentMetadataEntry[];
}

interface AgentStorageMutation {
  version: typeof CATALOG_VERSION;
  operationId: string;
  operation: "upsert" | "remove" | "prepared_commit" | "rebuild";
  baseGeneration: number;
  nextGeneration: number;
  affectedIds: string[];
  oldPaths: string[];
  newPaths: string[];
  recordRevision?: string;
  preparedId?: string;
  createdAt: string;
}

interface ScannedRecord {
  record: StoredAgentRecord;
  filePath: string;
  relativePath: string;
  recordRevision: string;
}

export function parseStoredAgentRecord(value: unknown): StoredAgentRecord {
  return STORED_AGENT_SCHEMA.parse(value);
}

/**
 * Stores heavyweight Agent records behind a lightweight, rebuildable catalog.
 * The record files remain authoritative; catalog and mutation files only make
 * normal startup and metadata reads bounded.
 */
export class AgentStorage {
  private cache = new Map<string, StoredAgentRecord>();
  private cacheRevisionById = new Map<string, string>();
  private metadataById = new Map<string, AgentMetadataEntry>();
  private pathById = new Map<string, string>();
  private pathsById = new Map<string, Set<string>>();
  private pendingWrites = new Map<string, Promise<void>>();
  private deleting = new Set<string>();
  private lazyReads = new Map<string, Promise<StoredAgentRecord | null>>();
  private daemonAgentIdsByExecution = new Map<string, string>();
  private handleAgentIds = new Map<string, Set<string>>();
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private rebuildPromise: Promise<void> | null = null;
  private globalMutationTail: Promise<void> = Promise.resolve();
  private generation = 0;
  private recoveryRequired = false;
  private readonly baseDir: string;
  private readonly logger: Logger;
  private readonly faultInjector?: AgentStorageOptions["faultInjector"];

  constructor(baseDir: string, logger: Logger, options: AgentStorageOptions = {}) {
    this.baseDir = path.resolve(baseDir);
    this.logger = logger.child({ module: "agent", component: "agent-storage" });
    this.faultInjector = options.faultInjector;
  }

  async initialize(): Promise<void> {
    await this.ensureReady();
  }

  /** Explicit compatibility seam that materializes every valid full record. */
  async list(): Promise<StoredAgentRecord[]> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const snapshot = await this.getMetadataSnapshot();
      const materialized = await this.materializeMetadata(
        snapshot.entries.map((entry) => entry.id),
        snapshot.generation,
      );
      if (!materialized.retryRequired) {
        return materialized.records.filter(
          (record): record is StoredAgentRecord => record !== null,
        );
      }
    }
    throw new Error("Agent metadata changed repeatedly while materializing all records");
  }

  async countMetadata(filter?: AgentMetadataFilter): Promise<number> {
    await this.ensureReady();
    if (!filter) return this.metadataById.size;
    return Array.from(this.metadataById.values()).filter((entry) =>
      matchesMetadataFilter(entry, filter),
    ).length;
  }

  async listAllMetadata(filter?: AgentMetadataFilter): Promise<AgentMetadataEntry[]> {
    return (await this.getMetadataSnapshot(filter)).entries;
  }

  async getMetadataSnapshot(filter?: AgentMetadataFilter): Promise<AgentMetadataSnapshot> {
    await this.ensureReady();
    return {
      entries: Array.from(this.metadataById.values())
        .filter((entry) => !filter || matchesMetadataFilter(entry, filter))
        .map(cloneMetadataEntry),
      generation: this.generation,
    };
  }

  async listMetadataPage(options: {
    limit: number;
    filter?: AgentMetadataFilter;
    sort?: AgentMetadataSort[];
    cursor?: string;
  }): Promise<AgentMetadataPage> {
    await this.ensureReady();
    if (!Number.isInteger(options.limit) || options.limit <= 0 || options.limit > 200) {
      throw new Error("Metadata page limit must be an integer between 1 and 200");
    }
    const sort = normalizeMetadataSort(options.sort);
    const cursor = options.cursor ? decodeMetadataCursor(options.cursor) : null;
    if (cursor && cursor.generation !== this.generation) {
      throw new Error("stale metadata cursor");
    }
    if (cursor && JSON.stringify(cursor.sort) !== JSON.stringify(sort)) {
      throw new Error("metadata cursor sort does not match request");
    }
    if (cursor && cursor.values.length !== sort.length) {
      throw new Error("invalid metadata cursor");
    }
    if (cursor && !metadataCursorValuesMatchSort(cursor.values, sort)) {
      throw new Error("invalid metadata cursor");
    }

    let entries = Array.from(this.metadataById.values()).filter(
      (entry) => !options.filter || matchesMetadataFilter(entry, options.filter),
    );
    entries.sort((left, right) => compareMetadataEntries(left, right, sort));
    if (cursor) {
      entries = entries.filter((entry) => compareMetadataEntryWithCursor(entry, cursor, sort) > 0);
    }

    const hasMore = entries.length > options.limit;
    const pageEntries = entries.slice(0, options.limit);
    const last = pageEntries.at(-1);
    return {
      entries: pageEntries.map(cloneMetadataEntry),
      generation: this.generation,
      nextCursor:
        hasMore && last
          ? encodeMetadataCursor({
              version: CATALOG_VERSION,
              generation: this.generation,
              sort,
              values: metadataSortValues(last, sort),
              id: last.id,
            })
          : null,
      hasMore,
    };
  }

  async getCatalogGeneration(): Promise<number> {
    await this.ensureReady();
    return this.generation;
  }

  async get(agentId: string): Promise<StoredAgentRecord | null> {
    await this.ensureReady();
    return await this.getInternal(agentId);
  }

  async materializeMetadata(
    agentIds: readonly string[],
    expectedGeneration: number,
  ): Promise<MaterializedAgentRecords> {
    await this.ensureReady();
    const records = await Promise.all(agentIds.map((agentId) => this.getInternal(agentId)));
    await this.ensureReady();
    return {
      records,
      generation: this.generation,
      retryRequired:
        this.generation !== expectedGeneration || records.some((record) => record === null),
    };
  }

  async findByPersistenceHandle(handle: {
    provider: string;
    sessionId: string;
    nativeHandle?: string;
  }): Promise<AgentMetadataEntry[]> {
    await this.ensureReady();
    const ids = new Set(
      this.handleAgentIds.get(handleKey(handle.provider, handle.sessionId)) ?? [],
    );
    if (typeof handle.nativeHandle === "string") {
      for (const id of this.handleAgentIds.get(handleKey(handle.provider, handle.nativeHandle)) ??
        []) {
        ids.add(id);
      }
    }
    return Array.from(ids)
      .map((id) => this.metadataById.get(id))
      .filter((entry): entry is AgentMetadataEntry => entry !== undefined)
      .sort(compareMetadataRecency)
      .map(cloneMetadataEntry);
  }

  async listByProviderSession(
    provider: string,
    providerHandleId: string,
  ): Promise<StoredAgentRecord[]> {
    await this.load();
    return Array.from(this.cache.values()).filter(
      (record) =>
        record.persistence?.provider === provider &&
        (record.persistence.sessionId === providerHandleId ||
          record.persistence.nativeHandle === providerHandleId),
    );
  }

  async listByWorkspace(workspaceId: string): Promise<StoredAgentRecord[]> {
    await this.load();
    return Array.from(this.cache.values()).filter((record) => record.workspaceId === workspaceId);
  }

  async findByDaemonExecution(owner: DaemonAgentOwner): Promise<StoredAgentRecord | null> {
    await this.ensureReady();
    const agentId = this.daemonAgentIdsByExecution.get(daemonExecutionKey(owner));
    return agentId ? await this.getInternal(agentId) : null;
  }

  /** Upsert a record, optionally failing closed if its current revision changed. */
  async upsert(record: StoredAgentRecord, options: AgentStorageUpsertOptions = {}): Promise<void> {
    await this.ensureReady();
    const parsed = parseStoredAgentRecord(record);
    const expectedRecordRevision =
      options.expectedRecordRevision === undefined
        ? undefined
        : RECORD_REVISION_SCHEMA.parse(options.expectedRecordRevision);
    await this.queueRecordMutation(parsed.id, async () => {
      const existing = await this.getInternal(parsed.id);
      await this.enqueueGlobalMutation(async () => {
        if (
          expectedRecordRevision !== undefined &&
          this.metadataById.get(parsed.id)?.recordRevision !== expectedRecordRevision
        ) {
          throw new Error(`Agent record revision changed: ${parsed.id}`);
        }
        await this.commitRecord(preserveLatestHubExecutionContract(existing, parsed), {
          allowTimelineRevisionChange: false,
        });
      });
    });
  }

  async setTimelineRevision(agentId: string, timelineRevision: string | null): Promise<void> {
    if (timelineRevision !== null) {
      z.string().uuid().parse(timelineRevision);
    }
    await this.ensureReady();
    await this.queueRecordMutation(agentId, async () => {
      const record = await this.getInternal(agentId);
      if (!record) {
        throw new Error(`Agent ${agentId} not found`);
      }
      const recordWithoutTimelineRevision = { ...record };
      delete recordWithoutTimelineRevision.timelineRevision;
      const nextRecord =
        timelineRevision === null
          ? recordWithoutTimelineRevision
          : { ...recordWithoutTimelineRevision, timelineRevision };
      await this.enqueueGlobalMutation(async () => {
        await this.commitRecord(nextRecord, { allowTimelineRevisionChange: true });
      });
    });
  }

  beginDelete(agentId: string): void {
    this.deleting.add(agentId);
  }

  async remove(agentId: string): Promise<void> {
    this.beginDelete(agentId);
    await this.ensureReady();
    await this.queueRecordMutation(
      agentId,
      async () => {
        await this.enqueueGlobalMutation(async () => {
          await this.commitRemove(agentId);
        });
      },
      { allowDeleting: true },
    );
  }

  async prepareRecord(
    record: StoredAgentRecord,
    expectation: PreparedRecordExpectation,
  ): Promise<PreparedAgentRecord> {
    await this.ensureReady();
    const { record: parsed, recordRevision } = serializeStoredAgentRecord(record);
    this.assertPreparedExpectation(parsed.id, expectation);
    const preparedId = randomUUID();
    await writeJsonFileAtomic(this.preparedPath(preparedId), {
      version: CATALOG_VERSION,
      preparedId,
      recordRevision,
      expectation,
      record: parsed,
    });
    return { preparedId, agentId: parsed.id, recordRevision };
  }

  async commitPreparedRecord(preparedId: string): Promise<AgentMetadataEntry> {
    const parsedPreparedId = z.string().uuid().parse(preparedId);
    await this.ensureReady();
    const alreadyCommitted = this.findPreparedCommit(parsedPreparedId);
    if (alreadyCommitted) {
      await this.removePreparedRecordBestEffort(parsedPreparedId);
      return cloneMetadataEntry(alreadyCommitted);
    }

    const prepared = await this.readPreparedRecord(parsedPreparedId);
    if (!prepared) {
      throw new Error(`Prepared agent record not found: ${parsedPreparedId}`);
    }

    return await this.queueRecordMutation(prepared.record.id, async () => {
      const committedDuringWait = this.findPreparedCommit(parsedPreparedId);
      if (committedDuringWait) {
        await this.removePreparedRecordBestEffort(parsedPreparedId);
        return cloneMetadataEntry(committedDuringWait);
      }
      const currentPrepared = await this.readPreparedRecord(parsedPreparedId);
      if (!currentPrepared) {
        const committedAfterRead = this.findPreparedCommit(parsedPreparedId);
        if (committedAfterRead) return cloneMetadataEntry(committedAfterRead);
        throw new Error(`Prepared agent record not found: ${parsedPreparedId}`);
      }
      if (
        currentPrepared.record.id !== prepared.record.id ||
        currentPrepared.recordRevision !== prepared.recordRevision
      ) {
        throw new Error(`Prepared agent record changed: ${parsedPreparedId}`);
      }
      this.assertPreparedExpectation(currentPrepared.record.id, currentPrepared.expectation);
      return await this.enqueueGlobalMutation(async () => {
        // The global queue may have waited for a rebuild or another generation
        // commit after the preflight check above. Revalidate at the commit point
        // so a prepared import never overwrites a newer record.
        this.assertPreparedExpectation(currentPrepared.record.id, currentPrepared.expectation);
        return await this.commitRecord(currentPrepared.record, {
          allowTimelineRevisionChange: true,
          preparedId: parsedPreparedId,
          preparedPath: this.preparedPath(parsedPreparedId),
        });
      });
    });
  }

  async discardPreparedRecord(preparedId: string): Promise<void> {
    const parsedPreparedId = z.string().uuid().parse(preparedId);
    await this.ensureReady();
    await fs.rm(this.preparedPath(parsedPreparedId), { force: true });
  }

  async applySnapshot(
    agent: ManagedAgent,
    options?: { title?: string | null; internal?: boolean },
  ): Promise<void> {
    await this.ensureReady();
    const hasTitleOverride =
      options !== undefined && Object.prototype.hasOwnProperty.call(options, "title");
    const hasInternalOverride =
      options !== undefined && Object.prototype.hasOwnProperty.call(options, "internal");
    await this.queueRecordMutation(agent.id, async () => {
      const existing = await this.getInternal(agent.id);
      const record = toStoredAgentRecord(agent, {
        title: hasTitleOverride ? (options?.title ?? null) : (existing?.title ?? null),
        createdAt: existing?.createdAt,
        internal: hasInternalOverride ? options?.internal : (agent.internal ?? existing?.internal),
      });
      if (existing && existing.archivedAt !== undefined) {
        record.archivedAt = existing.archivedAt;
      }
      await this.enqueueGlobalMutation(async () => {
        await this.commitRecord(preserveLatestHubExecutionContract(existing, record), {
          allowTimelineRevisionChange: false,
        });
      });
    });
  }

  /** Persist the first Hub owner/config snapshot together with its prepared contract. */
  async persistInitialHubExecutionSnapshot(
    agent: ManagedAgent,
    expectedPreparedContract: HubExecutionContract,
  ): Promise<void> {
    await this.ensureReady();
    const expected = requirePreparedHubExecutionContract(expectedPreparedContract);
    await this.queueRecordMutation(agent.id, async () => {
      const existing = await this.getInternal(agent.id);
      if (existing) {
        const current = classifyStoredHubExecutionContract(existing.hubExecutionContract);
        if (current.kind !== "valid") {
          throw new HubExecutionContractError(
            current.kind === "invalid"
              ? "hub_execution_contract_invalid"
              : "execution_contract_mismatch",
            `Agent ${agent.id} does not contain the expected prepared contract`,
          );
        }
        if (!sameHubExecutionContract(current.contract, expected)) {
          throw new HubExecutionContractError(
            "execution_contract_mismatch",
            `Agent ${agent.id} prepared contract does not match the create request`,
          );
        }
      }

      const record = toStoredAgentRecord(agent, {
        title: existing?.title ?? null,
        createdAt: existing?.createdAt,
        internal: agent.internal ?? existing?.internal,
      });
      if (existing?.archivedAt !== undefined) record.archivedAt = existing.archivedAt;
      record.hubExecutionContract = structuredClone(expected);
      await this.enqueueGlobalMutation(async () => {
        await this.commitRecord(record, { allowTimelineRevisionChange: false });
      });
    });
  }

  /** Atomically change an exact prepared Hub contract to applied before any prompt starts. */
  async persistHubExecutionContractBeforePrompt(
    agentId: string,
    expectedPreparedContract: HubExecutionContract,
  ): Promise<HubExecutionContract> {
    await this.ensureReady();
    const expected = requirePreparedHubExecutionContract(expectedPreparedContract);
    let applied: HubExecutionContract | null = null;
    await this.queueRecordMutation(agentId, async () => {
      const existing = await this.getInternal(agentId);
      if (!existing) {
        throw new HubExecutionContractError(
          "hub_execution_contract_incomplete",
          `Agent ${agentId} has no durable prepared snapshot`,
        );
      }
      const current = classifyStoredHubExecutionContract(existing.hubExecutionContract);
      if (current.kind === "invalid") {
        throw new HubExecutionContractError(
          "hub_execution_contract_invalid",
          `Agent ${agentId} has a malformed Hub execution contract`,
        );
      }
      if (current.kind === "legacy" || current.contract.applicationState !== "prepared") {
        throw new HubExecutionContractError(
          "hub_execution_contract_incomplete",
          `Agent ${agentId} is not in the prepared state`,
        );
      }
      if (!sameHubExecutionContract(current.contract, expected)) {
        throw new HubExecutionContractError(
          "execution_contract_mismatch",
          `Agent ${agentId} prepared contract does not match the create request`,
        );
      }

      applied = { ...expected, applicationState: "applied" };
      await this.enqueueGlobalMutation(async () => {
        await this.commitRecord(
          { ...existing, hubExecutionContract: applied },
          { allowTimelineRevisionChange: false },
        );
      });
    });
    if (!applied) {
      throw new HubExecutionContractError(
        "hub_execution_contract_incomplete",
        `Agent ${agentId} contract transition did not complete`,
      );
    }
    return applied;
  }

  async setTitle(agentId: string, title: string): Promise<void> {
    await this.ensureReady();
    await this.queueRecordMutation(agentId, async () => {
      const record = await this.getInternal(agentId);
      if (!record) {
        throw new Error(`Agent ${agentId} not found`);
      }
      await this.enqueueGlobalMutation(async () => {
        await this.commitRecord({ ...record, title }, { allowTimelineRevisionChange: false });
      });
    });
  }

  async flush(): Promise<void> {
    await this.ensureReady().catch(() => undefined);
    await Promise.allSettled(Array.from(this.pendingWrites.values()));
    await this.globalMutationTail;
  }

  private async ensureReady(): Promise<void> {
    await this.load();
    if (this.recoveryRequired) {
      await this.requestRebuild("pending recovery");
    }
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    if (!this.loadPromise) {
      const task = this.doLoad();
      this.loadPromise = task;
      void task.catch(() => {
        if (this.loadPromise === task) this.loadPromise = null;
      });
    }
    await this.loadPromise;
  }

  private async doLoad(): Promise<void> {
    this.clearIndexes();
    if (await fileExists(this.mutationPath())) {
      await this.requestRebuild("unfinished mutation marker");
      this.loaded = true;
      return;
    }

    try {
      const catalog = await this.readCatalog();
      this.applyCatalog(catalog);
      this.loaded = true;
    } catch (error) {
      this.logger.warn({ err: error }, "Agent metadata catalog unavailable; rebuilding");
      await this.requestRebuild("catalog missing or invalid");
      this.loaded = true;
    }
  }

  private async getInternal(agentId: string): Promise<StoredAgentRecord | null> {
    const cached = this.cache.get(agentId);
    if (cached) return cached;
    if (!this.metadataById.has(agentId)) return null;

    const existing = this.lazyReads.get(agentId);
    if (existing) return await existing;
    const task = this.readRecordFromCatalog(agentId, true);
    this.lazyReads.set(agentId, task);
    void task.then(
      () => {
        if (this.lazyReads.get(agentId) === task) this.lazyReads.delete(agentId);
        return undefined;
      },
      () => {
        if (this.lazyReads.get(agentId) === task) this.lazyReads.delete(agentId);
        return undefined;
      },
    );
    return await task;
  }

  private async readRecordFromCatalog(
    agentId: string,
    allowRebuild: boolean,
  ): Promise<StoredAgentRecord | null> {
    const metadata = this.metadataById.get(agentId);
    if (!metadata) return null;
    try {
      const serialized = await fs.readFile(this.resolveRecordPath(metadata.recordPath), "utf8");
      if (hashRecord(serialized) !== metadata.recordRevision) {
        throw new Error(`Agent record revision mismatch: ${agentId}`);
      }
      const record = parseStoredAgentRecord(JSON.parse(serialized));
      if (record.id !== agentId) {
        throw new Error(`Agent record identity mismatch: ${agentId}`);
      }
      const currentMetadata = this.metadataById.get(agentId);
      if (
        !currentMetadata ||
        currentMetadata.recordRevision !== metadata.recordRevision ||
        currentMetadata.recordPath !== metadata.recordPath
      ) {
        return allowRebuild ? await this.readRecordFromCatalog(agentId, false) : null;
      }
      this.cache.set(agentId, record);
      this.cacheRevisionById.set(agentId, metadata.recordRevision);
      return record;
    } catch (error) {
      this.logger.error({ err: error, agentId }, "Failed to read indexed agent record");
      if (!isRecoverableRecordReadError(error)) {
        throw error;
      }
      if (!allowRebuild) return null;
      await this.requestRebuild(`targeted read mismatch for ${agentId}`);
      return await this.readRecordFromCatalog(agentId, false);
    }
  }

  private queueRecordMutation<T>(
    agentId: string,
    operation: () => Promise<T>,
    options: { allowDeleting?: boolean } = {},
  ): Promise<T> {
    const previous = this.pendingWrites.get(agentId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        if (this.deleting.has(agentId) && !options.allowDeleting) {
          return undefined as T;
        }
        await (this.lazyReads.get(agentId) ?? Promise.resolve()).catch(() => undefined);
        return await operation();
      });
    const tracked = next.then(
      () => undefined,
      () => undefined,
    );
    this.pendingWrites.set(agentId, tracked);
    void tracked.finally(() => {
      if (this.pendingWrites.get(agentId) === tracked) this.pendingWrites.delete(agentId);
    });
    return next;
  }

  private enqueueGlobalMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.globalMutationTail.catch(() => undefined).then(operation);
    this.globalMutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private requestRebuild(reason: string): Promise<void> {
    if (this.rebuildPromise) return this.rebuildPromise;
    const task = this.enqueueGlobalMutation(async () => {
      await this.rebuildFromDisk(reason);
    });
    this.rebuildPromise = task;
    void task.then(
      () => {
        if (this.rebuildPromise === task) this.rebuildPromise = null;
        return undefined;
      },
      () => {
        if (this.rebuildPromise === task) this.rebuildPromise = null;
        return undefined;
      },
    );
    return task;
  }

  private async commitRecord(
    record: StoredAgentRecord,
    options: {
      allowTimelineRevisionChange: boolean;
      preparedId?: string;
      preparedPath?: string;
    },
  ): Promise<AgentMetadataEntry> {
    const existingMetadata = this.metadataById.get(record.id);
    const nextRecord =
      !options.allowTimelineRevisionChange && existingMetadata?.timelineRevision
        ? { ...record, timelineRevision: existingMetadata.timelineRevision }
        : record;
    const serializedRecord = serializeStoredAgentRecord(nextRecord);
    const nextPath = this.buildRecordPath(serializedRecord.record);
    const nextRelativePath = this.toRelativeRecordPath(nextPath);
    const previousPath = this.pathById.get(record.id);
    const previousRelativePath = previousPath ? this.toRelativeRecordPath(previousPath) : null;
    const nextGeneration = this.generation + 1;
    const marker = this.createMutationMarker({
      operation: options.preparedId ? "prepared_commit" : "upsert",
      nextGeneration,
      affectedIds: [record.id],
      oldPaths: previousRelativePath ? [previousRelativePath] : [],
      newPaths: [nextRelativePath],
      recordRevision: serializedRecord.recordRevision,
      preparedId: options.preparedId ?? existingMetadata?.preparedCommitId,
    });

    let markerWritten = false;
    try {
      await this.writeMutationMarker(marker);
      markerWritten = true;
      await writeFileAtomic(nextPath, serializedRecord.serialized);
      await this.injectFault("record_write");

      const nextEntry = buildMetadataEntry({
        record: serializedRecord.record,
        recordPath: nextRelativePath,
        recordRevision: serializedRecord.recordRevision,
        preparedCommitId: options.preparedId ?? existingMetadata?.preparedCommitId,
      });
      const nextEntries = Array.from(this.metadataById.values()).filter(
        (entry) => entry.id !== record.id,
      );
      nextEntries.push(nextEntry);
      const catalog = this.createCatalog(nextEntries, nextGeneration);
      await this.writeCatalog(catalog);
      this.applyCatalog(catalog);
      this.cache.set(record.id, serializedRecord.record);
      this.cacheRevisionById.set(record.id, serializedRecord.recordRevision);

      await this.finishCommittedMutation(async () => {
        if (previousPath && previousPath !== nextPath) {
          await fs.rm(previousPath, { force: true });
        }
        if (options.preparedPath) {
          await fs.rm(options.preparedPath, { force: true });
        }
      });
      return cloneMetadataEntry(nextEntry);
    } catch (error) {
      if (markerWritten) this.recoveryRequired = true;
      throw error;
    }
  }

  private async commitRemove(agentId: string): Promise<void> {
    const knownPaths = Array.from(
      new Set([
        ...(this.pathsById.get(agentId) ?? []),
        ...(await this.findRecordPathsForAgentId(agentId)),
      ]),
    );
    const nextGeneration = this.generation + 1;
    const marker = this.createMutationMarker({
      operation: "remove",
      nextGeneration,
      affectedIds: [agentId],
      oldPaths: knownPaths.map((filePath) => this.toRelativeRecordPath(filePath)),
      newPaths: [],
    });
    let markerWritten = false;
    try {
      await this.writeMutationMarker(marker);
      markerWritten = true;
      for (const filePath of knownPaths) {
        await fs.rm(filePath, { force: true });
      }
      await this.injectFault("record_write");
      const catalog = this.createCatalog(
        Array.from(this.metadataById.values()).filter((entry) => entry.id !== agentId),
        nextGeneration,
      );
      await this.writeCatalog(catalog);
      this.applyCatalog(catalog);
      await this.finishCommittedMutation(async () => undefined);
    } catch (error) {
      if (markerWritten) this.recoveryRequired = true;
      throw error;
    }
  }

  private async finishCommittedMutation(cleanup: () => Promise<void>): Promise<void> {
    try {
      await cleanup();
      await this.injectFault("committed_cleanup");
      await fs.rm(this.mutationPath(), { force: true });
      this.recoveryRequired = false;
    } catch (error) {
      this.recoveryRequired = true;
      this.logger.warn({ err: error }, "Agent storage commit cleanup deferred to recovery");
    }
  }

  // Keep marker recovery, duplicate selection, and catalog commit ordering auditable in one state machine.
  // eslint-disable-next-line complexity
  private async rebuildFromDisk(reason: string): Promise<void> {
    this.recoveryRequired = true;
    const previousCatalog = await this.readCatalogBestEffort();
    const previousMarker = await this.readMutationMarkerBestEffort();
    const markerGeneration = previousMarker
      ? Math.max(previousMarker.baseGeneration, previousMarker.nextGeneration)
      : 0;
    const baseGeneration = Math.max(
      previousCatalog?.generation ?? 0,
      this.generation,
      markerGeneration,
    );
    const scanned = await this.scanDisk();
    const nextGeneration =
      previousCatalog === null &&
      previousMarker === null &&
      baseGeneration === 0 &&
      scanned.records.length === 0
        ? 0
        : baseGeneration + 1;
    const marker = this.createMutationMarker({
      operation: "rebuild",
      baseGeneration,
      nextGeneration,
      affectedIds: previousMarker?.affectedIds ?? [],
      oldPaths: previousMarker?.oldPaths ?? [],
      newPaths: previousMarker?.newPaths ?? [],
      recordRevision: previousMarker?.recordRevision,
      preparedId: previousMarker?.preparedId,
    });
    await this.writeMutationMarker(marker);

    try {
      const previousCommitIds = new Map(
        previousCatalog?.entries
          .filter((entry) => entry.preparedCommitId)
          .map((entry) => [
            `${entry.id}\0${entry.recordRevision}`,
            entry.preparedCommitId as string,
          ]) ?? [],
      );
      if (previousMarker?.preparedId && previousMarker.recordRevision) {
        for (const agentId of previousMarker.affectedIds) {
          previousCommitIds.set(
            `${agentId}\0${previousMarker.recordRevision}`,
            previousMarker.preparedId,
          );
        }
      }

      const recordsById = new Map<string, ScannedRecord[]>();
      for (const item of scanned.records) {
        const records = recordsById.get(item.record.id) ?? [];
        records.push(item);
        recordsById.set(item.record.id, records);
      }

      const entries: AgentMetadataEntry[] = [];
      const quarantinePaths = [...scanned.invalidPaths];
      for (const records of recordsById.values()) {
        records.sort(compareScannedRecords);
        const preferredByMarker = previousMarker
          ? records.find(
              (item) =>
                previousMarker.newPaths.includes(item.relativePath) &&
                (!previousMarker.recordRevision ||
                  previousMarker.recordRevision === item.recordRevision),
            )
          : undefined;
        const winner = preferredByMarker ?? records[0];
        quarantinePaths.push(
          ...records.filter((item) => item !== winner).map((item) => item.filePath),
        );
        entries.push(
          buildMetadataEntry({
            record: winner.record,
            recordPath: winner.relativePath,
            recordRevision: winner.recordRevision,
            preparedCommitId: previousCommitIds.get(
              `${winner.record.id}\0${winner.recordRevision}`,
            ),
          }),
        );
      }

      const catalog = this.createCatalog(entries, nextGeneration);
      await this.writeCatalog(catalog);
      this.applyCatalog(catalog);
      this.cache.clear();
      this.cacheRevisionById.clear();
      this.lazyReads.clear();

      for (const filePath of quarantinePaths) {
        await this.quarantineRecord(filePath);
      }
      await fs.rm(this.mutationPath(), { force: true });
      this.recoveryRequired = false;
      this.loaded = true;
      this.logger.info(
        { reason, generation: nextGeneration, records: entries.length },
        "Agent metadata catalog rebuilt",
      );
    } catch (error) {
      this.recoveryRequired = true;
      throw error;
    }
  }

  private async scanDisk(): Promise<{ records: ScannedRecord[]; invalidPaths: string[] }> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(this.baseDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { records: [], invalidPaths: [] };
      }
      throw error;
    }

    const rootRecordPaths = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(this.baseDir, entry.name));
    const projectDirs = entries
      .filter((entry) => entry.isDirectory() && entry.name !== CONTROL_DIR_NAME)
      .map((entry) => path.join(this.baseDir, entry.name));
    const projectFileLists = await Promise.all(
      projectDirs.map(async (projectDir) => {
        try {
          const files = await fs.readdir(projectDir, { withFileTypes: true });
          return files
            .filter((file) => file.isFile() && file.name.endsWith(".json"))
            .map((file) => path.join(projectDir, file.name));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
          throw error;
        }
      }),
    );

    const records: ScannedRecord[] = [];
    const invalidPaths: string[] = [];
    for (const filePath of [...rootRecordPaths, ...projectFileLists.flat()]) {
      // A file that cannot be read is an environmental failure, not a corrupt
      // Agent record. Keep the marker in place and retry recovery instead of
      // quarantining a potentially valid file.
      const serialized = await fs.readFile(filePath, "utf8");
      try {
        const record = parseStoredAgentRecord(JSON.parse(serialized));
        assertSafeFileComponent(record.id, "agent id");
        records.push({
          record,
          filePath,
          relativePath: this.toRelativeRecordPath(filePath),
          recordRevision: hashRecord(serialized),
        });
      } catch (error) {
        invalidPaths.push(filePath);
        this.logger.error({ err: error, filePath }, "Quarantining invalid agent record");
      }
    }
    return { records, invalidPaths };
  }

  private createCatalog(entries: AgentMetadataEntry[], generation: number): AgentMetadataCatalog {
    return AGENT_METADATA_CATALOG_SCHEMA.parse({
      version: CATALOG_VERSION,
      generation,
      entries: [...entries].sort((left, right) => left.id.localeCompare(right.id)),
    });
  }

  private applyCatalog(catalog: AgentMetadataCatalog): void {
    const metadataById = new Map<string, AgentMetadataEntry>();
    const pathById = new Map<string, string>();
    const idByPath = new Map<string, string>();
    const pathsById = new Map<string, Set<string>>();
    const daemonAgentIdsByExecution = new Map<string, string>();
    const handleAgentIds = new Map<string, Set<string>>();

    for (const entry of catalog.entries) {
      if (metadataById.has(entry.id)) {
        throw new Error(`Duplicate agent id in metadata catalog: ${entry.id}`);
      }
      const recordPath = this.resolveRecordPath(entry.recordPath);
      const previousIdForPath = idByPath.get(recordPath);
      if (previousIdForPath && previousIdForPath !== entry.id) {
        throw new Error(`Duplicate record path in metadata catalog: ${entry.recordPath}`);
      }
      idByPath.set(recordPath, entry.id);
      metadataById.set(entry.id, entry);
      pathById.set(entry.id, recordPath);
      pathsById.set(entry.id, new Set([recordPath]));

      if (entry.owner?.kind === "daemon") {
        const key = daemonExecutionKey(entry.owner);
        const previousId = daemonAgentIdsByExecution.get(key);
        const previous = previousId ? metadataById.get(previousId) : undefined;
        if (!previous || compareMetadataRecency(entry, previous) < 0) {
          daemonAgentIdsByExecution.set(key, entry.id);
        }
      }
      if (entry.persistenceIdentity) {
        addHandleIndex(
          handleAgentIds,
          handleKey(entry.persistenceIdentity.provider, entry.persistenceIdentity.sessionId),
          entry.id,
        );
        if (typeof entry.persistenceIdentity.nativeHandle === "string") {
          addHandleIndex(
            handleAgentIds,
            handleKey(entry.persistenceIdentity.provider, entry.persistenceIdentity.nativeHandle),
            entry.id,
          );
        }
      }
    }

    const nextCache = new Map<string, StoredAgentRecord>();
    const nextCacheRevisions = new Map<string, string>();
    for (const [agentId, record] of this.cache) {
      const revision = this.cacheRevisionById.get(agentId);
      if (revision && metadataById.get(agentId)?.recordRevision === revision) {
        nextCache.set(agentId, record);
        nextCacheRevisions.set(agentId, revision);
      }
    }

    this.metadataById = metadataById;
    this.pathById = pathById;
    this.pathsById = pathsById;
    this.daemonAgentIdsByExecution = daemonAgentIdsByExecution;
    this.handleAgentIds = handleAgentIds;
    this.cache = nextCache;
    this.cacheRevisionById = nextCacheRevisions;
    this.generation = catalog.generation;
  }

  private clearIndexes(): void {
    this.cache.clear();
    this.cacheRevisionById.clear();
    this.metadataById.clear();
    this.pathById.clear();
    this.pathsById.clear();
    this.lazyReads.clear();
    this.daemonAgentIdsByExecution.clear();
    this.handleAgentIds.clear();
    this.generation = 0;
  }

  private createMutationMarker(input: {
    operation: AgentStorageMutation["operation"];
    baseGeneration?: number;
    nextGeneration: number;
    affectedIds: string[];
    oldPaths: string[];
    newPaths: string[];
    recordRevision?: string;
    preparedId?: string;
  }): AgentStorageMutation {
    return AGENT_STORAGE_MUTATION_SCHEMA.parse({
      version: CATALOG_VERSION,
      operationId: randomUUID(),
      operation: input.operation,
      baseGeneration: input.baseGeneration ?? this.generation,
      nextGeneration: input.nextGeneration,
      affectedIds: input.affectedIds,
      oldPaths: input.oldPaths,
      newPaths: input.newPaths,
      recordRevision: input.recordRevision,
      preparedId: input.preparedId,
      createdAt: new Date().toISOString(),
    });
  }

  private async readCatalog(): Promise<AgentMetadataCatalog> {
    const parsed = AGENT_METADATA_CATALOG_SCHEMA.parse(
      JSON.parse(await fs.readFile(this.catalogPath(), "utf8")),
    );
    for (const entry of parsed.entries) {
      assertSafeFileComponent(entry.id, "agent id");
      this.resolveRecordPath(entry.recordPath);
    }
    return parsed;
  }

  private async readCatalogBestEffort(): Promise<AgentMetadataCatalog | null> {
    try {
      return await this.readCatalog();
    } catch {
      return null;
    }
  }

  private async readMutationMarkerBestEffort(): Promise<AgentStorageMutation | null> {
    try {
      return AGENT_STORAGE_MUTATION_SCHEMA.parse(
        JSON.parse(await fs.readFile(this.mutationPath(), "utf8")),
      );
    } catch {
      return null;
    }
  }

  private async writeCatalog(catalog: AgentMetadataCatalog): Promise<void> {
    await writeJsonFileAtomic(this.catalogPath(), catalog);
    await this.injectFault("catalog_write");
  }

  private async writeMutationMarker(marker: AgentStorageMutation): Promise<void> {
    await writeJsonFileAtomic(this.mutationPath(), marker);
    this.recoveryRequired = true;
    await this.injectFault("mutation_marker");
  }

  private async readPreparedRecord(
    preparedId: string,
  ): Promise<z.infer<typeof PREPARED_RECORD_SCHEMA> | null> {
    try {
      const prepared = PREPARED_RECORD_SCHEMA.parse(
        JSON.parse(await fs.readFile(this.preparedPath(preparedId), "utf8")),
      );
      if (prepared.preparedId !== preparedId) {
        throw new Error("Prepared agent record identity mismatch");
      }
      const serialized = JSON.stringify(prepared.record, null, 2);
      if (hashRecord(serialized) !== prepared.recordRevision) {
        throw new Error("Prepared agent record revision mismatch");
      }
      return prepared;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private assertPreparedExpectation(agentId: string, expectation: PreparedRecordExpectation): void {
    const current = this.metadataById.get(agentId);
    if (expectation.kind === "absent") {
      if (current) throw new Error(`Prepared agent target already exists: ${agentId}`);
      return;
    }
    if (!current || current.recordRevision !== expectation.recordRevision) {
      throw new Error(`Prepared agent target revision changed: ${agentId}`);
    }
  }

  private findPreparedCommit(preparedId: string): AgentMetadataEntry | null {
    for (const entry of this.metadataById.values()) {
      if (entry.preparedCommitId === preparedId) return entry;
    }
    return null;
  }

  private async quarantineRecord(filePath: string): Promise<void> {
    if (!(await fileExists(filePath))) return;
    await fs.mkdir(this.quarantineDir(), { recursive: true });
    const destination = path.join(
      this.quarantineDir(),
      `${randomUUID()}-${path.basename(filePath)}`,
    );
    await fs.rename(filePath, destination);
  }

  private async findRecordPathsForAgentId(agentId: string): Promise<string[]> {
    assertSafeFileComponent(agentId, "agent id");
    let entries: Dirent[];
    try {
      entries = await fs.readdir(this.baseDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const fileName = `${agentId}.json`;
    const matches = entries
      .filter((entry) => entry.isFile() && entry.name === fileName)
      .map((entry) => path.join(this.baseDir, entry.name));
    const projectDirectories = entries.filter(
      (entry) => entry.isDirectory() && entry.name !== CONTROL_DIR_NAME,
    );
    for (const directory of projectDirectories) {
      const candidate = path.join(this.baseDir, directory.name, fileName);
      if (await fileExists(candidate)) matches.push(candidate);
    }
    return matches;
  }

  private resolveRecordPath(relativePath: string): string {
    if (path.isAbsolute(relativePath)) {
      throw new Error("Agent catalog record path must be relative");
    }
    const normalizedParts = relativePath.split("/");
    const resolved = path.resolve(this.baseDir, ...normalizedParts);
    const relative = path.relative(this.baseDir, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Agent catalog record path escapes storage root");
    }
    const firstPart = relative.split(path.sep)[0];
    if (firstPart === CONTROL_DIR_NAME) {
      throw new Error("Agent catalog record path points into reserved control storage");
    }
    return resolved;
  }

  private toRelativeRecordPath(filePath: string): string {
    const relative = path.relative(this.baseDir, path.resolve(filePath));
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Agent record path escapes storage root");
    }
    if (relative.split(path.sep)[0] === CONTROL_DIR_NAME) {
      throw new Error("Agent record path points into reserved control storage");
    }
    return relative.split(path.sep).join("/");
  }

  private buildRecordPath(record: StoredAgentRecord): string {
    assertSafeFileComponent(record.id, "agent id");
    const projectDir = projectDirNameFromCwd(record.cwd);
    return path.join(this.baseDir, projectDir, `${record.id}.json`);
  }

  private controlDir(): string {
    return path.join(this.baseDir, CONTROL_DIR_NAME);
  }

  private catalogPath(): string {
    return path.join(this.controlDir(), CATALOG_FILE_NAME);
  }

  private mutationPath(): string {
    return path.join(this.controlDir(), MUTATION_FILE_NAME);
  }

  private preparedPath(preparedId: string): string {
    return path.join(this.controlDir(), STAGING_DIR_NAME, `${preparedId}.json`);
  }

  private async removePreparedRecordBestEffort(preparedId: string): Promise<void> {
    try {
      await fs.rm(this.preparedPath(preparedId), { force: true });
    } catch (error) {
      this.logger.warn({ err: error, preparedId }, "Prepared agent cleanup deferred");
    }
  }

  private quarantineDir(): string {
    return path.join(this.controlDir(), QUARANTINE_DIR_NAME);
  }

  private async injectFault(point: AgentStorageFaultPoint): Promise<void> {
    await this.faultInjector?.(point);
  }
}

function serializeStoredAgentRecord(record: StoredAgentRecord): {
  record: StoredAgentRecord;
  serialized: string;
  recordRevision: string;
} {
  const parsed = parseStoredAgentRecord(record);
  assertSafeFileComponent(parsed.id, "agent id");
  const serialized = JSON.stringify(parsed, null, 2);
  return { record: parsed, serialized, recordRevision: hashRecord(serialized) };
}

function hashRecord(serialized: string): string {
  return createHash("sha256").update(serialized).digest("hex");
}

function buildMetadataEntry(input: {
  record: StoredAgentRecord;
  recordPath: string;
  recordRevision: string;
  preparedCommitId?: string;
}): AgentMetadataEntry {
  const { record } = input;
  const nativeHandle = record.persistence?.nativeHandle;
  return AGENT_METADATA_ENTRY_SCHEMA.parse({
    id: record.id,
    recordPath: input.recordPath,
    recordRevision: input.recordRevision,
    provider: record.provider,
    cwd: record.cwd,
    workspaceId: record.workspaceId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastActivityAt: record.lastActivityAt,
    lastUserMessageAt: record.lastUserMessageAt ?? null,
    lastMessageAt: record.lastMessageAt ?? null,
    title: record.title ?? null,
    labels: record.labels,
    lastStatus: record.lastStatus,
    lastModeId: record.lastModeId ?? null,
    effectiveThinkingOptionId: resolveStoredThinkingOptionId(record),
    requiresAttention: record.requiresAttention ?? false,
    attentionReason: record.attentionReason ?? null,
    attentionTimestamp: record.attentionTimestamp ?? null,
    internal: record.internal ?? false,
    archivedAt: record.archivedAt ?? null,
    timelineRevision: record.timelineRevision,
    owner: record.owner,
    persistenceIdentity: record.persistence
      ? {
          provider: record.persistence.provider,
          sessionId: record.persistence.sessionId,
          ...(typeof nativeHandle === "string" ? { nativeHandle } : {}),
        }
      : undefined,
    preparedCommitId: input.preparedCommitId,
  });
}

function resolveStoredThinkingOptionId(record: StoredAgentRecord): string | null {
  return resolveEffectiveThinkingOptionId({
    runtimeInfo: record.runtimeInfo,
    configuredThinkingOptionId: record.config?.thinkingOptionId,
  });
}

function cloneMetadataEntry(entry: AgentMetadataEntry): AgentMetadataEntry {
  return {
    ...entry,
    labels: { ...entry.labels },
    ...(entry.owner ? { owner: { ...entry.owner } } : {}),
    ...(entry.persistenceIdentity ? { persistenceIdentity: { ...entry.persistenceIdentity } } : {}),
  };
}

function matchesMetadataFilter(entry: AgentMetadataEntry, filter: AgentMetadataFilter): boolean {
  if (filter.includeArchived === false && entry.archivedAt) return false;
  if (filter.includeInternal === false && entry.internal) return false;
  if (filter.workspaceId !== undefined && entry.workspaceId !== filter.workspaceId) return false;
  if (
    filter.statuses &&
    filter.statuses.length > 0 &&
    !filter.statuses.includes(entry.lastStatus)
  ) {
    return false;
  }
  if (
    filter.requiresAttention !== undefined &&
    entry.requiresAttention !== filter.requiresAttention
  ) {
    return false;
  }
  if (
    filter.thinkingOptionId !== undefined &&
    normalizeThinkingOptionId(filter.thinkingOptionId) !== entry.effectiveThinkingOptionId
  ) {
    return false;
  }
  if (
    filter.labels &&
    !Object.entries(filter.labels).every(([key, value]) => entry.labels[key] === value)
  ) {
    return false;
  }
  return true;
}

function normalizeThinkingOptionId(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeMetadataSort(sort: AgentMetadataSort[] | undefined): AgentMetadataSort[] {
  if (!sort || sort.length === 0) return [{ key: "updated_at", direction: "desc" }];
  return z.array(METADATA_SORT_SCHEMA).parse(sort);
}

function metadataSortValue(
  entry: AgentMetadataEntry,
  key: AgentMetadataSort["key"],
): string | number | null {
  switch (key) {
    case "status_priority":
      return getAgentStatusPriority({
        status: entry.lastStatus,
        pendingPermissionCount: 0,
        requiresAttention: entry.requiresAttention,
        attentionReason: entry.attentionReason,
      });
    case "created_at":
      return parseTimestamp(entry.createdAt);
    case "updated_at":
      return parseTimestamp(resolveMetadataUpdatedAt(entry));
    case "title":
      return entry.title?.toLocaleLowerCase() ?? "";
  }
}

function metadataSortValues(
  entry: AgentMetadataEntry,
  sort: AgentMetadataSort[],
): Array<string | number | null> {
  return sort.map((spec) => metadataSortValue(entry, spec.key));
}

function metadataCursorValuesMatchSort(
  values: Array<string | number | null>,
  sort: AgentMetadataSort[],
): boolean {
  return sort.every((spec, index) => {
    const value = values[index];
    if (spec.key === "title") return typeof value === "string";
    return typeof value === "number" && Number.isFinite(value);
  });
}

function compareMetadataEntries(
  left: AgentMetadataEntry,
  right: AgentMetadataEntry,
  sort: AgentMetadataSort[],
): number {
  for (const spec of sort) {
    const result = compareSortValues(
      metadataSortValue(left, spec.key),
      metadataSortValue(right, spec.key),
    );
    if (result !== 0) return spec.direction === "asc" ? result : -result;
  }
  return left.id.localeCompare(right.id);
}

function compareMetadataEntryWithCursor(
  entry: AgentMetadataEntry,
  cursor: z.infer<typeof METADATA_CURSOR_SCHEMA>,
  sort: AgentMetadataSort[],
): number {
  for (let index = 0; index < sort.length; index += 1) {
    const spec = sort[index];
    const result = compareSortValues(metadataSortValue(entry, spec.key), cursor.values[index]);
    if (result !== 0) return spec.direction === "asc" ? result : -result;
  }
  return entry.id.localeCompare(cursor.id);
}

function compareSortValues(
  left: string | number | null | undefined,
  right: string | number | null | undefined,
): number {
  if (left === right) return 0;
  if (left == null) return -1;
  if (right == null) return 1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right));
}

function encodeMetadataCursor(cursor: z.infer<typeof METADATA_CURSOR_SCHEMA>): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeMetadataCursor(token: string): z.infer<typeof METADATA_CURSOR_SCHEMA> {
  try {
    return METADATA_CURSOR_SCHEMA.parse(
      JSON.parse(Buffer.from(token, "base64url").toString("utf8")),
    );
  } catch {
    throw new Error("invalid metadata cursor");
  }
}

function resolveMetadataUpdatedAt(entry: AgentMetadataEntry): string {
  const candidates = [entry.updatedAt, entry.lastActivityAt]
    .filter((value): value is string => typeof value === "string")
    .map((value) => ({ value, timestamp: Date.parse(value) }))
    .filter((value) => !Number.isNaN(value.timestamp))
    .sort((left, right) => right.timestamp - left.timestamp);
  return candidates[0]?.value ?? entry.updatedAt;
}

function compareMetadataRecency(left: AgentMetadataEntry, right: AgentMetadataEntry): number {
  return (
    parseTimestamp(right.updatedAt) - parseTimestamp(left.updatedAt) ||
    parseTimestamp(right.createdAt) - parseTimestamp(left.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

function compareScannedRecords(left: ScannedRecord, right: ScannedRecord): number {
  return (
    parseTimestamp(right.record.updatedAt) - parseTimestamp(left.record.updatedAt) ||
    parseTimestamp(right.record.createdAt) - parseTimestamp(left.record.createdAt) ||
    left.relativePath.localeCompare(right.relativePath)
  );
}

function parseTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function isRecoverableRecordReadError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === undefined || code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR";
}

function handleKey(provider: string, handle: string): string {
  return `${provider}\0${handle}`;
}

function addHandleIndex(target: Map<string, Set<string>>, key: string, agentId: string): void {
  const ids = target.get(key) ?? new Set<string>();
  ids.add(agentId);
  target.set(key, ids);
}

function assertSafeFileComponent(value: string, label: string): void {
  if (!value || value === "." || value === ".." || /[\\/]/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export type StoredHubExecutionContractClassification =
  | { kind: "legacy" }
  | { kind: "valid"; contract: HubExecutionContract }
  | { kind: "invalid" };

/** Classify a persisted Hub contract without hiding malformed state as a legacy record. */
export function classifyStoredHubExecutionContract(
  value: unknown,
): StoredHubExecutionContractClassification {
  if (value === undefined) return { kind: "legacy" };
  const parsed = HUB_EXECUTION_CONTRACT_SCHEMA.safeParse(value);
  return parsed.success ? { kind: "valid", contract: parsed.data } : { kind: "invalid" };
}

/** Permit legacy or applied Hub records while isolating interrupted and malformed executions. */
export function resolveLoadableHubExecutionContract(
  agentId: string,
  value: unknown,
): HubExecutionContract | undefined {
  const stored = classifyStoredHubExecutionContract(value);
  if (stored.kind === "legacy") return undefined;
  if (stored.kind === "invalid") {
    throw new HubExecutionContractError(
      "hub_execution_contract_invalid",
      `Agent ${agentId} has a malformed Hub execution contract`,
    );
  }
  if (stored.contract.applicationState === "prepared") {
    throw new HubExecutionContractError(
      "hub_execution_contract_incomplete",
      `Agent ${agentId} did not complete Hub execution setup`,
    );
  }
  return stored.contract;
}

function requirePreparedHubExecutionContract(value: HubExecutionContract): HubExecutionContract {
  const parsed = HUB_EXECUTION_CONTRACT_SCHEMA.safeParse(value);
  if (!parsed.success || parsed.data.applicationState !== "prepared") {
    throw new HubExecutionContractError(
      "hub_execution_contract_invalid",
      "Expected a valid prepared Hub execution contract",
    );
  }
  return parsed.data;
}

function sameHubExecutionContract(
  left: HubExecutionContract,
  right: HubExecutionContract,
): boolean {
  return (
    left.protocolVersion === right.protocolVersion &&
    left.executionFingerprint === right.executionFingerprint &&
    left.policyFingerprint === right.policyFingerprint &&
    left.applicationState === right.applicationState
  );
}

function preserveLatestHubExecutionContract(
  existing: StoredAgentRecord | null,
  next: StoredAgentRecord,
): StoredAgentRecord {
  if (existing?.hubExecutionContract === undefined) return next;
  return { ...next, hubExecutionContract: existing.hubExecutionContract };
}

function projectDirNameFromCwd(cwd: string): string {
  const { root } = path.win32.parse(cwd);
  const withoutRoot = cwd.slice(root.length).replace(/[\\/]+$/, "");
  const sanitizedRoot = root.replace(/[:\\/]+/g, "-").replace(/^-+|-+$/g, "");
  const prefix = sanitizedRoot ? sanitizedRoot + "-" : "";
  if (!withoutRoot) {
    return sanitizedRoot || "root";
  }
  return prefix + withoutRoot.replace(/[\\/]+/g, "-");
}
