import { getWorkspaceStateBucketPriority } from "@getpaseo/protocol/agent-state-bucket";
import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";
import { isWorkspaceRootAgent } from "@/subagents/policies";
import { deriveSidebarStateBucket } from "./sidebar-agent-state";

export interface WorkspaceAgentActivity {
  agentId: string;
  status: WorkspaceDescriptor["status"];
  enteredAt: Date | null;
  hasUnreadAttention: boolean;
  hasClearableAttention: boolean;
  hasMarkUnreadCandidate: boolean;
}

export interface WorkspaceManagedAgentIndex {
  agentsByWorkspace: Map<string, Agent[]>;
  residentCountsByWorkspace: Map<string, number>;
}

/** Groups unarchived managed Agents and counts the ones with a live runtime */
export function buildWorkspaceManagedAgentIndex(
  agents: ReadonlyMap<string, Agent>,
): WorkspaceManagedAgentIndex {
  const agentsByWorkspace = new Map<string, Agent[]>();
  const residentCountsByWorkspace = new Map<string, number>();
  for (const agent of agents.values()) {
    if (agent.archivedAt || !agent.workspaceId) continue;
    const workspaceAgents = agentsByWorkspace.get(agent.workspaceId);
    if (workspaceAgents) workspaceAgents.push(agent);
    else agentsByWorkspace.set(agent.workspaceId, [agent]);
    if (agent.status !== "closed") {
      residentCountsByWorkspace.set(
        agent.workspaceId,
        (residentCountsByWorkspace.get(agent.workspaceId) ?? 0) + 1,
      );
    }
  }
  return { agentsByWorkspace, residentCountsByWorkspace };
}

export interface WorkspaceReadActionAvailability {
  hasClearableAttention: boolean;
  canMarkUnread: boolean;
}

export interface WorkspaceReadActionInput {
  status: WorkspaceDescriptor["status"] | null;
  activity: Pick<WorkspaceAgentActivity, "hasClearableAttention" | "hasMarkUnreadCandidate"> | null;
  supportsMarkUnread: boolean;
}

type WorkspaceAgentReadFacts = Pick<
  WorkspaceAgentActivity,
  "hasUnreadAttention" | "hasClearableAttention" | "hasMarkUnreadCandidate"
>;

/** Uses live turn phase when an Agent status snapshot lags behind its current work */
function workspaceAgentStatus(agent: Agent): Agent["status"] {
  if (agent.turn.phase === "open") return "running";
  return agent.status === "running" ? "idle" : agent.status;
}

/** Projects root Agent activity and independent read facts once per Agent directory update */
export function buildWorkspaceAgentActivityIndex(
  agents: ReadonlyMap<string, Agent>,
  previous?: ReadonlyMap<string, WorkspaceAgentActivity>,
): Map<string, WorkspaceAgentActivity> {
  const activityByWorkspaceId = new Map<string, WorkspaceAgentActivity>();
  const readFactsByWorkspaceId = new Map<string, WorkspaceAgentReadFacts>();

  for (const agent of agents.values()) {
    if (agent.archivedAt || !agent.workspaceId) {
      continue;
    }

    const parentAgent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
    const isRoot = isWorkspaceRootAgent(agent, parentAgent);
    recordWorkspaceAgentReadFacts(agent, agent.workspaceId, isRoot, readFactsByWorkspaceId);
    if (!isRoot) continue;

    const status = deriveSidebarStateBucket({
      status: workspaceAgentStatus(agent),
      pendingPermissionCount: agent.pendingPermissions.length,
      requiresAttention: agent.requiresAttention,
      attentionReason: agent.attentionReason,
    });
    let enteredAt = agent.attentionTimestamp ?? agent.updatedAt;
    if (agent.turn.phase === "open") {
      if (status === "running") enteredAt = agent.turn.startedAt ?? agent.updatedAt;
    }
    const current = activityByWorkspaceId.get(agent.workspaceId);
    if (current) {
      const priority = getWorkspaceStateBucketPriority(status);
      const currentPriority = getWorkspaceStateBucketPriority(current.status);
      const isLowerPriority = priority > currentPriority;
      const isOlderInSameBucket =
        priority === currentPriority &&
        current.enteredAt !== null &&
        enteredAt <= current.enteredAt;
      if (isLowerPriority || isOlderInSameBucket) {
        continue;
      }
    }
    activityByWorkspaceId.set(agent.workspaceId, {
      agentId: agent.id,
      status,
      enteredAt,
      hasUnreadAttention: false,
      hasClearableAttention: false,
      hasMarkUnreadCandidate: false,
    });
  }

  for (const [workspaceId, activity] of activityByWorkspaceId) {
    activityByWorkspaceId.set(
      workspaceId,
      reconcileWorkspaceAgentActivity(
        activity,
        readFactsByWorkspaceId.get(workspaceId),
        previous?.get(workspaceId),
      ),
    );
  }

  if (previous && areWorkspaceAgentActivityIndexesIdentical(previous, activityByWorkspaceId)) {
    return previous instanceof Map ? previous : new Map(previous);
  }
  return activityByWorkspaceId;
}

/** Tracks unread visual state for roots while keeping clearable child attention available */
function recordWorkspaceAgentReadFacts(
  agent: Agent,
  workspaceId: string,
  isRoot: boolean,
  factsByWorkspaceId: Map<string, WorkspaceAgentReadFacts>,
): void {
  const facts = factsByWorkspaceId.get(workspaceId) ?? {
    hasUnreadAttention: false,
    hasClearableAttention: false,
    hasMarkUnreadCandidate: false,
  };
  factsByWorkspaceId.set(workspaceId, facts);

  const hasNoPendingPermissions = agent.pendingPermissions.length === 0;
  const isClearableAttention =
    agent.requiresAttention === true &&
    hasNoPendingPermissions &&
    agent.attentionReason !== "permission";
  if (isClearableAttention) {
    facts.hasClearableAttention = true;
  }
  if (!isRoot) return;

  const hasFinishedStatus = agent.status === "idle" || agent.status === "closed";
  if (agent.requiresAttention === true) {
    facts.hasUnreadAttention = true;
  } else if (hasFinishedStatus && hasNoPendingPermissions) {
    facts.hasMarkUnreadCandidate = true;
  }
}

/** Preserves the current bucket entry time when only read facts change */
function reconcileWorkspaceAgentActivity(
  activity: WorkspaceAgentActivity,
  facts: WorkspaceAgentReadFacts | undefined,
  previous: WorkspaceAgentActivity | undefined,
): WorkspaceAgentActivity {
  const next = { ...activity, ...facts };
  if (previous?.status !== next.status) return next;

  next.enteredAt = previous.enteredAt;
  const hasSameAgent = previous.agentId === next.agentId;
  const hasSameReadFacts =
    previous.hasUnreadAttention === next.hasUnreadAttention &&
    previous.hasClearableAttention === next.hasClearableAttention &&
    previous.hasMarkUnreadCandidate === next.hasMarkUnreadCandidate;
  if (hasSameAgent && hasSameReadFacts) {
    return previous;
  }
  return next;
}

/** Exposes read actions only when the Agent facts and Workspace priority allow them */
export function deriveWorkspaceReadActionAvailability(
  input: WorkspaceReadActionInput,
): WorkspaceReadActionAvailability {
  const { status, activity, supportsMarkUnread } = input;
  const canClearInBucket = status === "attention" || status === "failed" || status === "done";
  const canMarkUnreadInBucket = status === "attention" || status === "done";
  const hasClearableAttention = Boolean(activity?.hasClearableAttention) && canClearInBucket;
  const hasMarkUnreadCandidate = Boolean(activity?.hasMarkUnreadCandidate);
  const hasNoClearableAttention = !activity?.hasClearableAttention;
  const canMarkUnread =
    supportsMarkUnread &&
    hasMarkUnreadCandidate &&
    hasNoClearableAttention &&
    canMarkUnreadInBucket;
  return { hasClearableAttention, canMarkUnread };
}

/** Reuses the index when every Workspace kept the same projected activity object */
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
