import type {
  AgentGoalSnapshot,
  AgentGoalStepSnapshot,
  AgentGoalSyncStatus,
} from "@getpaseo/protocol/agent-types";
import type { GoalActionId } from "./presentation";

/** Maximum provider-supported Goal objective length in Unicode characters. */
export const MAX_GOAL_OBJECTIVE_CHARACTERS = 4_000;

/** Successful normalized Goal objective. */
export interface ValidGoalObjective {
  /** Indicates successful validation. */
  ok: true;
  /** Trimmed objective sent to the daemon. */
  objective: string;
}

/** Local validation failure for a Goal objective. */
export interface InvalidGoalObjective {
  /** Indicates failed validation. */
  ok: false;
  /** Stable reason translated by the Goal editor. */
  reason: "empty" | "too_long";
}

/** Result of normalizing and validating a Goal objective. */
export type GoalObjectiveValidation = ValidGoalObjective | InvalidGoalObjective;

/** Authoritative Goal fields returned by a daemon operation. */
export interface GoalProjection {
  /** Provider-owned Goal, or null when the provider confirms it is absent. */
  goal: AgentGoalSnapshot | null;
  /** Current step for the Goal generation, or null when absent. */
  goalStep: AgentGoalStepSnapshot | null;
  /** Freshness of the returned provider projection. */
  goalSync: AgentGoalSyncStatus;
}

/** Existing object that may already carry a Goal projection. */
export interface GoalProjectionTarget {
  /** Existing provider-owned Goal projection. */
  goal?: AgentGoalSnapshot | null;
  /** Existing current Goal step. */
  goalStep?: AgentGoalStepSnapshot | null;
  /** Existing Goal projection freshness. */
  goalSync?: AgentGoalSyncStatus;
}

/** Terminate response fields needed to update the local Goal projection. */
export interface GoalTerminateProjectionResponse {
  /** Provider-owned Goal returned by the daemon. */
  goal: AgentGoalSnapshot | null;
  /** Current step returned by the daemon. */
  goalStep: AgentGoalStepSnapshot | null;
  /** Optional for compatibility with daemons predating terminate freshness. */
  goalSync?: AgentGoalSyncStatus;
}

/** Idle Goal interaction state with no objective editor mounted. */
interface GoalInteractionIdleState {
  /** Stable interaction discriminator. */
  phase: "idle";
  /** No editor generation is retained while idle. */
  editorGoal: null;
  /** Latest non-sensitive action failure. */
  error: string | null;
}

/** Goal interaction state while the paused objective editor is open. */
interface GoalInteractionEditingState {
  /** Stable interaction discriminator. */
  phase: "editing";
  /** Goal generation captured when the editor opened. */
  editorGoal: AgentGoalSnapshot;
  /** Latest non-sensitive edit failure. */
  error: string | null;
}

/** Goal interaction state while an RPC is in flight. */
interface GoalInteractionPendingState {
  /** Stable interaction discriminator. */
  phase: "pending";
  /** Command whose result must settle this state. */
  action: GoalActionId;
  /** Editor generation retained only for an edit request. */
  editorGoal: AgentGoalSnapshot | null;
  /** Starting an action clears the previous error. */
  error: null;
}

/** Complete interactive state for the Goal track and objective editor. */
export type GoalInteractionState =
  | GoalInteractionIdleState
  | GoalInteractionEditingState
  | GoalInteractionPendingState;

/** User and RPC events accepted by the Goal interaction reducer. */
export type GoalInteractionEvent =
  | { type: "open_editor"; goal: AgentGoalSnapshot }
  | { type: "close_editor" }
  | { type: "action_started"; action: GoalActionId }
  | { type: "action_finished"; ok: boolean; error: string | null }
  | { type: "projection_changed"; goal: AgentGoalSnapshot | null | undefined };

/** Fresh idle state used for the first render and successful editor completion. */
export const INITIAL_GOAL_INTERACTION_STATE: GoalInteractionState = {
  phase: "idle",
  editorGoal: null,
  error: null,
};

/** Normalizes a Goal objective and enforces the provider-neutral input contract. */
export function validateGoalObjective(value: string): GoalObjectiveValidation {
  const objective = value.trim();
  if (!objective) {
    return { ok: false, reason: "empty" };
  }
  if (Array.from(objective).length > MAX_GOAL_OBJECTIVE_CHARACTERS) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true, objective };
}

/** Converts a terminate response into a conservative local projection. */
export function goalProjectionFromTerminateResponse(
  response: GoalTerminateProjectionResponse,
): GoalProjection {
  return {
    goal: response.goal,
    goalStep: response.goalStep,
    goalSync: response.goalSync ?? "stale",
  };
}

/** Invalidates an editor snapshot that no longer describes the current paused Goal generation. */
export function reconcileGoalInteraction(
  state: GoalInteractionState,
  goal: AgentGoalSnapshot | null | undefined,
): GoalInteractionState {
  if (state.editorGoal === null) return state;
  if (goal?.status === "paused" && goal.createdAt === state.editorGoal.createdAt) return state;
  return INITIAL_GOAL_INTERACTION_STATE;
}

/** Applies one user or RPC event to the Goal track's discriminated interaction state. */
export function reduceGoalInteraction(
  state: GoalInteractionState,
  event: GoalInteractionEvent,
): GoalInteractionState {
  switch (event.type) {
    case "open_editor":
      return { phase: "editing", editorGoal: event.goal, error: null };
    case "close_editor":
      return state.phase === "pending" ? state : INITIAL_GOAL_INTERACTION_STATE;
    case "action_started":
      if (event.action === "edit") {
        if (state.phase !== "editing") return state;
        return { phase: "pending", action: "edit", editorGoal: state.editorGoal, error: null };
      }
      return { phase: "pending", action: event.action, editorGoal: null, error: null };
    case "action_finished":
      if (state.phase !== "pending") return state;
      if (state.action === "edit" && state.editorGoal && (!event.ok || event.error)) {
        return { phase: "editing", editorGoal: state.editorGoal, error: event.error };
      }
      return { phase: "idle", editorGoal: null, error: event.error };
    case "projection_changed":
      return reconcileGoalInteraction(state, event.goal);
  }
}

/** Applies authoritative Goal fields without disturbing unrelated Agent state. */
export function applyGoalProjection<T extends GoalProjectionTarget>(
  current: T,
  projection: GoalProjection,
): T & GoalProjection {
  return { ...current, ...projection };
}
