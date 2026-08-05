import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "./agent-manager.js";
import { ensureAgentLoaded } from "./agent-loading.js";
import { AgentStorage, parseStoredAgentRecord } from "./agent-storage.js";
import type { AgentTimelineRow, AgentTimelineStore } from "./agent-timeline-store-types.js";
import type {
  AgentClient,
  AgentLaunchContext,
  AgentPersistenceHandle,
  AgentResumeSessionOptions,
  AgentSession,
  AgentSessionConfig,
} from "./agent-sdk-types.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";

function createDurableTimelineStore(initialRows: readonly AgentTimelineRow[]): AgentTimelineStore {
  const rows = initialRows.map((row) => ({ ...row }));
  return {
    appendCommitted: async (_agentId, item, options) => {
      const row = {
        seq: (rows.at(-1)?.seq ?? 0) + 1,
        timestamp: options?.timestamp ?? new Date().toISOString(),
        item,
      };
      rows.push(row);
      return { ...row };
    },
    fetchCommitted: async () => {
      throw new Error("fetchCommitted is not used by this test store");
    },
    getLatestCommittedSeq: async () => rows.at(-1)?.seq ?? 0,
    getCommittedRows: async () => rows.map((row) => ({ ...row })),
    getLastItem: async () => rows.at(-1)?.item ?? null,
    getLastAssistantMessage: async () =>
      rows.findLast((row) => row.item.type === "assistant_message")?.item.text ?? null,
    deleteAgent: async () => {
      rows.length = 0;
    },
    bulkInsert: async (_agentId, insertedRows) => {
      rows.push(...insertedRows.map((row) => ({ ...row })));
    },
  };
}

test("loads archived records for history and active records with the interactive default", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-loading-purpose-"));
  const logger = createTestLogger();
  const storage = new AgentStorage(path.join(root, "agents"), logger);
  const baseClient = createTestAgentClients().codex;
  if (!baseClient) {
    throw new Error("expected Codex test client");
  }

  const resumeOptions: Array<AgentResumeSessionOptions | undefined> = [];
  const client: AgentClient = {
    provider: baseClient.provider,
    capabilities: baseClient.capabilities,
    createSession: async (
      config: AgentSessionConfig,
      launchContext?: AgentLaunchContext,
    ): Promise<AgentSession> => await baseClient.createSession(config, launchContext),
    resumeSession: async (
      handle: AgentPersistenceHandle,
      overrides?: Partial<AgentSessionConfig>,
      launchContext?: AgentLaunchContext,
      options?: AgentResumeSessionOptions,
    ): Promise<AgentSession> => {
      resumeOptions.push(options);
      return await baseClient.resumeSession(handle, overrides, launchContext);
    },
    fetchCatalog: async (options) => await baseClient.fetchCatalog(options),
    isAvailable: async () => await baseClient.isAvailable(),
  };
  const manager = new AgentManager({
    clients: { codex: client },
    registry: storage,
    logger,
  });

  const archivedId = "00000000-0000-4000-8000-000000000301";
  const activeId = "00000000-0000-4000-8000-000000000302";

  try {
    const archived = await manager.createAgent({ provider: "codex", cwd: root }, archivedId, {
      workspaceId: "workspace-archived",
    });
    await manager.archiveAgent(archived.id);

    const active = await manager.createAgent({ provider: "codex", cwd: root }, activeId, {
      workspaceId: "workspace-active",
    });
    await manager.closeAgent(active.id);

    await ensureAgentLoaded(archived.id, { agentManager: manager, agentStorage: storage, logger });
    await ensureAgentLoaded(active.id, { agentManager: manager, agentStorage: storage, logger });

    expect(resumeOptions).toEqual([{ purpose: "history" }, undefined]);
  } finally {
    await Promise.all([
      manager.closeAgent(archivedId).catch(() => undefined),
      manager.closeAgent(activeId).catch(() => undefined),
    ]);
    await manager.flush().catch(() => undefined);
    await storage.flush().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("recovers a legacy lastMessageAt from canonical durable rows without using later activity", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-loading-last-message-at-"));
  const logger = createTestLogger();
  const storage = new AgentStorage(path.join(root, "agents"), logger);
  const agentId = "00000000-0000-4000-8000-000000000303";
  const createdAt = "2026-08-05T07:00:00.000Z";
  const userMessageAt = "2026-08-05T07:01:00.000Z";
  const assistantMessageAt = "2026-08-05T07:02:00.000Z";
  const laterActivityAt = "2026-08-05T07:03:00.000Z";
  const coldLoadAt = new Date("2026-08-05T07:04:00.000Z");
  const durableTimelineStore = createDurableTimelineStore([
    {
      seq: 1,
      timestamp: userMessageAt,
      item: { type: "user_message", text: "T1 user message" },
    },
    {
      seq: 2,
      timestamp: assistantMessageAt,
      item: { type: "assistant_message", text: "T2 assistant message" },
    },
    {
      seq: 3,
      timestamp: laterActivityAt,
      item: { type: "reasoning", text: "T3 non-message activity" },
    },
  ]);
  await storage.upsert(
    parseStoredAgentRecord({
      id: agentId,
      provider: "codex",
      cwd: root,
      workspaceId: "workspace-last-message-at",
      createdAt,
      updatedAt: laterActivityAt,
      lastActivityAt: laterActivityAt,
      lastUserMessageAt: userMessageAt,
      title: null,
      labels: {},
      lastStatus: "closed",
      lastModeId: null,
      config: null,
      persistence: {
        provider: "codex",
        sessionId: "legacy-provider-session",
        metadata: { provider: "codex", cwd: root },
      },
    }),
  );
  const client = createTestAgentClients().codex;
  if (!client) {
    throw new Error("expected Codex test client");
  }
  const manager = new AgentManager({
    clients: { codex: client },
    registry: storage,
    durableTimelineStore,
    logger,
  });

  vi.useFakeTimers();
  try {
    vi.setSystemTime(coldLoadAt);
    const loaded = await ensureAgentLoaded(agentId, {
      agentManager: manager,
      agentStorage: storage,
      logger,
    });
    expect(loaded.updatedAt).toEqual(coldLoadAt);
    expect(loaded.lastMessageAt).toEqual(new Date(assistantMessageAt));

    await manager.flush();
    await storage.flush();
    expect(await storage.get(agentId)).toMatchObject({
      updatedAt: coldLoadAt.toISOString(),
      lastMessageAt: assistantMessageAt,
    });
  } finally {
    vi.useRealTimers();
    await manager.closeAgent(agentId).catch(() => undefined);
    await manager.flush().catch(() => undefined);
    await storage.flush().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
