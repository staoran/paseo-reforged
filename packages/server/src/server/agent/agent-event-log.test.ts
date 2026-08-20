import { describe, expect, test } from "vitest";
import { agentStreamEventLogFields } from "./agent-event-log.js";

describe("agentStreamEventLogFields", () => {
  test("summarizes Goal events without retaining the objective", () => {
    const sentinel = "GOAL_OBJECTIVE_MUST_NOT_REACH_LOGS";
    const fields = agentStreamEventLogFields({
      type: "goal_changed",
      provider: "codex",
      goal: {
        objective: sentinel,
        status: "active",
        tokenBudget: 10_000,
        tokensUsed: 2_000,
        timeUsedSeconds: 60,
        createdAt: "2026-08-19T03:00:00.000Z",
        updatedAt: "2026-08-19T03:01:00.000Z",
      },
    });

    expect(fields).toEqual({
      eventType: "goal_changed",
      goalStatus: "active",
      goalGeneration: "2026-08-19T03:00:00.000Z",
      objectiveLength: sentinel.length,
    });
    expect(JSON.stringify(fields)).not.toContain(sentinel);
  });
});
