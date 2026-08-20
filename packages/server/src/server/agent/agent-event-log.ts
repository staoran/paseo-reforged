import type { AgentGoalSnapshot } from "@getpaseo/protocol/agent-types";
import type { AgentStreamEvent } from "./agent-sdk-types.js";

/** Non-sensitive fields retained when logging one provider Goal snapshot. */
export interface AgentGoalLogFields {
  /** Provider status, or null when the Goal was cleared. */
  goalStatus: AgentGoalSnapshot["status"] | null;
  /** Goal generation, or null when the Goal was cleared. */
  goalGeneration: string | null;
  /** Unicode character count without the user-authored objective. */
  objectiveLength: number;
}

/** Log fields retained for ordinary provider events. */
export interface AgentEventLogFields {
  /** Original event retained when it contains no Goal objective. */
  event: AgentStreamEvent;
}

/** Non-sensitive log fields retained for Goal change events. */
export interface AgentGoalEventLogFields extends AgentGoalLogFields {
  /** Event discriminator retained without the original Goal payload. */
  eventType: "goal_changed";
}

/** Safe logging projection for any provider event. */
export type AgentStreamEventLogFields = AgentEventLogFields | AgentGoalEventLogFields;

/** Produces a non-sensitive summary of one provider Goal snapshot. */
export function agentGoalLogFields(goal: AgentGoalSnapshot | null): AgentGoalLogFields {
  return {
    goalStatus: goal?.status ?? null,
    goalGeneration: goal?.createdAt ?? null,
    objectiveLength: goal ? Array.from(goal.objective).length : 0,
  };
}

/** Replaces sensitive Goal events with metadata while retaining ordinary event diagnostics. */
export function agentStreamEventLogFields(event: AgentStreamEvent): AgentStreamEventLogFields {
  if (event.type !== "goal_changed") return { event };
  return { eventType: event.type, ...agentGoalLogFields(event.goal) };
}
