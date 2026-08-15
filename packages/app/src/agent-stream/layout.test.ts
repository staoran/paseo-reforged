import { describe, expect, it } from "vitest";
import type { TurnTiming } from "@/timeline/turn-time";
import type { StreamItem } from "@/types/stream";
import type { StreamStrategy } from "./strategy";
import { resolveStreamRenderStrategy } from "./strategy-resolver";
import { buildAgentStreamRenderModel } from "./model";
import {
  layoutActivityFoldMembers,
  layoutStream,
  type StreamLayout,
  type StreamLayoutItem,
} from "./layout";

function timestamp(seed: number): Date {
  return new Date(`2026-01-01T00:00:${seed.toString().padStart(2, "0")}.000Z`);
}

function userMessage(id: string, seed: number): Extract<StreamItem, { kind: "user_message" }> {
  return {
    kind: "user_message",
    id,
    text: id,
    timestamp: timestamp(seed),
  };
}

function assistantMessage(
  id: string,
  seed: number,
  block?: { groupId: string; index: number },
  phase?: Extract<StreamItem, { kind: "assistant_message" }>["phase"],
): Extract<StreamItem, { kind: "assistant_message" }> {
  return {
    kind: "assistant_message",
    id,
    text: id,
    timestamp: timestamp(seed),
    ...(block ? { blockGroupId: block.groupId, blockIndex: block.index } : {}),
    ...(phase ? { phase } : {}),
  };
}

function toolCall(id: string, seed: number): Extract<StreamItem, { kind: "tool_call" }> {
  return {
    kind: "tool_call",
    id,
    timestamp: timestamp(seed),
    payload: {
      source: "orchestrator",
      data: {
        toolCallId: id,
        toolName: "Shell",
        arguments: "echo hi",
        result: null,
        status: "completed",
      },
    },
  };
}

function thought(id: string, seed: number): Extract<StreamItem, { kind: "thought" }> {
  return {
    kind: "thought",
    id,
    text: id,
    timestamp: timestamp(seed),
    status: "ready",
  };
}

function timingFor(...ids: string[]): Map<string, TurnTiming> {
  const timing = {
    startedAt: timestamp(1),
    completedAt: timestamp(9),
    durationMs: 8000,
  };
  return new Map(ids.map((id) => [id, timing]));
}

function strategyFor(platform: "web" | "android"): StreamStrategy {
  return resolveStreamRenderStrategy({
    platform,
    isMobileBreakpoint: false,
  });
}

function layoutFor(input: {
  platform: "web" | "android";
  isTurnActive?: boolean;
  tail: StreamItem[];
  head?: StreamItem[];
  timingIds?: string[];
}): StreamLayout {
  const strategy = strategyFor(input.platform);
  const model = buildAgentStreamRenderModel({
    isTurnActive: input.isTurnActive ?? false,
    activeTurnStartedAt: null,
    tail: input.tail,
    head: input.head ?? [],
    platform: input.platform === "web" ? "web" : "native",
    isMobileBreakpoint: false,
  });
  return layoutStream({
    strategy,
    isTurnActive: input.isTurnActive ?? false,
    history: model.history,
    liveHead: model.segments.liveHead,
    timingByAssistantId: timingFor(...(input.timingIds ?? [])),
  });
}

function footerOwners(layout: StreamLayout): string[] {
  const owners = [
    ...layout.history.flatMap((item) => (item.completedFooter ? [item.item.id] : [])),
    ...layout.liveHead.flatMap((item) => (item.completedFooter ? [item.item.id] : [])),
    ...(layout.auxiliaryTurnFooter ? [layout.auxiliaryTurnFooter.itemId] : []),
  ];
  return owners;
}

function footerAssistantIds(layout: StreamLayout): string[] {
  return [
    ...layout.history.flatMap((item) =>
      item.completedFooter ? [item.completedFooter.itemId] : [],
    ),
    ...layout.liveHead.flatMap((item) =>
      item.completedFooter ? [item.completedFooter.itemId] : [],
    ),
    ...(layout.auxiliaryTurnFooter ? [layout.auxiliaryTurnFooter.itemId] : []),
  ];
}

function inlineFooterPlacementByItemId(layout: StreamLayout): Record<string, string> {
  return Object.fromEntries(
    [...layout.history, ...layout.liveHead].flatMap((item) =>
      item.completedFooter ? [[item.item.id, item.completedFooter.itemId]] : [],
    ),
  );
}

function findLayoutItem(layout: StreamLayout, id: string): StreamLayoutItem {
  const item = [...layout.history, ...layout.liveHead].find(
    (candidate) =>
      candidate.item.id === id ||
      (candidate.row.kind === "activity" && candidate.row.fold.memberIds.includes(id)),
  );
  if (!item) {
    throw new Error(`Missing layout item ${id}`);
  }
  return item;
}

describe("layoutStream", () => {
  it.each(["web", "android"] as const)(
    "folds mixed activity before the final answer across history and live head on %s",
    (platform) => {
      const reasoning = thought("thought-1", 2);
      const commentary = assistantMessage("commentary-1", 3, undefined, "commentary");
      const tool = toolCall("tool-1", 4);
      const todo: Extract<StreamItem, { kind: "todo_list" }> = {
        kind: "todo_list",
        id: "todo-1",
        timestamp: timestamp(5),
        provider: "codex",
        items: [{ text: "Verify", completed: false }],
        activity: { type: "created", count: 1 },
      };
      const finalAnswer = assistantMessage("final-1", 6, undefined, "final_answer");
      const trailingTool = toolCall("tool-after-final", 7);
      const layout = layoutFor({
        platform,
        tail: [userMessage("u1", 1), reasoning, commentary],
        head: [tool, todo, finalAnswer, trailingTool],
        timingIds: [finalAnswer.id],
      });

      for (const item of [reasoning, commentary, tool, todo]) {
        expect(findLayoutItem(layout, item.id).activityFold).toMatchObject({
          id: "activity:u1",
          completed: true,
          hostItemId: reasoning.id,
        });
      }
      expect(findLayoutItem(layout, reasoning.id).isActivityFoldHost).toBe(true);
      expect([...layout.history, ...layout.liveHead]).toHaveLength(4);
      expect(
        [...layout.history, ...layout.liveHead].some((item) => item.item.id === commentary.id),
      ).toBe(false);
      expect(findLayoutItem(layout, finalAnswer.id).activityFold).toBeNull();
      expect(findLayoutItem(layout, trailingTool.id).activityFold).toBeNull();

      const host = findLayoutItem(layout, reasoning.id);
      const details = layoutActivityFoldMembers({
        strategy: strategyFor(platform),
        fold: host.activityFold!,
        aboveItem: host.aboveItem,
        belowItem: host.belowItem,
        phase: host.phase,
      });
      expect(details.map((item) => item.item.id).sort()).toEqual(
        [reasoning, commentary, tool, todo].map((item) => item.id).sort(),
      );
    },
  );

  it.each(["web", "android"] as const)(
    "keeps a final-answer fold active while the turn is running on %s",
    (platform) => {
      const reasoning = thought("thought-1", 2);
      const commentary = assistantMessage("commentary-1", 3, undefined, "commentary");
      const finalAnswer = assistantMessage("final-1", 4, undefined, "final_answer");
      const layout = layoutFor({
        platform,
        isTurnActive: true,
        tail: [userMessage("u1", 1)],
        head: [reasoning, commentary, finalAnswer],
      });

      expect(findLayoutItem(layout, reasoning.id).activityFold).toMatchObject({
        id: "activity:u1",
        completed: false,
      });
      expect(findLayoutItem(layout, finalAnswer.id).activityFold).toBeNull();
    },
  );

  it.each(["web", "android"] as const)(
    "keeps failed activity open without a final answer on %s",
    (platform) => {
      const reasoning = thought("thought-1", 2);
      const commentary = assistantMessage("commentary-1", 3, undefined, "commentary");
      const systemError: Extract<StreamItem, { kind: "activity_log" }> = {
        kind: "activity_log",
        id: "error-1",
        timestamp: timestamp(4),
        activityType: "error",
        message: "provider failed",
      };
      const layout = layoutFor({
        platform,
        tail: [userMessage("u1", 1)],
        head: [reasoning, commentary, systemError],
      });

      for (const item of [reasoning, commentary, systemError]) {
        expect(findLayoutItem(layout, item.id).activityFold).toMatchObject({
          id: "activity:u1",
          completed: false,
        });
      }
    },
  );

  it.each(["web", "android"] as const)(
    "does not infer an activity fold for legacy messages without phase on %s",
    (platform) => {
      const reasoning = thought("thought-1", 2);
      const assistant = assistantMessage("assistant-1", 3);
      const tool = toolCall("tool-1", 4);
      const layout = layoutFor({
        platform,
        tail: [userMessage("u1", 1), reasoning, assistant, tool],
      });

      for (const item of [reasoning, assistant, tool]) {
        expect(findLayoutItem(layout, item.id).activityFold).toBeNull();
      }
    },
  );

  it.each(["web", "android"] as const)(
    "completes a historical fold while keeping the latest activity fold open on %s",
    (platform) => {
      const historicalActivity = thought("thought-history", 2);
      const historicalCommentary = assistantMessage(
        "commentary-history",
        3,
        undefined,
        "commentary",
      );
      const historicalFinal = assistantMessage("final-history", 4, undefined, "final_answer");
      const liveActivity = thought("thought-live", 6);
      const liveCommentary = assistantMessage("commentary-live", 7, undefined, "commentary");
      const layout = layoutFor({
        platform,
        isTurnActive: true,
        tail: [userMessage("u1", 1), historicalActivity, historicalCommentary, historicalFinal],
        head: [userMessage("u2", 5), liveActivity, liveCommentary],
      });

      expect(findLayoutItem(layout, historicalActivity.id).activityFold).toMatchObject({
        id: "activity:u1",
        completed: true,
      });
      expect(findLayoutItem(layout, liveActivity.id).activityFold).toMatchObject({
        id: "activity:u2",
        completed: false,
      });
    },
  );

  it.each(["web", "android"] as const)(
    "marks only the active live-head assistant block as streaming on %s",
    (platform) => {
      const completed = assistantMessage("turn:block:0", 2, { groupId: "turn", index: 0 });
      const live = assistantMessage("turn:block:1", 3, { groupId: "turn", index: 1 });
      const active = layoutFor({
        platform,
        isTurnActive: true,
        tail: [userMessage("u1", 1), completed],
        head: [live],
      });
      const complete = layoutFor({
        platform,
        isTurnActive: false,
        tail: [userMessage("u1", 1), completed],
        head: [live],
      });

      expect(findLayoutItem(active, completed.id).phase).toBe("complete");
      expect(findLayoutItem(active, live.id).phase).toBe("streaming");
      expect(findLayoutItem(complete, live.id).phase).toBe("complete");
    },
  );

  it.each(["web", "android"] as const)(
    "keeps split assistant block spacing identical to unsplit history on %s",
    (platform) => {
      const firstBlock = assistantMessage("turn:block:0", 2, { groupId: "turn", index: 0 });
      const secondBlock = assistantMessage("turn:block:1", 3, { groupId: "turn", index: 1 });
      const thirdBlock = assistantMessage("turn:block:2", 4, { groupId: "turn", index: 2 });
      const splitLayout = layoutFor({
        platform,
        isTurnActive: true,
        tail: [userMessage("u1", 1), firstBlock],
        head: [secondBlock, thirdBlock],
        timingIds: [firstBlock.id, secondBlock.id, thirdBlock.id],
      });
      const unsplitLayout = layoutFor({
        platform,
        isTurnActive: true,
        tail: [userMessage("u1", 1), firstBlock, secondBlock, thirdBlock],
        timingIds: [firstBlock.id, secondBlock.id, thirdBlock.id],
      });

      expect(findLayoutItem(splitLayout, firstBlock.id).belowItem?.id).toBe(secondBlock.id);
      expect(findLayoutItem(splitLayout, secondBlock.id).aboveItem?.id).toBe(firstBlock.id);
      expect(findLayoutItem(splitLayout, firstBlock.id).assistantSpacing).toBe(
        findLayoutItem(unsplitLayout, firstBlock.id).assistantSpacing,
      );
      expect(findLayoutItem(splitLayout, secondBlock.id).assistantSpacing).toBe(
        findLayoutItem(unsplitLayout, secondBlock.id).assistantSpacing,
      );
      expect(findLayoutItem(splitLayout, firstBlock.id).gapBelow).toBe(
        findLayoutItem(unsplitLayout, firstBlock.id).gapBelow,
      );
      expect(findLayoutItem(splitLayout, secondBlock.id).gapBelow).toBe(
        findLayoutItem(unsplitLayout, secondBlock.id).gapBelow,
      );
    },
  );

  it("does not duplicate footers when a native assistant turn spans history and live head", () => {
    const historyBlock = assistantMessage("turn:block:0", 2, { groupId: "turn", index: 0 });
    const headBlock = assistantMessage("turn:head", 3, { groupId: "turn", index: 1 });
    const layout = layoutFor({
      platform: "android",
      tail: [userMessage("u1", 1), historyBlock],
      head: [headBlock],
      timingIds: [historyBlock.id, headBlock.id],
    });

    expect(footerOwners(layout)).toEqual([headBlock.id]);
    expect(findLayoutItem(layout, historyBlock.id).belowItem?.id).toBe(headBlock.id);
    expect(findLayoutItem(layout, historyBlock.id).completedFooter).toBeNull();
  });

  it("does not duplicate footers when a web assistant turn spans history and live head", () => {
    const historyBlock = assistantMessage("turn:block:0", 2, { groupId: "turn", index: 0 });
    const headBlock = assistantMessage("turn:head", 3, { groupId: "turn", index: 1 });
    const layout = layoutFor({
      platform: "web",
      tail: [userMessage("u1", 1), historyBlock],
      head: [headBlock],
      timingIds: [historyBlock.id, headBlock.id],
    });

    expect(footerOwners(layout)).toEqual([headBlock.id]);
    expect(findLayoutItem(layout, historyBlock.id).belowItem?.id).toBe(headBlock.id);
    expect(findLayoutItem(layout, headBlock.id).aboveItem?.id).toBe(historyBlock.id);
  });

  it("keeps the completed footer visually after the assistant after a native user reply", () => {
    const assistant = assistantMessage("a1", 2);
    const layout = layoutFor({
      platform: "android",
      tail: [userMessage("u1", 1), assistant, userMessage("u2", 3)],
      timingIds: [assistant.id],
    });
    const assistantRow = findLayoutItem(layout, assistant.id);

    expect(layout.auxiliaryTurnFooter).toBeNull();
    expect(assistantRow.completedFooter?.itemId).toBe(assistant.id);
    expect(assistantRow.belowItem?.id).toBe("u2");
    expect(assistantRow.frameOrder).toBe("footer-then-content");
  });

  it("keeps forward stream content before its completed footer", () => {
    const assistant = assistantMessage("a1", 2);
    const layout = layoutFor({
      platform: "web",
      tail: [userMessage("u1", 1), assistant, userMessage("u2", 3)],
      timingIds: [assistant.id],
    });
    const assistantRow = findLayoutItem(layout, assistant.id);

    expect(assistantRow.completedFooter?.itemId).toBe(assistant.id);
    expect(assistantRow.frameOrder).toBe("content-then-footer");
  });

  it("compacts assistant block spacing across the history and live-head boundary", () => {
    const historyBlock = assistantMessage("turn:block:0", 2, { groupId: "turn", index: 0 });
    const headBlock = assistantMessage("turn:head", 3, { groupId: "turn", index: 1 });
    const layout = layoutFor({
      platform: "android",
      tail: [userMessage("u1", 1), historyBlock],
      head: [headBlock],
      timingIds: [historyBlock.id, headBlock.id],
    });

    expect(findLayoutItem(layout, historyBlock.id).assistantSpacing).toBe("compactBottom");
    expect(findLayoutItem(layout, headBlock.id).assistantSpacing).toBe("compactTop");
  });

  it.each(["web", "android"] as const)(
    "keeps split tool sequencing and gapBelow identical to unsplit history on %s",
    (platform) => {
      const shell = toolCall("tool-1", 2);
      const thinking = thought("thought-1", 3);
      const assistant = assistantMessage("a1", 4);
      const splitLayout = layoutFor({
        platform,
        tail: [userMessage("u1", 1), shell],
        head: [thinking, assistant],
      });
      const unsplitLayout = layoutFor({
        platform,
        tail: [userMessage("u1", 1), shell, thinking, assistant],
      });

      expect(findLayoutItem(splitLayout, shell.id).belowItem?.id).toBe(thinking.id);
      expect(findLayoutItem(splitLayout, thinking.id).aboveItem?.id).toBe(shell.id);
      expect(findLayoutItem(splitLayout, shell.id).toolSequence).toBe(
        findLayoutItem(unsplitLayout, shell.id).toolSequence,
      );
      expect(findLayoutItem(splitLayout, thinking.id).toolSequence).toBe(
        findLayoutItem(unsplitLayout, thinking.id).toolSequence,
      );
      expect(findLayoutItem(splitLayout, shell.id).gapBelow).toBe(
        findLayoutItem(unsplitLayout, shell.id).gapBelow,
      );
      expect(findLayoutItem(splitLayout, thinking.id).gapBelow).toBe(
        findLayoutItem(unsplitLayout, thinking.id).gapBelow,
      );
    },
  );

  it("computes tool sequence position from strategy-aware neighbors", () => {
    const shell = toolCall("tool-1", 2);
    const thinking = thought("thought-1", 3);
    const layout = layoutFor({
      platform: "android",
      tail: [userMessage("u1", 1), shell, thinking, assistantMessage("a1", 4)],
    });

    expect(findLayoutItem(layout, shell.id).toolSequence).toBe("first");
    expect(findLayoutItem(layout, thinking.id).toolSequence).toBe("last");
  });

  it("keeps bottom and inline footer ownership mutually exclusive", () => {
    const assistant = assistantMessage("a1", 2);
    const layout = layoutFor({
      platform: "web",
      tail: [userMessage("u1", 1), assistant],
      timingIds: [assistant.id],
    });

    expect(layout.auxiliaryTurnFooter?.itemId).toBe(assistant.id);
    expect(findLayoutItem(layout, assistant.id).completedFooter).toBeNull();
    expect(footerOwners(layout)).toEqual([assistant.id]);
  });

  it.each(["web", "android"] as const)(
    "keeps the completed turn footer available after an agent error on %s",
    (platform) => {
      const assistant = assistantMessage("system-error", 2);
      const layout = layoutFor({
        platform,
        tail: [userMessage("u1", 1), assistant],
        timingIds: [assistant.id],
      });

      expect(layout.auxiliaryTurnFooter?.itemId).toBe(assistant.id);
      expect(footerOwners(layout)).toEqual([assistant.id]);
    },
  );

  it.each(["web", "android"] as const)(
    "places inline footer after trailing visible tool rows before the next user on %s",
    (platform) => {
      const assistant = assistantMessage("a1", 2);
      const tool = toolCall("tool-1", 3);
      const layout = layoutFor({
        platform,
        tail: [userMessage("u1", 1), assistant, tool, userMessage("u2", 4)],
        timingIds: [assistant.id],
      });

      expect(layout.auxiliaryTurnFooter).toBeNull();
      expect(findLayoutItem(layout, assistant.id).completedFooter).toBeNull();
      expect(findLayoutItem(layout, tool.id).completedFooter?.itemId).toBe(assistant.id);
      expect(footerOwners(layout)).toEqual([tool.id]);
      expect(footerAssistantIds(layout)).toEqual([assistant.id]);
    },
  );

  it.each(["web", "android"] as const)(
    "places split live-head tool footer using the assistant from history on %s",
    (platform) => {
      const assistant = assistantMessage("a1", 2);
      const tool = toolCall("tool-1", 3);
      const layout = layoutFor({
        platform,
        tail: [userMessage("u1", 1), assistant],
        head: [tool, userMessage("u2", 4)],
        timingIds: [assistant.id],
      });

      expect(layout.auxiliaryTurnFooter).toBeNull();
      expect(findLayoutItem(layout, assistant.id).completedFooter).toBeNull();
      expect(findLayoutItem(layout, tool.id).completedFooter?.itemId).toBe(assistant.id);
      expect(inlineFooterPlacementByItemId(layout)).toEqual({
        [tool.id]: assistant.id,
      });
    },
  );

  it.each(["web", "android"] as const)(
    "uses the latest assistant for footer content while placing after the visible turn end on %s",
    (platform) => {
      const firstAssistant = assistantMessage("a1", 2);
      const firstTool = toolCall("tool-1", 3);
      const latestAssistant = assistantMessage("a2", 4);
      const latestTool = toolCall("tool-2", 5);
      const layout = layoutFor({
        platform,
        tail: [
          userMessage("u1", 1),
          firstAssistant,
          firstTool,
          latestAssistant,
          latestTool,
          userMessage("u2", 6),
        ],
        timingIds: [firstAssistant.id, latestAssistant.id],
      });

      expect(layout.auxiliaryTurnFooter).toBeNull();
      expect(findLayoutItem(layout, firstAssistant.id).completedFooter).toBeNull();
      expect(findLayoutItem(layout, latestAssistant.id).completedFooter).toBeNull();
      expect(findLayoutItem(layout, latestTool.id).completedFooter?.itemId).toBe(
        latestAssistant.id,
      );
      expect(footerOwners(layout)).toEqual([latestTool.id]);
      expect(footerAssistantIds(layout)).toEqual([latestAssistant.id]);
    },
  );

  it.each(["web", "android"] as const)(
    "keeps every completed turn footer while placing each one after that turn's last visible item on %s",
    (platform) => {
      const firstAssistant = assistantMessage("a1", 2);
      const secondAssistant = assistantMessage("a2", 4);
      const secondTool = toolCall("tool-2", 5);
      const layout = layoutFor({
        platform,
        tail: [
          userMessage("u1", 1),
          firstAssistant,
          userMessage("u2", 3),
          secondAssistant,
          secondTool,
          userMessage("u3", 6),
        ],
        timingIds: [firstAssistant.id, secondAssistant.id],
      });

      expect(layout.auxiliaryTurnFooter).toBeNull();
      expect(findLayoutItem(layout, firstAssistant.id).completedFooter?.itemId).toBe(
        firstAssistant.id,
      );
      expect(findLayoutItem(layout, secondAssistant.id).completedFooter).toBeNull();
      expect(findLayoutItem(layout, secondTool.id).completedFooter?.itemId).toBe(
        secondAssistant.id,
      );
      expect(inlineFooterPlacementByItemId(layout)).toEqual({
        [firstAssistant.id]: firstAssistant.id,
        [secondTool.id]: secondAssistant.id,
      });
    },
  );

  it.each(["web", "android"] as const)(
    "keeps bottom footer on the latest assistant turn when trailing tool rows end the turn on %s",
    (platform) => {
      const assistant = assistantMessage("a1", 2);
      const tool = toolCall("tool-1", 3);
      const layout = layoutFor({
        platform,
        tail: [userMessage("u1", 1), assistant, tool],
        timingIds: [assistant.id],
      });

      expect(layout.auxiliaryTurnFooter?.itemId).toBe(assistant.id);
      expect(findLayoutItem(layout, assistant.id).completedFooter).toBeNull();
      expect(footerOwners(layout)).toEqual([assistant.id]);
    },
  );

  it.each(["web", "android"] as const)(
    "does not render a completed footer before tool rows while the turn is running on %s",
    (platform) => {
      const assistant = assistantMessage("a1", 2);
      const tool = toolCall("tool-1", 3);
      const layout = layoutFor({
        platform,
        isTurnActive: true,
        tail: [userMessage("u1", 1), assistant, tool],
        timingIds: [assistant.id],
      });

      expect(layout.auxiliaryTurnFooter).toBeNull();
      expect(findLayoutItem(layout, assistant.id).completedFooter).toBeNull();
      expect(footerOwners(layout)).toEqual([]);
    },
  );
});
