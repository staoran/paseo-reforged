import { describe, expect, it } from "vitest";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import type { WorkspaceAgentActivity } from "@/utils/workspace-agent-activity";
import {
  areSidebarWorkspaceSessionsEqual,
  selectSidebarWorkspaceSessions,
  type SidebarWorkspaceSession,
} from "./sidebar-workspaces-view-model";

function workspaceMap(): Map<string, WorkspaceDescriptor> {
  return new Map();
}

function activityMap(): Map<string, WorkspaceAgentActivity> {
  return new Map();
}

function sidebarSession(input?: Partial<Omit<SidebarWorkspaceSession, "serverId">>) {
  return {
    workspaces: input?.workspaces ?? workspaceMap(),
    workspaceAgentActivity: input?.workspaceAgentActivity ?? activityMap(),
    serverInfo: input?.supportsMarkUnread ? { features: { workspaceMarkUnread: true } } : null,
  };
}

describe("sidebar workspace session selection", () => {
  it("selects only sessions needed by sidebar placements", () => {
    const hostA = sidebarSession();
    const hostB = sidebarSession();
    const unusedHost = sidebarSession();

    expect(
      selectSidebarWorkspaceSessions(
        {
          "host-a": hostA,
          "host-b": hostB,
          unused: unusedHost,
        },
        ["host-b", "missing", "host-a"],
      ),
    ).toEqual([
      {
        serverId: "host-b",
        workspaces: hostB.workspaces,
        workspaceAgentActivity: hostB.workspaceAgentActivity,
        supportsMarkUnread: false,
      },
      {
        serverId: "host-a",
        workspaces: hostA.workspaces,
        workspaceAgentActivity: hostA.workspaceAgentActivity,
        supportsMarkUnread: false,
      },
    ]);
  });

  it("ignores high-frequency session changes outside the sidebar indexes", () => {
    const workspaces = workspaceMap();
    const workspaceAgentActivity = activityMap();

    const previous = selectSidebarWorkspaceSessions(
      { "host-a": sidebarSession({ workspaces, workspaceAgentActivity }) },
      ["host-a"],
    );
    const next = selectSidebarWorkspaceSessions(
      { "host-a": sidebarSession({ workspaces, workspaceAgentActivity }) },
      ["host-a"],
    );

    expect(previous).not.toBe(next);
    expect(areSidebarWorkspaceSessionsEqual(previous, next)).toBe(true);
  });

  it("detects changes to a selected workspace or activity index", () => {
    const workspaceAgentActivity = activityMap();
    const previous = selectSidebarWorkspaceSessions(
      { "host-a": sidebarSession({ workspaceAgentActivity, workspaces: workspaceMap() }) },
      ["host-a"],
    );
    const next = selectSidebarWorkspaceSessions(
      { "host-a": sidebarSession({ workspaceAgentActivity, workspaces: workspaceMap() }) },
      ["host-a"],
    );

    expect(areSidebarWorkspaceSessionsEqual(previous, next)).toBe(false);
  });

  it("updates row read actions when the host gains mark-unread support", () => {
    const workspaces = workspaceMap();
    const workspaceAgentActivity = activityMap();
    const previous = selectSidebarWorkspaceSessions(
      { "host-a": sidebarSession({ workspaces, workspaceAgentActivity }) },
      ["host-a"],
    );
    const next = selectSidebarWorkspaceSessions(
      {
        "host-a": sidebarSession({ workspaces, workspaceAgentActivity, supportsMarkUnread: true }),
      },
      ["host-a"],
    );

    expect(next[0]?.supportsMarkUnread).toBe(true);
    expect(areSidebarWorkspaceSessionsEqual(previous, next)).toBe(false);
  });
});
