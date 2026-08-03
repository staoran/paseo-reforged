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
  readonly id = EDIT_SESSION_ID;
  readonly capabilities = EDIT_CAPABILITIES;
  readonly persistence: AgentPersistenceHandle = {
    provider: this.provider,
    sessionId: EDIT_SESSION_ID,
    nativeHandle: EDIT_NATIVE_HANDLE,
  };
  readonly inPlaceEditCalls: Array<{ messageId: string }> = [];

  private turnOrdinal = 0;
  private readonly history: AgentStreamEvent[] = [];
  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();

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

test("edits the latest canonical text message in the same session and starts one replacement turn", async () => {
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
      replacementText: "replacement prompt",
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
          text: "replacement prompt",
          clientMessageId: "replacement-client-message",
        }),
      ]),
    );
    expect(
      afterTimeline.entries.some(
        (entry) => entry.item.type === "user_message" && entry.item.text === "original prompt",
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
