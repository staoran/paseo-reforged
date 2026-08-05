import { describe, expect, test } from "vitest";

import { AgentListItemPayloadSchema, AgentSnapshotPayloadSchema } from "./messages.js";

function createSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: "agent-last-message-at",
    provider: "codex",
    cwd: "/tmp/project",
    model: "gpt-5",
    thinkingOptionId: null,
    effectiveThinkingOptionId: null,
    createdAt: "2026-08-05T07:00:00.000Z",
    updatedAt: "2026-08-05T07:03:00.000Z",
    lastUserMessageAt: "2026-08-05T07:01:00.000Z",
    status: "idle",
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
      supportsRewindConversation: false,
      supportsRewindFiles: false,
      supportsRewindBoth: false,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: null,
    labels: {},
    ...overrides,
  };
}

describe("agent last message timestamp protocol fields", () => {
  test("accepts legacy snapshot and list payloads without lastMessageAt", () => {
    const snapshot = AgentSnapshotPayloadSchema.parse(createSnapshot());
    const list = AgentListItemPayloadSchema.parse({
      id: snapshot.id,
      shortId: snapshot.id.slice(0, 7),
      title: snapshot.title,
      provider: snapshot.provider,
      model: snapshot.model,
      status: snapshot.status,
      cwd: snapshot.cwd,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      lastUserMessageAt: snapshot.lastUserMessageAt,
      labels: {},
    });

    expect(snapshot).not.toHaveProperty("lastMessageAt");
    expect(list).not.toHaveProperty("lastMessageAt");
  });

  test("parses string and explicit null lastMessageAt values on both payloads", () => {
    const timestamp = "2026-08-05T07:02:00.000Z";
    const snapshot = AgentSnapshotPayloadSchema.parse(createSnapshot({ lastMessageAt: timestamp }));
    const list = AgentListItemPayloadSchema.parse({
      id: snapshot.id,
      shortId: snapshot.id.slice(0, 7),
      title: snapshot.title,
      provider: snapshot.provider,
      model: snapshot.model,
      status: snapshot.status,
      cwd: snapshot.cwd,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      lastUserMessageAt: snapshot.lastUserMessageAt,
      lastMessageAt: timestamp,
      labels: {},
    });

    expect(snapshot.lastMessageAt).toBe(timestamp);
    expect(list.lastMessageAt).toBe(timestamp);
    expect(
      AgentSnapshotPayloadSchema.parse(createSnapshot({ lastMessageAt: null })).lastMessageAt,
    ).toBe(null);
    expect(
      AgentListItemPayloadSchema.parse({
        ...list,
        lastMessageAt: null,
      }).lastMessageAt,
    ).toBeNull();
  });
});
