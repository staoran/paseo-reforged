import type {
  AgentGoalSnapshot,
  AgentGoalStatus,
  AgentGoalSyncStatus,
} from "@getpaseo/protocol/agent-types";

/** Inputs used to derive the Goal control presentation. */
export interface GoalPresentationInput {
  /** Provider-owned Goal projection; undefined means the daemon has not reported support or state. */
  goal: AgentGoalSnapshot | null | undefined;
  /** Freshness of the provider-owned Goal projection. */
  goalSync: AgentGoalSyncStatus | undefined;
  /** Command currently awaiting a daemon response. */
  pendingAction?: GoalActionId | null;
}

/** Capability and projection inputs that decide which composer progress surface owns the row. */
export interface GoalTrackVisibilityInput {
  /** Whether the connected daemon advertises Goal control. */
  supported: boolean;
  /** Provider-owned Goal tri-state projection. */
  goal: AgentGoalSnapshot | null | undefined;
}

/** Stable Goal commands exposed by the presentation layer. */
export type GoalActionId = "pause" | "resume" | "edit" | "terminate" | "retry";

/** Visibility and availability of one Goal command. */
export interface GoalActionPresentation {
  /** Stable command identifier consumed by the Goal control. */
  id: GoalActionId;
  /** Whether the command may be invoked from the current projection. */
  enabled: boolean;
  /** Whether this command is currently awaiting a daemon response. */
  pending?: true;
}

/** Visible provider-owned Goal projection. */
export interface GoalPresentation {
  /** Goal shown by the control. */
  goal: AgentGoalSnapshot;
  /** Freshness shown by the control. */
  goalSync: AgentGoalSyncStatus | undefined;
  /** Commands shown for the provider-owned Goal state. */
  actions: GoalActionPresentation[];
}

/** Goal states that may request a native scheduler resume. */
const RESUMABLE_GOAL_STATUSES = new Set<AgentGoalStatus>([
  "blocked",
  "usageLimited",
  "budgetLimited",
]);

/** Returns true only when a supported daemon has reported an existing Goal. */
export function shouldShowAgentGoalTrack(input: GoalTrackVisibilityInput): boolean {
  return input.supported && input.goal != null;
}

/** Builds commands for a fresh provider-owned Goal state. */
function buildSyncedActions(status: AgentGoalStatus): GoalActionPresentation[] {
  if (status === "active") {
    return [
      { id: "pause", enabled: true },
      { id: "terminate", enabled: true },
    ];
  }

  if (status === "paused") {
    return [
      { id: "resume", enabled: true },
      { id: "edit", enabled: true },
      { id: "terminate", enabled: true },
    ];
  }

  if (RESUMABLE_GOAL_STATUSES.has(status)) {
    return [
      { id: "resume", enabled: true },
      { id: "terminate", enabled: true },
    ];
  }

  if (status === "complete") {
    return [{ id: "terminate", enabled: true }];
  }

  return [];
}

/** Disables one action while preserving its stable command identity. */
function disableGoalAction(action: GoalActionPresentation): GoalActionPresentation {
  return { id: action.id, enabled: false };
}

/** Disables one action and marks the matching command as pending. */
function disableGoalActionForPending(
  action: GoalActionPresentation,
  pendingAction: GoalActionId,
): GoalActionPresentation {
  if (action.id === pendingAction) {
    return { id: action.id, enabled: false, pending: true };
  }
  return disableGoalAction(action);
}

/** Applies projection freshness to the status-derived Goal commands. */
function buildSynchronizedActions(
  statusActions: GoalActionPresentation[],
  goalSync: AgentGoalSyncStatus | undefined,
): GoalActionPresentation[] {
  if (goalSync === "synced") {
    return statusActions;
  }
  const disabledActions = statusActions.map(disableGoalAction);
  if (goalSync === "stale") {
    disabledActions.push({ id: "retry", enabled: true });
  }
  return disabledActions;
}

/** Derives whether a Goal control should be visible from the authoritative tri-state projection. */
export function buildGoalPresentation(input: GoalPresentationInput): GoalPresentation | null {
  if (input.goal == null) {
    return null;
  }

  // Status-derived commands remain visible while stale so the control does not jump in size.
  const statusActions = buildSyncedActions(input.goal.status);
  const syncActions = buildSynchronizedActions(statusActions, input.goalSync);
  // A single per-control mutation lane prevents duplicate or conflicting Goal RPCs.
  const pendingAction = input.pendingAction;
  let actions = syncActions;
  if (pendingAction) {
    actions = syncActions.map((action) => disableGoalActionForPending(action, pendingAction));
  }

  return {
    goal: input.goal,
    goalSync: input.goalSync,
    actions,
  };
}
