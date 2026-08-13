import { promises as fs } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { Logger } from "pino";

import { writeJsonFileAtomic } from "../atomic-file.js";
import {
  parsePersistedProjectRecord,
  parsePersistedWorkspaceRecord,
  type PersistedProjectRecord,
  type PersistedWorkspaceRecord,
  type ProjectRegistry,
  type WorkspaceRegistry,
} from "../workspace-registry.js";
import {
  parseStoredAgentRecord,
  type AgentMetadataEntry,
  type AgentStorage,
  type StoredAgentRecord,
} from "./agent-storage.js";
import type { AgentPersistenceHandle, AgentProvider } from "./agent-sdk-types.js";
import type { AgentManager } from "./agent-manager.js";
import type { AgentTimelineStore } from "./agent-timeline-store-types.js";
import { createRealpathAwarePathMatcher } from "../../utils/path.js";

const TRANSACTION_VERSION = 1 as const;

const PreparedImportRecordSchema = z.object({
  preparedId: z.string().uuid(),
  recordRevision: z.string().regex(/^[a-f0-9]{64}$/),
  timelineRevision: z.string().uuid(),
});

const WorkspaceOwnershipSchema = z.object({
  created: z.boolean(),
  workspace: z.unknown(),
  previousProjectKnown: z.literal(true),
  previousProject: z.unknown().nullable(),
});

const ProviderSessionImportTransactionSchema = z
  .object({
    version: z.literal(TRANSACTION_VERSION),
    transactionId: z.string().uuid(),
    kind: z.enum(["fresh", "archived_restore"]),
    phase: z.enum(["prepared", "workspace_ready", "record_prepared"]),
    recoveryDisposition: z
      .enum(["commit_or_compensate", "compensate"])
      .default("commit_or_compensate"),
    provider: z.string().min(1),
    providerHandleId: z.string().min(1),
    requestFingerprint: z.string().min(1),
    agentId: z.string().min(1),
    cwd: z.string().min(1),
    requestedWorkspaceId: z.string().min(1).nullable(),
    plannedWorkspaceId: z.string().min(1).nullable(),
    originalRecord: z.unknown().nullable(),
    originalRecordRevision: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    workspaceOwnership: WorkspaceOwnershipSchema.nullable(),
    preparedRecord: PreparedImportRecordSchema.nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .superRefine((value, context) => {
    if (value.requestedWorkspaceId === null && value.plannedWorkspaceId === null) {
      context.addIssue({
        code: "custom",
        path: ["plannedWorkspaceId"],
        message: "Fresh imports without a requested workspace require a planned workspace id",
      });
    }
    if (value.requestedWorkspaceId !== null && value.plannedWorkspaceId !== null) {
      context.addIssue({
        code: "custom",
        path: ["plannedWorkspaceId"],
        message: "Requested workspaces cannot also have a planned workspace id",
      });
    }
    if (value.kind === "fresh") {
      if (value.originalRecord !== null || value.originalRecordRevision !== null) {
        context.addIssue({
          code: "custom",
          path: ["originalRecord"],
          message: "Fresh imports cannot carry an archived record snapshot",
        });
      }
      if (value.phase === "record_prepared" && value.preparedRecord === null) {
        context.addIssue({
          code: "custom",
          path: ["preparedRecord"],
          message: "Prepared fresh imports require prepared record metadata",
        });
      }
    } else {
      if (value.originalRecord === null || value.originalRecordRevision === null) {
        context.addIssue({
          code: "custom",
          path: ["originalRecord"],
          message: "Archived restores require the original record snapshot and revision",
        });
      }
      if (value.phase === "record_prepared" || value.preparedRecord !== null) {
        context.addIssue({
          code: "custom",
          path: ["preparedRecord"],
          message: "Archived restores cannot carry prepared fresh-record metadata",
        });
      }
    }
    if (value.phase === "prepared" && value.workspaceOwnership !== null) {
      context.addIssue({
        code: "custom",
        path: ["workspaceOwnership"],
        message: "Prepared transactions cannot claim workspace ownership",
      });
    }
    if (value.phase !== "prepared" && value.workspaceOwnership === null) {
      context.addIssue({
        code: "custom",
        path: ["workspaceOwnership"],
        message: "Advanced transactions require workspace ownership evidence",
      });
    }
    if (value.phase !== "record_prepared" && value.preparedRecord !== null) {
      context.addIssue({
        code: "custom",
        path: ["preparedRecord"],
        message: "Prepared record metadata is only valid in the record_prepared phase",
      });
    }
  });

export interface ProviderSessionPreparedImportRecord {
  preparedId: string;
  recordRevision: string;
  timelineRevision: string;
}

export interface ProviderSessionImportWorkspaceOwnership {
  created: boolean;
  workspace: PersistedWorkspaceRecord;
  previousProjectKnown: true;
  previousProject: PersistedProjectRecord | null;
}

export interface ProviderSessionImportTransaction {
  version: typeof TRANSACTION_VERSION;
  transactionId: string;
  kind: "fresh" | "archived_restore";
  phase: "prepared" | "workspace_ready" | "record_prepared";
  recoveryDisposition: "commit_or_compensate" | "compensate";
  provider: AgentProvider;
  providerHandleId: string;
  requestFingerprint: string;
  agentId: string;
  cwd: string;
  requestedWorkspaceId: string | null;
  plannedWorkspaceId: string | null;
  originalRecord: StoredAgentRecord | null;
  originalRecordRevision: string | null;
  workspaceOwnership: ProviderSessionImportWorkspaceOwnership | null;
  preparedRecord: ProviderSessionPreparedImportRecord | null;
  createdAt: string;
  updatedAt: string;
}

export type CreateProviderSessionImportTransaction = Omit<
  ProviderSessionImportTransaction,
  | "version"
  | "phase"
  | "recoveryDisposition"
  | "workspaceOwnership"
  | "preparedRecord"
  | "createdAt"
  | "updatedAt"
>;

/** Durable marker store for the small cross-store provider import transaction. */
export class FileProviderSessionImportTransactionStore {
  private readonly directory: string;
  private readonly mutationTails = new Map<string, Promise<void>>();

  constructor(directory: string) {
    this.directory = path.resolve(directory);
  }

  async create(
    input: CreateProviderSessionImportTransaction,
  ): Promise<ProviderSessionImportTransaction> {
    const now = new Date().toISOString();
    const marker = parseProviderSessionImportTransaction({
      ...input,
      version: TRANSACTION_VERSION,
      phase: "prepared",
      recoveryDisposition: "commit_or_compensate",
      workspaceOwnership: null,
      preparedRecord: null,
      createdAt: now,
      updatedAt: now,
    });
    return await this.enqueue(marker.transactionId, async () => {
      if (await fileExists(this.markerPath(marker.transactionId))) {
        throw new Error(`Provider import transaction already exists: ${marker.transactionId}`);
      }
      await writeJsonFileAtomic(this.markerPath(marker.transactionId), marker);
      return cloneTransaction(marker);
    });
  }

  async update(
    transactionId: string,
    patch: {
      phase: ProviderSessionImportTransaction["phase"];
      recoveryDisposition?: ProviderSessionImportTransaction["recoveryDisposition"];
      workspaceOwnership?: ProviderSessionImportWorkspaceOwnership;
      preparedRecord?: ProviderSessionPreparedImportRecord;
    },
  ): Promise<ProviderSessionImportTransaction> {
    return await this.enqueue(transactionId, async () => {
      const current = await this.readRequired(transactionId);
      const next = parseProviderSessionImportTransaction({
        ...current,
        phase: patch.phase,
        ...(patch.recoveryDisposition ? { recoveryDisposition: patch.recoveryDisposition } : {}),
        ...(patch.workspaceOwnership ? { workspaceOwnership: patch.workspaceOwnership } : {}),
        ...(patch.preparedRecord ? { preparedRecord: patch.preparedRecord } : {}),
        updatedAt: new Date().toISOString(),
      });
      await writeJsonFileAtomic(this.markerPath(transactionId), next);
      return cloneTransaction(next);
    });
  }

  async list(): Promise<ProviderSessionImportTransaction[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const markerNames = names.filter((name) => name.endsWith(".json")).sort();
    return await Promise.all(
      markerNames.map(async (name) => {
        const transactionId = path.basename(name, ".json");
        return await this.readRequired(transactionId);
      }),
    );
  }

  async findByIdentity(
    provider: AgentProvider,
    providerHandleId: string,
  ): Promise<ProviderSessionImportTransaction[]> {
    return (await this.list()).filter(
      (marker) => marker.provider === provider && marker.providerHandleId === providerHandleId,
    );
  }

  async remove(transactionId: string): Promise<void> {
    await this.enqueue(transactionId, async () => {
      await fs.rm(this.markerPath(transactionId), { force: true });
    });
  }

  private async readRequired(transactionId: string): Promise<ProviderSessionImportTransaction> {
    assertTransactionId(transactionId);
    let serialized: string;
    try {
      serialized = await fs.readFile(this.markerPath(transactionId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Provider import transaction not found: ${transactionId}`, {
          cause: error,
        });
      }
      throw error;
    }
    try {
      return parseProviderSessionImportTransaction(JSON.parse(serialized));
    } catch (error) {
      throw new Error(`Invalid provider import transaction marker: ${transactionId}`, {
        cause: error,
      });
    }
  }

  private markerPath(transactionId: string): string {
    assertTransactionId(transactionId);
    return path.join(this.directory, `${transactionId}.json`);
  }

  private enqueue<T>(transactionId: string, operation: () => Promise<T>): Promise<T> {
    assertTransactionId(transactionId);
    const previous = this.mutationTails.get(transactionId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tracked = result.then(
      () => undefined,
      () => undefined,
    );
    this.mutationTails.set(transactionId, tracked);
    void tracked.finally(() => {
      if (this.mutationTails.get(transactionId) === tracked) {
        this.mutationTails.delete(transactionId);
      }
    });
    return result;
  }
}

export interface ProviderSessionImportRecoveryDependencies {
  transactionStore: FileProviderSessionImportTransactionStore;
  agentManager: Pick<AgentManager, "closeAgent" | "deleteAgentState" | "getAgent">;
  /** Best-effort provider-side rollback for an archived restore. */
  archiveNativeSessionBestEffort: (
    provider: AgentProvider,
    persistence: AgentPersistenceHandle | null | undefined,
  ) => Promise<void>;
  agentStorage: Pick<
    AgentStorage,
    | "discardPreparedRecord"
    | "findByPersistenceHandle"
    | "get"
    | "getMetadataSnapshot"
    | "remove"
    | "upsert"
  >;
  durableTimelineStore: Pick<AgentTimelineStore, "getCoverage">;
  workspaceRegistry: Pick<WorkspaceRegistry, "get" | "list" | "remove">;
  projectRegistry: Pick<ProjectRegistry, "remove" | "upsert">;
  logger: Pick<Logger, "info" | "warn">;
}

export async function recoverProviderSessionImportTransactions(
  dependencies: ProviderSessionImportRecoveryDependencies,
): Promise<void> {
  for (const marker of await dependencies.transactionStore.list()) {
    await recoverProviderSessionImportTransaction(marker, dependencies);
  }
}

export async function recoverProviderSessionImportTransaction(
  marker: ProviderSessionImportTransaction,
  dependencies: ProviderSessionImportRecoveryDependencies,
  options?: { acceptCommitted?: boolean },
): Promise<"committed" | "compensated"> {
  const acceptCommitted =
    options?.acceptCommitted ?? marker.recoveryDisposition === "commit_or_compensate";
  if (acceptCommitted && (await isImportTransactionCommitted(marker, dependencies))) {
    if (marker.preparedRecord) {
      await dependencies.agentStorage.discardPreparedRecord(marker.preparedRecord.preparedId);
    }
    await dependencies.transactionStore.remove(marker.transactionId);
    dependencies.logger.info(
      { transactionId: marker.transactionId, agentId: marker.agentId },
      "Recovered committed provider session import",
    );
    return "committed";
  }

  await compensateImportTransaction(marker, dependencies);
  await dependencies.transactionStore.remove(marker.transactionId);
  dependencies.logger.info(
    { transactionId: marker.transactionId, agentId: marker.agentId },
    "Compensated incomplete provider session import",
  );
  return "compensated";
}

async function isImportTransactionCommitted(
  marker: ProviderSessionImportTransaction,
  dependencies: ProviderSessionImportRecoveryDependencies,
): Promise<boolean> {
  const entries = await dependencies.agentStorage.findByPersistenceHandle({
    provider: marker.provider,
    sessionId: marker.providerHandleId,
    nativeHandle: marker.providerHandleId,
  });
  const entry = entries.find((candidate) => candidate.id === marker.agentId);
  if (!entry || !matchesImportEntryIdentity(entry, marker)) {
    return false;
  }

  if (marker.kind === "archived_restore") return true;
  const prepared = marker.preparedRecord;
  if (!prepared || !matchesPreparedRecordLineage(entry, prepared) || !entry.timelineRevision) {
    return false;
  }
  // Once the prepared lineage is durable, ordinary timeline commits may advance
  // the timeline revision before the marker is removed. Only the legacy catalog
  // rebuild fallback requires the original timeline revision exactly.
  if (
    entry.preparedCommitId === undefined &&
    entry.timelineRevision !== prepared.timelineRevision
  ) {
    return false;
  }
  const coverage = await dependencies.durableTimelineStore.getCoverage(marker.agentId, {
    expectedRevision: entry.timelineRevision,
  });
  return coverage.eligible;
}

async function compensateImportTransaction(
  marker: ProviderSessionImportTransaction,
  dependencies: ProviderSessionImportRecoveryDependencies,
): Promise<void> {
  if (marker.kind === "fresh") {
    const stored = await dependencies.agentStorage.get(marker.agentId);
    if (stored) {
      const prepared = marker.preparedRecord;
      const ownedEntry = (
        await dependencies.agentStorage.findByPersistenceHandle({
          provider: marker.provider,
          sessionId: marker.providerHandleId,
          nativeHandle: marker.providerHandleId,
        })
      ).find((entry) => entry.id === marker.agentId);
      if (
        !prepared ||
        !ownedEntry ||
        !matchesImportEntryIdentity(ownedEntry, marker) ||
        !matchesPreparedRecordLineage(ownedEntry, prepared)
      ) {
        throw new Error(
          `Provider import recovery cannot prove record ownership: ${marker.agentId}`,
        );
      }
    }
    if (dependencies.agentManager.getAgent(marker.agentId)) {
      await dependencies.agentManager.closeAgent(marker.agentId);
    }
    await dependencies.agentManager.deleteAgentState(marker.agentId);
    if (stored) {
      await dependencies.agentStorage.remove(marker.agentId);
    }
    if (marker.preparedRecord) {
      await dependencies.agentStorage.discardPreparedRecord(marker.preparedRecord.preparedId);
    }
  } else {
    const originalRecord = marker.originalRecord;
    if (!originalRecord) {
      throw new Error(`Archived provider import marker lost original record: ${marker.agentId}`);
    }
    const ownedEntry = await requireOwnedArchivedRestoreEntry(marker, dependencies);
    const hadLiveAgent = Boolean(dependencies.agentManager.getAgent(marker.agentId));
    if (hadLiveAgent) {
      await dependencies.agentManager.closeAgent(marker.agentId);
    }
    const currentEntry = hadLiveAgent
      ? await requireOwnedArchivedRestoreEntry(marker, dependencies)
      : ownedEntry;
    await dependencies.archiveNativeSessionBestEffort(
      originalRecord.provider,
      originalRecord.persistence,
    );
    await dependencies.agentStorage.upsert(originalRecord, {
      expectedRecordRevision: currentEntry.recordRevision,
    });
  }

  await removeOwnedImportWorkspace(marker, dependencies);
}

async function requireOwnedArchivedRestoreEntry(
  marker: ProviderSessionImportTransaction,
  dependencies: ProviderSessionImportRecoveryDependencies,
): Promise<AgentMetadataEntry> {
  const originalRecord = marker.originalRecord;
  const originalRecordRevision = marker.originalRecordRevision;
  if (!originalRecord || !originalRecordRevision) {
    throw new Error(`Archived provider import marker lost original record: ${marker.agentId}`);
  }

  const entries = await dependencies.agentStorage.findByPersistenceHandle({
    provider: marker.provider,
    sessionId: marker.providerHandleId,
    nativeHandle: marker.providerHandleId,
  });
  const entry = entries.find((candidate) => candidate.id === marker.agentId);
  const currentRecord = entry ? await dependencies.agentStorage.get(marker.agentId) : null;
  const ownsActiveRestore =
    entry !== undefined &&
    !entry.archivedAt &&
    entry.createdAt === originalRecord.createdAt &&
    matchesImportEntryIdentity(entry, marker);
  const ownsOriginalArchive =
    entry !== undefined &&
    currentRecord !== null &&
    Boolean(entry.archivedAt) &&
    ((entry.recordRevision === originalRecordRevision &&
      isDeepStrictEqual(currentRecord, originalRecord)) ||
      matchesCompensatedArchivedRecord(currentRecord, originalRecord));
  if (!entry || (!ownsActiveRestore && !ownsOriginalArchive)) {
    throw new Error(
      `Provider import recovery cannot prove archived record ownership: ${marker.agentId}`,
    );
  }
  return entry;
}

function matchesCompensatedArchivedRecord(
  current: StoredAgentRecord,
  original: StoredAgentRecord,
): boolean {
  const { timelineRevision: _currentTimelineRevision, ...currentWithoutTimelineRevision } = current;
  const { timelineRevision: _originalTimelineRevision, ...originalWithoutTimelineRevision } =
    original;
  return isDeepStrictEqual(currentWithoutTimelineRevision, originalWithoutTimelineRevision);
}

// Workspace cleanup keeps all ownership checks together so destructive steps remain visibly guarded.
// eslint-disable-next-line complexity
async function removeOwnedImportWorkspace(
  marker: ProviderSessionImportTransaction,
  dependencies: ProviderSessionImportRecoveryDependencies,
): Promise<void> {
  const ownership = marker.workspaceOwnership;
  const plannedWorkspaceId = marker.plannedWorkspaceId;
  if (ownership && !ownership.created) return;
  if (!ownership && !plannedWorkspaceId) return;

  const workspaceId = ownership?.workspace.workspaceId ?? plannedWorkspaceId!;
  const workspace = await dependencies.workspaceRegistry.get(workspaceId);
  if (!workspace && !ownership) return;
  const expectedWorkspace = ownership?.workspace;
  if (
    workspace &&
    ((expectedWorkspace &&
      (workspace.projectId !== expectedWorkspace.projectId ||
        !createRealpathAwarePathMatcher(expectedWorkspace.cwd)(workspace.cwd))) ||
      !createRealpathAwarePathMatcher(marker.cwd)(workspace.cwd))
  ) {
    dependencies.logger.warn(
      { transactionId: marker.transactionId, workspaceId },
      "Skipped provider import workspace cleanup because ownership changed",
    );
    return;
  }

  const agentReferences = (await dependencies.agentStorage.getMetadataSnapshot()).entries.filter(
    (entry) => entry.workspaceId === workspaceId,
  );
  if (agentReferences.length > 0) {
    dependencies.logger.warn(
      { transactionId: marker.transactionId, workspaceId },
      "Skipped provider import workspace cleanup because it has agent references",
    );
    return;
  }

  if (workspace) {
    await dependencies.workspaceRegistry.remove(workspaceId);
  } else {
    dependencies.logger.warn(
      { transactionId: marker.transactionId, workspaceId },
      "Owned provider import workspace is already absent; continuing project cleanup",
    );
  }
  if (!ownership?.previousProjectKnown) return;
  const projectId = expectedWorkspace?.projectId ?? workspace?.projectId;
  if (!projectId) return;
  const remainingProjectWorkspaces = (await dependencies.workspaceRegistry.list()).filter(
    (candidate) => candidate.projectId === projectId,
  );
  if (remainingProjectWorkspaces.length > 0) return;
  if (ownership.previousProject === null) {
    await dependencies.projectRegistry.remove(projectId);
  } else if (ownership.previousProject.archivedAt) {
    await dependencies.projectRegistry.upsert(ownership.previousProject);
  }
}

function matchesImportEntryIdentity(
  entry: AgentMetadataEntry,
  marker: ProviderSessionImportTransaction,
): boolean {
  if (entry.archivedAt || entry.provider !== marker.provider) return false;
  const persistence = entry.persistenceIdentity;
  if (
    !persistence ||
    (persistence.sessionId !== marker.providerHandleId &&
      persistence.nativeHandle !== marker.providerHandleId)
  ) {
    return false;
  }
  if (!createRealpathAwarePathMatcher(marker.cwd)(entry.cwd)) return false;
  const expectedWorkspaceId =
    marker.workspaceOwnership?.workspace.workspaceId ??
    marker.requestedWorkspaceId ??
    marker.plannedWorkspaceId;
  return expectedWorkspaceId === null || entry.workspaceId === expectedWorkspaceId;
}

function parseProviderSessionImportTransaction(value: unknown): ProviderSessionImportTransaction {
  const parsed = ProviderSessionImportTransactionSchema.parse(value);
  const originalRecord = parsed.originalRecord
    ? parseStoredAgentRecord(parsed.originalRecord)
    : null;
  if (parsed.kind === "archived_restore" && !originalRecord?.archivedAt) {
    throw new Error("Archived provider import transaction requires an archived record snapshot");
  }
  if (parsed.kind === "fresh" && originalRecord !== null) {
    throw new Error("Fresh provider import transaction cannot include an original record");
  }
  const workspaceOwnership = parsed.workspaceOwnership
    ? {
        created: parsed.workspaceOwnership.created,
        workspace: parsePersistedWorkspaceRecord(parsed.workspaceOwnership.workspace),
        previousProjectKnown: true as const,
        previousProject: parsed.workspaceOwnership.previousProject
          ? parsePersistedProjectRecord(parsed.workspaceOwnership.previousProject)
          : null,
      }
    : null;
  validateProviderSessionImportSemantics(parsed, originalRecord, workspaceOwnership);
  return {
    ...parsed,
    provider: parsed.provider as AgentProvider,
    originalRecord,
    workspaceOwnership,
  };
}

function validateProviderSessionImportSemantics(
  parsed: z.infer<typeof ProviderSessionImportTransactionSchema>,
  originalRecord: StoredAgentRecord | null,
  workspaceOwnership: ProviderSessionImportWorkspaceOwnership | null,
): void {
  if (originalRecord) {
    if (originalRecord.id !== parsed.agentId) {
      throw new Error("Provider import transaction archived record id does not match marker");
    }
    if (originalRecord.provider !== parsed.provider || !originalRecord.persistence) {
      throw new Error("Provider import transaction archived record provider does not match marker");
    }
    if (
      originalRecord.persistence.provider !== parsed.provider ||
      (originalRecord.persistence.sessionId !== parsed.providerHandleId &&
        originalRecord.persistence.nativeHandle !== parsed.providerHandleId)
    ) {
      throw new Error("Provider import transaction archived record handle does not match marker");
    }
    if (!createRealpathAwarePathMatcher(parsed.cwd)(originalRecord.cwd)) {
      throw new Error("Provider import transaction archived record cwd does not match marker");
    }
  }

  if (!workspaceOwnership) return;
  const expectedWorkspaceId = parsed.requestedWorkspaceId ?? parsed.plannedWorkspaceId;
  if (!expectedWorkspaceId || workspaceOwnership.workspace.workspaceId !== expectedWorkspaceId) {
    throw new Error("Provider import transaction workspace id does not match marker");
  }
  if (
    (parsed.requestedWorkspaceId !== null && workspaceOwnership.created) ||
    (parsed.plannedWorkspaceId !== null && !workspaceOwnership.created)
  ) {
    throw new Error("Provider import transaction workspace ownership kind does not match marker");
  }
  if (!createRealpathAwarePathMatcher(parsed.cwd)(workspaceOwnership.workspace.cwd)) {
    throw new Error("Provider import transaction workspace cwd does not match marker");
  }
  if (
    workspaceOwnership.previousProject &&
    workspaceOwnership.previousProject.projectId !== workspaceOwnership.workspace.projectId
  ) {
    throw new Error("Provider import transaction previous project does not match workspace");
  }
}

function matchesPreparedRecordLineage(
  entry: AgentMetadataEntry,
  prepared: ProviderSessionPreparedImportRecord,
): boolean {
  return (
    entry.preparedCommitId === prepared.preparedId ||
    (entry.preparedCommitId === undefined && entry.recordRevision === prepared.recordRevision)
  );
}

function cloneTransaction(
  marker: ProviderSessionImportTransaction,
): ProviderSessionImportTransaction {
  return structuredClone(marker);
}

function assertTransactionId(transactionId: string): void {
  z.string().uuid().parse(transactionId);
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
