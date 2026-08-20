import { describe, expect, it } from "vitest";
import {
  INITIAL_GOAL_INTERACTION_STATE,
  applyGoalProjection,
  goalProjectionFromTerminateResponse,
  reduceGoalInteraction,
  validateGoalObjective,
} from "./model";

describe("validateGoalObjective", () => {
  it("trims a non-empty objective and enforces the 4000 Unicode-character limit", () => {
    expect(validateGoalObjective("  Ship Goal controls  ")).toEqual({
      ok: true,
      objective: "Ship Goal controls",
    });
    expect(validateGoalObjective(" \n\t ")).toEqual({ ok: false, reason: "empty" });
    expect(validateGoalObjective("😀".repeat(4_000))).toEqual({
      ok: true,
      objective: "😀".repeat(4_000),
    });
    expect(validateGoalObjective("😀".repeat(4_001))).toEqual({
      ok: false,
      reason: "too_long",
    });
  });
});

describe("applyGoalProjection", () => {
  it("applies an authoritative cleared Goal even when a terminate operation only partly succeeds", () => {
    const current = {
      id: "agent-1",
      title: "Keep me",
      goal: {
        objective: "Ship Goal controls",
        status: "active" as const,
        tokenBudget: null,
        tokensUsed: 2_500,
        timeUsedSeconds: 90,
        createdAt: "2026-08-18T08:00:00.000Z",
        updatedAt: "2026-08-18T08:01:30.000Z",
      },
      goalStep: {
        generation: "2026-08-18T08:00:00.000Z",
        ordinal: 1,
        text: "Build the App control",
        status: "in_progress" as const,
      },
      goalSync: "stale" as const,
    };

    expect(
      applyGoalProjection(current, {
        goal: null,
        goalStep: null,
        goalSync: "synced",
      }),
    ).toEqual({
      id: "agent-1",
      title: "Keep me",
      goal: null,
      goalStep: null,
      goalSync: "synced",
    });
  });
});

describe("goalProjectionFromTerminateResponse", () => {
  it("preserves authoritative freshness and treats old-daemon responses as stale", () => {
    expect(
      goalProjectionFromTerminateResponse({
        goal: null,
        goalStep: null,
        goalSync: "synced",
      }),
    ).toEqual({ goal: null, goalStep: null, goalSync: "synced" });

    expect(
      goalProjectionFromTerminateResponse({
        goal: {
          objective: "Keep the Goal after a failed clear",
          status: "active",
          tokenBudget: null,
          tokensUsed: 10,
          timeUsedSeconds: 2,
          createdAt: "2026-08-19T02:00:00.000Z",
          updatedAt: "2026-08-19T02:00:02.000Z",
        },
        goalStep: null,
      }),
    ).toMatchObject({ goalSync: "stale" });
  });
});

describe("reduceGoalInteraction", () => {
  const pausedGoal = {
    objective: "Edit the paused Goal",
    status: "paused",
    tokenBudget: null,
    tokensUsed: 100,
    timeUsedSeconds: 30,
    createdAt: "2026-08-19T02:10:00.000Z",
    updatedAt: "2026-08-19T02:10:30.000Z",
  } as const;

  it("keeps one discriminated interaction state across edit failures and success", () => {
    const editing = reduceGoalInteraction(INITIAL_GOAL_INTERACTION_STATE, {
      type: "open_editor",
      goal: pausedGoal,
    });
    const pending = reduceGoalInteraction(editing, { type: "action_started", action: "edit" });
    const failed = reduceGoalInteraction(pending, {
      type: "action_finished",
      ok: false,
      error: "Provider rejected the edit.",
    });

    expect(failed).toEqual({
      phase: "editing",
      editorGoal: pausedGoal,
      error: "Provider rejected the edit.",
    });

    const retrying = reduceGoalInteraction(failed, { type: "action_started", action: "edit" });
    expect(
      reduceGoalInteraction(retrying, { type: "action_finished", ok: true, error: null }),
    ).toEqual(INITIAL_GOAL_INTERACTION_STATE);
  });

  it("tracks non-editor failures without retaining an editor snapshot", () => {
    const pending = reduceGoalInteraction(INITIAL_GOAL_INTERACTION_STATE, {
      type: "action_started",
      action: "pause",
    });

    expect(
      reduceGoalInteraction(pending, {
        type: "action_finished",
        ok: false,
        error: "Pause failed.",
      }),
    ).toEqual({ phase: "idle", editorGoal: null, error: "Pause failed." });
  });
});
