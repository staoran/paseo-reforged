import { describe, expect, it } from "vitest";
import type { AgentGoalSnapshot } from "@getpaseo/protocol/agent-types";
import { buildGoalPresentation, shouldShowAgentGoalTrack } from "./presentation";

/** Creates a stable provider-owned Goal projection for presentation tests. */
function goal(status: AgentGoalSnapshot["status"]): AgentGoalSnapshot {
  return {
    objective: "Ship Goal controls",
    status,
    tokenBudget: 10_000,
    tokensUsed: 2_500,
    timeUsedSeconds: 90,
    createdAt: "2026-08-18T08:00:00.000Z",
    updatedAt: "2026-08-18T08:01:30.000Z",
  };
}

describe("buildGoalPresentation", () => {
  it("shows the Goal track only for a supported authoritative object projection", () => {
    expect(shouldShowAgentGoalTrack({ supported: false, goal: goal("active") })).toBe(false);
    expect(shouldShowAgentGoalTrack({ supported: true, goal: undefined })).toBe(false);
    expect(shouldShowAgentGoalTrack({ supported: true, goal: null })).toBe(false);
    expect(shouldShowAgentGoalTrack({ supported: true, goal: goal("active") })).toBe(true);
  });

  it("hides Goal controls until the daemon authoritatively reports a Goal", () => {
    expect(buildGoalPresentation({ goal: undefined, goalSync: undefined })).toBeNull();
    expect(buildGoalPresentation({ goal: null, goalSync: "synced" })).toBeNull();
  });

  it("offers pause and terminate for an active synced Goal", () => {
    expect(buildGoalPresentation({ goal: goal("active"), goalSync: "synced" })?.actions).toEqual([
      { id: "pause", enabled: true },
      { id: "terminate", enabled: true },
    ]);
  });

  it("offers resume, objective editing, and terminate for a paused synced Goal", () => {
    expect(buildGoalPresentation({ goal: goal("paused"), goalSync: "synced" })?.actions).toEqual([
      { id: "resume", enabled: true },
      { id: "edit", enabled: true },
      { id: "terminate", enabled: true },
    ]);
  });

  it.each(["blocked", "usageLimited", "budgetLimited"] as const)(
    "offers resume and terminate for a synced %s Goal",
    (status) => {
      expect(buildGoalPresentation({ goal: goal(status), goalSync: "synced" })?.actions).toEqual([
        { id: "resume", enabled: true },
        { id: "terminate", enabled: true },
      ]);
    },
  );

  it("only offers terminate for a completed Goal that is still present", () => {
    expect(buildGoalPresentation({ goal: goal("complete"), goalSync: "synced" })?.actions).toEqual([
      { id: "terminate", enabled: true },
    ]);
  });

  it("disables Goal mutations and offers retry while the projection is stale", () => {
    expect(buildGoalPresentation({ goal: goal("active"), goalSync: "stale" })?.actions).toEqual([
      { id: "pause", enabled: false },
      { id: "terminate", enabled: false },
      { id: "retry", enabled: true },
    ]);
  });

  it.each(["hydrating", undefined] as const)(
    "disables Goal mutations without retry while sync is %s",
    (goalSync) => {
      expect(buildGoalPresentation({ goal: goal("active"), goalSync })?.actions).toEqual([
        { id: "pause", enabled: false },
        { id: "terminate", enabled: false },
      ]);
    },
  );

  it("marks the in-flight action pending and disables every Goal mutation", () => {
    expect(
      buildGoalPresentation({
        goal: goal("active"),
        goalSync: "synced",
        pendingAction: "pause",
      })?.actions,
    ).toEqual([
      { id: "pause", enabled: false, pending: true },
      { id: "terminate", enabled: false },
    ]);
  });
});
