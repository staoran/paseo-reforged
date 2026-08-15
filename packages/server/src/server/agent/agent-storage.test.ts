import { describe, expect, test, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { promises as fs } from "node:fs";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentStorage } from "./agent-storage.js";
import { buildConfigOverrides, buildSessionConfig } from "../persistence-hooks.js";
import type { ManagedAgent } from "./agent-manager.js";
import type { HubExecutionContract } from "./agent-config-compat.js";
import type {
  AgentPermissionRequest,
  AgentProvider,
  AgentSession,
  AgentSessionConfig,
} from "./agent-sdk-types.js";

type ManagedAgentOverrides = Omit<
  Partial<ManagedAgent>,
  "config" | "pendingPermissions" | "session" | "activeForegroundTurnId"
> & {
  config?: Partial<AgentSessionConfig>;
  pendingPermissions?: Map<string, AgentPermissionRequest>;
  session?: AgentSession | null;
  activeForegroundTurnId?: string | null;
  runtimeInfo?: ManagedAgent["runtimeInfo"];
  attention?: ManagedAgent["attention"];
};

function buildManagedAgentConfig(
  provider: AgentProvider,
  cwd: string,
  configOverrides: Partial<AgentSessionConfig>,
): AgentSessionConfig {
  const config: AgentSessionConfig = {
    provider,
    cwd,
    title: configOverrides.title,
    modeId: configOverrides.modeId ?? "plan",
    model: configOverrides.model ?? "gpt-5.1",
    thinkingOptionId: configOverrides.thinkingOptionId,
    approvalPolicy: configOverrides.approvalPolicy,
    sandboxMode: configOverrides.sandboxMode,
    networkAccess: configOverrides.networkAccess,
    webSearch: configOverrides.webSearch,
    extra: configOverrides.extra,
    providerOptions: configOverrides.providerOptions,
    toolPolicy: configOverrides.toolPolicy,
    systemPrompt: configOverrides.systemPrompt,
    mcpServers: configOverrides.mcpServers,
  };
  if (Object.prototype.hasOwnProperty.call(configOverrides, "featureValues")) {
    config.featureValues = configOverrides.featureValues;
  }
  return config;
}

function buildDefaultCapabilities() {
  return {
    supportsStreaming: true,
    supportsSessionPersistence: true,
    supportsDynamicModes: true,
    supportsMcpServers: true,
    supportsReasoningStream: true,
    supportsToolInvocations: true,
  };
}

function buildDefaultRuntimeInfo(params: {
  provider: AgentProvider;
  config: AgentSessionConfig;
  sessionId: string;
}) {
  return {
    provider: params.provider,
    sessionId: params.sessionId,
    model: params.config.model ?? null,
    modeId: params.config.modeId ?? null,
  };
}

interface ManagedAgentCore {
  provider: AgentProvider;
  cwd: string;
  lifecycle: ManagedAgent["lifecycle"];
  config: AgentSessionConfig;
  session: AgentSession | null;
  activeForegroundTurnId: string | null;
  now: Date;
}

function resolveManagedAgentCore(overrides: ManagedAgentOverrides): ManagedAgentCore {
  const now = overrides.updatedAt ?? new Date("2025-01-01T00:00:00.000Z");
  const provider = overrides.provider ?? "claude";
  const cwd = overrides.cwd ?? "/tmp/project";
  const lifecycle = overrides.lifecycle ?? "idle";
  const config = buildManagedAgentConfig(provider, cwd, overrides.config ?? {});
  const session = lifecycle === "closed" ? null : (overrides.session ?? ({} as AgentSession));
  const activeForegroundTurnId =
    overrides.activeForegroundTurnId ?? (lifecycle === "running" ? "test-turn-id" : null);
  return { provider, cwd, lifecycle, config, session, activeForegroundTurnId, now };
}

function createManagedAgent(overrides: ManagedAgentOverrides = {}): ManagedAgent {
  const core = resolveManagedAgentCore(overrides);
  return {
    id: overrides.id ?? "agent-test",
    provider: core.provider,
    cwd: core.cwd,
    workspaceId: overrides.workspaceId,
    session: core.session,
    capabilities: overrides.capabilities ?? buildDefaultCapabilities(),
    config: core.config,
    lifecycle: core.lifecycle,
    createdAt: overrides.createdAt ?? core.now,
    updatedAt: overrides.updatedAt ?? core.now,
    availableModes: overrides.availableModes ?? [],
    currentModeId: overrides.currentModeId ?? core.config.modeId ?? null,
    pendingPermissions: overrides.pendingPermissions ?? new Map<string, AgentPermissionRequest>(),
    activeForegroundTurnId: core.activeForegroundTurnId,
    foregroundTurnWaiters: new Set(),
    unsubscribeSession: null,
    timeline: overrides.timeline ?? [],
    attention: overrides.attention ?? { requiresAttention: false },
    runtimeInfo:
      overrides.runtimeInfo ??
      buildDefaultRuntimeInfo({
        provider: core.provider,
        config: core.config,
        sessionId: overrides.sessionId ?? "session-123",
      }),
    persistence: overrides.persistence ?? null,
    historyPrimed: overrides.historyPrimed ?? true,
    lastUserMessageAt: overrides.lastUserMessageAt ?? core.now,
    lastMessageAt: overrides.lastMessageAt === undefined ? core.now : overrides.lastMessageAt,
    lastUsage: overrides.lastUsage,
    lastError: overrides.lastError,
  };
}

describe("AgentStorage", () => {
  let tmpDir: string;
  let storagePath: string;
  let storage: AgentStorage;
  const logger = createTestLogger();

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "agent-registry-"));
    storagePath = path.join(tmpDir, "agents");
    storage = new AgentStorage(storagePath, logger);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("applySnapshot persists configs and snapshot metadata", async () => {
    await storage.applySnapshot(
      createManagedAgent({
        id: "agent-1",
        cwd: "/tmp/project",
        currentModeId: "coding",
        lifecycle: "idle",
        config: {
          title: "Initial title",
          modeId: "coding",
          model: "gpt-5.1",
          systemPrompt: "Be terse and explicit.",
          providerOptions: { allowedTools: ["Read"] },
          mcpServers: {
            paseo: {
              type: "stdio",
              command: "node",
              args: ["/tmp/mcp-stdio-socket-bridge-cli.mjs", "--socket", "/tmp/test.sock"],
            },
          },
        },
      }),
    );

    const records = await storage.list();
    expect(records).toHaveLength(1);
    const [record] = records;
    expect(record.provider).toBe("claude");
    expect(record.config?.modeId).toBe("coding");
    expect(record.config?.model).toBe("gpt-5.1");
    expect(record.config?.systemPrompt).toBe("Be terse and explicit.");
    expect(record.config?.mcpServers).toEqual({
      paseo: {
        type: "stdio",
        command: "node",
        args: ["/tmp/mcp-stdio-socket-bridge-cli.mjs", "--socket", "/tmp/test.sock"],
      },
    });
    expect(record.lastModeId).toBe("coding");
    expect(record.lastStatus).toBe("idle");

    const reloaded = new AgentStorage(storagePath, logger);
    const [persisted] = await reloaded.list();
    expect(persisted.cwd).toBe("/tmp/project");
    expect(persisted.config?.providerOptions).toEqual({ allowedTools: ["Read"] });
  });

  test("round-trips beta.5 and canonical launch config without losing either source", async () => {
    await storage.applySnapshot(
      createManagedAgent({
        id: "agent-config-compat",
        provider: "codex",
        config: {
          approvalPolicy: "never",
          sandboxMode: "read-only",
          networkAccess: false,
          webSearch: false,
          extra: {
            codex: { web_search: "disabled", custom_legacy_flag: true },
          },
          providerOptions: {
            approval_policy: "never",
            sandbox_mode: "read-only",
          },
          toolPolicy: {
            preapproved: [{ kind: "mcp", server: "custom", tool: "read" }],
          },
        },
      }),
    );

    const reloaded = new AgentStorage(storagePath, logger);
    const persisted = await reloaded.get("agent-config-compat");
    expect(persisted?.config).toMatchObject({
      approvalPolicy: "never",
      sandboxMode: "read-only",
      networkAccess: false,
      webSearch: false,
      extra: {
        codex: { web_search: "disabled", custom_legacy_flag: true },
      },
      providerOptions: {
        approval_policy: "never",
        sandbox_mode: "read-only",
      },
      toolPolicy: {
        preapproved: [{ kind: "mcp", server: "custom", tool: "read" }],
      },
    });
    expect(buildSessionConfig(persisted!)).toMatchObject(persisted!.config!);
  });

  test("conditional upsert refuses to overwrite a newer record revision", async () => {
    const agentId = "agent-conditional-upsert";
    await storage.applySnapshot(createManagedAgent({ id: agentId }));
    const originalRecord = (await storage.get(agentId))!;
    const originalEntry = (await storage.listAllMetadata()).find((entry) => entry.id === agentId)!;

    await storage.upsert({ ...originalRecord, title: "Newer title" });
    await expect(
      storage.upsert(
        { ...originalRecord, title: "Stale rollback" },
        { expectedRecordRevision: originalEntry.recordRevision },
      ),
    ).rejects.toThrow(`Agent record revision changed: ${agentId}`);
    await expect(storage.get(agentId)).resolves.toMatchObject({ title: "Newer title" });
  });

  test("round-trips lastMessageAt while keeping legacy records without the field readable", async () => {
    const agentId = "agent-last-message-at";
    const messageAt = new Date("2026-08-05T07:02:00.000Z");
    await storage.applySnapshot(
      createManagedAgent({
        id: agentId,
        lastMessageAt: messageAt,
        updatedAt: new Date("2026-08-05T07:03:00.000Z"),
      }),
    );

    const current = await storage.get(agentId);
    expect(current?.lastMessageAt).toBe(messageAt.toISOString());

    const { lastMessageAt: _removed, ...legacyRecord } = current!;
    await storage.upsert(legacyRecord);
    await storage.flush();

    const reloaded = new AgentStorage(storagePath, logger);
    expect(await reloaded.get(agentId)).not.toHaveProperty("lastMessageAt");
  });

  test("applySnapshot stores and reloads featureValues when present", async () => {
    await storage.applySnapshot(
      createManagedAgent({
        id: "agent-feature-values",
        config: {
          featureValues: {
            fast_mode: true,
          },
        },
      }),
    );

    const record = await storage.get("agent-feature-values");
    expect(record?.config?.featureValues).toEqual({ fast_mode: true });

    const reloaded = new AgentStorage(storagePath, logger);
    const persisted = await reloaded.get("agent-feature-values");
    expect(persisted?.config?.featureValues).toEqual({ fast_mode: true });
    expect(buildSessionConfig(persisted!).featureValues).toEqual({ fast_mode: true });
  });

  test("applySnapshot keeps featureValues absent when they were never set", async () => {
    await storage.applySnapshot(
      createManagedAgent({
        id: "agent-no-feature-values",
      }),
    );

    const reloaded = new AgentStorage(storagePath, logger);
    const persisted = await reloaded.get("agent-no-feature-values");
    expect(persisted?.config?.featureValues).toBeUndefined();
    expect(buildSessionConfig(persisted!).featureValues).toBeUndefined();
  });

  test("buildConfigOverrides includes featureValues when present in stored config", async () => {
    await storage.applySnapshot(
      createManagedAgent({
        id: "agent-resume-overrides",
        config: {
          featureValues: {
            fast_mode: true,
          },
        },
      }),
    );

    const record = await storage.get("agent-resume-overrides");
    expect(record).not.toBeNull();
    expect(buildConfigOverrides(record!)).toMatchObject({
      cwd: "/tmp/project",
      featureValues: {
        fast_mode: true,
      },
    });
  });

  test("applySnapshot preserves original createdAt timestamp", async () => {
    const agentId = "agent-created-at";
    const firstTimestamp = new Date("2025-01-01T00:00:00.000Z");
    await storage.applySnapshot(createManagedAgent({ id: agentId, createdAt: firstTimestamp }));

    const initialRecord = await storage.get(agentId);
    expect(initialRecord?.createdAt).toBe(firstTimestamp.toISOString());

    await storage.applySnapshot(
      createManagedAgent({
        id: agentId,
        createdAt: new Date("2025-02-01T00:00:00.000Z"),
        updatedAt: new Date("2025-02-01T00:00:00.000Z"),
        lifecycle: "running",
      }),
    );

    const updatedRecord = await storage.get(agentId);
    expect(updatedRecord?.createdAt).toBe(firstTimestamp.toISOString());
    expect(updatedRecord?.lastStatus).toBe("running");
  });

  test("applySnapshot preserves archivedAt (soft-delete) status", async () => {
    const agentId = "agent-archived";
    await storage.applySnapshot(
      createManagedAgent({
        id: agentId,
        lifecycle: "idle",
      }),
    );

    const archivedAt = "2025-01-03T00:00:00.000Z";
    const recordBeforeArchive = await storage.get(agentId);
    expect(recordBeforeArchive).not.toBeNull();
    await storage.upsert({ ...recordBeforeArchive!, archivedAt });

    await storage.applySnapshot(
      createManagedAgent({
        id: agentId,
        lifecycle: "running",
        updatedAt: new Date("2025-01-04T00:00:00.000Z"),
      }),
    );

    const recordAfterSnapshot = await storage.get(agentId);
    expect(recordAfterSnapshot?.archivedAt).toBe(archivedAt);
  });

  test("Hub execution contracts transition through prepared storage without ordinary-write loss", async () => {
    const prepared = {
      protocolVersion: 1,
      executionFingerprint: "a".repeat(64),
      policyFingerprint: "b".repeat(64),
      applicationState: "prepared",
    } satisfies HubExecutionContract;
    const agent = createManagedAgent({
      id: "agent-hub-contract",
      workspaceId: "workspace-hub-contract",
      owner: {
        kind: "daemon",
        daemonId: "daemon-hub-contract",
        executionId: "execution-hub-contract",
      },
    });
    agent.hubExecutionContract = prepared;

    await storage.persistInitialHubExecutionSnapshot(agent, prepared);
    const staleRecord = await storage.get(agent.id);
    expect(staleRecord?.hubExecutionContract).toEqual(prepared);

    agent.hubExecutionContract = undefined;
    await storage.applySnapshot(agent);
    await storage.upsert({ ...staleRecord!, hubExecutionContract: undefined });
    expect((await storage.get(agent.id))?.hubExecutionContract).toEqual(prepared);

    const applied = await storage.persistHubExecutionContractBeforePrompt(agent.id, prepared);
    expect(applied.applicationState).toBe("applied");

    agent.hubExecutionContract = prepared;
    await storage.applySnapshot(agent);
    expect((await storage.get(agent.id))?.hubExecutionContract).toEqual(applied);
  });

  test("only the dedicated timeline revision mutation changes the stored revision", async () => {
    const agentId = "agent-timeline-revision";
    await storage.applySnapshot(createManagedAgent({ id: agentId }), { title: "Original" });
    await storage.setTimelineRevision(agentId, "00000000-0000-4000-8000-000000000042");

    await storage.applySnapshot(
      createManagedAgent({
        id: agentId,
        updatedAt: new Date("2025-01-02T00:00:00.000Z"),
      }),
    );
    await storage.setTitle(agentId, "Updated title");

    expect(await storage.get(agentId)).toMatchObject({
      title: "Updated title",
      timelineRevision: "00000000-0000-4000-8000-000000000042",
    });
    const restarted = new AgentStorage(storagePath, logger);
    await restarted.initialize();
    expect(await restarted.get(agentId)).toMatchObject({
      timelineRevision: "00000000-0000-4000-8000-000000000042",
    });
  });

  test("clears timeline eligibility without ordinary snapshots restoring the revision", async () => {
    const agentId = "agent-cleared-timeline-revision";
    await storage.applySnapshot(createManagedAgent({ id: agentId }));
    await storage.setTimelineRevision(agentId, "00000000-0000-4000-8000-000000000043");
    await storage.setTimelineRevision(agentId, null);
    await storage.applySnapshot(createManagedAgent({ id: agentId }));

    expect(await storage.get(agentId)).not.toHaveProperty("timelineRevision");
    const restarted = new AgentStorage(storagePath, logger);
    await restarted.initialize();
    expect(await restarted.get(agentId)).not.toHaveProperty("timelineRevision");
  });

  test("stores titles independently of snapshots", async () => {
    await storage.applySnapshot(
      createManagedAgent({
        id: "agent-2",
        provider: "codex",
        cwd: "/tmp/second",
      }),
    );
    await storage.setTitle("agent-2", "Fix Login Bug");

    const current = await storage.get("agent-2");
    expect(current?.title).toBe("Fix Login Bug");

    const reloaded = new AgentStorage(storagePath, logger);
    const persisted = await reloaded.get("agent-2");
    expect(persisted?.title).toBe("Fix Login Bug");
  });

  test("setTitle throws when the agent record does not exist", async () => {
    await expect(storage.setTitle("missing-agent", "Impossible")).rejects.toThrow(
      "Agent missing-agent not found",
    );
  });

  test("applySnapshot accepts explicit title overrides", async () => {
    const agentId = "agent-override";
    await storage.applySnapshot(createManagedAgent({ id: agentId }), { title: "Provided Title" });

    const record = await storage.get(agentId);
    expect(record?.title).toBe("Provided Title");
  });

  test("applySnapshot preserves custom titles while updating metadata", async () => {
    const agentId = "agent-3";
    await storage.applySnapshot(
      createManagedAgent({
        id: agentId,
        lifecycle: "idle",
        currentModeId: "plan",
      }),
    );
    await storage.setTitle(agentId, "Important Bug Fix");

    await storage.applySnapshot(
      createManagedAgent({
        id: agentId,
        lifecycle: "running",
        currentModeId: "build",
        updatedAt: new Date("2025-01-02T00:00:00.000Z"),
      }),
    );

    const record = await storage.get(agentId);
    expect(record?.title).toBe("Important Bug Fix");
    expect(record?.lastModeId).toBe("build");
    expect(record?.lastStatus).toBe("running");
  });

  test("applySnapshot projects metadata after in-flight archival writes", async () => {
    const agentId = "agent-pending-write";
    await storage.applySnapshot(createManagedAgent({ id: agentId }));
    const initialRecord = await storage.get(agentId);
    expect(initialRecord).not.toBeNull();

    let releasePendingWrite: (() => void) | null = null;
    const pendingWrite = new Promise<void>((resolve) => {
      releasePendingWrite = resolve;
    });

    const storageInternals = storage as unknown as {
      pendingWrites: Map<string, Promise<void>>;
      cache: Map<string, unknown>;
    };
    storageInternals.pendingWrites.set(agentId, pendingWrite);

    const applySnapshotPromise = storage.applySnapshot(
      createManagedAgent({
        id: agentId,
        lifecycle: "running",
        updatedAt: new Date("2025-01-02T00:00:00.000Z"),
      }),
    );

    storageInternals.cache.set(agentId, {
      ...initialRecord!,
      title: "Generated title",
      archivedAt: "2025-01-03T00:00:00.000Z",
    });
    releasePendingWrite?.();

    await applySnapshotPromise;
    const record = await storage.get(agentId);
    expect(record?.title).toBe("Generated title");
    expect(record?.archivedAt).toBe("2025-01-03T00:00:00.000Z");
  });

  test("list returns all agents including internal ones", async () => {
    // Create a normal agent
    await storage.applySnapshot(
      createManagedAgent({
        id: "normal-agent",
        cwd: "/tmp/project",
      }),
    );

    // Create an internal agent
    await storage.applySnapshot(
      createManagedAgent({
        id: "internal-agent",
        cwd: "/tmp/project",
        config: { internal: true },
      }),
      { internal: true },
    );

    // Registry should return all agents - filtering is done at the manager level
    const records = await storage.list();
    expect(records).toHaveLength(2);
  });

  test("get returns internal agents by ID", async () => {
    await storage.applySnapshot(
      createManagedAgent({
        id: "internal-agent",
        cwd: "/tmp/project",
        config: { internal: true },
      }),
      { internal: true },
    );

    const record = await storage.get("internal-agent");
    expect(record).not.toBeNull();
    expect(record?.internal).toBe(true);
  });

  test("queries agents by provider session and native handle", async () => {
    await storage.applySnapshot(
      createManagedAgent({
        id: "matching-session",
        provider: "codex",
        persistence: {
          provider: "codex",
          sessionId: "session-1",
          nativeHandle: "thread-1",
        },
      }),
    );
    await storage.applySnapshot(
      createManagedAgent({
        id: "other-session",
        provider: "codex",
        persistence: { provider: "codex", sessionId: "session-2" },
      }),
    );

    await expect(storage.listByProviderSession("codex", "session-1")).resolves.toMatchObject([
      { id: "matching-session" },
    ]);
    await expect(storage.listByProviderSession("codex", "thread-1")).resolves.toMatchObject([
      { id: "matching-session" },
    ]);
  });

  test("queries agents by workspace", async () => {
    await storage.applySnapshot(
      createManagedAgent({ id: "workspace-agent", workspaceId: "workspace-1" }),
    );
    await storage.applySnapshot(
      createManagedAgent({ id: "other-workspace-agent", workspaceId: "workspace-2" }),
    );

    await expect(storage.listByWorkspace("workspace-1")).resolves.toMatchObject([
      { id: "workspace-agent" },
    ]);
  });

  test("internal flag is persisted and reloaded", async () => {
    await storage.applySnapshot(
      createManagedAgent({
        id: "internal-agent",
        cwd: "/tmp/project",
        config: { internal: true },
      }),
      { internal: true },
    );

    // Reload the registry from disk
    const reloaded = new AgentStorage(storagePath, logger);
    const record = await reloaded.get("internal-agent");
    expect(record?.internal).toBe(true);

    // Registry returns all agents - filtering happens at manager level
    const records = await reloaded.list();
    expect(records).toHaveLength(1);
    expect(records[0]?.internal).toBe(true);
  });

  test("Windows drive-letter paths produce valid directory names", async () => {
    await storage.applySnapshot(
      createManagedAgent({
        id: "win-agent",
        cwd: "D:\\Users\\dev\\MyProject",
      }),
    );

    const record = await storage.get("win-agent");
    expect(record).not.toBeNull();

    // The persisted directory must not contain a colon (invalid on Windows)
    const dirs = readdirSync(storagePath).filter((entry) => entry !== ".paseo-agent-storage");
    expect(dirs).toHaveLength(1);
    expect(dirs[0]).not.toContain(":");
    expect(dirs[0]).toBe("D-Users-dev-MyProject");
  });

  test("remove deletes all duplicate record files across project directories", async () => {
    const agentId = "agent-duplicate";

    // Create a valid record file in two different project directories to simulate
    // storage migrations/duplication. Only one copy will be referenced in-memory,
    // but deletion should remove *all* copies on disk.
    const recordA = await (async () => {
      await storage.applySnapshot(
        createManagedAgent({
          id: agentId,
          cwd: "/tmp/project-a",
          provider: "codex",
        }),
      );
      const record = await storage.get(agentId);
      expect(record).not.toBeNull();
      return record!;
    })();

    const projectDirB = path.join(storagePath, "tmp-project-b");
    await fs.mkdir(projectDirB, { recursive: true });
    const duplicatePathB = path.join(projectDirB, `${agentId}.json`);
    await fs.writeFile(
      duplicatePathB,
      JSON.stringify({ ...recordA, cwd: "/tmp/project-b" }, null, 2),
      "utf8",
    );

    // Force a reload so the registry has to discover from disk (and may choose either copy).
    const reloaded = new AgentStorage(storagePath, logger);
    const before = await reloaded.list();
    expect(before.map((r) => r.id)).toContain(agentId);

    await reloaded.remove(agentId);

    const hasAnyRecordFile = async () => {
      const projects = await fs
        .readdir(storagePath, { withFileTypes: true })
        .catch(() => [] as Awaited<ReturnType<typeof fs.readdir>>);
      const exists = await Promise.all(
        projects
          .filter((project) => project.isDirectory())
          .map(async (project) => {
            const candidate = path.join(storagePath, project.name, `${agentId}.json`);
            try {
              await fs.access(candidate);
              return true;
            } catch {
              return false;
            }
          }),
      );
      return exists.some((present) => present);
    };

    expect(await hasAnyRecordFile()).toBe(false);

    const afterReload = new AgentStorage(storagePath, logger);
    const after = await afterReload.list();
    expect(after.some((r) => r.id === agentId)).toBe(false);
  });

  test("initializes from a valid lightweight catalog without parsing full records", async () => {
    const agentId = "agent-catalog-startup";
    await storage.applySnapshot(createManagedAgent({ id: agentId, cwd: "/tmp/catalog-startup" }), {
      title: "Catalog title",
    });
    await storage.flush();

    const metadata = await storage.listAllMetadata();
    expect(metadata).toHaveLength(1);
    expect(metadata[0]).toMatchObject({ id: agentId, title: "Catalog title" });
    expect(metadata[0]).not.toHaveProperty("config");
    expect(metadata[0]).not.toHaveProperty("runtimeInfo");

    const recordPath = path.join(storagePath, ...metadata[0].recordPath.split("/"));
    await fs.writeFile(recordPath, "{ definitely not valid json", "utf8");

    const restarted = new AgentStorage(storagePath, logger);
    await restarted.initialize();
    expect(await restarted.countMetadata()).toBe(1);
    expect(await restarted.listAllMetadata()).toMatchObject([{ id: agentId }]);

    expect(await restarted.get(agentId)).toBeNull();
    expect(await restarted.countMetadata()).toBe(0);
  });

  test("rebuilds once from a mutation marker and excludes the reserved control tree", async () => {
    const agentId = "agent-marker-recovery";
    await storage.applySnapshot(createManagedAgent({ id: agentId, cwd: "/tmp/marker" }));
    const [metadata] = await storage.listAllMetadata();
    const recordPath = path.join(storagePath, ...metadata.recordPath.split("/"));
    const record = JSON.parse(await fs.readFile(recordPath, "utf8"));
    await fs.writeFile(recordPath, JSON.stringify({ ...record, title: "Recovered" }, null, 2));
    await fs.writeFile(
      path.join(storagePath, ".paseo-agent-storage", "mutation.json"),
      JSON.stringify({ interrupted: true }),
    );

    const restarted = new AgentStorage(storagePath, logger);
    await restarted.initialize();
    expect(await restarted.listAllMetadata()).toMatchObject([{ id: agentId, title: "Recovered" }]);
    expect(
      await fs
        .access(path.join(storagePath, ".paseo-agent-storage", "mutation.json"))
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
  });

  test("binds metadata cursors to the catalog generation", async () => {
    await storage.applySnapshot(
      createManagedAgent({ id: "agent-page-a", updatedAt: new Date("2025-01-02T00:00:00Z") }),
    );
    await storage.applySnapshot(
      createManagedAgent({ id: "agent-page-b", updatedAt: new Date("2025-01-01T00:00:00Z") }),
    );

    const first = await storage.listMetadataPage({
      limit: 1,
      sort: [{ key: "updated_at", direction: "desc" }],
    });
    expect(first.entries.map((entry) => entry.id)).toEqual(["agent-page-a"]);
    expect(first.nextCursor).toBeTypeOf("string");

    await storage.applySnapshot(
      createManagedAgent({ id: "agent-page-c", updatedAt: new Date("2025-01-03T00:00:00Z") }),
    );
    await expect(
      storage.listMetadataPage({
        limit: 1,
        sort: [{ key: "updated_at", direction: "desc" }],
        cursor: first.nextCursor ?? undefined,
      }),
    ).rejects.toThrow("stale metadata cursor");
  });

  test("returns all persistence handle conflicts without indexing non-string native handles", async () => {
    const baseRecord = await (async () => {
      await storage.applySnapshot(createManagedAgent({ id: "agent-handle-template" }));
      return (await storage.get("agent-handle-template"))!;
    })();
    await storage.upsert({
      ...baseRecord,
      id: "agent-handle-old",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      lastActivityAt: "2025-01-03T00:00:00.000Z",
      persistence: {
        provider: "codex",
        sessionId: "shared-session",
        nativeHandle: { legacy: true },
      },
    });
    await storage.upsert({
      ...baseRecord,
      id: "agent-handle-new",
      createdAt: "2025-01-02T00:00:00.000Z",
      updatedAt: "2025-01-02T00:00:00.000Z",
      persistence: {
        provider: "codex",
        sessionId: "shared-session",
        nativeHandle: "native-session",
      },
    });

    expect(
      (
        await storage.findByPersistenceHandle({
          provider: "codex",
          sessionId: "shared-session",
        })
      ).map((entry) => entry.id),
    ).toEqual(["agent-handle-new", "agent-handle-old"]);
    expect(
      (
        await storage.findByPersistenceHandle({
          provider: "codex",
          sessionId: "missing",
          nativeHandle: "native-session",
        })
      ).map((entry) => entry.id),
    ).toEqual(["agent-handle-new"]);
    expect(
      await storage.findByPersistenceHandle({
        provider: "codex",
        sessionId: "missing",
        nativeHandle: "[object Object]",
      }),
    ).toEqual([]);
  });

  test("keeps catalog generations monotonic when a recovery marker is newer than the catalog", async () => {
    const agentId = "agent-generation-recovery";
    await storage.applySnapshot(createManagedAgent({ id: agentId, cwd: "/tmp/generation" }));
    const [metadata] = await storage.listAllMetadata();
    const controlDir = path.join(storagePath, ".paseo-agent-storage");

    await fs.writeFile(path.join(controlDir, "catalog.json"), "{ invalid", "utf8");
    await fs.writeFile(
      path.join(controlDir, "mutation.json"),
      JSON.stringify({
        version: 1,
        operationId: "11111111-1111-4111-8111-111111111111",
        operation: "upsert",
        baseGeneration: 7,
        nextGeneration: 8,
        affectedIds: [agentId],
        oldPaths: [],
        newPaths: [metadata.recordPath],
        recordRevision: metadata.recordRevision,
        createdAt: "2026-08-09T00:00:00.000Z",
      }),
      "utf8",
    );

    const restarted = new AgentStorage(storagePath, logger);
    await restarted.initialize();
    expect((await restarted.getMetadataSnapshot()).generation).toBe(9);
  });

  test("keeps prepared records invisible and commits them idempotently", async () => {
    await storage.applySnapshot(createManagedAgent({ id: "agent-prepared-template" }));
    const template = (await storage.get("agent-prepared-template"))!;
    const prepared = await storage.prepareRecord(
      {
        ...template,
        id: "agent-prepared",
        cwd: "/tmp/prepared",
        persistence: {
          provider: "codex",
          sessionId: "prepared-session",
        },
      },
      { kind: "absent" },
    );

    expect(await storage.get("agent-prepared")).toBeNull();
    expect((await storage.listAllMetadata()).map((entry) => entry.id)).not.toContain(
      "agent-prepared",
    );

    const firstCommit = await storage.commitPreparedRecord(prepared.preparedId);
    const repeatedCommit = await storage.commitPreparedRecord(prepared.preparedId);
    expect(repeatedCommit).toEqual(firstCommit);
    expect(firstCommit).toMatchObject({
      id: "agent-prepared",
      recordRevision: prepared.recordRevision,
      preparedCommitId: prepared.preparedId,
    });
    expect(await storage.get("agent-prepared")).toMatchObject({
      id: "agent-prepared",
      cwd: "/tmp/prepared",
    });

    await storage.discardPreparedRecord(prepared.preparedId);
    expect(await storage.get("agent-prepared")).not.toBeNull();
  });

  test("preserves prepared commit identity when recovery is interrupted", async () => {
    await storage.applySnapshot(createManagedAgent({ id: "agent-recovery-template" }));
    const template = (await storage.get("agent-recovery-template"))!;
    const prepared = await storage.prepareRecord(
      {
        ...template,
        id: "agent-recovery-prepared",
        cwd: "/tmp/recovery-prepared",
      },
      { kind: "absent" },
    );

    const interruptedCommit = new AgentStorage(storagePath, logger, {
      faultInjector(point) {
        if (point === "record_write") throw new Error("interrupt prepared commit");
      },
    });
    await expect(interruptedCommit.commitPreparedRecord(prepared.preparedId)).rejects.toThrow(
      "interrupt prepared commit",
    );

    const interruptedRecovery = new AgentStorage(storagePath, logger, {
      faultInjector(point) {
        if (point === "mutation_marker") throw new Error("interrupt recovery marker");
      },
    });
    await expect(interruptedRecovery.initialize()).rejects.toThrow("interrupt recovery marker");

    const recovered = new AgentStorage(storagePath, logger);
    await recovered.initialize();
    await expect(recovered.commitPreparedRecord(prepared.preparedId)).resolves.toMatchObject({
      id: "agent-recovery-prepared",
      recordRevision: prepared.recordRevision,
      preparedCommitId: prepared.preparedId,
    });
    await expect(
      fs.access(
        path.join(storagePath, ".paseo-agent-storage", "staging", `${prepared.preparedId}.json`),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("preserves prepared commit lineage across later record revisions", async () => {
    await storage.applySnapshot(createManagedAgent({ id: "agent-prepared-update-template" }));
    const template = (await storage.get("agent-prepared-update-template"))!;
    const prepared = await storage.prepareRecord(
      {
        ...template,
        id: "agent-prepared-update",
        cwd: "/tmp/prepared-update",
      },
      { kind: "absent" },
    );
    await storage.commitPreparedRecord(prepared.preparedId);
    const committed = (await storage.get("agent-prepared-update"))!;
    await storage.upsert({ ...committed, title: "Changed after import" });

    const metadataAfterUpdate = (await storage.listAllMetadata()).find(
      (entry) => entry.id === "agent-prepared-update",
    );
    expect(metadataAfterUpdate).toMatchObject({
      preparedCommitId: prepared.preparedId,
    });
    await expect(storage.commitPreparedRecord(prepared.preparedId)).resolves.toEqual(
      metadataAfterUpdate,
    );
  });

  test("preserves prepared commit lineage when a later record revision is recovered", async () => {
    await storage.applySnapshot(createManagedAgent({ id: "agent-prepared-recovery-template" }));
    const template = (await storage.get("agent-prepared-recovery-template"))!;
    const prepared = await storage.prepareRecord(
      {
        ...template,
        id: "agent-prepared-recovery-update",
        cwd: "/tmp/prepared-recovery-update",
      },
      { kind: "absent" },
    );
    await storage.commitPreparedRecord(prepared.preparedId);
    const committed = (await storage.get("agent-prepared-recovery-update"))!;

    const interruptedUpdate = new AgentStorage(storagePath, logger, {
      faultInjector(point) {
        if (point === "record_write") throw new Error("interrupt later record update");
      },
    });
    await expect(
      interruptedUpdate.upsert({ ...committed, title: "Recovered update" }),
    ).rejects.toThrow("interrupt later record update");

    const recovered = new AgentStorage(storagePath, logger);
    await recovered.initialize();
    expect(await recovered.get("agent-prepared-recovery-update")).toMatchObject({
      title: "Recovered update",
    });
    expect(
      (await recovered.listAllMetadata()).find(
        (entry) => entry.id === "agent-prepared-recovery-update",
      ),
    ).toMatchObject({ preparedCommitId: prepared.preparedId });
  });
});
