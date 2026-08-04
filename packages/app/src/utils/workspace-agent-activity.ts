import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";
import { isWorkspaceRootAgent } from "@/subagents/policies";
import { deriveSidebarStateBucket } from "./sidebar-agent-state";

export interface WorkspaceAgentActivity {
  agentId: string;
  status: WorkspaceDescriptor["status"];
  enteredAt: Date | null;
  lastActivityAt: Date;
}

export type WorkspaceRuntimeResidency = "resident" | "closed";

export function buildWorkspaceRuntimeResidencyIndex(
  agents: ReadonlyMap<string, Agent>,
  previous?: ReadonlyMap<string, WorkspaceRuntimeResidency>,
): Map<string, WorkspaceRuntimeResidency> {
  const residencyByWorkspaceId = new Map<string, WorkspaceRuntimeResidency>();

  for (const agent of agents.values()) {
    if (agent.archivedAt || !agent.workspaceId) {
      continue;
    }

    const current = residencyByWorkspaceId.get(agent.workspaceId);
    if (current === "resident") {
      continue;
    }
    residencyByWorkspaceId.set(
      agent.workspaceId,
      agent.status === "closed" ? "closed" : "resident",
    );
  }

  if (previous && areWorkspaceRuntimeResidencyIndexesEqual(previous, residencyByWorkspaceId)) {
    return previous instanceof Map ? previous : new Map(previous);
  }
  return residencyByWorkspaceId;
}

export function buildWorkspaceAgentActivityIndex(
  agents: ReadonlyMap<string, Agent>,
  previous?: ReadonlyMap<string, WorkspaceAgentActivity>,
): Map<string, WorkspaceAgentActivity> {
  const activityByWorkspaceId = new Map<string, WorkspaceAgentActivity>();
  const latestStatusAtByWorkspaceId = new Map<string, Date>();
  const latestActivityAtByWorkspaceId = new Map<string, Date>();

  for (const agent of agents.values()) {
    const parentAgent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
    if (agent.archivedAt || !agent.workspaceId || !isWorkspaceRootAgent(agent, parentAgent)) {
      continue;
    }

    const latestActivityAt = latestActivityAtByWorkspaceId.get(agent.workspaceId);
    if (!latestActivityAt || agent.lastActivityAt > latestActivityAt) {
      latestActivityAtByWorkspaceId.set(agent.workspaceId, agent.lastActivityAt);
    }

    const enteredAt = agent.attentionTimestamp ?? agent.updatedAt;
    const latestStatusAt = latestStatusAtByWorkspaceId.get(agent.workspaceId);
    if (latestStatusAt && enteredAt <= latestStatusAt) {
      continue;
    }
    latestStatusAtByWorkspaceId.set(agent.workspaceId, enteredAt);

    const status = deriveSidebarStateBucket({
      status: agent.status,
      pendingPermissionCount: agent.pendingPermissions.length,
      requiresAttention: agent.requiresAttention,
      attentionReason: agent.attentionReason,
    });
    activityByWorkspaceId.set(agent.workspaceId, {
      agentId: agent.id,
      status,
      enteredAt,
      lastActivityAt: agent.lastActivityAt,
    });
  }

  for (const [workspaceId, activity] of activityByWorkspaceId) {
    const previousActivity = previous?.get(workspaceId);
    const lastActivityAt =
      latestActivityAtByWorkspaceId.get(workspaceId) ?? activity.lastActivityAt;
    activityByWorkspaceId.set(
      workspaceId,
      reconcileWorkspaceAgentActivity(activity, previousActivity, lastActivityAt),
    );
  }

  if (previous && areWorkspaceAgentActivityIndexesIdentical(previous, activityByWorkspaceId)) {
    return previous instanceof Map ? previous : new Map(previous);
  }
  return activityByWorkspaceId;
}

function reconcileWorkspaceAgentActivity(
  activity: WorkspaceAgentActivity,
  previousActivity: WorkspaceAgentActivity | undefined,
  lastActivityAt: Date,
): WorkspaceAgentActivity {
  const continuesPreviousStatus =
    previousActivity?.agentId === activity.agentId && previousActivity.status === activity.status;

  if (!continuesPreviousStatus) {
    return activity.lastActivityAt.getTime() === lastActivityAt.getTime()
      ? activity
      : { ...activity, lastActivityAt };
  }

  if (previousActivity.lastActivityAt.getTime() === lastActivityAt.getTime()) {
    return previousActivity;
  }

  return {
    ...activity,
    enteredAt: previousActivity.enteredAt,
    lastActivityAt,
  };
}

function areWorkspaceAgentActivityIndexesIdentical(
  previous: ReadonlyMap<string, WorkspaceAgentActivity>,
  next: ReadonlyMap<string, WorkspaceAgentActivity>,
): boolean {
  if (previous.size !== next.size) {
    return false;
  }
  for (const [workspaceId, activity] of next) {
    if (previous.get(workspaceId) !== activity) {
      return false;
    }
  }
  return true;
}

function areWorkspaceRuntimeResidencyIndexesEqual(
  previous: ReadonlyMap<string, WorkspaceRuntimeResidency>,
  next: ReadonlyMap<string, WorkspaceRuntimeResidency>,
): boolean {
  if (previous.size !== next.size) {
    return false;
  }
  for (const [workspaceId, residency] of next) {
    if (previous.get(workspaceId) !== residency) {
      return false;
    }
  }
  return true;
}
