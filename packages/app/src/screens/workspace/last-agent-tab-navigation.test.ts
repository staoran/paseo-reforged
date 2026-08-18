import { describe, expect, it } from "vitest";
import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";
import {
  selectLastAgentTabNavigationTarget,
  type LastAgentTabNavigationSession,
} from "./last-agent-tab-navigation";

/** Creates the smallest complete workspace descriptor needed by the selector. */
function createWorkspace(input: {
  id: string;
  status: WorkspaceDescriptor["status"];
  enteredAt: number;
  defaultAgentId?: string | null;
  archivingAt?: string | null;
}): WorkspaceDescriptor {
  return {
    id: input.id,
    projectId: `project-${input.id}`,
    projectDisplayName: `Project ${input.id}`,
    projectRootPath: `/repo/${input.id}`,
    workspaceDirectory: `/repo/${input.id}`,
    projectKind: "git",
    workspaceKind: "worktree",
    name: input.id,
    status: input.status,
    statusEnteredAt: new Date(input.enteredAt),
    archivingAt: input.archivingAt ?? null,
    diffStat: null,
    defaultAgentId: input.defaultAgentId === undefined ? `agent-${input.id}` : input.defaultAgentId,
    scripts: [],
  };
}

/** Creates selector session data with resident default Agents unless explicitly overridden. */
function createSession(
  workspaces: WorkspaceDescriptor[],
  archivedAgentIds: readonly string[] = [],
  nonResidentWorkspaceIds: readonly string[] = [],
): LastAgentTabNavigationSession {
  const archivedIds = new Set(archivedAgentIds);
  const nonResidentIds = new Set(nonResidentWorkspaceIds);
  const agents = new Map<string, Pick<Agent, "workspaceId" | "archivedAt">>();
  const workspaceResidentAgentCounts = new Map<string, number>();
  for (const workspace of workspaces) {
    if (!workspace.defaultAgentId) continue;
    const archivedAt = archivedIds.has(workspace.defaultAgentId) ? new Date(10_000) : null;
    agents.set(workspace.defaultAgentId, {
      workspaceId: workspace.id,
      archivedAt,
    });
    if (!archivedAt && !nonResidentIds.has(workspace.id)) {
      workspaceResidentAgentCounts.set(workspace.id, 1);
    }
  }
  return {
    agents,
    workspaces: new Map(workspaces.map((workspace) => [workspace.id, workspace])),
    workspaceAgentActivity: new Map(),
    workspaceResidentAgentCounts,
  };
}

describe("last Agent tab navigation", () => {
  it("returns no target when no Agent workspace remains", () => {
    expect(
      selectLastAgentTabNavigationTarget({
        sessions: {},
        currentServerId: "host-a",
        currentWorkspaceId: "current",
      }),
    ).toBeNull();
  });

  it("excludes the current, empty, archiving, and archived-Agent workspaces", () => {
    const current = createWorkspace({ id: "current", status: "attention", enteredAt: 4_000 });
    const empty = createWorkspace({
      id: "empty",
      status: "done",
      enteredAt: 3_000,
      defaultAgentId: null,
    });
    const archiving = createWorkspace({
      id: "archiving",
      status: "attention",
      enteredAt: 2_000,
      archivingAt: "2026-08-18T00:00:00.000Z",
    });
    const archivedAgent = createWorkspace({
      id: "archived-agent",
      status: "attention",
      enteredAt: 1_000,
    });

    expect(
      selectLastAgentTabNavigationTarget({
        sessions: {
          "host-a": createSession(
            [current, empty, archiving, archivedAgent],
            ["agent-archived-agent"],
          ),
        },
        currentServerId: "host-a",
        currentWorkspaceId: "current",
      }),
    ).toBeNull();
  });

  it("returns no target when remaining Agent workspaces have no resident Agents", () => {
    const closedOnly = createWorkspace({ id: "closed-only", status: "done", enteredAt: 1_000 });

    expect(
      selectLastAgentTabNavigationTarget({
        sessions: {
          "host-a": createSession([closedOnly], [], [closedOnly.id]),
        },
        currentServerId: "host-a",
        currentWorkspaceId: "current",
      }),
    ).toBeNull();
  });

  it.each(["needs_input", "failed", "attention"] as const)(
    "prioritizes the latest %s workspace over done and running workspaces",
    (status) => {
      const actionable = createWorkspace({ id: "actionable", status, enteredAt: 1_000 });
      const done = createWorkspace({ id: "done", status: "done", enteredAt: 2_000 });
      const running = createWorkspace({ id: "running", status: "running", enteredAt: 3_000 });

      expect(
        selectLastAgentTabNavigationTarget({
          sessions: { "host-a": createSession([actionable, done, running]) },
          currentServerId: "host-a",
          currentWorkspaceId: "current",
        }),
      ).toEqual({
        serverId: "host-a",
        workspaceId: "actionable",
        agentId: "agent-actionable",
      });
    },
  );

  it("prioritizes a read completed workspace over a newer working workspace", () => {
    const done = createWorkspace({ id: "done", status: "done", enteredAt: 1_000 });
    const running = createWorkspace({ id: "running", status: "running", enteredAt: 2_000 });

    expect(
      selectLastAgentTabNavigationTarget({
        sessions: { "host-a": createSession([running, done]) },
        currentServerId: "host-a",
        currentWorkspaceId: "current",
      }),
    ).toEqual({
      serverId: "host-a",
      workspaceId: "done",
      agentId: "agent-done",
    });
  });

  it("selects the newest workspace in the winning tier across hosts", () => {
    const older = createWorkspace({ id: "older", status: "attention", enteredAt: 1_000 });
    const newer = createWorkspace({ id: "newer", status: "failed", enteredAt: 2_000 });

    expect(
      selectLastAgentTabNavigationTarget({
        sessions: {
          "host-a": createSession([older]),
          "host-b": createSession([newer]),
        },
        currentServerId: "host-a",
        currentWorkspaceId: "current",
      }),
    ).toEqual({
      serverId: "host-b",
      workspaceId: "newer",
      agentId: "agent-newer",
    });
  });
});
