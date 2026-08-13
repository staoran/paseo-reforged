import { afterEach, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { createPersistedWorkspaceRecord } from "../workspace-registry.js";
import type { AgentMetadataEntry, StoredAgentRecord } from "./agent-storage.js";
import {
  FileProviderSessionImportTransactionStore,
  type ProviderSessionImportRecoveryDependencies,
  recoverProviderSessionImportTransaction,
} from "./provider-session-import-transaction.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createStore(): FileProviderSessionImportTransactionStore {
  const directory = mkdtempSync(path.join(tmpdir(), "provider-import-transactions-"));
  directories.push(directory);
  return new FileProviderSessionImportTransactionStore(directory);
}

async function markExistingWorkspaceReady(
  store: FileProviderSessionImportTransactionStore,
  transactionId: string,
): Promise<void> {
  await store.update(transactionId, {
    phase: "workspace_ready",
    workspaceOwnership: {
      created: false,
      workspace: createPersistedWorkspaceRecord({
        workspaceId: "workspace-existing",
        projectId: "project-existing",
        cwd: "/tmp/import",
        kind: "directory",
        displayName: "import",
        createdAt: "2026-08-09T00:00:00.000Z",
        updatedAt: "2026-08-09T00:00:00.000Z",
      }),
      previousProjectKnown: true,
      previousProject: null,
    },
  });
}

function makeStoredAgent(input: {
  id: string;
  cwd?: string;
  workspaceId?: string;
  providerHandleId?: string;
  archivedAt?: string | null;
}): StoredAgentRecord {
  const cwd = input.cwd ?? "/tmp/import";
  const providerHandleId = input.providerHandleId ?? "thread-recovery";
  return {
    id: input.id,
    provider: "codex",
    cwd,
    workspaceId: input.workspaceId ?? "workspace-existing",
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
    lastActivityAt: "2026-08-09T00:00:00.000Z",
    lastUserMessageAt: null,
    lastMessageAt: null,
    title: null,
    labels: {},
    config: { provider: "codex", cwd },
    persistence: {
      provider: "codex",
      sessionId: providerHandleId,
      nativeHandle: providerHandleId,
    },
    lastStatus: "closed",
    archivedAt: input.archivedAt ?? null,
  };
}

function makeMetadataEntry(input: {
  id: string;
  workspaceId?: string;
  providerHandleId?: string;
  preparedCommitId?: string;
  timelineRevision?: string;
  archivedAt?: string | null;
}): AgentMetadataEntry {
  const providerHandleId = input.providerHandleId ?? "thread-recovery";
  return {
    id: input.id,
    recordPath: `codex/${input.id}.json`,
    recordRevision: "e".repeat(64),
    provider: "codex",
    cwd: "/tmp/import",
    workspaceId: input.workspaceId ?? "workspace-existing",
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
    lastUserMessageAt: null,
    lastMessageAt: null,
    title: null,
    labels: {},
    lastStatus: "closed",
    lastModeId: null,
    effectiveThinkingOptionId: null,
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    internal: false,
    archivedAt: input.archivedAt ?? null,
    persistenceIdentity: {
      provider: "codex",
      sessionId: providerHandleId,
      nativeHandle: providerHandleId,
    },
    ...(input.preparedCommitId ? { preparedCommitId: input.preparedCommitId } : {}),
    ...(input.timelineRevision ? { timelineRevision: input.timelineRevision } : {}),
  };
}

function createRecoveryHarness(input: {
  storedRecord?: StoredAgentRecord | null;
  handleEntries?: AgentMetadataEntry[];
  metadataEntries?: AgentMetadataEntry[];
  coverageEligible?: boolean;
  workspace?: ReturnType<typeof createPersistedWorkspaceRecord> | null;
  remainingWorkspaces?: ReturnType<typeof createPersistedWorkspaceRecord>[];
}) {
  let workspaceRemoved = false;
  const closeAgent = vi.fn(async () => {});
  const deleteAgentState = vi.fn(async () => {});
  const archiveNativeSessionBestEffort = vi.fn(async () => {});
  const discardPreparedRecord = vi.fn(async () => {});
  const removeRecord = vi.fn(async () => {});
  const upsertRecord = vi.fn(
    async (_record: StoredAgentRecord, _options?: { expectedRecordRevision?: string }) => {},
  );
  const removeWorkspace = vi.fn(async () => {
    workspaceRemoved = true;
  });
  const removeProject = vi.fn(async () => {});
  const upsertProject = vi.fn(async () => {});
  const getCoverage = vi.fn(async () => ({
    active: null,
    working: null,
    eligible: input.coverageEligible ?? false,
  }));
  const dependencies: ProviderSessionImportRecoveryDependencies = {
    transactionStore: createStore(),
    agentManager: {
      getAgent: () => null,
      closeAgent,
      deleteAgentState,
    },
    archiveNativeSessionBestEffort,
    agentStorage: {
      findByPersistenceHandle: async () => input.handleEntries ?? [],
      discardPreparedRecord,
      get: async () => input.storedRecord ?? null,
      getMetadataSnapshot: async () => ({
        generation: 1,
        entries: input.metadataEntries ?? [],
      }),
      remove: removeRecord,
      upsert: upsertRecord,
    },
    durableTimelineStore: {
      getCoverage,
    },
    workspaceRegistry: {
      get: async (workspaceId) =>
        !workspaceRemoved && input.workspace?.workspaceId === workspaceId ? input.workspace : null,
      list: async () => [
        ...(!workspaceRemoved && input.workspace ? [input.workspace] : []),
        ...(input.remainingWorkspaces ?? []),
      ],
      remove: removeWorkspace,
    },
    projectRegistry: { remove: removeProject, upsert: upsertProject },
    logger: createTestLogger(),
  };
  return {
    dependencies,
    closeAgent,
    deleteAgentState,
    archiveNativeSessionBestEffort,
    discardPreparedRecord,
    getCoverage,
    removeRecord,
    upsertRecord,
    removeWorkspace,
    removeProject,
    upsertProject,
  };
}

test("provider import transaction markers persist workspace and prepared-record ownership", async () => {
  const store = createStore();
  const transactionId = "00000000-0000-4000-8000-000000000651";
  const workspace = createPersistedWorkspaceRecord({
    workspaceId: "00000000-0000-4000-8000-000000000652",
    projectId: "project-import",
    cwd: "/tmp/import",
    kind: "directory",
    displayName: "import",
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
  });
  await store.create({
    transactionId,
    kind: "fresh",
    provider: "codex",
    providerHandleId: "thread-1",
    requestFingerprint: "fingerprint",
    agentId: "00000000-0000-4000-8000-000000000653",
    cwd: "/tmp/import",
    requestedWorkspaceId: null,
    plannedWorkspaceId: workspace.workspaceId,
    originalRecord: null,
    originalRecordRevision: null,
  });
  await store.update(transactionId, {
    phase: "workspace_ready",
    workspaceOwnership: {
      created: true,
      workspace,
      previousProjectKnown: true,
      previousProject: null,
    },
  });
  const preparedId = "00000000-0000-4000-8000-000000000654";
  const timelineRevision = "00000000-0000-4000-8000-000000000655";
  await store.update(transactionId, {
    phase: "record_prepared",
    preparedRecord: {
      preparedId,
      recordRevision: "a".repeat(64),
      timelineRevision,
    },
  });

  await expect(store.list()).resolves.toEqual([
    expect.objectContaining({
      transactionId,
      phase: "record_prepared",
      workspaceOwnership: expect.objectContaining({
        created: true,
        workspace: expect.objectContaining({ workspaceId: workspace.workspaceId }),
      }),
      preparedRecord: { preparedId, recordRevision: "a".repeat(64), timelineRevision },
    }),
  ]);
});

test("provider import transaction rejects workspace ownership that does not match its planned id", async () => {
  const store = createStore();
  const transactionId = "00000000-0000-4000-8000-000000000656";
  await store.create({
    transactionId,
    kind: "fresh",
    provider: "codex",
    providerHandleId: "thread-invalid-workspace",
    requestFingerprint: "fingerprint",
    agentId: "00000000-0000-4000-8000-000000000657",
    cwd: "/tmp/import",
    requestedWorkspaceId: null,
    plannedWorkspaceId: "00000000-0000-4000-8000-000000000658",
    originalRecord: null,
    originalRecordRevision: null,
  });

  await expect(
    store.update(transactionId, {
      phase: "workspace_ready",
      workspaceOwnership: {
        created: true,
        workspace: createPersistedWorkspaceRecord({
          workspaceId: "00000000-0000-4000-8000-000000000659",
          projectId: "project-invalid",
          cwd: "/tmp/import",
          kind: "directory",
          displayName: "import",
          createdAt: "2026-08-09T00:00:00.000Z",
          updatedAt: "2026-08-09T00:00:00.000Z",
        }),
        previousProjectKnown: true,
        previousProject: null,
      },
    }),
  ).rejects.toThrow("workspace id does not match marker");
  await expect(store.list()).resolves.toEqual([
    expect.objectContaining({ transactionId, phase: "prepared" }),
  ]);
});

test("provider import recovery recognizes a committed prepared record and clears its marker", async () => {
  const store = createStore();
  const transactionId = "00000000-0000-4000-8000-000000000661";
  const agentId = "00000000-0000-4000-8000-000000000662";
  const preparedId = "00000000-0000-4000-8000-000000000663";
  const timelineRevision = "00000000-0000-4000-8000-000000000664";
  await store.create({
    transactionId,
    kind: "fresh",
    provider: "codex",
    providerHandleId: "thread-committed",
    requestFingerprint: "fingerprint",
    agentId,
    cwd: "/tmp/import",
    requestedWorkspaceId: "workspace-existing",
    plannedWorkspaceId: null,
    originalRecord: null,
    originalRecordRevision: null,
  });
  const committedWorkspace = createPersistedWorkspaceRecord({
    workspaceId: "workspace-existing",
    projectId: "project-existing",
    cwd: "/tmp/import",
    kind: "directory",
    displayName: "import",
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
  });
  await store.update(transactionId, {
    phase: "workspace_ready",
    workspaceOwnership: {
      created: false,
      workspace: committedWorkspace,
      previousProjectKnown: true,
      previousProject: null,
    },
  });
  const marker = await store.update(transactionId, {
    phase: "record_prepared",
    preparedRecord: {
      preparedId,
      recordRevision: "b".repeat(64),
      timelineRevision,
    },
  });
  const discardPreparedRecord = vi.fn(async () => {});

  await expect(
    recoverProviderSessionImportTransaction(marker, {
      transactionStore: store,
      agentManager: {
        getAgent: () => null,
        closeAgent: async () => {},
        deleteAgentState: async () => {},
      },
      archiveNativeSessionBestEffort: async () => {},
      agentStorage: {
        findByPersistenceHandle: async () => [
          {
            id: agentId,
            recordPath: "codex/record.json",
            recordRevision: "b".repeat(64),
            provider: "codex",
            cwd: "/tmp/import",
            workspaceId: "workspace-existing",
            createdAt: "2026-08-09T00:00:00.000Z",
            updatedAt: "2026-08-09T00:00:00.000Z",
            lastUserMessageAt: null,
            lastMessageAt: null,
            title: null,
            labels: {},
            lastStatus: "idle",
            lastModeId: null,
            effectiveThinkingOptionId: null,
            requiresAttention: false,
            attentionReason: null,
            attentionTimestamp: null,
            internal: false,
            archivedAt: null,
            persistenceIdentity: {
              provider: "codex",
              sessionId: "thread-committed",
              nativeHandle: "thread-committed",
            },
            preparedCommitId: preparedId,
            timelineRevision,
          },
        ],
        discardPreparedRecord,
        get: async () => null,
        getMetadataSnapshot: async () => ({ generation: 1, entries: [] }),
        remove: async () => {},
        upsert: async () => {},
      },
      durableTimelineStore: {
        getCoverage: async () => ({ active: null, working: null, eligible: true }),
      },
      workspaceRegistry: {
        get: async () => null,
        list: async () => [],
        remove: async () => {},
      },
      projectRegistry: { remove: async () => {}, upsert: async () => {} },
      logger: createTestLogger(),
    }),
  ).resolves.toBe("committed");
  expect(discardPreparedRecord).toHaveBeenCalledWith(preparedId);
  await expect(store.list()).resolves.toEqual([]);
});

test("provider import recovery accepts a later eligible timeline for the same prepared lineage", async () => {
  const agentId = "00000000-0000-4000-8000-000000000721";
  const preparedId = "00000000-0000-4000-8000-000000000722";
  const initialTimelineRevision = "00000000-0000-4000-8000-000000000723";
  const advancedTimelineRevision = "00000000-0000-4000-8000-000000000724";
  const harness = createRecoveryHarness({
    coverageEligible: true,
    handleEntries: [
      makeMetadataEntry({
        id: agentId,
        providerHandleId: "thread-advanced-timeline",
        preparedCommitId: preparedId,
        timelineRevision: advancedTimelineRevision,
      }),
    ],
  });
  const store = harness.dependencies.transactionStore;
  const transactionId = "00000000-0000-4000-8000-000000000725";
  await store.create({
    transactionId,
    kind: "fresh",
    provider: "codex",
    providerHandleId: "thread-advanced-timeline",
    requestFingerprint: "fingerprint",
    agentId,
    cwd: "/tmp/import",
    requestedWorkspaceId: "workspace-existing",
    plannedWorkspaceId: null,
    originalRecord: null,
    originalRecordRevision: null,
  });
  await markExistingWorkspaceReady(store, transactionId);
  const marker = await store.update(transactionId, {
    phase: "record_prepared",
    preparedRecord: {
      preparedId,
      recordRevision: "7".repeat(64),
      timelineRevision: initialTimelineRevision,
    },
  });

  await expect(recoverProviderSessionImportTransaction(marker, harness.dependencies)).resolves.toBe(
    "committed",
  );
  expect(harness.getCoverage).toHaveBeenCalledWith(agentId, {
    expectedRevision: advancedTimelineRevision,
  });
  expect(harness.discardPreparedRecord).toHaveBeenCalledWith(preparedId);
  await expect(store.list()).resolves.toEqual([]);
});

test("provider import recovery compensates an owned record when timeline commit is incomplete", async () => {
  const transactionId = "00000000-0000-4000-8000-000000000665";
  const agentId = "00000000-0000-4000-8000-000000000666";
  const preparedId = "00000000-0000-4000-8000-000000000667";
  const timelineRevision = "00000000-0000-4000-8000-000000000668";
  const storedRecord = makeStoredAgent({
    id: agentId,
    providerHandleId: "thread-incomplete",
  });
  const harness = createRecoveryHarness({
    storedRecord,
    handleEntries: [
      makeMetadataEntry({
        id: agentId,
        providerHandleId: "thread-incomplete",
        preparedCommitId: preparedId,
        timelineRevision,
      }),
    ],
  });
  const store = harness.dependencies.transactionStore;
  await store.create({
    transactionId,
    kind: "fresh",
    provider: "codex",
    providerHandleId: "thread-incomplete",
    requestFingerprint: "fingerprint",
    agentId,
    cwd: "/tmp/import",
    requestedWorkspaceId: "workspace-existing",
    plannedWorkspaceId: null,
    originalRecord: null,
    originalRecordRevision: null,
  });
  await markExistingWorkspaceReady(store, transactionId);
  const marker = await store.update(transactionId, {
    phase: "record_prepared",
    preparedRecord: {
      preparedId,
      recordRevision: "f".repeat(64),
      timelineRevision,
    },
  });

  await expect(recoverProviderSessionImportTransaction(marker, harness.dependencies)).resolves.toBe(
    "compensated",
  );
  expect(harness.deleteAgentState).toHaveBeenCalledWith(agentId);
  expect(harness.removeRecord).toHaveBeenCalledWith(agentId);
  expect(harness.discardPreparedRecord).toHaveBeenCalledWith(preparedId);
  await expect(store.list()).resolves.toEqual([]);
});

test("provider import recovery refuses to delete a record with foreign prepared lineage", async () => {
  const transactionId = "00000000-0000-4000-8000-000000000675";
  const agentId = "00000000-0000-4000-8000-000000000676";
  const preparedId = "00000000-0000-4000-8000-000000000677";
  const timelineRevision = "00000000-0000-4000-8000-000000000678";
  const harness = createRecoveryHarness({
    storedRecord: makeStoredAgent({
      id: agentId,
      providerHandleId: "thread-foreign",
    }),
    handleEntries: [
      makeMetadataEntry({
        id: agentId,
        providerHandleId: "thread-foreign",
        preparedCommitId: "00000000-0000-4000-8000-000000000679",
        timelineRevision,
      }),
    ],
  });
  const store = harness.dependencies.transactionStore;
  await store.create({
    transactionId,
    kind: "fresh",
    provider: "codex",
    providerHandleId: "thread-foreign",
    requestFingerprint: "fingerprint",
    agentId,
    cwd: "/tmp/import",
    requestedWorkspaceId: "workspace-existing",
    plannedWorkspaceId: null,
    originalRecord: null,
    originalRecordRevision: null,
  });
  await markExistingWorkspaceReady(store, transactionId);
  const marker = await store.update(transactionId, {
    phase: "record_prepared",
    preparedRecord: {
      preparedId,
      recordRevision: "1".repeat(64),
      timelineRevision,
    },
  });

  await expect(
    recoverProviderSessionImportTransaction(marker, harness.dependencies),
  ).rejects.toThrow(`Provider import recovery cannot prove record ownership: ${agentId}`);
  expect(harness.deleteAgentState).not.toHaveBeenCalled();
  expect(harness.removeRecord).not.toHaveBeenCalled();
  await expect(store.list()).resolves.toHaveLength(1);
});

test("archived import recovery restores the original record without deleting its timeline", async () => {
  const transactionId = "00000000-0000-4000-8000-000000000681";
  const agentId = "00000000-0000-4000-8000-000000000682";
  const originalRecord = makeStoredAgent({
    id: agentId,
    providerHandleId: "thread-archived",
    archivedAt: "2026-08-09T01:00:00.000Z",
  });
  const activeRecord = { ...originalRecord, archivedAt: null };
  const harness = createRecoveryHarness({
    storedRecord: activeRecord,
    handleEntries: [
      makeMetadataEntry({
        id: agentId,
        providerHandleId: "thread-archived",
        archivedAt: null,
      }),
    ],
  });
  const store = harness.dependencies.transactionStore;
  const preparedMarker = await store.create({
    transactionId,
    kind: "archived_restore",
    provider: "codex",
    providerHandleId: "thread-archived",
    requestFingerprint: "fingerprint",
    agentId,
    cwd: "/tmp/import",
    requestedWorkspaceId: "workspace-existing",
    plannedWorkspaceId: null,
    originalRecord,
    originalRecordRevision: "2".repeat(64),
  });
  const marker = await store.update(transactionId, {
    phase: preparedMarker.phase,
    recoveryDisposition: "compensate",
  });

  await expect(recoverProviderSessionImportTransaction(marker, harness.dependencies)).resolves.toBe(
    "compensated",
  );
  expect(harness.upsertRecord).toHaveBeenCalledWith(marker.originalRecord, {
    expectedRecordRevision: "e".repeat(64),
  });
  expect(harness.archiveNativeSessionBestEffort).toHaveBeenCalledWith(
    originalRecord.provider,
    originalRecord.persistence,
  );
  expect(harness.deleteAgentState).not.toHaveBeenCalled();
  await expect(store.list()).resolves.toEqual([]);
});

test("archived import recovery refuses to overwrite a foreign active record", async () => {
  const transactionId = "00000000-0000-4000-8000-000000000683";
  const agentId = "00000000-0000-4000-8000-000000000684";
  const originalRecord = makeStoredAgent({
    id: agentId,
    providerHandleId: "thread-archived-owner",
    archivedAt: "2026-08-09T01:00:00.000Z",
  });
  const harness = createRecoveryHarness({
    storedRecord: makeStoredAgent({
      id: agentId,
      providerHandleId: "thread-foreign-owner",
      archivedAt: null,
    }),
    handleEntries: [
      makeMetadataEntry({
        id: agentId,
        providerHandleId: "thread-foreign-owner",
        archivedAt: null,
      }),
    ],
  });
  const store = harness.dependencies.transactionStore;
  const marker = await store.create({
    transactionId,
    kind: "archived_restore",
    provider: "codex",
    providerHandleId: "thread-archived-owner",
    requestFingerprint: "fingerprint",
    agentId,
    cwd: "/tmp/import",
    requestedWorkspaceId: "workspace-existing",
    plannedWorkspaceId: null,
    originalRecord,
    originalRecordRevision: "2".repeat(64),
  });

  await expect(
    recoverProviderSessionImportTransaction(marker, harness.dependencies),
  ).rejects.toThrow(`Provider import recovery cannot prove archived record ownership: ${agentId}`);
  expect(harness.archiveNativeSessionBestEffort).not.toHaveBeenCalled();
  expect(harness.upsertRecord).not.toHaveBeenCalled();
  await expect(store.list()).resolves.toHaveLength(1);
});

test("archived import recovery refuses to overwrite a concurrently edited archived record", async () => {
  const transactionId = "00000000-0000-4000-8000-000000000685";
  const agentId = "00000000-0000-4000-8000-000000000686";
  const originalRecord = makeStoredAgent({
    id: agentId,
    providerHandleId: "thread-archived-edited",
    archivedAt: "2026-08-09T01:00:00.000Z",
  });
  const harness = createRecoveryHarness({
    storedRecord: { ...originalRecord, title: "Concurrent edit" },
    handleEntries: [
      makeMetadataEntry({
        id: agentId,
        providerHandleId: "thread-archived-edited",
        archivedAt: originalRecord.archivedAt,
      }),
    ],
  });
  const store = harness.dependencies.transactionStore;
  const marker = await store.create({
    transactionId,
    kind: "archived_restore",
    provider: "codex",
    providerHandleId: "thread-archived-edited",
    requestFingerprint: "fingerprint",
    agentId,
    cwd: "/tmp/import",
    requestedWorkspaceId: "workspace-existing",
    plannedWorkspaceId: null,
    originalRecord,
    originalRecordRevision: "2".repeat(64),
  });

  await expect(
    recoverProviderSessionImportTransaction(marker, harness.dependencies),
  ).rejects.toThrow(`Provider import recovery cannot prove archived record ownership: ${agentId}`);
  expect(harness.upsertRecord).not.toHaveBeenCalled();
  await expect(store.list()).resolves.toHaveLength(1);
});

test("provider import recovery keeps an owned workspace referenced by an archived agent", async () => {
  const workspace = createPersistedWorkspaceRecord({
    workspaceId: "00000000-0000-4000-8000-000000000691",
    projectId: "project-shared",
    cwd: "/tmp/import",
    kind: "directory",
    displayName: "import",
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
  });
  const harness = createRecoveryHarness({
    workspace,
    metadataEntries: [
      makeMetadataEntry({
        id: "archived-reference",
        workspaceId: workspace.workspaceId,
        providerHandleId: "other-thread",
        archivedAt: "2026-08-09T01:00:00.000Z",
      }),
    ],
  });
  const store = harness.dependencies.transactionStore;
  const transactionId = "00000000-0000-4000-8000-000000000692";
  await store.create({
    transactionId,
    kind: "fresh",
    provider: "codex",
    providerHandleId: "thread-workspace-reference",
    requestFingerprint: "fingerprint",
    agentId: "00000000-0000-4000-8000-000000000693",
    cwd: "/tmp/import",
    requestedWorkspaceId: null,
    plannedWorkspaceId: workspace.workspaceId,
    originalRecord: null,
    originalRecordRevision: null,
  });
  const marker = await store.update(transactionId, {
    phase: "workspace_ready",
    workspaceOwnership: {
      created: true,
      workspace,
      previousProjectKnown: true,
      previousProject: null,
    },
  });

  await expect(recoverProviderSessionImportTransaction(marker, harness.dependencies)).resolves.toBe(
    "compensated",
  );
  expect(harness.removeWorkspace).not.toHaveBeenCalled();
  expect(harness.removeProject).not.toHaveBeenCalled();
});

test("provider import recovery keeps a project that still owns another workspace", async () => {
  const workspace = createPersistedWorkspaceRecord({
    workspaceId: "00000000-0000-4000-8000-000000000695",
    projectId: "project-shared",
    cwd: "/tmp/import",
    kind: "directory",
    displayName: "import",
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
  });
  const otherWorkspace = createPersistedWorkspaceRecord({
    workspaceId: "00000000-0000-4000-8000-000000000696",
    projectId: workspace.projectId,
    cwd: "/tmp/other",
    kind: "directory",
    displayName: "other",
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
  });
  const harness = createRecoveryHarness({ workspace, remainingWorkspaces: [otherWorkspace] });
  const store = harness.dependencies.transactionStore;
  const transactionId = "00000000-0000-4000-8000-000000000697";
  await store.create({
    transactionId,
    kind: "fresh",
    provider: "codex",
    providerHandleId: "thread-project-reference",
    requestFingerprint: "fingerprint",
    agentId: "00000000-0000-4000-8000-000000000698",
    cwd: "/tmp/import",
    requestedWorkspaceId: null,
    plannedWorkspaceId: workspace.workspaceId,
    originalRecord: null,
    originalRecordRevision: null,
  });
  const marker = await store.update(transactionId, {
    phase: "workspace_ready",
    workspaceOwnership: {
      created: true,
      workspace,
      previousProjectKnown: true,
      previousProject: null,
    },
  });

  await expect(recoverProviderSessionImportTransaction(marker, harness.dependencies)).resolves.toBe(
    "compensated",
  );
  expect(harness.removeWorkspace).toHaveBeenCalledWith(workspace.workspaceId);
  expect(harness.removeProject).not.toHaveBeenCalled();
});

test("provider import recovery retries project cleanup after its workspace was removed", async () => {
  const workspace = createPersistedWorkspaceRecord({
    workspaceId: "00000000-0000-4000-8000-000000000731",
    projectId: "project-retry-cleanup",
    cwd: "/tmp/import",
    kind: "directory",
    displayName: "import",
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
  });
  const harness = createRecoveryHarness({ workspace });
  harness.removeProject.mockRejectedValueOnce(new Error("project registry unavailable"));
  const store = harness.dependencies.transactionStore;
  const transactionId = "00000000-0000-4000-8000-000000000732";
  await store.create({
    transactionId,
    kind: "fresh",
    provider: "codex",
    providerHandleId: "thread-project-cleanup-retry",
    requestFingerprint: "fingerprint",
    agentId: "00000000-0000-4000-8000-000000000733",
    cwd: "/tmp/import",
    requestedWorkspaceId: null,
    plannedWorkspaceId: workspace.workspaceId,
    originalRecord: null,
    originalRecordRevision: null,
  });
  const marker = await store.update(transactionId, {
    phase: "workspace_ready",
    workspaceOwnership: {
      created: true,
      workspace,
      previousProjectKnown: true,
      previousProject: null,
    },
  });

  await expect(
    recoverProviderSessionImportTransaction(marker, harness.dependencies),
  ).rejects.toThrow("project registry unavailable");
  expect(harness.removeWorkspace).toHaveBeenCalledTimes(1);
  await expect(store.list()).resolves.toHaveLength(1);

  const [retryMarker] = await store.list();
  await expect(
    recoverProviderSessionImportTransaction(retryMarker, harness.dependencies),
  ).resolves.toBe("compensated");
  expect(harness.removeWorkspace).toHaveBeenCalledTimes(1);
  expect(harness.removeProject).toHaveBeenCalledTimes(2);
  await expect(store.list()).resolves.toEqual([]);
});

test("provider import transaction store fails closed on a corrupt marker", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "provider-import-corrupt-"));
  directories.push(directory);
  writeFileSync(path.join(directory, "00000000-0000-4000-8000-000000000671.json"), "{ invalid");
  const store = new FileProviderSessionImportTransactionStore(directory);

  await expect(store.list()).rejects.toThrow("Invalid provider import transaction marker");
});
