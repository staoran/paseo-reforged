import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";
import { isWorkspaceRootAgent } from "@/subagents/policies";
import { deriveSidebarStateBucket } from "./sidebar-agent-state";

export interface WorkspaceAgentActivity {
  agentId: string;
  status: WorkspaceDescriptor["status"];
  enteredAt: Date | null;
  lastActivityAt: Date | null;
  /** True when any unarchived root agent in the workspace still requires attention. */
  hasUnreadAttention: boolean;
}

export function buildWorkspaceResidentAgentCountIndex(
  agents: ReadonlyMap<string, Agent>,
  previous?: ReadonlyMap<string, number>,
): Map<string, number> {
  const residentAgentCountByWorkspaceId = new Map<string, number>();

  for (const agent of agents.values()) {
    if (agent.archivedAt || !agent.workspaceId || agent.status === "closed") {
      continue;
    }

    residentAgentCountByWorkspaceId.set(
      agent.workspaceId,
      (residentAgentCountByWorkspaceId.get(agent.workspaceId) ?? 0) + 1,
    );
  }

  if (
    previous &&
    areWorkspaceResidentAgentCountIndexesEqual(previous, residentAgentCountByWorkspaceId)
  ) {
    return previous instanceof Map ? previous : new Map(previous);
  }
  return residentAgentCountByWorkspaceId;
}

export function buildWorkspaceAgentActivityIndex(
  agents: ReadonlyMap<string, Agent>,
  previous?: ReadonlyMap<string, WorkspaceAgentActivity>,
): Map<string, WorkspaceAgentActivity> {
  const activityByWorkspaceId = new Map<string, WorkspaceAgentActivity>();
  const latestStatusAtByWorkspaceId = new Map<string, Date>();
  const latestMessageAtByWorkspaceId = new Map<string, Date>();
  const workspaceIdsWithUnreadAttention = new Set<string>();

  for (const agent of agents.values()) {
    const parentAgent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
    if (agent.archivedAt || !agent.workspaceId || !isWorkspaceRootAgent(agent, parentAgent)) {
      continue;
    }

    if (agent.requiresAttention) {
      workspaceIdsWithUnreadAttention.add(agent.workspaceId);
    }

    const latestMessageAt = latestMessageAtByWorkspaceId.get(agent.workspaceId);
    if (agent.lastMessageAt && (!latestMessageAt || agent.lastMessageAt > latestMessageAt)) {
      latestMessageAtByWorkspaceId.set(agent.workspaceId, agent.lastMessageAt);
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
      lastActivityAt: agent.lastMessageAt,
      hasUnreadAttention: false,
    });
  }

  for (const [workspaceId, activity] of activityByWorkspaceId) {
    const previousActivity = previous?.get(workspaceId);
    const lastActivityAt = latestMessageAtByWorkspaceId.get(workspaceId) ?? null;
    const hasUnreadAttention = workspaceIdsWithUnreadAttention.has(workspaceId);
    const nextActivity = hasUnreadAttention ? { ...activity, hasUnreadAttention: true } : activity;
    activityByWorkspaceId.set(
      workspaceId,
      reconcileWorkspaceAgentActivity(nextActivity, previousActivity, lastActivityAt),
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
  lastActivityAt: Date | null,
): WorkspaceAgentActivity {
  const continuesPreviousStatus =
    previousActivity?.agentId === activity.agentId && previousActivity.status === activity.status;

  if (!continuesPreviousStatus) {
    return areActivityTimestampsEqual(activity.lastActivityAt, lastActivityAt)
      ? activity
      : { ...activity, lastActivityAt };
  }

  if (
    previousActivity.hasUnreadAttention === activity.hasUnreadAttention &&
    areActivityTimestampsEqual(previousActivity.lastActivityAt, lastActivityAt)
  ) {
    return previousActivity;
  }

  return {
    ...activity,
    enteredAt: previousActivity.enteredAt,
    lastActivityAt,
  };
}

function areActivityTimestampsEqual(left: Date | null, right: Date | null): boolean {
  return left === right || (left !== null && right !== null && left.getTime() === right.getTime());
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

function areWorkspaceResidentAgentCountIndexesEqual(
  previous: ReadonlyMap<string, number>,
  next: ReadonlyMap<string, number>,
): boolean {
  if (previous.size !== next.size) {
    return false;
  }
  for (const [workspaceId, count] of next) {
    if (previous.get(workspaceId) !== count) {
      return false;
    }
  }
  return true;
}
