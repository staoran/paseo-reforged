import { describe, expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import {
  buildWorkspaceAgentActivityIndex,
  buildWorkspaceResidentAgentCountIndex,
} from "./workspace-agent-activity";

function agent(input: {
  id: string;
  workspaceId?: string;
  status?: Agent["status"];
  updatedAt: string;
  lastActivityAt?: string;
  lastMessageAt?: string | null;
  attentionTimestamp?: string | null;
  requiresAttention?: boolean;
  attentionReason?: Agent["attentionReason"];
  pendingPermissionCount?: number;
  archivedAt?: string | null;
  parentAgentId?: string | null;
}): Agent {
  let lastMessageAt: Date | null = null;
  if (input.lastMessageAt === undefined) {
    lastMessageAt = new Date(input.lastActivityAt ?? input.updatedAt);
  } else if (input.lastMessageAt) {
    lastMessageAt = new Date(input.lastMessageAt);
  }

  return {
    serverId: "host-a",
    id: input.id,
    provider: "codex",
    status: input.status ?? "idle",
    activeTurn: input.status === "running" ? { turnId: "turn-1", startedAt: null } : null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date(input.updatedAt),
    lastUserMessageAt: null,
    lastMessageAt,
    lastActivityAt: new Date(input.lastActivityAt ?? input.updatedAt),
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: Array.from({ length: input.pendingPermissionCount ?? 0 }, (_, index) => ({
      id: `permission-${index}`,
      provider: "codex",
      name: "shell",
      kind: "tool",
      input: {},
    })),
    persistence: null,
    title: null,
    cwd: "/repo",
    workspaceId: input.workspaceId,
    model: null,
    providerRetryMessage: null,
    requiresAttention: input.requiresAttention,
    attentionReason: input.attentionReason,
    attentionTimestamp: input.attentionTimestamp ? new Date(input.attentionTimestamp) : null,
    archivedAt: input.archivedAt ? new Date(input.archivedAt) : null,
    parentAgentId: input.parentAgentId ?? null,
    labels: {},
  };
}

describe("workspace agent activity index", () => {
  it("uses the last message timestamp instead of later Agent activity", () => {
    const index = buildWorkspaceAgentActivityIndex(
      new Map([
        [
          "root",
          agent({
            id: "root",
            workspaceId: "workspace-a",
            updatedAt: "2026-08-05T07:03:00.000Z",
            lastActivityAt: "2026-08-05T07:03:00.000Z",
            lastMessageAt: "2026-08-05T07:02:00.000Z",
          }),
        ],
      ]),
    );

    expect(index.get("workspace-a")?.lastActivityAt).toEqual(new Date("2026-08-05T07:02:00.000Z"));
  });

  it("takes the latest message across unarchived workspace roots", () => {
    const index = buildWorkspaceAgentActivityIndex(
      new Map([
        [
          "latest-status",
          agent({
            id: "latest-status",
            workspaceId: "workspace-a",
            status: "running",
            updatedAt: "2026-08-05T07:04:00.000Z",
            lastMessageAt: "2026-08-05T07:01:00.000Z",
          }),
        ],
        [
          "latest-message",
          agent({
            id: "latest-message",
            workspaceId: "workspace-a",
            updatedAt: "2026-08-05T07:03:00.000Z",
            lastMessageAt: "2026-08-05T07:02:00.000Z",
          }),
        ],
        [
          "child",
          agent({
            id: "child",
            workspaceId: "workspace-a",
            updatedAt: "2026-08-05T07:05:00.000Z",
            lastMessageAt: "2026-08-05T07:05:00.000Z",
            parentAgentId: "latest-status",
          }),
        ],
        [
          "archived",
          agent({
            id: "archived",
            workspaceId: "workspace-a",
            updatedAt: "2026-08-05T07:06:00.000Z",
            lastMessageAt: "2026-08-05T07:06:00.000Z",
            archivedAt: "2026-08-05T07:06:00.000Z",
          }),
        ],
      ]),
    );

    expect(index.get("workspace-a")).toMatchObject({
      agentId: "latest-status",
      status: "running",
      lastActivityAt: new Date("2026-08-05T07:02:00.000Z"),
    });
  });

  it("keeps workspace status without displaying a time when roots have no messages", () => {
    const index = buildWorkspaceAgentActivityIndex(
      new Map([
        [
          "root",
          agent({
            id: "root",
            workspaceId: "workspace-a",
            status: "running",
            updatedAt: "2026-08-05T07:03:00.000Z",
            lastMessageAt: null,
          }),
        ],
        [
          "child",
          agent({
            id: "child",
            workspaceId: "workspace-a",
            updatedAt: "2026-08-05T07:04:00.000Z",
            lastMessageAt: "2026-08-05T07:04:00.000Z",
            parentAgentId: "root",
          }),
        ],
      ]),
    );

    expect(index.get("workspace-a")).toMatchObject({
      agentId: "root",
      status: "running",
      lastActivityAt: null,
    });
  });

  it("keeps the latest active root agent for each workspace", () => {
    const index = buildWorkspaceAgentActivityIndex(
      new Map([
        [
          "older",
          agent({
            id: "older",
            workspaceId: "workspace-a",
            status: "running",
            updatedAt: "2026-06-01T10:00:00.000Z",
          }),
        ],
        [
          "permission",
          agent({
            id: "permission",
            workspaceId: "workspace-a",
            updatedAt: "2026-06-01T10:01:00.000Z",
            pendingPermissionCount: 1,
          }),
        ],
        [
          "attention",
          agent({
            id: "attention",
            workspaceId: "workspace-b",
            updatedAt: "2026-06-01T10:00:00.000Z",
            attentionTimestamp: "2026-06-01T10:02:00.000Z",
            requiresAttention: true,
            attentionReason: "finished",
          }),
        ],
      ]),
    );

    expect(index).toEqual(
      new Map([
        [
          "workspace-a",
          {
            agentId: "permission",
            status: "needs_input",
            enteredAt: new Date("2026-06-01T10:01:00.000Z"),
            lastActivityAt: new Date("2026-06-01T10:01:00.000Z"),
          },
        ],
        [
          "workspace-b",
          {
            agentId: "attention",
            status: "attention",
            enteredAt: new Date("2026-06-01T10:02:00.000Z"),
            lastActivityAt: new Date("2026-06-01T10:00:00.000Z"),
          },
        ],
      ]),
    );
  });

  it("does not let archived or child agents change root workspace activity", () => {
    const index = buildWorkspaceAgentActivityIndex(
      new Map([
        [
          "root",
          agent({
            id: "root",
            workspaceId: "workspace-a",
            status: "running",
            updatedAt: "2026-06-01T10:00:00.000Z",
          }),
        ],
        [
          "child",
          agent({
            id: "child",
            workspaceId: "workspace-a",
            updatedAt: "2026-06-01T10:03:00.000Z",
            pendingPermissionCount: 1,
            parentAgentId: "root",
          }),
        ],
        [
          "archived",
          agent({
            id: "archived",
            workspaceId: "workspace-a",
            updatedAt: "2026-06-01T10:04:00.000Z",
            requiresAttention: true,
            attentionReason: "error",
            archivedAt: "2026-06-01T10:04:00.000Z",
          }),
        ],
      ]),
    );

    expect(index.get("workspace-a")).toEqual({
      agentId: "root",
      status: "running",
      enteredAt: new Date("2026-06-01T10:00:00.000Z"),
      lastActivityAt: new Date("2026-06-01T10:00:00.000Z"),
    });
  });

  it("treats a cross-workspace subagent as activity in its own workspace", () => {
    const index = buildWorkspaceAgentActivityIndex(
      new Map([
        [
          "parent",
          agent({
            id: "parent",
            workspaceId: "workspace-a",
            updatedAt: "2026-06-01T10:00:00.000Z",
          }),
        ],
        [
          "child",
          agent({
            id: "child",
            workspaceId: "workspace-b",
            status: "running",
            updatedAt: "2026-06-01T10:03:00.000Z",
            parentAgentId: "parent",
          }),
        ],
      ]),
    );

    expect(index).toEqual(
      new Map([
        [
          "workspace-a",
          {
            agentId: "parent",
            status: "attention",
            enteredAt: new Date("2026-06-01T10:00:00.000Z"),
            lastActivityAt: new Date("2026-06-01T10:00:00.000Z"),
          },
        ],
        [
          "workspace-b",
          {
            agentId: "child",
            status: "running",
            enteredAt: new Date("2026-06-01T10:03:00.000Z"),
            lastActivityAt: new Date("2026-06-01T10:03:00.000Z"),
          },
        ],
      ]),
    );
  });

  it("preserves the activity index while the same agent remains in the same status", () => {
    const previous = buildWorkspaceAgentActivityIndex(
      new Map([
        [
          "root",
          agent({
            id: "root",
            workspaceId: "workspace-a",
            status: "running",
            updatedAt: "2026-06-01T10:00:00.000Z",
          }),
        ],
      ]),
    );

    const next = buildWorkspaceAgentActivityIndex(
      new Map([
        [
          "root",
          agent({
            id: "root",
            workspaceId: "workspace-a",
            status: "running",
            updatedAt: "2026-06-01T10:05:00.000Z",
            lastActivityAt: "2026-06-01T10:00:00.000Z",
          }),
        ],
      ]),
      previous,
    );

    expect(next).toBe(previous);
    expect(next.get("workspace-a")?.enteredAt).toEqual(new Date("2026-06-01T10:00:00.000Z"));
  });

  it("records a new entry time when an agent changes status", () => {
    const previous = buildWorkspaceAgentActivityIndex(
      new Map([
        [
          "root",
          agent({
            id: "root",
            workspaceId: "workspace-a",
            status: "running",
            updatedAt: "2026-06-01T10:00:00.000Z",
          }),
        ],
      ]),
    );

    const next = buildWorkspaceAgentActivityIndex(
      new Map([
        [
          "root",
          agent({
            id: "root",
            workspaceId: "workspace-a",
            status: "idle",
            updatedAt: "2026-06-01T10:05:00.000Z",
            pendingPermissionCount: 1,
          }),
        ],
      ]),
      previous,
    );

    expect(next).not.toBe(previous);
    expect(next.get("workspace-a")).toEqual({
      agentId: "root",
      status: "needs_input",
      enteredAt: new Date("2026-06-01T10:05:00.000Z"),
      lastActivityAt: new Date("2026-06-01T10:05:00.000Z"),
    });
  });

  it("advances last activity without resetting the current status entry time", () => {
    const previous = buildWorkspaceAgentActivityIndex(
      new Map([
        [
          "root",
          agent({
            id: "root",
            workspaceId: "workspace-a",
            status: "running",
            updatedAt: "2026-06-01T10:00:00.000Z",
            lastActivityAt: "2026-06-01T10:02:00.000Z",
          }),
        ],
      ]),
    );

    const next = buildWorkspaceAgentActivityIndex(
      new Map([
        [
          "root",
          agent({
            id: "root",
            workspaceId: "workspace-a",
            status: "running",
            updatedAt: "2026-06-01T10:05:00.000Z",
            lastActivityAt: "2026-06-01T10:05:00.000Z",
          }),
        ],
      ]),
      previous,
    );

    expect(next.get("workspace-a")).toEqual({
      agentId: "root",
      status: "running",
      enteredAt: new Date("2026-06-01T10:00:00.000Z"),
      lastActivityAt: new Date("2026-06-01T10:05:00.000Z"),
    });
  });
});

describe("workspace resident Agent count index", () => {
  it("counts unarchived resident root and subagent runtimes", () => {
    const index = buildWorkspaceResidentAgentCountIndex(
      new Map([
        [
          "root",
          agent({
            id: "root",
            workspaceId: "workspace-a",
            status: "idle",
            updatedAt: "2026-06-01T10:00:00.000Z",
          }),
        ],
        [
          "child",
          agent({
            id: "child",
            workspaceId: "workspace-a",
            status: "idle",
            updatedAt: "2026-06-01T10:01:00.000Z",
            parentAgentId: "root",
          }),
        ],
        [
          "closed",
          agent({
            id: "closed",
            workspaceId: "workspace-a",
            status: "closed",
            updatedAt: "2026-06-01T10:02:00.000Z",
          }),
        ],
        [
          "archived",
          agent({
            id: "archived",
            workspaceId: "workspace-a",
            status: "idle",
            updatedAt: "2026-06-01T10:03:00.000Z",
            archivedAt: "2026-06-01T10:04:00.000Z",
          }),
        ],
        [
          "without-workspace",
          agent({
            id: "without-workspace",
            status: "idle",
            updatedAt: "2026-06-01T10:05:00.000Z",
          }),
        ],
      ]),
    );

    expect(index).toEqual(new Map([["workspace-a", 2]]));
  });

  it("omits workspaces when every unarchived managed agent is closed", () => {
    const index = buildWorkspaceResidentAgentCountIndex(
      new Map([
        [
          "root",
          agent({
            id: "root",
            workspaceId: "workspace-a",
            status: "closed",
            updatedAt: "2026-06-01T10:00:00.000Z",
          }),
        ],
        [
          "child",
          agent({
            id: "child",
            workspaceId: "workspace-a",
            status: "closed",
            updatedAt: "2026-06-01T10:01:00.000Z",
            parentAgentId: "root",
          }),
        ],
      ]),
    );

    expect(index).toEqual(new Map());
  });

  it("omits workspaces with no unarchived managed agents", () => {
    const index = buildWorkspaceResidentAgentCountIndex(
      new Map([
        [
          "archived",
          agent({
            id: "archived",
            workspaceId: "workspace-a",
            status: "idle",
            updatedAt: "2026-06-01T10:00:00.000Z",
            archivedAt: "2026-06-01T10:01:00.000Z",
          }),
        ],
      ]),
    );

    expect(index).toEqual(new Map());
  });

  it("preserves the previous index when resident counts are unchanged", () => {
    const previous = new Map([["workspace-a", 1]]);
    const next = buildWorkspaceResidentAgentCountIndex(
      new Map([
        [
          "root",
          agent({
            id: "root",
            workspaceId: "workspace-a",
            status: "idle",
            updatedAt: "2026-06-01T10:00:00.000Z",
          }),
        ],
      ]),
      previous,
    );

    expect(next).toBe(previous);
  });
});
