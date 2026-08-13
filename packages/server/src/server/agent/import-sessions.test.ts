import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  AgentManager,
  ManagedAgent,
  ManagedImportableProviderSession,
} from "./agent-manager.js";
import { AgentStorage, type AgentMetadataEntry, type StoredAgentRecord } from "./agent-storage.js";
import type { FetchRecentProviderSessionsRequestMessage } from "@getpaseo/protocol/messages";
import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import { createPersistedWorkspaceRecord } from "../workspace-registry.js";
import type { WorkspaceProvisioningService } from "../session/workspace-provisioning/workspace-provisioning-service.js";
import { createTestLogger } from "../../test-utils/test-logger.js";
import {
  type ImportSessionAgentManager,
  ImportSessionsRequestError,
  importProviderSession,
  listImportableProviderSessions,
  normalizeImportAgentRequest,
} from "./import-sessions.js";

const directorySymlinkType = process.platform === "win32" ? "junction" : "dir";
const importTestDirectories: string[] = [];

const TEST_CAPABILITIES = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  for (const directory of importTestDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeImportableSession(args: {
  provider?: string;
  sessionId: string;
  nativeHandle?: string;
  cwd?: string;
  title?: string | null;
  lastActivityAt: string;
  firstPrompt?: string;
  lastPrompt?: string;
}): ManagedImportableProviderSession {
  const provider = args.provider ?? "codex";
  const cwd = args.cwd ?? "/tmp/project";
  return {
    provider,
    providerHandleId: args.nativeHandle ?? args.sessionId,
    cwd,
    title: args.title ?? null,
    lastActivityAt: new Date(args.lastActivityAt),
    firstPromptPreview: args.firstPrompt ?? null,
    lastPromptPreview: args.lastPrompt ?? args.firstPrompt ?? null,
  };
}

function makeManagedAgent(args: {
  id?: string;
  provider?: string;
  cwd: string;
  sessionId: string;
  nativeHandle?: string;
  title?: string | null;
}): ManagedAgent {
  const provider = args.provider ?? "codex";
  return {
    id: args.id ?? "00000000-0000-4000-8000-000000000632",
    provider,
    cwd: args.cwd,
    capabilities: TEST_CAPABILITIES,
    config: { provider, cwd: args.cwd, title: args.title },
    createdAt: new Date("2026-04-30T00:00:00.000Z"),
    updatedAt: new Date("2026-04-30T00:00:00.000Z"),
    availableModes: [],
    currentModeId: null,
    pendingPermissions: new Map(),
    bufferedPermissionResolutions: new Map(),
    inFlightPermissionResponses: new Set(),
    pendingReplacement: false,
    persistence: {
      provider,
      sessionId: args.sessionId,
      ...(args.nativeHandle ? { nativeHandle: args.nativeHandle } : {}),
      metadata: { provider, cwd: args.cwd },
    },
    historyPrimed: true,
    lastUserMessageAt: null,
    attention: { requiresAttention: false },
    foregroundTurnWaiters: new Set(),
    finalizedForegroundTurnIds: new Set(),
    unsubscribeSession: null,
    internal: false,
    labels: {},
    lifecycle: "closed",
    session: null,
    activeForegroundTurnId: null,
  } satisfies ManagedAgent;
}

function createImportWorkspace(
  workspaceId: string,
  capturedInputs?: unknown[],
): Pick<WorkspaceProvisioningService, "runInImportWorkspace"> {
  return {
    async runInImportWorkspace(input, operation) {
      capturedInputs?.push(input);
      const workspace = createPersistedWorkspaceRecord({
        workspaceId,
        projectId: `project-${workspaceId}`,
        cwd: input.cwd,
        kind: "directory",
        displayName: "imported",
        createdAt: "2026-04-30T00:00:00.000Z",
        updatedAt: "2026-04-30T00:00:00.000Z",
      });
      return {
        value: await operation(workspace),
        createdWorkspace: null,
      };
    },
  };
}

function makeRequest(
  overrides: Partial<FetchRecentProviderSessionsRequestMessage> = {},
): FetchRecentProviderSessionsRequestMessage {
  return {
    type: "fetch_recent_provider_sessions_request",
    requestId: "recent-provider-sessions",
    ...overrides,
  };
}

function makeAgentMetadataEntry(input: {
  id?: string;
  provider: string;
  archivedAt?: string | null;
  persistenceIdentity: NonNullable<AgentMetadataEntry["persistenceIdentity"]>;
}): AgentMetadataEntry {
  const timestamp = "2026-04-30T00:00:00.000Z";
  return {
    id: input.id ?? `stored-${input.persistenceIdentity.sessionId}`,
    recordPath: `test/${input.id ?? input.persistenceIdentity.sessionId}.json`,
    recordRevision: "0".repeat(64),
    provider: input.provider,
    cwd: "/tmp/project",
    createdAt: timestamp,
    updatedAt: timestamp,
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
    persistenceIdentity: input.persistenceIdentity,
  };
}

test("listImportableProviderSessions filters, sorts, limits, and projects importable sessions", async () => {
  const cwd = "/tmp/project";
  const sessions = [
    makeImportableSession({
      sessionId: "outside-cwd",
      nativeHandle: "outside-cwd-handle",
      cwd: "/tmp/elsewhere",
      title: "Outside cwd",
      lastActivityAt: "2026-04-30T12:05:00.000Z",
    }),
    makeImportableSession({
      sessionId: "stored-session",
      nativeHandle: "stored-handle",
      cwd,
      title: "Already stored",
      lastActivityAt: "2026-04-30T12:04:00.000Z",
      firstPrompt: "stored prompt",
    }),
    makeImportableSession({
      sessionId: "older-session",
      nativeHandle: "older-handle",
      cwd,
      title: "Older than since",
      lastActivityAt: "2026-04-29T23:59:59.000Z",
    }),
    makeImportableSession({
      sessionId: "newer-session",
      nativeHandle: "newer-handle",
      cwd,
      title: "Newer import",
      lastActivityAt: "2026-04-30T12:02:00.000Z",
      firstPrompt: "newer first prompt",
      lastPrompt: "newer last prompt",
    }),
    makeImportableSession({
      sessionId: "second-session",
      nativeHandle: "second-handle",
      cwd,
      title: "Second import",
      lastActivityAt: "2026-04-30T12:00:00.000Z",
      firstPrompt: "second prompt",
    }),
    makeImportableSession({
      sessionId: "third-session",
      nativeHandle: "third-handle",
      cwd,
      title: "Third import",
      lastActivityAt: "2026-04-30T11:59:00.000Z",
      firstPrompt: "third prompt",
    }),
    makeImportableSession({
      sessionId: "live-session",
      nativeHandle: "live-handle",
      cwd,
      title: "Already live",
      lastActivityAt: "2026-04-30T12:01:00.000Z",
      firstPrompt: "live prompt",
    }),
  ];
  const listImportableSessions = vi.fn(async () => sessions);
  const agentManager = {
    listImportableSessions,
  } satisfies Pick<AgentManager, "listImportableSessions">;
  const agentStorage = {
    getMetadataSnapshot: async () => ({
      generation: 1,
      entries: [
        makeAgentMetadataEntry({
          provider: "codex",
          persistenceIdentity: {
            provider: "codex",
            sessionId: "stored-session",
            nativeHandle: "stored-handle",
          },
        }),
        makeAgentMetadataEntry({
          id: "live-agent",
          provider: "codex",
          persistenceIdentity: {
            provider: "codex",
            sessionId: "live-session",
            nativeHandle: "live-handle",
          },
        }),
      ],
    }),
  } satisfies Pick<AgentStorage, "getMetadataSnapshot">;

  const result = await listImportableProviderSessions({
    request: makeRequest({
      cwd,
      providers: ["codex"],
      since: "2026-04-30T00:00:00.000Z",
      limit: 2,
    }),
    agentManager,
    agentStorage,
    providerSnapshotManager: { getProviderLabel: () => "Codex" },
  });

  expect(listImportableSessions).toHaveBeenCalledWith({
    limit: 2,
    providerFilter: new Set(["codex"]),
    cwd,
  });
  expect(result).toEqual({
    filteredAlreadyImportedCount: 2,
    entries: [
      {
        providerId: "codex",
        providerLabel: "Codex",
        providerHandleId: "newer-handle",
        cwd,
        title: "Newer import",
        firstPromptPreview: "newer first prompt",
        lastPromptPreview: "newer last prompt",
        lastActivityAt: "2026-04-30T12:02:00.000Z",
      },
      {
        providerId: "codex",
        providerLabel: "Codex",
        providerHandleId: "second-handle",
        cwd,
        title: "Second import",
        firstPromptPreview: "second prompt",
        lastPromptPreview: "second prompt",
        lastActivityAt: "2026-04-30T12:00:00.000Z",
      },
    ],
  });
});

test("listImportableProviderSessions keeps the provider snapshot bounded after filtering", async () => {
  const cwd = "/tmp/project";
  const imported = makeImportableSession({
    provider: "claude",
    sessionId: "already-imported",
    cwd,
    lastActivityAt: "2026-04-30T12:02:00.000Z",
  });
  const available = makeImportableSession({
    provider: "claude",
    sessionId: "available",
    cwd,
    lastActivityAt: "2026-04-30T12:01:00.000Z",
  });
  const listImportableSessions = vi.fn(async (options?: { limit?: number }) =>
    [imported, available].slice(0, options?.limit),
  );

  const result = await listImportableProviderSessions({
    request: makeRequest({ cwd, providers: ["claude"], limit: 1 }),
    agentManager: {
      listImportableSessions,
    },
    agentStorage: {
      getMetadataSnapshot: async () => ({
        generation: 1,
        entries: [
          makeAgentMetadataEntry({
            provider: "claude",
            persistenceIdentity: { provider: "claude", sessionId: "already-imported" },
          }),
        ],
      }),
    },
    providerSnapshotManager: { getProviderLabel: () => "Claude Code" },
  });

  expect(listImportableSessions).toHaveBeenCalledWith({
    limit: 1,
    providerFilter: new Set(["claude"]),
    cwd,
  });
  expect(result.entries).toEqual([]);
  expect(result.filteredAlreadyImportedCount).toBe(1);
});

test("listImportableProviderSessions does not scale provider limit with imported metadata", async () => {
  const cwd = "/tmp/project";
  const listImportableSessions = vi.fn(async () => []);
  const entries = Array.from({ length: 1_000 }, (_, index) =>
    makeAgentMetadataEntry({
      id: `stored-${index}`,
      provider: "codex",
      persistenceIdentity: {
        provider: "codex",
        sessionId: `session-${index}`,
      },
    }),
  );

  await listImportableProviderSessions({
    request: makeRequest({ cwd, providers: ["codex"], limit: 20 }),
    agentManager: { listImportableSessions },
    agentStorage: {
      getMetadataSnapshot: async () => ({ generation: 42, entries }),
    },
    providerSnapshotManager: { getProviderLabel: () => "Codex" },
  });

  expect(listImportableSessions).toHaveBeenCalledWith({
    limit: 20,
    providerFilter: new Set(["codex"]),
    cwd,
  });
});

test("listImportableProviderSessions shares in-flight work and invalidates by generation and TTL", async () => {
  const cwd = "/tmp/project";
  let generation = 1;
  let now = 10_000;
  const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
  const listImportableSessions = vi.fn(async () => [
    makeImportableSession({
      sessionId: "available",
      cwd,
      lastActivityAt: "2026-04-30T12:00:00.000Z",
    }),
  ]);
  const input = {
    request: makeRequest({ cwd, providers: ["codex"], limit: 20 }),
    agentManager: { listImportableSessions },
    agentStorage: {
      getMetadataSnapshot: async () => ({ generation, entries: [] }),
    },
    providerSnapshotManager: { getProviderLabel: () => "Codex" },
  } satisfies Parameters<typeof listImportableProviderSessions>[0];

  try {
    const [first, concurrent] = await Promise.all([
      listImportableProviderSessions(input),
      listImportableProviderSessions(input),
    ]);
    expect(listImportableSessions).toHaveBeenCalledTimes(1);
    expect(concurrent).toEqual(first);
    concurrent.entries[0].title = "caller mutation";

    const cached = await listImportableProviderSessions(input);
    expect(listImportableSessions).toHaveBeenCalledTimes(1);
    expect(cached.entries[0].title).not.toBe("caller mutation");

    generation = 2;
    await listImportableProviderSessions(input);
    expect(listImportableSessions).toHaveBeenCalledTimes(2);

    now += 1_001;
    await listImportableProviderSessions(input);
    expect(listImportableSessions).toHaveBeenCalledTimes(3);
  } finally {
    nowSpy.mockRestore();
  }
});

test("listImportableProviderSessions does not cache provider failures", async () => {
  const listImportableSessions = vi
    .fn()
    .mockRejectedValueOnce(new Error("provider listing failed"))
    .mockResolvedValueOnce([]);
  const input = {
    request: makeRequest({ providers: ["codex"] }),
    agentManager: { listImportableSessions },
    agentStorage: {
      getMetadataSnapshot: async () => ({ generation: 1, entries: [] }),
    },
    providerSnapshotManager: { getProviderLabel: () => "Codex" },
  } satisfies Parameters<typeof listImportableProviderSessions>[0];

  await expect(listImportableProviderSessions(input)).rejects.toThrow("provider listing failed");
  await expect(listImportableProviderSessions(input)).resolves.toEqual({
    entries: [],
    filteredAlreadyImportedCount: 0,
  });
  expect(listImportableSessions).toHaveBeenCalledTimes(2);
});

test("listImportableProviderSessions bounds settled query cache entries", async () => {
  const listImportableSessions = vi.fn(async () => []);
  const agentStorage = {
    getMetadataSnapshot: async () => ({ generation: 1, entries: [] }),
  } satisfies Pick<AgentStorage, "getMetadataSnapshot">;

  for (let index = 0; index < 66; index += 1) {
    await listImportableProviderSessions({
      request: makeRequest({ cwd: `/tmp/project-${index}`, providers: ["codex"] }),
      agentManager: { listImportableSessions },
      agentStorage,
      providerSnapshotManager: { getProviderLabel: () => "Codex" },
    });
  }
  expect(listImportableSessions).toHaveBeenCalledTimes(66);

  await listImportableProviderSessions({
    request: makeRequest({ cwd: "/tmp/project-0", providers: ["codex"] }),
    agentManager: { listImportableSessions },
    agentStorage,
    providerSnapshotManager: { getProviderLabel: () => "Codex" },
  });
  expect(listImportableSessions).toHaveBeenCalledTimes(67);
});

test("listImportableProviderSessions includes a provider session after its Paseo agent is archived", async () => {
  const cwd = "/tmp/project";
  const archivedSession = makeImportableSession({
    provider: "claude",
    sessionId: "archived-session",
    cwd,
    title: "Archived import",
    lastActivityAt: "2026-04-30T12:00:00.000Z",
    firstPrompt: "import me again",
  });

  const result = await listImportableProviderSessions({
    request: makeRequest({ cwd, providers: ["claude"] }),
    agentManager: {
      listImportableSessions: async () => [archivedSession],
    },
    agentStorage: {
      getMetadataSnapshot: async () => ({
        generation: 1,
        entries: [
          makeAgentMetadataEntry({
            provider: "claude",
            archivedAt: "2026-04-30T12:01:00.000Z",
            persistenceIdentity: {
              provider: "claude",
              sessionId: "archived-session",
            },
          }),
        ],
      }),
    },
    providerSnapshotManager: { getProviderLabel: () => "Claude" },
  });

  expect(result.entries.map((entry) => entry.providerHandleId)).toEqual(["archived-session"]);
  expect(result.filteredAlreadyImportedCount).toBe(0);
});

test("listImportableProviderSessions includes an archived provider session still loaded in memory", async () => {
  const cwd = "/tmp/project";
  const agentId = "00000000-0000-4000-8000-000000000633";
  const archivedSession = makeImportableSession({
    provider: "claude",
    sessionId: "archived-live-session",
    cwd,
    title: "Archived live import",
    lastActivityAt: "2026-04-30T12:00:00.000Z",
    firstPrompt: "import the loaded session again",
  });

  const result = await listImportableProviderSessions({
    request: makeRequest({ cwd, providers: ["claude"] }),
    agentManager: {
      listImportableSessions: async () => [archivedSession],
    },
    agentStorage: {
      getMetadataSnapshot: async () => ({
        generation: 1,
        entries: [
          makeAgentMetadataEntry({
            id: agentId,
            provider: "claude",
            archivedAt: "2026-04-30T12:01:00.000Z",
            persistenceIdentity: {
              provider: "claude",
              sessionId: "archived-live-session",
            },
          }),
        ],
      }),
    },
    providerSnapshotManager: { getProviderLabel: () => "Claude" },
  });

  expect(result.entries.map((entry) => entry.providerHandleId)).toEqual(["archived-live-session"]);
  expect(result.filteredAlreadyImportedCount).toBe(0);
});

test("listImportableProviderSessions filters out metadata generation sessions", async () => {
  const cwd = "/tmp/project";
  const sessions = [
    makeImportableSession({
      sessionId: "metadata-session",
      nativeHandle: "metadata-handle",
      cwd,
      title: "Generate metadata for a coding agent based on the user prom...",
      lastActivityAt: "2026-04-30T12:05:00.000Z",
      firstPrompt:
        "Generate metadata for a coding agent based on the user prompt.\nTitle: short descriptive label (<= 40 chars).",
    }),
    makeImportableSession({
      sessionId: "real-session",
      nativeHandle: "real-handle",
      cwd,
      title: "Real session",
      lastActivityAt: "2026-04-30T12:00:00.000Z",
      firstPrompt: "hey hey",
    }),
  ];

  const result = await listImportableProviderSessions({
    request: makeRequest({ cwd, providers: ["codex"] }),
    agentManager: {
      listImportableSessions: async () => sessions,
    } satisfies Pick<AgentManager, "listImportableSessions">,
    agentStorage: {
      getMetadataSnapshot: async () => ({ generation: 1, entries: [] }),
    } satisfies Pick<AgentStorage, "getMetadataSnapshot">,
    providerSnapshotManager: { getProviderLabel: () => "Codex" },
  });

  expect(result.entries).toHaveLength(1);
  expect(result.entries[0].providerHandleId).toBe("real-handle");
  expect(result.filteredAlreadyImportedCount).toBe(0);
});

test("listImportableProviderSessions keeps realpath-equivalent cwd matches", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "paseo-import-cwd-"));
  const realCwd = path.join(root, "real-project");
  const linkedCwd = path.join(root, "linked-project");
  mkdirSync(realCwd, { recursive: true });
  symlinkSync(realCwd, linkedCwd, directorySymlinkType);
  const persistedCwd = realpathSync(linkedCwd);

  const result = await listImportableProviderSessions({
    request: makeRequest({ cwd: linkedCwd, providers: ["pi"] }),
    agentManager: {
      listImportableSessions: async () => [
        makeImportableSession({
          provider: "pi",
          sessionId: "pi-session",
          nativeHandle: "pi-handle",
          cwd: persistedCwd,
          title: "Pi session",
          lastActivityAt: "2026-04-30T12:00:00.000Z",
          firstPrompt: "remember this",
        }),
      ],
    } satisfies Pick<AgentManager, "listImportableSessions">,
    agentStorage: {
      getMetadataSnapshot: async () => ({ generation: 1, entries: [] }),
    } satisfies Pick<AgentStorage, "getMetadataSnapshot">,
    providerSnapshotManager: { getProviderLabel: () => "Pi" },
  });

  expect(result.entries.map((entry) => entry.providerHandleId)).toEqual(["pi-handle"]);
});

test("listImportableProviderSessions rejects invalid since values", async () => {
  await expect(
    listImportableProviderSessions({
      request: makeRequest({ since: "not-a-date" }),
      agentManager: {
        listImportableSessions: async () => [],
      } satisfies Pick<AgentManager, "listImportableSessions">,
      agentStorage: {
        getMetadataSnapshot: async () => ({ generation: 1, entries: [] }),
      } satisfies Pick<AgentStorage, "getMetadataSnapshot">,
      providerSnapshotManager: { getProviderLabel: () => "" },
    }),
  ).rejects.toMatchObject(
    new ImportSessionsRequestError("invalid_since", "Invalid recent provider sessions since"),
  );
});

test("normalizeImportAgentRequest accepts new and legacy import handle shapes", () => {
  expect(
    normalizeImportAgentRequest({
      type: "import_agent_request",
      requestId: "new-shape",
      providerId: "custom-codex",
      providerHandleId: "thread-1",
    }),
  ).toEqual({
    requestId: "new-shape",
    provider: "custom-codex",
    providerHandleId: "thread-1",
  });

  expect(
    normalizeImportAgentRequest({
      type: "import_agent_request",
      requestId: "legacy-shape",
      provider: "codex",
      sessionId: "thread-2",
    }),
  ).toEqual({
    requestId: "legacy-shape",
    provider: "codex",
    providerHandleId: "thread-2",
  });
});

test("normalizeImportAgentRequest trims import titles without collapsing omitted and null", () => {
  const titled = normalizeImportAgentRequest({
    type: "import_agent_request",
    requestId: "titled",
    providerId: "custom-codex",
    providerHandleId: "thread-1",
    workspaceTitle: "  Imported session  ",
  });
  const blank = normalizeImportAgentRequest({
    type: "import_agent_request",
    requestId: "blank",
    providerId: "custom-codex",
    providerHandleId: "thread-2",
    workspaceTitle: "   ",
  });
  const untitled = normalizeImportAgentRequest({
    type: "import_agent_request",
    requestId: "untitled",
    providerId: "custom-codex",
    providerHandleId: "thread-3",
    workspaceTitle: null,
  });
  const legacy = normalizeImportAgentRequest({
    type: "import_agent_request",
    requestId: "legacy",
    providerId: "custom-codex",
    providerHandleId: "thread-4",
  });

  expect(titled).toHaveProperty("workspaceTitle", "Imported session");
  expect(blank).toHaveProperty("workspaceTitle", null);
  expect(untitled).toHaveProperty("workspaceTitle", null);
  expect(legacy).not.toHaveProperty("workspaceTitle");
});

function makeStoredProviderSession(input: {
  id: string;
  cwd: string;
  sessionId: string;
  nativeHandle?: string;
  workspaceId?: string;
  title?: string | null;
  labels?: Record<string, string>;
  archivedAt?: string | null;
}): StoredAgentRecord {
  return {
    id: input.id,
    provider: "codex",
    cwd: input.cwd,
    workspaceId: input.workspaceId ?? "ws-archived",
    createdAt: "2026-04-30T10:00:00.000Z",
    updatedAt: "2026-04-30T11:00:00.000Z",
    lastActivityAt: "2026-04-30T10:30:00.000Z",
    lastUserMessageAt: null,
    title: input.title ?? null,
    labels: input.labels ?? {},
    config: { provider: "codex", cwd: input.cwd },
    persistence: {
      provider: "codex",
      sessionId: input.sessionId,
      nativeHandle: input.nativeHandle ?? input.sessionId,
      metadata: { provider: "codex", cwd: input.cwd },
    },
    archivedAt: input.archivedAt === undefined ? "2026-04-30T12:00:00.000Z" : input.archivedAt,
  };
}

class ProviderImportHarness {
  readonly storage: AgentStorage;
  readonly manager: ImportSessionAgentManager;
  readonly snapshot: ManagedAgent;
  readonly freshImports: unknown[] = [];
  readonly workspaceInputs: unknown[] = [];
  readonly closedAgentIds: string[] = [];
  timeline: AgentTimelineItem[] = [];
  activeAgent: ManagedAgent | null = null;
  resumeError: Error | null = null;
  resumeAttempts = 0;
  unarchiveAttempts = 0;
  freshImportError: Error | null = null;
  keepFreshImportLive = true;
  durableTimelineSize: number | null = null;
  private unarchiveWait: Promise<void> | null = null;
  private releaseUnarchive: (() => void) | null = null;
  private freshImportWait: Promise<void> | null = null;
  private releaseFreshImport: (() => void) | null = null;

  private constructor(input: { storage: AgentStorage; snapshot: ManagedAgent }) {
    this.storage = input.storage;
    this.snapshot = input.snapshot;
    this.manager = {
      importProviderSession: async (request: unknown) => {
        this.freshImports.push(request);
        if (this.freshImportWait) await this.freshImportWait;
        if (this.freshImportError) throw this.freshImportError;
        if (this.keepFreshImportLive) this.activeAgent = this.snapshot;
        return this.snapshot;
      },
      unarchiveSnapshot: async (
        agentId: string,
        updates?: { workspaceId?: string; labels?: Record<string, string | null> },
      ) => {
        this.unarchiveAttempts += 1;
        if (this.unarchiveWait) {
          await this.unarchiveWait;
        }
        const record = await this.storage.get(agentId);
        if (!record?.archivedAt) {
          return false;
        }
        const labels = { ...record.labels };
        for (const [key, value] of Object.entries(updates?.labels ?? {})) {
          if (value === null) {
            delete labels[key];
          } else {
            labels[key] = value;
          }
        }
        await this.storage.upsert({
          ...record,
          workspaceId: updates?.workspaceId ?? record.workspaceId,
          labels,
          archivedAt: null,
        });
        return true;
      },
      notifyAgentState: () => {},
      getAgent: () => this.activeAgent,
      getRegisteredProviderIds: () => ["codex"],
      createAgent: async () => {
        throw new Error("Stored provider imports must resume their persisted session");
      },
      resumeAgentFromPersistence: async (
        _handle: unknown,
        _overrides: unknown,
        _agentId?: string,
        _options?: unknown,
      ) => {
        this.resumeAttempts += 1;
        if (this.resumeError) {
          this.activeAgent = this.snapshot;
          throw this.resumeError;
        }
        this.activeAgent = this.snapshot;
        return this.snapshot;
      },
      hydrateTimelineFromProvider: async () => {},
      getTimeline: () => this.timeline,
      getDurableTimelineCoverage: async () =>
        this.durableTimelineSize === null
          ? { active: null, working: null, eligible: false }
          : {
              active: {
                generationId: "00000000-0000-4000-8000-000000000633",
                timelineRevision: "00000000-0000-4000-8000-000000000634",
                epoch: "00000000-0000-4000-8000-000000000635",
                window: {
                  minSeq: this.durableTimelineSize === 0 ? 0 : 1,
                  maxSeq: this.durableTimelineSize,
                  nextSeq: this.durableTimelineSize + 1,
                },
                valid: true,
              },
              working: null,
              eligible: true,
            },
      deleteAgentState: async (agentId: string) => {
        if (this.activeAgent?.id === agentId) this.activeAgent = null;
      },
      closeAgent: async (agentId: string) => {
        this.closedAgentIds.push(agentId);
        this.activeAgent = null;
      },
      archiveSnapshot: async (agentId: string, archivedAt: string) => {
        const record = await this.storage.get(agentId);
        if (!record) {
          throw new Error("Agent not found: " + agentId);
        }
        const archived = { ...record, archivedAt };
        await this.storage.upsert(archived);
        return archived;
      },
      archiveNativeSessionBestEffort: async () => {},
    } satisfies ImportSessionAgentManager;
  }

  static async create(
    input: {
      id?: string;
      cwd?: string;
      sessionId?: string;
      nativeHandle?: string;
    } = {},
  ): Promise<ProviderImportHarness> {
    const directory = mkdtempSync(path.join(tmpdir(), "provider-import-"));
    importTestDirectories.push(directory);
    const storage = new AgentStorage(path.join(directory, "agents"), createTestLogger());
    await storage.initialize();
    const cwd = input.cwd ?? "/tmp/imported-agent";
    const sessionId = input.sessionId ?? "thread-imported";
    const snapshot = makeManagedAgent({
      id: input.id,
      provider: "codex",
      cwd,
      sessionId,
      nativeHandle: input.nativeHandle,
    });
    return new ProviderImportHarness({ storage, snapshot });
  }

  async seed(record: StoredAgentRecord): Promise<void> {
    await this.storage.upsert(record);
  }

  blockUnarchive(): () => void {
    this.unarchiveWait = new Promise<void>((resolve) => {
      this.releaseUnarchive = resolve;
    });
    return () => {
      this.releaseUnarchive?.();
      this.unarchiveWait = null;
      this.releaseUnarchive = null;
    };
  }

  blockFreshImport(): () => void {
    this.freshImportWait = new Promise<void>((resolve) => {
      this.releaseFreshImport = resolve;
    });
    return () => {
      this.releaseFreshImport?.();
      this.freshImportWait = null;
      this.releaseFreshImport = null;
    };
  }

  import(input: {
    providerHandleId: string;
    cwd?: string;
    workspaceTitle?: string | null;
    labels?: Record<string, string>;
  }) {
    return importProviderSession({
      request: {
        requestId: "import-thread",
        provider: "codex",
        providerHandleId: input.providerHandleId,
        cwd: input.cwd,
        ...(input.workspaceTitle !== undefined ? { workspaceTitle: input.workspaceTitle } : {}),
        labels: input.labels,
      },
      workspaceProvisioning: createImportWorkspace("ws-restored", this.workspaceInputs),
      agentManager: this.manager,
      agentStorage: this.storage,
      logger: createTestLogger(),
    });
  }
}

test("importProviderSession uses the provider import path with the requested labels", async () => {
  const harness = await ProviderImportHarness.create();
  harness.timeline = [
    { type: "user_message", text: "Trace recent provider sessions" },
    { type: "assistant_message", text: "I will inspect the provider listing." },
  ];

  const result = await harness.import({
    providerHandleId: "thread-imported",
    cwd: "/tmp/imported-agent",
    labels: { source: "import" },
  });

  expect(harness.freshImports).toEqual([
    {
      provider: "codex",
      providerHandleId: "thread-imported",
      cwd: "/tmp/imported-agent",
      workspaceId: "ws-restored",
      labels: { source: "import" },
    },
  ]);
  expect(harness.workspaceInputs[0]).not.toHaveProperty("initialTitle");
  expect(result).toEqual({
    snapshot: harness.snapshot,
    timelineSize: 2,
    createdWorkspace: null,
  });
});

test.each([
  ["Provider session title", "Provider session title"],
  [null, null],
] as const)(
  "importProviderSession passes workspace title %s to fresh workspace and agent inputs",
  async (workspaceTitle, expectedTitle) => {
    const harness = await ProviderImportHarness.create();

    await harness.import({
      providerHandleId: "thread-imported",
      cwd: "/tmp/imported-agent",
      workspaceTitle,
    });

    expect(harness.workspaceInputs[0]).toHaveProperty("initialTitle", expectedTitle);
    expect(harness.freshImports[0]).toHaveProperty("title", expectedTitle);
  },
);

test("importProviderSession returns the existing agent for an active stored owner", async () => {
  const harness = await ProviderImportHarness.create({ sessionId: "thread-active" });
  await harness.seed(
    makeStoredProviderSession({
      id: harness.snapshot.id,
      cwd: harness.snapshot.cwd,
      sessionId: "thread-active",
      archivedAt: null,
    }),
  );

  await expect(
    harness.import({ providerHandleId: "thread-active", cwd: harness.snapshot.cwd }),
  ).resolves.toMatchObject({
    snapshot: { id: harness.snapshot.id },
    createdWorkspace: null,
  });
  expect(harness.freshImports).toEqual([]);
});

test("importProviderSession shares one in-flight import for matching parameters", async () => {
  const harness = await ProviderImportHarness.create({ sessionId: "thread-shared" });
  const releaseImport = harness.blockFreshImport();

  const first = harness.import({
    providerHandleId: "thread-shared",
    cwd: harness.snapshot.cwd,
    labels: { source: "shared" },
  });
  const second = harness.import({
    providerHandleId: "thread-shared",
    cwd: harness.snapshot.cwd,
    labels: { source: "shared" },
  });
  await vi.waitFor(() => expect(harness.freshImports).toHaveLength(1));
  releaseImport();

  await expect(Promise.all([first, second])).resolves.toEqual([
    expect.objectContaining({ snapshot: expect.objectContaining({ id: harness.snapshot.id }) }),
    expect.objectContaining({ snapshot: expect.objectContaining({ id: harness.snapshot.id }) }),
  ]);
  expect(harness.freshImports).toHaveLength(1);
});

test("importProviderSession rejects conflicting parameters while an import is in flight", async () => {
  const harness = await ProviderImportHarness.create({ sessionId: "thread-conflict" });
  const releaseImport = harness.blockFreshImport();

  const first = harness.import({
    providerHandleId: "thread-conflict",
    cwd: harness.snapshot.cwd,
    workspaceTitle: "First title",
  });
  await vi.waitFor(() => expect(harness.freshImports).toHaveLength(1));
  const conflicting = harness.import({
    providerHandleId: "thread-conflict",
    cwd: harness.snapshot.cwd,
    workspaceTitle: "Different title",
  });

  await expect(conflicting).rejects.toThrow(
    "Provider session import is already running with different parameters",
  );
  releaseImport();
  await expect(first).resolves.toMatchObject({ snapshot: { id: harness.snapshot.id } });
  expect(harness.freshImports).toHaveLength(1);
});

test("importProviderSession evicts a settled failure so the same handle can retry", async () => {
  const harness = await ProviderImportHarness.create({ sessionId: "thread-retry" });
  harness.freshImportError = new Error("provider import failed");

  await expect(
    harness.import({ providerHandleId: "thread-retry", cwd: harness.snapshot.cwd }),
  ).rejects.toThrow("provider import failed");
  harness.freshImportError = null;
  await expect(
    harness.import({ providerHandleId: "thread-retry", cwd: harness.snapshot.cwd }),
  ).resolves.toMatchObject({ snapshot: { id: harness.snapshot.id } });
  expect(harness.freshImports).toHaveLength(2);
});

test("importProviderSession reports durable timeline size after live registration falls back", async () => {
  const harness = await ProviderImportHarness.create({ sessionId: "thread-durable-fallback" });
  harness.keepFreshImportLive = false;
  harness.durableTimelineSize = 3;

  await expect(
    harness.import({
      providerHandleId: "thread-durable-fallback",
      cwd: harness.snapshot.cwd,
    }),
  ).resolves.toMatchObject({
    snapshot: { id: harness.snapshot.id },
    timelineSize: 3,
  });
});

test("importProviderSession restores an archived session as the same standalone agent", async () => {
  const harness = await ProviderImportHarness.create({ sessionId: "thread-archived" });
  harness.timeline = [{ type: "user_message", text: "restored" }];
  const archived = makeStoredProviderSession({
    id: harness.snapshot.id,
    cwd: harness.snapshot.cwd,
    sessionId: "thread-archived",
    title: "Archived title",
    labels: { existing: "label", [PARENT_AGENT_ID_LABEL]: "archived-parent" },
  });
  await harness.seed(archived);

  const result = await harness.import({
    providerHandleId: "thread-archived",
    cwd: harness.snapshot.cwd,
    workspaceTitle: "New provider title",
    labels: { source: "reimport" },
  });

  expect(result).toEqual({
    snapshot: harness.snapshot,
    timelineSize: 1,
    createdWorkspace: null,
  });
  expect(await harness.storage.get(harness.snapshot.id)).toMatchObject({
    id: harness.snapshot.id,
    workspaceId: "ws-restored",
    labels: { existing: "label", source: "reimport" },
    title: "Archived title",
    archivedAt: null,
  });
  expect((await harness.storage.get(harness.snapshot.id))?.labels).not.toHaveProperty(
    PARENT_AGENT_ID_LABEL,
  );
  expect(harness.resumeAttempts).toBe(1);
  expect(harness.freshImports).toEqual([]);
});

test("importProviderSession rejects an archived session from a different cwd before restoring", async () => {
  const harness = await ProviderImportHarness.create({ sessionId: "thread-other-cwd" });
  const archived = makeStoredProviderSession({
    id: harness.snapshot.id,
    cwd: "/tmp/other-agent",
    sessionId: "thread-other-cwd",
  });
  await harness.seed(archived);
  const persistedArchived = await harness.storage.get(harness.snapshot.id);

  await expect(
    harness.import({ providerHandleId: "thread-other-cwd", cwd: "/tmp/target-agent" }),
  ).rejects.toThrow("Provider session cwd does not match import cwd: thread-other-cwd");
  expect(await harness.storage.get(harness.snapshot.id)).toEqual(persistedArchived);
  expect(harness.resumeAttempts).toBe(0);
});

test("importProviderSession restores storage and closes a partial runtime when loading fails", async () => {
  const harness = await ProviderImportHarness.create({ sessionId: "thread-stale" });
  const archived = makeStoredProviderSession({
    id: harness.snapshot.id,
    cwd: harness.snapshot.cwd,
    sessionId: "thread-stale",
  });
  await harness.seed(archived);
  const persistedArchived = await harness.storage.get(harness.snapshot.id);
  harness.resumeError = new Error("provider session is unavailable");

  await expect(
    harness.import({ providerHandleId: "thread-stale", cwd: harness.snapshot.cwd }),
  ).rejects.toThrow("provider session is unavailable");

  expect(await harness.storage.get(harness.snapshot.id)).toEqual(persistedArchived);
  expect(harness.activeAgent).toBeNull();
  expect(harness.closedAgentIds).toEqual([harness.snapshot.id]);
});

test("importProviderSession serializes legacy and native aliases for one archived session", async () => {
  const harness = await ProviderImportHarness.create({
    sessionId: "legacy-thread",
    nativeHandle: "native-thread",
  });
  await harness.seed(
    makeStoredProviderSession({
      id: harness.snapshot.id,
      cwd: harness.snapshot.cwd,
      sessionId: "legacy-thread",
      nativeHandle: "native-thread",
    }),
  );
  const releaseUnarchive = harness.blockUnarchive();

  const winningRestore = harness.import({
    providerHandleId: "native-thread",
    cwd: harness.snapshot.cwd,
  });
  const duplicateRestore = harness.import({
    providerHandleId: "legacy-thread",
    cwd: harness.snapshot.cwd,
  });
  releaseUnarchive();

  await expect(winningRestore).resolves.toMatchObject({
    snapshot: { id: harness.snapshot.id },
    timelineSize: 0,
  });
  await expect(duplicateRestore).resolves.toMatchObject({
    snapshot: { id: harness.snapshot.id },
    timelineSize: 0,
  });
  expect(harness.resumeAttempts).toBe(1);
  expect(harness.closedAgentIds).toEqual([]);
});

test("importProviderSession rejects conflicting parameters across archived handle aliases", async () => {
  const harness = await ProviderImportHarness.create({
    sessionId: "legacy-conflict",
    nativeHandle: "native-conflict",
  });
  await harness.seed(
    makeStoredProviderSession({
      id: harness.snapshot.id,
      cwd: harness.snapshot.cwd,
      sessionId: "legacy-conflict",
      nativeHandle: "native-conflict",
    }),
  );
  const releaseUnarchive = harness.blockUnarchive();

  const first = harness.import({
    providerHandleId: "native-conflict",
    cwd: harness.snapshot.cwd,
    workspaceTitle: "First title",
  });
  await vi.waitFor(() => expect(harness.unarchiveAttempts).toBe(1));
  const conflicting = harness.import({
    providerHandleId: "legacy-conflict",
    cwd: harness.snapshot.cwd,
    workspaceTitle: "Different title",
  });

  await expect(conflicting).rejects.toThrow(
    "Provider session import is already running with different parameters",
  );
  releaseUnarchive();
  await expect(first).resolves.toMatchObject({ snapshot: { id: harness.snapshot.id } });
  expect(harness.resumeAttempts).toBe(1);
});

test("importProviderSession requires cwd from the selected provider row", async () => {
  const harness = await ProviderImportHarness.create();

  await expect(harness.import({ providerHandleId: "thread-imported" })).rejects.toThrow(
    "Import requires cwd from the selected provider session",
  );
});
