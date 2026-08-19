import { describe, expect, it } from "vitest";
import { applyGoalProjection, validateGoalObjective } from "./model";

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
