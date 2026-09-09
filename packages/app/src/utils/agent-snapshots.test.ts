import { describe, expect, it } from "vitest";
import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";
import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import { normalizeAgentSnapshot, projectAgentSnapshot } from "./agent-snapshots";

/** Inputs accepted by the Agent snapshot test builder. */
type SnapshotInput = Partial<Omit<AgentSnapshotPayload, "labels">> & {
  labels?: Record<string, unknown>;
};

/** Applies optional Goal fields while preserving omitted-versus-null semantics. */
function applyGoalInput(snapshot: AgentSnapshotPayload, input: SnapshotInput): void {
  if (input.goal !== undefined) snapshot.goal = input.goal;
  if (input.goalStep !== undefined) snapshot.goalStep = input.goalStep;
  if (input.goalSync !== undefined) snapshot.goalSync = input.goalSync;
}

/** Builds one complete wire snapshot for normalization tests. */
function createSnapshot(input: SnapshotInput = {}): AgentSnapshotPayload {
  const snapshot: AgentSnapshotPayload = {
    id: input.id ?? "agent-1",
    provider: input.provider ?? "codex",
    cwd: input.cwd ?? "/repo",
    model: input.model ?? null,
    createdAt: input.createdAt ?? "2026-04-20T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-04-20T00:01:00.000Z",
    lastUserMessageAt: input.lastUserMessageAt ?? null,
    ...(input.lastMessageAt !== undefined ? { lastMessageAt: input.lastMessageAt } : {}),
    status: input.status ?? "idle",
    activeTurn: input.activeTurn,
    capabilities: input.capabilities ?? {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: input.currentModeId ?? null,
    availableModes: input.availableModes ?? [],
    pendingPermissions: input.pendingPermissions ?? [],
    persistence: input.persistence ?? null,
    ...(input.providerRetryMessage !== undefined
      ? { providerRetryMessage: input.providerRetryMessage }
      : {}),
    title: input.title ?? null,
    labels: (input.labels ?? {}) as AgentSnapshotPayload["labels"],
  };
  applyGoalInput(snapshot, input);
  return snapshot;
}

describe("normalizeAgentSnapshot", () => {
  it("round-trips identified active turns through the canonical snapshot boundary", () => {
    const snapshot = createSnapshot({
      status: "running",
      activeTurn: { turnId: "turn-1", startedAt: "2026-07-31T12:00:00.000Z" },
    });

    expect(projectAgentSnapshot(normalizeAgentSnapshot(snapshot, "server-1"))).toMatchObject({
      status: "running",
      activeTurn: snapshot.activeTurn,
    });
  });

  it("normalizes identified and legacy active turns at the snapshot boundary", () => {
    const startedAt = "2026-07-31T12:00:00.000Z";
    expect(
      normalizeAgentSnapshot(
        createSnapshot({
          status: "running",
          activeTurn: { turnId: "turn-1", startedAt },
        }),
        "server-1",
      ).activeTurn,
    ).toEqual({ turnId: "turn-1", startedAt: new Date(startedAt) });

    expect(
      normalizeAgentSnapshot(
        createSnapshot({ status: "running", lastUserMessageAt: startedAt }),
        "server-1",
      ).activeTurn,
    ).toEqual({ turnId: null, startedAt: new Date(startedAt) });
  });

  it("derives parentAgentId from the parent label while preserving labels", () => {
    const labels = {
      [PARENT_AGENT_ID_LABEL]: "parent-1",
      "custom.label": "still-here",
    };

    const agent = normalizeAgentSnapshot(createSnapshot({ labels }), "server-1");

    expect(agent.parentAgentId).toBe("parent-1");
    expect(agent.labels).toEqual(labels);
  });

  it("trims whitespace around the parent label", () => {
    const agent = normalizeAgentSnapshot(
      createSnapshot({ labels: { [PARENT_AGENT_ID_LABEL]: "  parent-1 \n" } }),
      "server-1",
    );

    expect(agent.parentAgentId).toBe("parent-1");
  });

  it("maps missing, empty, and non-string parent labels to null", () => {
    const missing = normalizeAgentSnapshot(createSnapshot(), "server-1");
    const empty = normalizeAgentSnapshot(
      createSnapshot({ labels: { [PARENT_AGENT_ID_LABEL]: "   " } }),
      "server-1",
    );
    const nonString = normalizeAgentSnapshot(
      createSnapshot({ labels: { [PARENT_AGENT_ID_LABEL]: 42 } }),
      "server-1",
    );

    expect(missing.parentAgentId).toBeNull();
    expect(empty.parentAgentId).toBeNull();
    expect(nonString.parentAgentId).toBeNull();
  });

  it("normalizes optional provider retry messages without rewriting them", () => {
    const missing = normalizeAgentSnapshot(createSnapshot(), "server-1");
    const retrying = normalizeAgentSnapshot(
      createSnapshot({ providerRetryMessage: " Reconnecting... 2/5 " }),
      "server-1",
    );

    expect(missing.providerRetryMessage).toBeNull();
    expect(retrying.providerRetryMessage).toBe(" Reconnecting... 2/5 ");
  });

  it("normalizes lastMessageAt independently from updatedAt and defaults legacy payloads to null", () => {
    const messageAt = new Date("2026-08-05T07:02:00.000Z");
    const normalized = normalizeAgentSnapshot(
      createSnapshot({
        updatedAt: "2026-08-05T07:03:00.000Z",
        lastMessageAt: messageAt.toISOString(),
      }),
      "server-1",
    );
    const legacy = normalizeAgentSnapshot(createSnapshot(), "server-1");

    expect(normalized.lastMessageAt).toEqual(messageAt);
    expect(normalized.lastActivityAt).toEqual(new Date("2026-08-05T07:03:00.000Z"));
    expect(legacy.lastMessageAt).toBeNull();
  });

  it("preserves the Goal projection's undefined, null, and object states", () => {
    const missing = normalizeAgentSnapshot(createSnapshot(), "server-1");
    const absent = normalizeAgentSnapshot(createSnapshot({ goal: null }), "server-1");
    const goal = {
      objective: "Ship Goal controls",
      status: "active" as const,
      tokenBudget: 10_000,
      tokensUsed: 2_500,
      timeUsedSeconds: 90,
      createdAt: "2026-08-18T08:00:00.000Z",
      updatedAt: "2026-08-18T08:01:30.000Z",
    };
    const goalStep = {
      generation: goal.createdAt,
      ordinal: 1,
      text: "Build the App control",
      status: "in_progress" as const,
      activeForm: "Building the App control",
    };
    const active = normalizeAgentSnapshot(
      createSnapshot({ goal, goalStep, goalSync: "synced" }),
      "server-1",
    );

    expect(missing.goal).toBeUndefined();
    expect(absent.goal).toBeNull();
    expect(active.goal).toEqual(goal);
    expect(active.goalStep).toEqual(goalStep);
    expect(active.goalSync).toBe("synced");
  });
});
