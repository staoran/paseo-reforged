import type {
  AgentGoalSnapshot,
  AgentGoalStepSnapshot,
  AgentGoalSyncStatus,
} from "@getpaseo/protocol/agent-types";

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

/** Applies authoritative Goal fields without disturbing unrelated Agent state. */
export function applyGoalProjection<T extends GoalProjectionTarget>(
  current: T,
  projection: GoalProjection,
): T & GoalProjection {
  return { ...current, ...projection };
}
