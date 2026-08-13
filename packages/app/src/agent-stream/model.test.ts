import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { buildAgentStreamRenderModel, type ActivityFold } from "./model";

function createTimestamp(seed: number): Date {
  return new Date(`2026-01-01T00:00:${seed.toString().padStart(2, "0")}.000Z`);
}

function userMessage(id: string, seed: number): StreamItem {
  return {
    kind: "user_message",
    id,
    text: id,
    timestamp: createTimestamp(seed),
  };
}

function assistantMessage(
  id: string,
  seed: number,
  phase?: Extract<StreamItem, { kind: "assistant_message" }>["phase"],
): StreamItem {
  return {
    kind: "assistant_message",
    id,
    text: id,
    timestamp: createTimestamp(seed),
    ...(phase ? { phase } : {}),
  };
}

function thought(id: string, seed: number): StreamItem {
  return {
    kind: "thought",
    id,
    text: id,
    timestamp: createTimestamp(seed % 60),
    status: "ready",
  };
}

describe("buildAgentStreamRenderModel", () => {
  it("keeps head separate from committed history on desktop web", () => {
    const tail: StreamItem[] = [];
    for (let index = 0; index < 60; index += 1) {
      const seed = index * 2;
      tail.push(userMessage(`u${index}`, seed + 1));
      tail.push(assistantMessage(`a${index}`, seed + 2));
    }
    const head = [assistantMessage("live-a", 121)];

    const model = buildAgentStreamRenderModel({
      isTurnActive: true,
      activeTurnStartedAt: tail.at(-2)?.timestamp ?? null,
      tail,
      head,
      platform: "web",
      isMobileBreakpoint: false,
    });

    expect(model.segments.historyVirtualized.length).toBeGreaterThan(0);
    expect(model.segments.historyMounted.length).toBeGreaterThan(0);
    expect(model.segments.liveHead.map((item) => item.id)).toEqual(["live-a"]);
    expect(model.history).not.toContain(head[0]);
  });

  it("keeps the full committed tail mounted on mobile web", () => {
    const tail = [userMessage("u1", 1), assistantMessage("a1", 2)];
    const head = [assistantMessage("live-a", 3)];

    const model = buildAgentStreamRenderModel({
      isTurnActive: true,
      activeTurnStartedAt: tail[0]?.timestamp ?? null,
      tail,
      head,
      platform: "web",
      isMobileBreakpoint: true,
    });

    expect(model.segments.historyVirtualized).toHaveLength(0);
    expect(model.segments.historyMounted.map((row) => row.item)).toEqual(tail);
    expect(model.segments.liveHead.map((row) => row.item)).toEqual(head);
  });

  it("reuses ordered committed history when only the live head changes", () => {
    const tail = [userMessage("u1", 1), assistantMessage("a1", 2)];
    const firstHead = [assistantMessage("live-a", 3)];
    const secondHead = [assistantMessage("live-b", 4)];

    const first = buildAgentStreamRenderModel({
      isTurnActive: true,
      activeTurnStartedAt: tail[0]?.timestamp ?? null,
      tail,
      head: firstHead,
      platform: "native",
      isMobileBreakpoint: false,
    });
    const second = buildAgentStreamRenderModel({
      isTurnActive: true,
      activeTurnStartedAt: tail[0]?.timestamp ?? null,
      tail,
      head: secondHead,
      platform: "native",
      isMobileBreakpoint: false,
    });

    expect(first.history).toBe(second.history);
    expect(first.segments.historyMounted).toBe(second.segments.historyMounted);
    expect(second.segments.liveHead.map((item) => item.id)).toEqual(["live-b"]);
  });

  it("derives running turn timing across committed history and live head", () => {
    const tail = [userMessage("u1", 1)];
    const head = [assistantMessage("live-a", 4)];

    const model = buildAgentStreamRenderModel({
      isTurnActive: true,
      activeTurnStartedAt: tail[0]?.timestamp ?? null,
      tail,
      head,
      platform: "web",
      isMobileBreakpoint: false,
    });

    expect(model.turnTiming.runningStartedAt).toBe(tail[0]?.timestamp);
    expect(model.turnTiming.byAssistantId.has("live-a")).toBe(false);
  });

  it("maps completed turn timing to assistant ids across committed history and live head", () => {
    const tail = [userMessage("u1", 1)];
    const head = [assistantMessage("live-a", 4)];

    const model = buildAgentStreamRenderModel({
      isTurnActive: false,
      activeTurnStartedAt: null,
      tail,
      head,
      platform: "web",
      isMobileBreakpoint: false,
    });

    expect(model.turnTiming.runningStartedAt).toBe(null);
    expect(model.turnTiming.byAssistantId.get("live-a")).toEqual({
      startedAt: tail[0]?.timestamp,
      completedAt: head[0]?.timestamp,
      durationMs: 3000,
    });
  });

  it("derives the same timing for native inverted rendering", () => {
    const tail = [userMessage("u1", 1), assistantMessage("a1", 4)];

    const model = buildAgentStreamRenderModel({
      isTurnActive: false,
      activeTurnStartedAt: null,
      tail,
      head: [],
      platform: "native",
      isMobileBreakpoint: false,
    });

    expect(model.segments.historyMounted.map((item) => item.id)).toEqual(["a1", "u1"]);
    expect(model.turnTiming.byAssistantId.get("a1")).toEqual({
      startedAt: tail[0]?.timestamp,
      completedAt: tail[1]?.timestamp,
      durationMs: 3000,
    });
  });

  it("does not create completed timing for adjacent user messages", () => {
    const tail = [userMessage("u1", 1), userMessage("u2", 4)];

    const model = buildAgentStreamRenderModel({
      isTurnActive: false,
      activeTurnStartedAt: null,
      tail,
      head: [],
      platform: "web",
      isMobileBreakpoint: false,
    });

    expect(model.turnTiming.byAssistantId.size).toBe(0);
  });

  it.each(["web", "native"] as const)(
    "projects 5000 activity members to one top-level row on %s",
    (platform) => {
      const members = Array.from({ length: 5000 }, (_, index) =>
        thought(`thought-${index}`, index + 2),
      );
      const tail = [userMessage("u1", 1), ...members.slice(0, 2500)];
      const final = assistantMessage("final-1", 59, "final_answer");
      const head = [...members.slice(2500), final];

      const model = buildAgentStreamRenderModel({
        isTurnActive: false,
        activeTurnStartedAt: null,
        tail,
        head,
        platform,
        isMobileBreakpoint: false,
      });
      const rows = [...model.history, ...model.segments.liveHead];
      const foldRow = rows.find((row) => row.kind === "activity");

      expect(rows.map((row) => row.id)).toHaveLength(3);
      expect(rows.some((row) => row.id === final.id && row.kind === "item")).toBe(true);
      expect(foldRow).toMatchObject({
        kind: "activity",
        id: members[0]?.id,
        fold: {
          id: "activity:u1",
          completed: true,
          hostItemId: members[0]?.id,
        },
      });
      if (foldRow?.kind !== "activity") {
        throw new Error("Missing activity row");
      }
      expect(foldRow.fold.members).toHaveLength(5000);
      expect(model.history.some((row) => row.id === foldRow.id)).toBe(true);
      expect(model.segments.liveHead.some((row) => row.id === foldRow.id)).toBe(false);
    },
  );

  it.each(["web", "native"] as const)(
    "uses an injected projection fold as the single Activity row on %s",
    (platform) => {
      const placeholder = thought("activity:one", 2);
      const members = [thought("reasoning-1", 2)];
      const fold: ActivityFold = {
        id: "activity:one",
        completed: true,
        hostItemId: placeholder.id,
        memberIds: members.map((item) => item.id),
        members,
        detailStatus: "ready",
        detailError: null,
      };
      const model = buildAgentStreamRenderModel({
        isTurnActive: false,
        activeTurnStartedAt: null,
        tail: [
          userMessage("user-1", 1),
          placeholder,
          assistantMessage("final-1", 4, "final_answer"),
        ],
        head: [],
        platform,
        isMobileBreakpoint: false,
        activityFolds: [fold],
      });
      const rows = model.history;
      const activity = rows.find((row) => row.kind === "activity");

      expect(rows).toHaveLength(3);
      expect(activity).toMatchObject({
        kind: "activity",
        id: "activity:one",
        fold: { detailStatus: "ready", memberIds: ["reasoning-1"] },
      });
    },
  );

  it("uses turn presentation activity rather than lifecycle status for latest fold completion", () => {
    const activity = thought("thought-1", 2);
    const final = assistantMessage("final-1", 3, "final_answer");
    const active = buildAgentStreamRenderModel({
      isTurnActive: true,
      activeTurnStartedAt: createTimestamp(1),
      tail: [userMessage("u1", 1)],
      head: [activity, final],
      platform: "web",
      isMobileBreakpoint: false,
    });
    const completed = buildAgentStreamRenderModel({
      isTurnActive: false,
      activeTurnStartedAt: null,
      tail: [userMessage("u1", 1)],
      head: [activity, final],
      platform: "web",
      isMobileBreakpoint: false,
    });

    expect(active.segments.liveHead.find((row) => row.kind === "activity")?.fold.completed).toBe(
      false,
    );
    expect(completed.segments.liveHead.find((row) => row.kind === "activity")?.fold.completed).toBe(
      true,
    );
  });
});
