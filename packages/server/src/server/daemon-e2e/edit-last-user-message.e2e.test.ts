import { expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DaemonClient } from "../test-utils/index.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentPersistenceHandle,
  AgentPromptInput,
  AgentRunOptions,
  AgentRunResult,
  AgentRuntimeInfo,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
  AgentTimelineItem,
} from "../agent/agent-sdk-types.js";

const EDIT_SESSION_ID = "mock-edit-session";
const EDIT_NATIVE_HANDLE = "mock-edit-native-handle";

const EDIT_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsSessionListing: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
  supportsRewindConversation: false,
  supportsRewindFiles: false,
  supportsRewindBoth: false,
  supportsInPlaceEditLastUserMessage: true,
};

class InPlaceEditSession implements AgentSession {
  readonly provider = "mock" as const;
  readonly capabilities = EDIT_CAPABILITIES;
  readonly inPlaceEditCalls: Array<{ messageId: string }> = [];

  private sessionId = EDIT_SESSION_ID;
  private nativeHandle = EDIT_NATIVE_HANDLE;
  private turnOrdinal = 0;
  private readonly history: AgentStreamEvent[] = [];
  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();

  get id(): string {
    return this.sessionId;
  }

  get persistence(): AgentPersistenceHandle {
    return {
      provider: this.provider,
      sessionId: this.sessionId,
      nativeHandle: this.nativeHandle,
    };
  }

  setPersistenceIdentity(sessionId: string, nativeHandle: string): void {
    this.sessionId = sessionId;
    this.nativeHandle = nativeHandle;
  }

  async run(): Promise<AgentRunResult> {
    return { sessionId: this.id, finalText: "", timeline: [] };
  }

  async startTurn(
    prompt: AgentPromptInput,
    options?: AgentRunOptions,
  ): Promise<{ turnId: string }> {
    const turnId = `mock-edit-turn-${++this.turnOrdinal}`;
    const text = typeof prompt === "string" ? prompt : "";
    const messageId = options?.clientMessageId ?? `mock-message-${this.turnOrdinal}`;
    const events: AgentStreamEvent[] = [
      { type: "turn_started", provider: this.provider, turnId },
      {
        type: "timeline",
        provider: this.provider,
        turnId,
        item: {
          type: "user_message",
          text,
          messageId,
          ...(options?.clientMessageId ? { clientMessageId: options.clientMessageId } : {}),
        },
      },
      {
        type: "timeline",
        provider: this.provider,
        turnId,
        item: {
          type: "assistant_message",
          text: `ack:${text}`,
          messageId: `mock-assistant-${this.turnOrdinal}`,
          phase: "final_answer",
        },
      },
      { type: "turn_completed", provider: this.provider, turnId },
    ];

    setTimeout(() => {
      for (const event of events) {
        this.history.push(event);
        for (const subscriber of this.subscribers) {
          subscriber(event);
        }
      }
    }, 0);
    return { turnId };
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
    for (const event of this.history) {
      yield event;
    }
  }

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    return {
      provider: this.provider,
      sessionId: this.id,
      model: "mock-edit-model",
      modeId: "mock-edit-mode",
    };
  }

  async getAvailableModes() {
    return [{ id: "mock-edit-mode", label: "Mock edit mode" }];
  }

  async getCurrentMode(): Promise<string> {
    return "mock-edit-mode";
  }

  async setMode(): Promise<void> {}

  getPendingPermissions() {
    return [];
  }

  async respondToPermission(): Promise<void> {}

  describePersistence(): AgentPersistenceHandle {
    return this.persistence;
  }

  async interrupt(): Promise<void> {}

  async close(): Promise<void> {}

  async rewindLastUserMessageInPlace(input: { messageId: string }): Promise<void> {
    this.inPlaceEditCalls.push(input);
    const targetIndex = this.history.findIndex(
      (event) => event.type === "timeline" && event.item.messageId === input.messageId,
    );
    if (targetIndex < 0) {
      throw new Error(`Unknown edit target ${input.messageId}`);
    }
    this.history.splice(targetIndex);
  }

  appendExternalTurn(text: string, messageId: string): void {
    const turnId = `mock-edit-external-turn-${++this.turnOrdinal}`;
    this.history.push(
      { type: "turn_started", provider: this.provider, turnId },
      {
        type: "timeline",
        provider: this.provider,
        turnId,
        item: { type: "user_message", text, messageId },
      },
      {
        type: "timeline",
        provider: this.provider,
        turnId,
        item: {
          type: "assistant_message",
          text: `ack:${text}`,
          messageId: `mock-external-assistant-${this.turnOrdinal}`,
          phase: "final_answer",
        },
      },
      { type: "turn_completed", provider: this.provider, turnId },
    );
  }
}

class InPlaceEditClient implements AgentClient {
  readonly provider = "mock" as const;
  readonly capabilities = EDIT_CAPABILITIES;
  readonly session = new InPlaceEditSession();
  readonly createSessionCalls: AgentSessionConfig[] = [];

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async createSession(config: AgentSessionConfig): Promise<AgentSession> {
    this.createSessionCalls.push(config);
    return this.session;
  }

  async resumeSession(): Promise<AgentSession> {
    return this.session;
  }

  async fetchCatalog() {
    return {
      models: [{ provider: this.provider, id: "mock-edit-model", label: "Mock edit model" }],
      modes: [{ id: "mock-edit-mode", label: "Mock edit mode" }],
    };
  }
}

type UserMessageItem = Extract<AgentTimelineItem, { type: "user_message" }>;

function requireUserMessage(
  entries: readonly { item: AgentTimelineItem }[],
  predicate: (item: UserMessageItem) => boolean,
  errorMessage: string,
): UserMessageItem {
  const item = entries
    .map((entry) => entry.item)
    .find((candidate): candidate is UserMessageItem =>
      candidate.type === "user_message" ? predicate(candidate) : false,
    );
  if (!item) {
    throw new Error(errorMessage);
  }
  return item;
}

class RestartableEditDaemonHarness {
  readonly provider = new InPlaceEditClient();
  readonly cwd = mkdtempSync(path.join(tmpdir(), "paseo-edit-restart-cwd-"));

  private readonly paseoHomeRoot = mkdtempSync(path.join(tmpdir(), "paseo-edit-restart-home-"));
  private readonly staticDirs: string[] = [];
  private activeDaemon: Awaited<ReturnType<typeof createTestPaseoDaemon>> | null = null;
  private activeClient: DaemonClient | null = null;

  constructor(private readonly subscriptionId: string) {}

  async start(): Promise<DaemonClient> {
    if (this.activeDaemon || this.activeClient) {
      throw new Error("Restartable edit daemon is already running");
    }
    const daemon = await createTestPaseoDaemon({
      agentClients: { mock: this.provider },
      isDev: true,
      paseoHomeRoot: this.paseoHomeRoot,
      cleanup: false,
    });
    this.activeDaemon = daemon;
    this.staticDirs.push(daemon.staticDir);
    const client = new DaemonClient({
      url: `ws://127.0.0.1:${daemon.port}/ws`,
      appVersion: "0.2.5",
    });
    this.activeClient = client;
    await client.connect();
    await client.fetchAgents({ subscribe: { subscriptionId: this.subscriptionId } });
    return client;
  }

  async stop(): Promise<void> {
    const client = this.activeClient;
    const daemon = this.activeDaemon;
    this.activeClient = null;
    this.activeDaemon = null;
    await client?.close();
    await daemon?.close();
  }

  async createReplayableAgent(
    client: DaemonClient,
    input: { title: string; prompt: string },
  ): Promise<{
    agentId: string;
    workspaceId: string;
    messageId: string;
    persistence: AgentPersistenceHandle;
  }> {
    const workspaceResult = await client.createWorkspace({
      source: { kind: "directory", path: this.cwd },
      title: input.title,
    });
    const workspaceId = workspaceResult.workspace?.id;
    if (!workspaceId) {
      throw new Error(workspaceResult.error ?? "Expected restart test workspace");
    }
    const created = await client.createAgent({
      provider: "mock",
      cwd: this.cwd,
      workspaceId,
      model: "mock-edit-model",
      modeId: "mock-edit-mode",
    });
    await client.sendMessage(created.id, input.prompt);
    await client.waitForFinish(created.id, 5_000);
    const timeline = await client.fetchAgentTimeline(created.id, {
      direction: "tail",
      limit: 20,
      projection: "projected",
    });
    const userMessage = requireUserMessage(
      timeline.entries,
      (item) => item.text === input.prompt,
      "Expected the live replayable user message",
    );
    if (!userMessage.messageId) {
      throw new Error("Expected a stable user message ID");
    }
    expect(userMessage.replayKind).toBe("text_only");
    const snapshot = await client.fetchAgent(created.id);
    const persistence = snapshot?.agent?.persistence;
    if (!persistence) {
      throw new Error("Expected a stable provider persistence identity");
    }
    return {
      agentId: created.id,
      workspaceId,
      messageId: userMessage.messageId,
      persistence,
    };
  }

  async cleanup(): Promise<void> {
    await this.stop().catch(() => undefined);
    rmSync(this.cwd, { recursive: true, force: true });
    rmSync(this.paseoHomeRoot, { recursive: true, force: true });
    for (const staticDir of this.staticDirs) {
      rmSync(staticDir, { recursive: true, force: true });
    }
  }
}

test("regenerates the latest answer from the original text in the same session", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "paseo-edit-last-user-message-"));
  const provider = new InPlaceEditClient();
  const daemon = await createTestPaseoDaemon({ agentClients: { mock: provider }, isDev: true });
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.2.5",
  });

  try {
    await client.connect();
    const workspaceResult = await client.createWorkspace({
      source: { kind: "directory", path: cwd },
      title: "Edit last user message",
    });
    const workspaceId = workspaceResult.workspace?.id;
    if (!workspaceId) {
      throw new Error(workspaceResult.error ?? "Expected edit test workspace");
    }
    await client.fetchAgents({ subscribe: { subscriptionId: "edit-last-user-message" } });
    const created = await client.createAgent({
      provider: "mock",
      cwd,
      workspaceId,
      model: "mock-edit-model",
      modeId: "mock-edit-mode",
    });
    await client.sendMessage(created.id, "original prompt");
    await client.waitForFinish(created.id, 5_000);
    const before = await client.fetchAgent(created.id);
    const initialTimeline = await client.fetchAgentTimeline(created.id, {
      direction: "tail",
      limit: 20,
      projection: "projected",
    });
    const original = initialTimeline.entries.find(
      (entry) => entry.item.type === "user_message" && entry.item.text === "original prompt",
    );
    if (!original || original.item.type !== "user_message" || !original.item.messageId) {
      throw new Error("Expected the canonical original user message");
    }

    const result = await client.editLastUserMessage({
      agentId: created.id,
      messageId: original.item.messageId,
      replacementText: "original prompt",
      replacementMessageId: "replacement-client-message",
    });

    expect(result).toEqual({
      requestId: expect.any(String),
      agentId: created.id,
      ok: true,
      historyState: "rewound",
      replacementStarted: true,
      failureStage: null,
      error: null,
    });
    await client.waitForFinish(created.id, 5_000);

    const after = await client.fetchAgent(created.id);
    const afterTimeline = await client.fetchAgentTimeline(created.id, {
      direction: "tail",
      limit: 20,
      projection: "projected",
    });
    expect(before?.agent?.id).toBe(created.id);
    expect(before?.agent?.workspaceId).toBe(workspaceId);
    expect(before?.agent?.persistence).toEqual(after?.agent?.persistence);
    expect(after?.agent?.persistence).toMatchObject({
      provider: "mock",
      sessionId: EDIT_SESSION_ID,
      nativeHandle: EDIT_NATIVE_HANDLE,
    });
    expect(afterTimeline.epoch).not.toBe(initialTimeline.epoch);
    expect(afterTimeline.entries.map((entry) => entry.item)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "user_message",
          text: "original prompt",
          messageId: "replacement-client-message",
          clientMessageId: "replacement-client-message",
        }),
      ]),
    );
    expect(
      afterTimeline.entries.some(
        (entry) =>
          entry.item.type === "user_message" && entry.item.messageId === original.item.messageId,
      ),
    ).toBe(false);
    expect(provider.createSessionCalls).toHaveLength(1);
    expect(provider.session.inPlaceEditCalls).toEqual([{ messageId: original.item.messageId }]);
  } finally {
    await client.close();
    await daemon.close();
    rmSync(cwd, { recursive: true, force: true });
  }
}, 30_000);

test("restores the latest replayable message marker after a daemon restart", async () => {
  const harness = new RestartableEditDaemonHarness("edit-last-user-message-restart");

  try {
    const firstClient = await harness.start();
    const seeded = await harness.createReplayableAgent(firstClient, {
      title: "Edit last user message after restart",
      prompt: "restart-safe prompt",
    });
    await harness.stop();

    const secondClient = await harness.start();
    const afterTimeline = await secondClient.fetchAgentTimeline(seeded.agentId, {
      direction: "tail",
      limit: 20,
      projection: "projected",
    });
    const afterUser = requireUserMessage(
      afterTimeline.entries,
      (item) => item.messageId === seeded.messageId,
      "Expected the restored user message",
    );
    const after = await secondClient.fetchAgent(seeded.agentId);

    expect(after?.agent?.id).toBe(seeded.agentId);
    expect(after?.agent?.workspaceId).toBe(seeded.workspaceId);
    expect(after?.agent?.status).toBe("idle");
    expect(after?.agent?.persistence).toEqual(seeded.persistence);
    expect(afterUser.replayKind).toBe("text_only");
  } finally {
    await harness.cleanup();
  }
}, 30_000);

test("preserves the replayable marker across same-session refresh and restart", async () => {
  const harness = new RestartableEditDaemonHarness("edit-last-user-message-refresh-restart");

  try {
    const firstClient = await harness.start();
    const seeded = await harness.createReplayableAgent(firstClient, {
      title: "Preserve edit marker through refresh",
      prompt: "refresh-safe prompt",
    });

    await firstClient.refreshAgent(seeded.agentId);
    const refreshedTimeline = await firstClient.fetchAgentTimeline(seeded.agentId, {
      direction: "tail",
      limit: 20,
      projection: "projected",
    });
    const refreshedUser = requireUserMessage(
      refreshedTimeline.entries,
      (item) => item.messageId === seeded.messageId,
      "Expected the refreshed user message",
    );
    const refreshed = await firstClient.fetchAgent(seeded.agentId);
    expect(refreshed?.agent?.persistence).toEqual(seeded.persistence);
    expect(refreshedUser.replayKind).toBe("text_only");
    await harness.stop();

    const secondClient = await harness.start();
    const restartedTimeline = await secondClient.fetchAgentTimeline(seeded.agentId, {
      direction: "tail",
      limit: 20,
      projection: "projected",
    });
    const restartedUser = requireUserMessage(
      restartedTimeline.entries,
      (item) => item.messageId === seeded.messageId,
      "Expected the restarted user message after refresh",
    );
    expect(restartedUser.replayKind).toBe("text_only");
  } finally {
    await harness.cleanup();
  }
}, 30_000);

test("does not resurrect a stale replayable marker after provider history advances", async () => {
  const harness = new RestartableEditDaemonHarness("edit-stale-message-restart");

  try {
    const firstClient = await harness.start();
    const seeded = await harness.createReplayableAgent(firstClient, {
      title: "Reject stale edit marker",
      prompt: "original replayable prompt",
    });
    await harness.stop();

    harness.provider.session.appendExternalTurn("newer external prompt", "external-user-message");
    const secondClient = await harness.start();
    const advancedTimeline = await secondClient.fetchAgentTimeline(seeded.agentId, {
      direction: "tail",
      limit: 20,
      projection: "projected",
    });
    const latestAdvancedUser = requireUserMessage(
      advancedTimeline.entries.toReversed(),
      () => true,
      "Expected the externally advanced user message",
    );
    expect(latestAdvancedUser.messageId).toBe("external-user-message");
    expect(latestAdvancedUser.replayKind).toBeUndefined();
    await harness.stop();

    await harness.provider.session.rewindLastUserMessageInPlace({
      messageId: "external-user-message",
    });
    const thirdClient = await harness.start();
    const rewoundTimeline = await thirdClient.fetchAgentTimeline(seeded.agentId, {
      direction: "tail",
      limit: 20,
      projection: "projected",
    });
    const restoredOriginal = requireUserMessage(
      rewoundTimeline.entries,
      (item) => item.messageId === seeded.messageId,
      "Expected the original user message after external rewind",
    );
    expect(restoredOriginal.replayKind).toBeUndefined();
  } finally {
    await harness.cleanup();
  }
}, 30_000);

test("does not restore a replayable marker for a different provider session identity", async () => {
  const harness = new RestartableEditDaemonHarness("edit-identity-restart");

  try {
    const firstClient = await harness.start();
    const seeded = await harness.createReplayableAgent(firstClient, {
      title: "Reject mismatched provider identity",
      prompt: "identity-bound prompt",
    });
    await harness.stop();
    harness.provider.session.setPersistenceIdentity(
      "mock-edit-replacement-session",
      "mock-edit-replacement-native-handle",
    );

    const secondClient = await harness.start();
    const afterTimeline = await secondClient.fetchAgentTimeline(seeded.agentId, {
      direction: "tail",
      limit: 20,
      projection: "projected",
    });
    const afterUser = requireUserMessage(
      afterTimeline.entries,
      (item) => item.messageId === seeded.messageId,
      "Expected the restored identity-bound user message",
    );
    expect(afterUser.replayKind).toBeUndefined();
  } finally {
    await harness.cleanup();
  }
}, 30_000);
