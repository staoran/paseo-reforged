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

/** Authoritative fields that delimit one local Goal interaction lifetime. */
export interface GoalInteractionScopeInput {
  /** Current provider-owned Goal generation and status. */
  goal: AgentGoalSnapshot;
  /** Freshness required before mutations may continue. */
  goalSync: AgentGoalSyncStatus | undefined;
}

/** Failure feedback retained for one host, Agent, and Goal generation. */
export interface GoalActionFailure {
  /** Host that owns the failed Goal operation. */
  serverId: string;
  /** Agent that owns the failed Goal operation. */
  agentId: string;
  /** Goal generation associated with the failed operation. */
  generation: string;
  /** Non-sensitive message rendered in the Goal track. */
  message: string;
}

/** Inputs used to decide whether one retained Goal failure is still relevant. */
export interface GoalActionFailureVisibilityInput {
  /** Retained failure, when the last Goal operation failed. */
  failure: GoalActionFailure | null;
  /** Current host. */
  serverId: string;
  /** Current Agent. */
  agentId: string;
  /** Current provider-owned Goal projection. */
  goal: AgentGoalSnapshot | null | undefined;
}

/** Idle Goal interaction state with no objective editor mounted. */
interface GoalInteractionIdleState {
  /** Stable interaction discriminator. */
  phase: "idle";
  /** No editor generation is retained while idle. */
  editorGoal: null;
}

/** Goal interaction state while the paused objective editor is open. */
interface GoalInteractionEditingState {
  /** Stable interaction discriminator. */
  phase: "editing";
  /** Goal generation captured when the editor opened. */
  editorGoal: AgentGoalSnapshot;
}

/** Goal interaction state while an objective edit RPC is in flight. */
interface GoalInteractionEditPendingState {
  /** Stable interaction discriminator. */
  phase: "pending";
  /** Objective edit command whose result must settle this state. */
  action: "edit";
  /** Editor generation retained for a failed edit retry. */
  editorGoal: AgentGoalSnapshot;
}

/** Goal interaction state while a non-editor RPC is in flight. */
interface GoalInteractionCommandPendingState {
  /** Stable interaction discriminator. */
  phase: "pending";
  /** Non-editor command whose result must settle this state. */
  action: Exclude<GoalActionId, "edit">;
  /** Non-editor commands never retain an editor generation. */
  editorGoal: null;
}

/** Complete interactive state for the Goal track and objective editor. */
export type GoalInteractionState =
  | GoalInteractionIdleState
  | GoalInteractionEditingState
  | GoalInteractionEditPendingState
  | GoalInteractionCommandPendingState;

/** User and RPC events accepted by the Goal interaction reducer. */
export type GoalInteractionEvent =
  | { type: "open_editor"; goal: AgentGoalSnapshot }
  | { type: "close_editor" }
  | { type: "action_started"; action: GoalActionId }
  | { type: "action_finished"; ok: boolean };

/** Fresh idle state used for the first render and successful editor completion. */
export const INITIAL_GOAL_INTERACTION_STATE: GoalInteractionState = {
  phase: "idle",
  editorGoal: null,
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

/** Identifies the React interaction lifetime for one authoritative Goal state. */
export function goalInteractionScopeKey(input: GoalInteractionScopeInput): string {
  return `${input.goal.createdAt}:${input.goal.status}:${input.goalSync ?? "unknown"}`;
}

/** Returns retained Goal failure feedback only while its Agent generation remains current. */
export function goalActionFailureMessage(input: GoalActionFailureVisibilityInput): string | null {
  if (!input.failure) return null;
  if (!input.goal) return null;
  if (input.failure.serverId !== input.serverId) return null;
  if (input.failure.agentId !== input.agentId) return null;
  if (input.failure.generation !== input.goal.createdAt) return null;
  return input.failure.message;
}

/** Applies one user or RPC event to the Goal track's discriminated interaction state. */
export function reduceGoalInteraction(
  state: GoalInteractionState,
  event: GoalInteractionEvent,
): GoalInteractionState {
  switch (event.type) {
    case "open_editor":
      return { phase: "editing", editorGoal: event.goal };
    case "close_editor":
      return state.phase === "pending" ? state : INITIAL_GOAL_INTERACTION_STATE;
    case "action_started":
      if (event.action === "edit") {
        if (state.phase !== "editing") return state;
        return { phase: "pending", action: "edit", editorGoal: state.editorGoal };
      }
      return { phase: "pending", action: event.action, editorGoal: null };
    case "action_finished":
      if (state.phase !== "pending") return state;
      if (event.ok) return INITIAL_GOAL_INTERACTION_STATE;
      if (state.action !== "edit") return INITIAL_GOAL_INTERACTION_STATE;
      return { phase: "editing", editorGoal: state.editorGoal };
  }
}

/** Applies authoritative Goal fields without disturbing unrelated Agent state. */
export function applyGoalProjection<T extends GoalProjectionTarget>(
  current: T,
  projection: GoalProjection,
): T & GoalProjection {
  return { ...current, ...projection };
}
