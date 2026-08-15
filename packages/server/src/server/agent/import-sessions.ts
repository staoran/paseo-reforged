import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { Logger } from "pino";
import type { ProviderSnapshotManager } from "./provider-snapshot-manager.js";
import type {
  AgentManager,
  ManagedAgent,
  ManagedImportableProviderSession,
} from "./agent-manager.js";
import type { AgentMetadataEntry, AgentStorage, StoredAgentRecord } from "./agent-storage.js";
import type { AgentPersistenceHandle, AgentProvider } from "./agent-sdk-types.js";
import { ensureAgentLoaded, type AgentLoaderManager } from "./agent-loading.js";
import { unarchiveAgentState } from "./agent-prompt.js";
import { toRecentProviderSessionDescriptorPayload } from "./agent-projections.js";
import type { WorkspaceProvisioningService } from "../session/workspace-provisioning/workspace-provisioning-service.js";
import type {
  PersistedWorkspaceRecord,
  ProjectRegistry,
  WorkspaceRegistry,
} from "../workspace-registry.js";
import type {
  FetchRecentProviderSessionsRequestMessage,
  ImportAgentRequestMessageSchema,
  RecentProviderSessionDescriptorPayload,
} from "@getpaseo/protocol/messages";
import { getParentAgentIdFromLabels, PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import { createRealpathAwarePathMatcher, normalizePathForIdentity } from "../../utils/path.js";
import { generateWorkspaceId } from "../workspace-registry-model.js";
import {
  type FileProviderSessionImportTransactionStore,
  type ProviderSessionImportRecoveryDependencies,
  type ProviderSessionImportTransaction,
  recoverProviderSessionImportTransaction,
} from "./provider-session-import-transaction.js";

type ImportAgentRequestMessage = z.infer<typeof ImportAgentRequestMessageSchema>;

const METADATA_GENERATION_PROMPT_PREFIX =
  "Generate metadata for a coding agent based on the user prompt.";
const IMPORTABLE_QUERY_CACHE_TTL_MS = 1_000;
const IMPORTABLE_QUERY_CACHE_MAX_SETTLED_ENTRIES = 64;
export type ImportSessionAgentManager = AgentLoaderManager &
  Pick<
    AgentManager,
    | "archiveNativeSessionBestEffort"
    | "archiveSnapshot"
    | "closeAgent"
    | "deleteAgentState"
    | "getDurableTimelineCoverage"
    | "getTimeline"
    | "importProviderSession"
    | "notifyAgentState"
    | "unarchiveSnapshot"
  >;

interface ProviderSessionImportMutation {
  fingerprint: string;
  promise: Promise<ImportProviderSessionResult>;
  keys: Set<string>;
}

const providerSessionImportMutations = new WeakMap<
  ImportSessionAgentManager,
  Map<string, ProviderSessionImportMutation>
>();

interface ImportableQueryCacheEntry {
  promise: Promise<ListImportableProviderSessionsResult>;
  expiresAt: number | null;
}

const importableQueryCache = new WeakMap<object, Map<string, ImportableQueryCacheEntry>>();

export interface NormalizedImportAgentRequest {
  provider: AgentProvider;
  providerHandleId: string;
  cwd?: string;
  workspaceId?: string;
  workspaceTitle?: string | null;
  labels?: Record<string, string>;
  requestId: string;
}

export class ImportSessionsRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ImportSessionsRequestError";
  }
}

export interface ListImportableProviderSessionsInput {
  request: FetchRecentProviderSessionsRequestMessage;
  agentManager: Pick<AgentManager, "listImportableSessions">;
  agentStorage: Pick<AgentStorage, "getMetadataSnapshot">;
  providerSnapshotManager: Pick<ProviderSnapshotManager, "getProviderLabel">;
}

export interface ListImportableProviderSessionsResult {
  entries: RecentProviderSessionDescriptorPayload[];
  filteredAlreadyImportedCount: number;
}

export interface ImportProviderSessionInput {
  request: NormalizedImportAgentRequest;
  workspaceProvisioning: Pick<WorkspaceProvisioningService, "runInImportWorkspace">;
  agentManager: ImportSessionAgentManager;
  agentStorage: AgentStorage;
  transactionStore?: FileProviderSessionImportTransactionStore;
  workspaceRegistry?: Pick<WorkspaceRegistry, "get" | "list" | "remove">;
  projectRegistry?: Pick<ProjectRegistry, "remove" | "upsert">;
  logger: Logger;
}

export interface ImportProviderSessionResult {
  snapshot: ManagedAgent;
  timelineSize: number;
  createdWorkspace: PersistedWorkspaceRecord | null;
}

interface ImportedProviderSession {
  snapshot: ManagedAgent;
  timelineSize: number;
}

// COMPAT(import-agent-request-v1): accept legacy {provider, sessionId} shape
// alongside the new {providerId, providerHandleId} shape. Old clients
// (< target daemon floor) send the legacy fields. Drop the fallbacks and the
// .optional() in messages.ts when the supported client floor is >= the daemon
// version that ships the new shape (target: 2026-11-08).
export function normalizeImportAgentRequest(
  msg: ImportAgentRequestMessage,
): NormalizedImportAgentRequest | { error: string } {
  const provider = msg.providerId ?? msg.provider;
  const providerHandleId = msg.providerHandleId ?? msg.sessionId;
  if (!provider || !providerHandleId) {
    return { error: "Import requires providerId and providerHandleId" };
  }
  return {
    provider: provider as AgentProvider,
    providerHandleId,
    cwd: msg.cwd,
    workspaceId: msg.workspaceId,
    ...(msg.workspaceTitle !== undefined
      ? { workspaceTitle: msg.workspaceTitle?.trim() || null }
      : {}),
    labels: msg.labels,
    requestId: msg.requestId,
  };
}

export async function listImportableProviderSessions(
  input: ListImportableProviderSessionsInput,
): Promise<ListImportableProviderSessionsResult> {
  const { request, agentManager, agentStorage, providerSnapshotManager } = input;
  const limit = request.limit ?? 20;
  const sinceTimestamp = parseRecentProviderSessionsSince(request.since);
  const providerFilter = request.providers ? new Set(request.providers) : undefined;
  const metadata = await agentStorage.getMetadataSnapshot();
  const queryKey = buildImportableQueryKey({
    request,
    limit,
    sinceTimestamp,
    catalogGeneration: metadata.generation,
  });
  const cache = getImportableQueryCache(agentStorage);
  const existing = cache.get(queryKey);
  const now = Date.now();
  if (existing && (existing.expiresAt === null || existing.expiresAt > now)) {
    return cloneImportableResult(await existing.promise);
  }
  if (existing) cache.delete(queryKey);

  const promise = listImportableProviderSessionsSnapshot({
    limit,
    sinceTimestamp,
    request,
    providerFilter,
    metadataEntries: metadata.entries,
    agentManager,
    providerSnapshotManager,
  });
  const entry: ImportableQueryCacheEntry = { promise, expiresAt: null };
  cache.set(queryKey, entry);
  pruneImportableQueryCache(cache, now);
  try {
    const result = await promise;
    if (cache.get(queryKey) === entry) {
      entry.expiresAt = Date.now() + IMPORTABLE_QUERY_CACHE_TTL_MS;
      pruneImportableQueryCache(cache, Date.now());
    }
    return cloneImportableResult(result);
  } catch (error) {
    if (cache.get(queryKey) === entry) cache.delete(queryKey);
    throw error;
  }
}

async function listImportableProviderSessionsSnapshot(input: {
  limit: number;
  sinceTimestamp: number | null;
  request: FetchRecentProviderSessionsRequestMessage;
  providerFilter: Set<string> | undefined;
  metadataEntries: AgentMetadataEntry[];
  agentManager: Pick<AgentManager, "listImportableSessions">;
  providerSnapshotManager: Pick<ProviderSnapshotManager, "getProviderLabel">;
}): Promise<ListImportableProviderSessionsResult> {
  const importedHandles = collectImportedProviderHandles(
    input.metadataEntries,
    input.providerFilter,
  );
  const sessions = await input.agentManager.listImportableSessions({
    limit: input.limit,
    providerFilter: input.providerFilter,
    cwd: input.request.cwd,
  });
  let filteredAlreadyImportedCount = 0;
  const candidates: ManagedImportableProviderSession[] = [];
  const matchesRequestCwd = input.request.cwd
    ? createRealpathAwarePathMatcher(input.request.cwd)
    : null;
  for (const session of sessions) {
    if (matchesRequestCwd && !matchesRequestCwd(session.cwd)) {
      continue;
    }
    if (input.sinceTimestamp !== null && session.lastActivityAt.getTime() < input.sinceTimestamp) {
      continue;
    }
    if (isMetadataGenerationSession(session)) {
      continue;
    }
    if (
      importedHandles.has(toProviderSessionHandleKey(session.provider, session.providerHandleId))
    ) {
      filteredAlreadyImportedCount += 1;
      continue;
    }
    candidates.push(session);
  }

  const entries = candidates
    .sort(
      (a, b) =>
        b.lastActivityAt.getTime() - a.lastActivityAt.getTime() ||
        a.provider.localeCompare(b.provider) ||
        a.providerHandleId.localeCompare(b.providerHandleId),
    )
    .slice(0, input.limit)
    .map((descriptor) =>
      toRecentProviderSessionDescriptorPayload(descriptor, {
        providerLabel: input.providerSnapshotManager.getProviderLabel(descriptor.provider),
      }),
    );

  return { entries, filteredAlreadyImportedCount };
}

export async function importProviderSession(
  input: ImportProviderSessionInput,
): Promise<ImportProviderSessionResult> {
  const cwd = input.request.cwd;
  if (!cwd) {
    throw new Error("Import requires cwd from the selected provider session");
  }
  const initialOwner = await resolveProviderSessionImportOwner(input);
  const initialKeys = buildProviderSessionImportMutationKeys(input.request, initialOwner);
  const fingerprint = buildProviderSessionImportFingerprint(input.request, cwd);
  return await shareProviderSessionImport(
    input.agentManager,
    initialKeys,
    fingerprint,
    // Import commit and compensation ordering is one transaction state machine.
    // eslint-disable-next-line complexity
    async (registerKeys) => {
      await recoverMatchingImportTransactions(input, initialOwner?.entry.id ?? null);
      const owner = await resolveProviderSessionImportOwner(input);
      registerKeys(buildProviderSessionImportMutationKeys(input.request, owner));
      if (owner?.entry && !owner.entry.archivedAt) {
        return await resolveCommittedProviderSessionImport(input, owner.record, cwd);
      }
      if (!input.transactionStore) {
        const result = await runProviderSessionImport(input, cwd, owner, null);
        registerKeys(buildProviderSessionImportMutationKeys(input.request, owner, result.snapshot));
        return result;
      }

      const transactionId = randomUUID();
      const agentId = owner?.entry.id ?? randomUUID();
      registerKeys([toProviderSessionImportAgentMutationKey(agentId)]);
      const plannedWorkspaceId = input.request.workspaceId ? null : generateWorkspaceId();
      let marker = await input.transactionStore.create({
        transactionId,
        kind: owner ? "archived_restore" : "fresh",
        provider: input.request.provider,
        providerHandleId: input.request.providerHandleId,
        requestFingerprint: fingerprint,
        agentId,
        cwd,
        requestedWorkspaceId: input.request.workspaceId ?? null,
        plannedWorkspaceId,
        originalRecord: owner?.record ?? null,
        originalRecordRevision: owner?.entry.recordRevision ?? null,
      });
      try {
        const result = await runProviderSessionImport(input, cwd, owner, marker, (next) => {
          marker = next;
        });
        registerKeys(buildProviderSessionImportMutationKeys(input.request, null, result.snapshot));
        if (marker.kind === "fresh" && marker.phase !== "record_prepared") {
          throw new Error("Provider import completed without a prepared record commit marker");
        }
        await input.transactionStore.remove(transactionId).catch((error) => {
          input.logger.warn(
            { err: error, transactionId, agentId },
            "Provider import committed but transaction marker cleanup was deferred",
          );
        });
        return result;
      } catch (error) {
        let dispositionError: unknown = null;
        if (marker.kind === "archived_restore") {
          try {
            marker = await input.transactionStore.update(marker.transactionId, {
              phase: marker.phase,
              recoveryDisposition: "compensate",
            });
          } catch (updateError) {
            dispositionError = updateError;
            input.logger.warn(
              { err: updateError, transactionId, agentId },
              "Failed to persist archived import compensation intent",
            );
          }
        }
        try {
          await recoverProviderSessionImportTransaction(
            marker,
            buildImportRecoveryDependencies(input),
            { acceptCommitted: marker.kind === "fresh" },
          );
        } catch (recoveryError) {
          // AggregateError preserves the import, disposition, and recovery failures together.
          // eslint-disable-next-line preserve-caught-error
          throw new AggregateError(
            [error, ...(dispositionError ? [dispositionError] : []), recoveryError],
            `Provider import recovery failed for ${input.request.providerHandleId}`,
            { cause: error },
          );
        }
        throw error;
      }
    },
  );
}

interface ResolvedProviderSessionImportOwner {
  entry: AgentMetadataEntry;
  record: StoredAgentRecord;
}

async function importProviderSessionNow(
  input: ImportProviderSessionInput,
  cwd: string,
  workspaceId: string,
  owner: ResolvedProviderSessionImportOwner | null,
  marker: ProviderSessionImportTransaction | null,
  onMarkerUpdated?: (marker: ProviderSessionImportTransaction) => void,
): Promise<ImportedProviderSession> {
  const { provider, providerHandleId, labels } = input.request;
  const archivedRecord = owner?.entry.archivedAt ? owner.record : null;
  if (archivedRecord?.persistence && archivedRecord.archivedAt) {
    if (!createRealpathAwarePathMatcher(cwd)(archivedRecord.cwd)) {
      throw new Error(`Provider session cwd does not match import cwd: ${providerHandleId}`);
    }
    const requestedParentAgentId = getParentAgentIdFromLabels(input.request.labels);
    const labelPatch: Record<string, string | null> = { ...input.request.labels };
    if (
      Object.hasOwn(archivedRecord.labels, PARENT_AGENT_ID_LABEL) ||
      Object.hasOwn(input.request.labels ?? {}, PARENT_AGENT_ID_LABEL)
    ) {
      labelPatch[PARENT_AGENT_ID_LABEL] = requestedParentAgentId;
    }
    await unarchiveAgentState(input.agentStorage, input.agentManager, archivedRecord.id, {
      workspaceId,
      labels: Object.keys(labelPatch).length > 0 ? labelPatch : undefined,
    });
    try {
      const snapshot = await ensureAgentLoaded(archivedRecord.id, {
        agentManager: input.agentManager,
        agentStorage: input.agentStorage,
        logger: input.logger,
      });
      return {
        snapshot,
        timelineSize: input.agentManager.getTimeline(snapshot.id).length,
      };
    } catch (error) {
      if (!marker) {
        await rollbackArchivedImport(input, archivedRecord, archivedRecord.archivedAt);
      }
      throw error;
    }
  }

  const snapshot = await input.agentManager.importProviderSession({
    provider,
    providerHandleId,
    cwd,
    workspaceId,
    ...(input.request.workspaceTitle !== undefined ? { title: input.request.workspaceTitle } : {}),
    labels,
    ...(marker ? { agentId: marker.agentId } : {}),
    ...(marker && input.transactionStore
      ? {
          onPreparedRecord: async (prepared) => {
            const next = await input.transactionStore!.update(marker.transactionId, {
              phase: "record_prepared",
              preparedRecord: prepared,
            });
            onMarkerUpdated?.(next);
          },
        }
      : {}),
  });

  return {
    snapshot,
    timelineSize: await resolveImportedTimelineSize(input.agentManager, snapshot.id),
  };
}

async function resolveImportedTimelineSize(
  agentManager: ImportSessionAgentManager,
  agentId: string,
): Promise<number> {
  if (agentManager.getAgent(agentId)) {
    return agentManager.getTimeline(agentId).length;
  }
  const coverage = await agentManager.getDurableTimelineCoverage(agentId);
  return coverage.active?.window.maxSeq ?? 0;
}

async function shareProviderSessionImport(
  agentManager: ImportSessionAgentManager,
  initialKeys: Iterable<string>,
  fingerprint: string,
  operation: (
    registerKeys: (keys: Iterable<string>) => void,
  ) => Promise<ImportProviderSessionResult>,
): Promise<ImportProviderSessionResult> {
  let mutations = providerSessionImportMutations.get(agentManager);
  if (!mutations) {
    mutations = new Map();
    providerSessionImportMutations.set(agentManager, mutations);
  }

  const normalizedInitialKeys = Array.from(new Set(initialKeys));
  const existingMutations = new Set(
    normalizedInitialKeys
      .map((key) => mutations.get(key))
      .filter((mutation): mutation is ProviderSessionImportMutation => mutation !== undefined),
  );
  if (existingMutations.size > 1) {
    throw new Error(
      "Provider session import aliases are already running in conflicting operations",
    );
  }
  const existing = existingMutations.values().next().value;
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      throw new Error("Provider session import is already running with different parameters");
    }
    return await existing.promise;
  }

  let mutation!: ProviderSessionImportMutation;
  const registerKeys = (keys: Iterable<string>): void => {
    for (const key of keys) {
      const conflicting = mutations.get(key);
      if (conflicting && conflicting !== mutation) {
        throw new Error(
          conflicting.fingerprint === fingerprint
            ? "Provider session import identity converged with another in-flight operation"
            : "Provider session import is already running with different parameters",
        );
      }
      mutations.set(key, mutation);
      mutation.keys.add(key);
    }
  };
  const promise = Promise.resolve().then(() => operation(registerKeys));
  mutation = { fingerprint, promise, keys: new Set() };
  registerKeys(normalizedInitialKeys);
  try {
    return await mutation.promise;
  } finally {
    for (const key of mutation.keys) {
      if (mutations.get(key) === mutation) mutations.delete(key);
    }
  }
}

function buildProviderSessionImportMutationKeys(
  request: Pick<NormalizedImportAgentRequest, "provider" | "providerHandleId">,
  owner: ResolvedProviderSessionImportOwner | null,
  snapshot?: ManagedAgent,
): string[] {
  const handleKeys = new Set<string>([
    toProviderSessionHandleKey(request.provider, request.providerHandleId),
  ]);
  if (owner?.record.persistence) {
    collectProviderSessionHandleKeys(handleKeys, request.provider, owner.record.persistence);
  }
  if (snapshot?.persistence) {
    collectProviderSessionHandleKeys(handleKeys, request.provider, snapshot.persistence);
  }
  return [
    ...Array.from(handleKeys, (key) => `handle\0${key}`),
    ...(owner ? [toProviderSessionImportAgentMutationKey(owner.entry.id)] : []),
    ...(snapshot ? [toProviderSessionImportAgentMutationKey(snapshot.id)] : []),
  ];
}

function toProviderSessionImportAgentMutationKey(agentId: string): string {
  return `agent\0${agentId}`;
}

async function resolveProviderSessionImportOwner(
  input: ImportProviderSessionInput,
): Promise<ResolvedProviderSessionImportOwner | null> {
  const matchingRecords = await input.agentStorage.listByProviderSession(
    input.request.provider,
    input.request.providerHandleId,
  );
  const record = matchingRecords.reduce<StoredAgentRecord | null>((selected, candidate) => {
    if (!selected) return candidate;
    if (Boolean(selected.archivedAt) !== Boolean(candidate.archivedAt)) {
      return candidate.archivedAt ? selected : candidate;
    }
    return Date.parse(candidate.updatedAt) > Date.parse(selected.updatedAt) ? candidate : selected;
  }, null);
  if (!record?.persistence) return null;
  const entry = (await input.agentStorage.getMetadataSnapshot()).entries.find(
    (candidate) => candidate.id === record.id,
  );
  if (!entry) {
    throw new Error(`Indexed provider session metadata is unavailable: ${record.id}`);
  }
  return { entry, record };
}

async function resolveCommittedProviderSessionImport(
  input: ImportProviderSessionInput,
  record: StoredAgentRecord,
  cwd: string,
): Promise<ImportProviderSessionResult> {
  if (!createRealpathAwarePathMatcher(cwd)(record.cwd)) {
    throw new Error(
      `Provider session cwd does not match import cwd: ${input.request.providerHandleId}`,
    );
  }
  if (input.request.workspaceId && record.workspaceId !== input.request.workspaceId) {
    throw new Error(
      `Provider session workspace does not match import workspace: ${input.request.providerHandleId}`,
    );
  }
  const snapshot = await ensureAgentLoaded(record.id, {
    agentManager: input.agentManager,
    agentStorage: input.agentStorage,
    logger: input.logger,
  });
  return {
    snapshot,
    timelineSize: input.agentManager.getTimeline(snapshot.id).length,
    createdWorkspace: null,
  };
}

async function runProviderSessionImport(
  input: ImportProviderSessionInput,
  cwd: string,
  owner: ResolvedProviderSessionImportOwner | null,
  marker: ProviderSessionImportTransaction | null,
  onMarkerUpdated?: (marker: ProviderSessionImportTransaction) => void,
): Promise<ImportProviderSessionResult> {
  const placement = await input.workspaceProvisioning.runInImportWorkspace(
    {
      cwd,
      requestedWorkspaceId: input.request.workspaceId,
      ...(input.request.workspaceTitle !== undefined
        ? { initialTitle: input.request.workspaceTitle }
        : {}),
    },
    (workspace) =>
      importProviderSessionNow(input, cwd, workspace.workspaceId, owner, marker, onMarkerUpdated),
    marker && input.transactionStore
      ? {
          ...(marker.plannedWorkspaceId ? { plannedWorkspaceId: marker.plannedWorkspaceId } : {}),
          onWorkspacePrepared: async (context) => {
            const next = await input.transactionStore!.update(marker.transactionId, {
              phase: "workspace_ready",
              workspaceOwnership: {
                created: context.created,
                workspace: context.workspace,
                previousProjectKnown: true,
                previousProject: context.previousProject,
              },
            });
            onMarkerUpdated?.(next);
          },
        }
      : undefined,
  );
  return { ...placement.value, createdWorkspace: placement.createdWorkspace };
}

async function recoverMatchingImportTransactions(
  input: ImportProviderSessionInput,
  ownerAgentId: string | null,
): Promise<void> {
  if (!input.transactionStore) return;
  const matches = (await input.transactionStore.list()).filter(
    (marker) =>
      (ownerAgentId !== null && marker.agentId === ownerAgentId) ||
      (marker.provider === input.request.provider &&
        marker.providerHandleId === input.request.providerHandleId),
  );
  for (const marker of matches) {
    await recoverProviderSessionImportTransaction(marker, buildImportRecoveryDependencies(input));
  }
}

function buildImportRecoveryDependencies(
  input: ImportProviderSessionInput,
): ProviderSessionImportRecoveryDependencies {
  if (!input.transactionStore || !input.workspaceRegistry || !input.projectRegistry) {
    throw new Error("Provider import transaction recovery dependencies are unavailable");
  }
  return {
    transactionStore: input.transactionStore,
    agentManager: input.agentManager,
    agentStorage: input.agentStorage,
    durableTimelineStore: {
      getCoverage: (agentId, options) =>
        input.agentManager.getDurableTimelineCoverage(agentId, options),
    },
    workspaceRegistry: input.workspaceRegistry,
    projectRegistry: input.projectRegistry,
    archiveNativeSessionBestEffort: input.agentManager.archiveNativeSessionBestEffort.bind(
      input.agentManager,
    ),
    logger: input.logger,
  };
}

function buildProviderSessionImportFingerprint(
  request: NormalizedImportAgentRequest,
  cwd: string,
): string {
  return JSON.stringify({
    provider: request.provider,
    cwd: normalizePathForIdentity(cwd),
    workspaceId: request.workspaceId ?? null,
    workspaceTitle: Object.hasOwn(request, "workspaceTitle")
      ? (request.workspaceTitle ?? null)
      : { omitted: true },
    labels: Object.fromEntries(
      Object.entries(request.labels ?? {}).sort(([left], [right]) => left.localeCompare(right)),
    ),
  });
}

async function rollbackArchivedImport(
  input: ImportProviderSessionInput,
  archivedRecord: StoredAgentRecord,
  archivedAt: string,
): Promise<void> {
  try {
    if (input.agentManager.getAgent(archivedRecord.id)) {
      await input.agentManager.closeAgent(archivedRecord.id);
    }
    await input.agentManager.archiveSnapshot(archivedRecord.id, archivedAt);
  } catch (error) {
    input.logger.error(
      { err: error, agentId: archivedRecord.id },
      "Failed to re-archive provider session after import failure",
    );
  }

  try {
    await input.agentStorage.upsert(archivedRecord);
  } catch (error) {
    input.logger.error(
      { err: error, agentId: archivedRecord.id },
      "Failed to restore archived agent record after import failure",
    );
  }
}

function parseRecentProviderSessionsSince(since: string | undefined): number | null {
  if (!since) {
    return null;
  }
  const timestamp = Date.parse(since);
  if (Number.isNaN(timestamp)) {
    throw new ImportSessionsRequestError("invalid_since", "Invalid recent provider sessions since");
  }
  return timestamp;
}

function collectImportedProviderHandles(
  records: readonly AgentMetadataEntry[],
  providerFilter: Set<string> | undefined,
): Set<string> {
  const handles = new Set<string>();

  const collect = (
    provider: AgentProvider | AgentMetadataEntry["provider"] | string,
    persistence:
      | AgentPersistenceHandle
      | AgentMetadataEntry["persistenceIdentity"]
      | null
      | undefined,
  ) => {
    if (!persistence || (providerFilter && !providerFilter.has(provider))) return;
    collectProviderSessionHandleKeys(handles, provider, persistence);
  };

  for (const record of records) {
    if (record.archivedAt) {
      continue;
    }
    collect(record.provider, record.persistenceIdentity);
  }

  return handles;
}

function buildImportableQueryKey(input: {
  request: FetchRecentProviderSessionsRequestMessage;
  limit: number;
  sinceTimestamp: number | null;
  catalogGeneration: number;
}): string {
  return JSON.stringify({
    providers: input.request.providers ? [...input.request.providers].sort() : null,
    cwd: input.request.cwd ? normalizePathForIdentity(input.request.cwd) : null,
    since: input.sinceTimestamp,
    limit: input.limit,
    catalogGeneration: input.catalogGeneration,
  });
}

function getImportableQueryCache(owner: object): Map<string, ImportableQueryCacheEntry> {
  let cache = importableQueryCache.get(owner);
  if (!cache) {
    cache = new Map();
    importableQueryCache.set(owner, cache);
  }
  return cache;
}

function pruneImportableQueryCache(
  cache: Map<string, ImportableQueryCacheEntry>,
  now: number,
): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt !== null && entry.expiresAt <= now) cache.delete(key);
  }
  if (cache.size <= IMPORTABLE_QUERY_CACHE_MAX_SETTLED_ENTRIES) return;
  for (const [key, entry] of cache) {
    if (entry.expiresAt === null) continue;
    cache.delete(key);
    if (cache.size <= IMPORTABLE_QUERY_CACHE_MAX_SETTLED_ENTRIES) return;
  }
}

function cloneImportableResult(
  result: ListImportableProviderSessionsResult,
): ListImportableProviderSessionsResult {
  return {
    entries: result.entries.map((entry) => ({ ...entry })),
    filteredAlreadyImportedCount: result.filteredAlreadyImportedCount,
  };
}

function toProviderSessionHandleKey(provider: string, providerHandleId: string): string {
  return `${provider}\0${providerHandleId}`;
}

function isMetadataGenerationSession(input: { firstPromptPreview: string | null }): boolean {
  return (
    input.firstPromptPreview?.trimStart().startsWith(METADATA_GENERATION_PROMPT_PREFIX) ?? false
  );
}

function collectProviderSessionHandleKeys(
  target: Set<string>,
  provider: AgentProvider | AgentMetadataEntry["provider"] | string,
  persistence:
    | AgentPersistenceHandle
    | AgentMetadataEntry["persistenceIdentity"]
    | null
    | undefined,
): void {
  if (!persistence) {
    return;
  }

  target.add(toProviderSessionHandleKey(provider, persistence.sessionId));
  if (persistence.nativeHandle) {
    target.add(toProviderSessionHandleKey(provider, persistence.nativeHandle));
  }
}
