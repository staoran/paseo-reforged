import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { projectPluginTimelineItems } from "@/plugins/timeline/projection";
import { findMountedWindowStart } from "./history-window";
import { buildAgentStreamRenderModel } from "./model";
import {
  createActivityProjection,
  projectActivityLane,
  isActivityMemberAlwaysVisible,
} from "./activity";

describe("Activity process projection", () => {
  it("keeps the Activity host when a reasoning row gets a new history id", () => {
    const reasoning = {
      kind: "thought" as const,
      id: "live-reasoning",
      text: "working",
      status: "ready" as const,
      timestamp: createTimestamp(2),
    };
    const commentary = { ...assistantMessage("commentary", 3), phase: "commentary" as const };
    const final = { ...assistantMessage("final", 4), phase: "final_answer" as const };
    const project = createActivityProjection();
    const live = project({
      agentId: "agent",
      tail: [],
      head: [reasoning, commentary],
      isTurnActive: true,
      activeTurnId: null,
    });
    const liveHost = [...live.keys()][0]!;
    const answering = project({
      agentId: "agent",
      tail: [],
      head: [reasoning, commentary, final],
      isTurnActive: true,
      activeTurnId: null,
    });
    expect([...answering.keys()]).toEqual([liveHost]);
    const historyReasoning = { ...reasoning, id: "history-reasoning" };
    const history = [historyReasoning, commentary, final];
    const hydrated = project({
      agentId: "agent",
      tail: history,
      head: [],
      isTurnActive: false,
      activeTurnId: null,
    });

    expect(liveHost).not.toBe(reasoning.id);
    expect([...hydrated.keys()]).toEqual([liveHost]);
    expect(hydrated.get(liveHost)?.hostMemberId).toBe(historyReasoning.id);
    expect(projectActivityLane(history, hydrated).map((item) => item.id)).toEqual([
      liveHost,
      final.id,
    ]);
  });

  it("shows one expanded Activity host before final and retains it after final", () => {
    const user = userMessage("user", 1);
    const first = { ...assistantMessage("first", 2), phase: "commentary" as const };
    const second = { ...assistantMessage("second", 3), phase: "commentary" as const };
    const project = createActivityProjection();
    const running = project({
      agentId: "agent",
      tail: [user],
      head: [first, second],
      isTurnActive: true,
      activeTurnId: null,
    });
    const hostId = [...running.keys()][0]!;

    expect(running.size).toBe(1);
    expect(running.get(hostId)).toMatchObject({
      hostMemberId: first.id,
      members: [first, second],
      completed: false,
    });
    expect(projectActivityLane([first, second], running).map((item) => item.id)).toEqual([hostId]);

    const final = { ...assistantMessage("final", 4), phase: "final_answer" as const };
    const completed = project({
      agentId: "agent",
      tail: [user, first, second, final],
      head: [],
      isTurnActive: false,
      activeTurnId: null,
    });
    expect([...completed.keys()]).toEqual([hostId]);
    expect(completed.get(hostId)?.completed).toBe(true);
  });

  it("closes one segment per final across canonical turns and Markdown blocks", () => {
    const processA: StreamItem = {
      ...assistantMessage("process-a", 2),
      turnId: "a",
      phase: "commentary",
    };
    const processB: StreamItem = {
      ...assistantMessage("process-b", 3),
      turnId: "b",
      phase: "commentary",
    };
    const final: StreamItem = {
      ...assistantMessage("final:0", 4),
      turnId: "b",
      phase: "final_answer",
      blockGroupId: "final",
    };
    const finalBlock: StreamItem = { ...final, id: "final:1", timestamp: createTimestamp(5) };
    const secondProcess: StreamItem = {
      ...assistantMessage("process-c", 6),
      turnId: "c",
      phase: "commentary",
    };
    const secondFinal: StreamItem = {
      ...assistantMessage("second-final", 8),
      turnId: "c",
      phase: "final_answer",
    };
    const tail = [
      userMessage("user", 1),
      processA,
      processB,
      final,
      finalBlock,
      secondProcess,
      secondFinal,
    ];
    const project = createActivityProjection();
    const folds = project({
      agentId: "agent",
      tail,
      head: [],
      isTurnActive: false,
      activeTurnId: null,
    });
    const [firstHostId, secondHostId] = [...folds.keys()];
    expect(firstHostId).not.toBe(processA.id);
    expect(secondHostId).not.toBe(secondProcess.id);
    expect(folds.get(firstHostId!)).toMatchObject({
      hostMemberId: processA.id,
      members: [processA, processB],
      durationMs: 4000,
      completed: true,
    });
    expect(folds.get(secondHostId!)).toMatchObject({
      hostMemberId: secondProcess.id,
      members: [secondProcess],
      durationMs: 3000,
    });
    expect(projectActivityLane(tail, folds).map((item) => item.id)).toEqual([
      "user",
      firstHostId,
      "final:0",
      "final:1",
      secondHostId,
      "second-final",
    ]);
    expect(
      project({ agentId: "agent", tail, head: [], isTurnActive: false, activeTurnId: null }),
    ).toBe(folds);
    const historyRows = projectActivityLane(tail, folds);
    const updatedFinal = { ...secondFinal, timestamp: createTimestamp(9) };
    const updatedTail = [...tail.slice(0, -1), updatedFinal];
    const updatedFolds = project({
      agentId: "agent",
      tail: updatedTail,
      head: [],
      isTurnActive: false,
      activeTurnId: null,
    });
    const updatedRows = projectActivityLane(updatedTail, updatedFolds);
    expect(updatedRows[1]).toBe(historyRows[1]);
    expect(updatedRows[4]).not.toBe(historyRows[4]);
    expect(updatedRows[0]).toBe(historyRows[0]);
  });

  it("retains one host across live/history handoff and forces an active final open", () => {
    const process = {
      ...assistantMessage("process", 2),
      phase: "commentary" as const,
      turnId: "turn",
    };
    const final = {
      ...assistantMessage("final", 4),
      phase: "final_answer" as const,
      turnId: "turn",
    };
    const tail = [userMessage("u", 1), process];
    const project = createActivityProjection();
    const live = project({
      agentId: "agent",
      tail,
      head: [final],
      isTurnActive: true,
      activeTurnId: "turn",
    });
    const hostId = [...live.keys()][0]!;
    expect(live.get(hostId)?.completed).toBe(false);
    const finished = project({
      agentId: "agent",
      tail: [...tail, final],
      head: [],
      isTurnActive: false,
      activeTurnId: null,
    });
    expect(finished.get(hostId)?.completed).toBe(true);
    expect(projectActivityLane(tail, live).filter((item) => live.has(item.id))).toHaveLength(1);
    expect(projectActivityLane([final], live)).toEqual([final]);
  });

  it("leaves legacy, canceled and failed responses without a final unfolded", () => {
    const project = createActivityProjection();
    for (const tail of [
      [userMessage("u", 1), assistantMessage("legacy", 2)],
      [{ ...assistantMessage("interrupted", 2), phase: "commentary" as const }],
    ]) {
      const folds = project({
        agentId: "agent",
        tail,
        head: [],
        isTurnActive: false,
        activeTurnId: null,
      });
      expect(folds.size).toBe(0);
      expect(projectActivityLane(tail, folds)).toBe(tail);
    }
  });

  it("keeps the fold host when pagination reveals the earlier process start", () => {
    const earlier = assistantMessage("earlier", 2);
    const process = assistantMessage("process", 3);
    const final = { ...assistantMessage("final", 4), phase: "final_answer" as const };
    const project = createActivityProjection();
    const initial = project({
      agentId: "agent",
      tail: [process, final],
      head: [],
      isTurnActive: false,
      activeTurnId: null,
    });
    const hostId = [...initial.keys()][0]!;
    expect(initial.get(hostId)?.durationMs).toBeNull();
    const tail = [userMessage("user", 1), earlier, process, final];
    const paginated = project({
      agentId: "agent",
      tail,
      head: [],
      isTurnActive: false,
      activeTurnId: null,
    });
    expect([...paginated.keys()]).toEqual([hostId]);
    expect(paginated.get(hostId)).toMatchObject({
      hostMemberId: process.id,
      members: [earlier, process],
      durationMs: 3000,
    });
    expect(projectActivityLane(tail, paginated).map((item) => item.id)).toEqual([
      "user",
      hostId,
      "final",
    ]);
  });

  it("keeps distinct hosts when pagination reveals an earlier final", () => {
    const earlier = assistantMessage("earlier", 1);
    const earlierFinal = {
      ...assistantMessage("earlier-final", 2),
      phase: "final_answer" as const,
    };
    const process = assistantMessage("process", 3);
    const final = { ...assistantMessage("final", 4), phase: "final_answer" as const };
    const project = createActivityProjection();
    const initial = project({
      agentId: "agent",
      tail: [process, final],
      head: [],
      isTurnActive: false,
      activeTurnId: null,
    });
    const retainedHostId = [...initial.keys()][0]!;
    const paginated = project({
      agentId: "agent",
      tail: [earlier, earlierFinal, process, final],
      head: [],
      isTurnActive: false,
      activeTurnId: null,
    });

    expect(paginated.size).toBe(2);
    expect([...paginated.keys()][1]).toBe(retainedHostId);
    expect([...paginated.keys()][0]).not.toBe(retainedHostId);
  });

  it("does not transfer a running host to an earlier paginated final", () => {
    const process = { ...assistantMessage("process", 3), phase: "commentary" as const };
    const earlier = assistantMessage("earlier", 1);
    const earlierFinal = {
      ...assistantMessage("earlier-final", 2),
      phase: "final_answer" as const,
    };
    const project = createActivityProjection();
    const running = project({
      agentId: "agent",
      tail: [],
      head: [process],
      isTurnActive: true,
      activeTurnId: null,
    });
    const runningHostId = [...running.keys()][0]!;
    const paginated = project({
      agentId: "agent",
      tail: [earlier, earlierFinal],
      head: [process],
      isTurnActive: true,
      activeTurnId: null,
    });

    expect(paginated.size).toBe(2);
    expect([...paginated.keys()][0]).not.toBe(runningHostId);
    expect([...paginated.keys()][1]).toBe(runningHostId);
  });

  it("does not reuse a running host for the next segment at the same timestamp", () => {
    const first = { ...assistantMessage("first", 2), phase: "commentary" as const };
    const final = { ...assistantMessage("final", 2), phase: "final_answer" as const };
    const second = { ...assistantMessage("second", 2), phase: "commentary" as const };
    const project = createActivityProjection();
    const running = project({
      agentId: "agent",
      tail: [],
      head: [first],
      isTurnActive: true,
      activeTurnId: null,
    });
    const firstHostId = [...running.keys()][0]!;
    const next = project({
      agentId: "agent",
      tail: [],
      head: [first, final, second],
      isTurnActive: true,
      activeTurnId: null,
    });

    expect(next.size).toBe(2);
    expect([...next.keys()][0]).toBe(firstHostId);
    expect([...next.keys()][1]).not.toBe(firstHostId);
  });

  it("retains unknown duration for a paginated segment and preserves required actions", () => {
    const process = assistantMessage("process", 2);
    const final = { ...assistantMessage("final", 4), phase: "final_answer" as const };
    const fold = createActivityProjection()({
      agentId: "agent",
      tail: [process, final],
      head: [],
      isTurnActive: false,
      activeTurnId: null,
    });
    expect([...fold.values()][0]?.durationMs).toBeNull();
    expect(
      isActivityMemberAlwaysVisible({
        kind: "notification",
        sourceType: "error",
        level: "error",
        message: "failed",
        id: "error",
        timestamp: createTimestamp(3),
      }),
    ).toBe(true);
  });
});

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
): Extract<StreamItem, { kind: "assistant_message" }> {
  return {
    kind: "assistant_message",
    id,
    text: id,
    timestamp: createTimestamp(seed),
  };
}

describe("buildAgentStreamRenderModel", () => {
  it("projects a bounded recent turn-aligned history window on every platform", () => {
    const tail = [
      userMessage("u1", 1),
      assistantMessage("a1", 2),
      userMessage("u2", 3),
      assistantMessage("a2", 4),
      userMessage("u3", 5),
      assistantMessage("a3", 6),
    ];

    const model = buildAgentStreamRenderModel({
      isTurnActive: false,
      activeTurnStartedAt: null,
      tail,
      head: [],
      platform: "native",
      isMobileBreakpoint: false,
      historyStart: 2,
    });

    expect(model.history.map((item) => item.id)).toEqual(["a3", "u3", "a2", "u2"]);
    expect(model.segments.historyVirtualized).toHaveLength(0);
  });

  it("derives timing only for the rendered history window", () => {
    const tail = [
      userMessage("hidden-u", 1),
      assistantMessage("hidden-a", 2),
      userMessage("visible-u", 3),
      assistantMessage("visible-a", 4),
    ];

    const model = buildAgentStreamRenderModel({
      isTurnActive: false,
      activeTurnStartedAt: null,
      tail,
      head: [],
      platform: "web",
      isMobileBreakpoint: false,
      historyStart: 2,
    });

    expect(model.turnTiming.byAssistantId.has("hidden-a")).toBe(false);
    expect(model.turnTiming.byAssistantId.get("visible-a")).toEqual({
      completedAt: tail[3]?.timestamp,
      durationMs: 1000,
    });
  });

  it("keeps the mounted boundary stable when a transformer filters an earlier item", () => {
    const tail = [
      userMessage("filtered", 1),
      assistantMessage("hidden", 2),
      userMessage("visible-u", 3),
      assistantMessage("visible-a", 4),
    ];

    const projectedTail = projectPluginTimelineItems(tail, ({ sourceId }) =>
      sourceId === "filtered" ? [] : undefined,
    );
    const historyStart = findMountedWindowStart({ items: projectedTail, minMountedCount: 2 });
    const model = buildAgentStreamRenderModel({
      isTurnActive: false,
      activeTurnStartedAt: null,
      tail: projectedTail,
      head: [],
      platform: "native",
      isMobileBreakpoint: false,
      historyStart,
    });

    expect(model.history.map((item) => item.id)).toEqual(["visible-a", "visible-u"]);
  });

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
    expect(model.segments.historyMounted).toBe(tail);
    expect(model.segments.liveHead).toBe(head);
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
});
