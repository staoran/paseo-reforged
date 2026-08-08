import type { TurnTiming } from "@/timeline/turn-time";
import type { StreamItem } from "@/types/stream";
import { getAssistantBlockSpacing, getGapBetweenStreamItems } from "./spacing";
import type { StreamFrameChildOrder, StreamStrategy } from "./strategy";

export type StreamToolSequence = "single" | "first" | "middle" | "last" | "none";

export interface TurnFooterHost {
  itemId: string;
  items: StreamItem[];
  timing?: TurnTiming;
  startIndex: number;
}

export interface ActivityFold {
  id: string;
  completed: boolean;
  hostItemId: string;
  durationMs?: number;
}

export interface StreamLayoutItem {
  item: StreamItem;
  index: number;
  items: StreamItem[];
  aboveItem: StreamItem | null;
  belowItem: StreamItem | null;
  gapBelow: number;
  assistantSpacing: "default" | "compactTop" | "compactBottom" | "compactBoth";
  completedFooter: TurnFooterHost | null;
  activityFold: ActivityFold | null;
  isActivityFoldHost: boolean;
  toolSequence: StreamToolSequence;
  isFirstInUserGroup: boolean;
  isLastInUserGroup: boolean;
  isLastInToolSequence: boolean;
  frameOrder: StreamFrameChildOrder;
}

export interface StreamLayout {
  history: StreamLayoutItem[];
  liveHead: StreamLayoutItem[];
  auxiliaryTurnFooter: TurnFooterHost | null;
}

export interface StreamLayoutInput {
  strategy: StreamStrategy;
  isTurnActive: boolean;
  agentStatus: string;
  history: StreamItem[];
  liveHead: StreamItem[];
  timingByAssistantId: Map<string, TurnTiming>;
}

interface LayoutSegmentInput {
  strategy: StreamStrategy;
  items: StreamItem[];
  timingByAssistantId: Map<string, TurnTiming>;
  auxiliaryTurnFooter: TurnFooterHost | null;
  completedTurnItemIds: Set<string>;
  activityFoldByItemId: ReadonlyMap<string, ActivityFold>;
  frameOrder: StreamFrameChildOrder;
  boundaryIndex: number | null;
  boundaryAboveItem: StreamItem | null;
  boundaryBelowItem: StreamItem | null;
  boundaryAboveItems: StreamItem[] | null;
  boundaryAboveIndex: number | null;
}

interface AssistantFooterSource {
  item: Extract<StreamItem, { kind: "assistant_message" }>;
  items: StreamItem[];
  index: number;
}

function createTurnFooterHost(input: {
  item: StreamItem;
  items: StreamItem[];
  index: number;
  timingByAssistantId: Map<string, TurnTiming>;
}): TurnFooterHost {
  return {
    itemId: input.item.id,
    items: input.items,
    timing: input.timingByAssistantId.get(input.item.id),
    startIndex: input.index,
  };
}

function findLatestAssistantInTurn(input: {
  strategy: StreamStrategy;
  items: StreamItem[];
  startIndex: number;
  boundaryAboveItems?: StreamItem[] | null;
  boundaryAboveIndex?: number | null;
}): AssistantFooterSource | null {
  let items = input.items;
  let index = input.startIndex;
  let canCrossBoundary = true;

  while (true) {
    for (
      ;
      index >= 0 && index < items.length;
      index = input.strategy.getNeighborIndex(index, "above")
    ) {
      const item = items[index];
      if (!item || item.kind === "user_message") {
        return null;
      }
      if (item.kind === "assistant_message") {
        return { item, items, index };
      }
    }

    if (
      !canCrossBoundary ||
      !input.boundaryAboveItems ||
      input.boundaryAboveIndex === null ||
      input.boundaryAboveIndex === undefined
    ) {
      return null;
    }

    items = input.boundaryAboveItems;
    index = input.boundaryAboveIndex;
    canCrossBoundary = false;
  }
}

function resolveAuxiliaryTurnFooter(input: StreamLayoutInput): TurnFooterHost | null {
  if (input.isTurnActive) {
    return null;
  }

  const usesLiveHead = input.liveHead.length > 0;
  const footerItems = usesLiveHead ? input.liveHead : input.history;
  const latestIndex = input.strategy.getLatestItemIndex(footerItems);
  if (latestIndex === null) {
    return null;
  }

  const assistant = findLatestAssistantInTurn({
    strategy: input.strategy,
    items: footerItems,
    startIndex: latestIndex,
    boundaryAboveItems: usesLiveHead ? input.history : null,
    boundaryAboveIndex: usesLiveHead
      ? input.strategy.getHistoryLiveBoundaryIndex(input.history)
      : null,
  });
  if (!assistant) {
    return null;
  }

  return createTurnFooterHost({
    item: assistant.item,
    items: assistant.items,
    index: assistant.index,
    timingByAssistantId: input.timingByAssistantId,
  });
}

function resolveCompletedFooter(input: {
  strategy: StreamStrategy;
  items: StreamItem[];
  index: number;
  item: StreamItem;
  belowItem: StreamItem | null;
  timingByAssistantId: Map<string, TurnTiming>;
  auxiliaryTurnFooter: TurnFooterHost | null;
  completedTurnItemIds: Set<string>;
  boundaryAboveItems: StreamItem[] | null;
  boundaryAboveIndex: number | null;
}): TurnFooterHost | null {
  if (
    input.item.kind === "user_message" ||
    input.belowItem?.kind !== "user_message" ||
    !input.completedTurnItemIds.has(input.item.id)
  ) {
    return null;
  }

  const assistant = findLatestAssistantInTurn({
    strategy: input.strategy,
    items: input.items,
    startIndex: input.index,
    boundaryAboveItems: input.boundaryAboveItems,
    boundaryAboveIndex: input.boundaryAboveIndex,
  });
  if (!assistant || input.auxiliaryTurnFooter?.itemId === assistant.item.id) {
    return null;
  }
  return createTurnFooterHost({
    item: assistant.item,
    items: assistant.items,
    index: assistant.index,
    timingByAssistantId: input.timingByAssistantId,
  });
}

function projectSegmentCompletedTurnItemIds(input: {
  strategy: StreamStrategy;
  items: StreamItem[];
  latestTurnCompleted: boolean;
  boundaryAboveItem: StreamItem | null;
}): { itemIds: Set<string>; boundaryTurnCompleted: boolean } {
  const completed = new Set<string>();
  let isTurnCompleted = input.latestTurnCompleted;
  let index = input.strategy.getLatestItemIndex(input.items);

  while (index !== null) {
    const item = input.items[index];
    if (!item) {
      break;
    }
    if (isTurnCompleted) {
      completed.add(item.id);
    }

    const nextIndex = input.strategy.getNeighborIndex(index, "above");
    const hasNextItem = nextIndex >= 0 && nextIndex < input.items.length;
    const nextOlderItem = hasNextItem ? input.items[nextIndex] : input.boundaryAboveItem;
    if (item.kind === "user_message" && nextOlderItem?.kind !== "user_message") {
      isTurnCompleted = true;
    }
    index = hasNextItem ? nextIndex : null;
  }

  return { itemIds: completed, boundaryTurnCompleted: isTurnCompleted };
}

interface ActivityFoldProjection {
  foldByItemId: ReadonlyMap<string, ActivityFold>;
  historyFoldKey: string;
}

interface ActivityTurn {
  userId: string | null;
  items: StreamItem[];
}

const activityFoldProjectionCache = new WeakMap<
  StreamItem[],
  Map<string, ActivityFoldProjection>
>();

function collectChronologicalItems(input: StreamLayoutInput): StreamItem[] {
  const newestToOldest: StreamItem[] = [];
  const appendSegment = (items: StreamItem[], startIndex: number | null) => {
    for (
      let index = startIndex;
      index !== null && index >= 0 && index < items.length;
      index = input.strategy.getNeighborIndex(index, "above")
    ) {
      const item = items[index];
      if (item) {
        newestToOldest.push(item);
      }
    }
  };

  if (input.liveHead.length > 0) {
    appendSegment(input.liveHead, input.strategy.getLatestItemIndex(input.liveHead));
    appendSegment(input.history, input.strategy.getHistoryLiveBoundaryIndex(input.history));
  } else {
    appendSegment(input.history, input.strategy.getLatestItemIndex(input.history));
  }
  return newestToOldest.toReversed();
}

function collectActivityTurns(items: StreamItem[]): ActivityTurn[] {
  const turns: ActivityTurn[] = [];
  let turn: ActivityTurn = { userId: null, items: [] };
  for (const item of items) {
    if (item.kind === "user_message") {
      if (turn.userId !== null || turn.items.length > 0) {
        turns.push(turn);
      }
      turn = { userId: item.id, items: [] };
    } else {
      turn.items.push(item);
    }
  }
  if (turn.userId !== null || turn.items.length > 0) {
    turns.push(turn);
  }
  return turns;
}

function createActivityFoldForTurn(input: {
  turn: ActivityTurn;
  isLatestTurn: boolean;
  agentStatus: string;
  timingByAssistantId: Map<string, TurnTiming>;
}): { fold: ActivityFold; items: StreamItem[] } | null {
  const hasPhase = input.turn.items.some(
    (item) => item.kind === "assistant_message" && item.phase !== undefined,
  );
  if (!hasPhase) {
    return null;
  }

  const finalAnswerIndex = input.turn.items.findIndex(
    (item) => item.kind === "assistant_message" && item.phase === "final_answer",
  );
  const finalAnswer = finalAnswerIndex >= 0 ? input.turn.items[finalAnswerIndex] : undefined;
  const durationMs = finalAnswer
    ? input.timingByAssistantId.get(finalAnswer.id)?.durationMs
    : undefined;
  const items =
    finalAnswerIndex >= 0 ? input.turn.items.slice(0, finalAnswerIndex) : input.turn.items;
  const host = items[0];
  if (!host) {
    return null;
  }

  return {
    fold: {
      id: `activity:${input.turn.userId ?? host.id}`,
      completed: finalAnswerIndex >= 0 && (!input.isLatestTurn || input.agentStatus !== "running"),
      hostItemId: host.id,
      ...(durationMs === undefined ? {} : { durationMs }),
    },
    items,
  };
}

function projectActivityFolds(input: StreamLayoutInput): ActivityFoldProjection {
  const cacheKey = JSON.stringify([
    input.strategy.getFrameChildOrder(),
    input.agentStatus === "running",
    input.liveHead.map((item) => [
      item.id,
      item.kind,
      item.kind === "assistant_message" ? (item.phase ?? null) : null,
    ]),
  ]);
  let byKey = activityFoldProjectionCache.get(input.history);
  if (!byKey) {
    byKey = new Map();
    activityFoldProjectionCache.set(input.history, byKey);
  }
  const cached = byKey.get(cacheKey);
  if (cached) {
    return cached;
  }

  const turns = collectActivityTurns(collectChronologicalItems(input));

  const foldByItemId = new Map<string, ActivityFold>();
  for (const [turnIndex, projectedTurn] of turns.entries()) {
    const projection = createActivityFoldForTurn({
      turn: projectedTurn,
      isLatestTurn: turnIndex === turns.length - 1,
      agentStatus: input.agentStatus,
      timingByAssistantId: input.timingByAssistantId,
    });
    if (!projection) {
      continue;
    }
    for (const item of projection.items) {
      foldByItemId.set(item.id, projection.fold);
    }
  }

  let latestHistoryFold: ActivityFold | null = null;
  for (
    let index = input.strategy.getLatestItemIndex(input.history);
    index !== null && index >= 0 && index < input.history.length;
    index = input.strategy.getNeighborIndex(index, "above")
  ) {
    const item = input.history[index];
    const fold = item ? foldByItemId.get(item.id) : undefined;
    if (fold) {
      latestHistoryFold = fold;
      break;
    }
  }
  const projection = {
    foldByItemId,
    historyFoldKey: latestHistoryFold
      ? `${latestHistoryFold.id}:${latestHistoryFold.completed}:${latestHistoryFold.hostItemId}:${latestHistoryFold.durationMs ?? "unknown"}`
      : "none",
  };
  byKey.set(cacheKey, projection);
  return projection;
}

function isToolSequenceItem(
  item: StreamItem | null,
): item is Extract<StreamItem, { kind: "tool_call" | "thought" | "todo_list" }> {
  return item?.kind === "tool_call" || item?.kind === "thought" || item?.kind === "todo_list";
}

function getToolSequence(input: {
  item: StreamItem;
  aboveItem: StreamItem | null;
  belowItem: StreamItem | null;
}): StreamToolSequence {
  if (!isToolSequenceItem(input.item)) {
    return "none";
  }

  const hasAbove = isToolSequenceItem(input.aboveItem);
  const hasBelow = isToolSequenceItem(input.belowItem);
  if (hasAbove && hasBelow) {
    return "middle";
  }
  if (hasAbove) {
    return "last";
  }
  if (hasBelow) {
    return "first";
  }
  return "single";
}

function getSegmentNeighbor(input: {
  strategy: StreamStrategy;
  items: StreamItem[];
  index: number;
  relation: "above" | "below";
  boundaryIndex: number | null;
  boundaryItem: StreamItem | null;
}): StreamItem | null {
  const neighbor = input.strategy.getNeighborItem(input.items, input.index, input.relation);
  if (neighbor) {
    return neighbor;
  }
  if (input.index === input.boundaryIndex) {
    return input.boundaryItem;
  }
  return null;
}

function layoutSegment(input: LayoutSegmentInput): StreamLayoutItem[] {
  return input.items.map((item, index) => {
    const aboveItem = getSegmentNeighbor({
      strategy: input.strategy,
      items: input.items,
      index,
      relation: "above",
      boundaryIndex: input.boundaryIndex,
      boundaryItem: input.boundaryAboveItem,
    });
    const belowItem = getSegmentNeighbor({
      strategy: input.strategy,
      items: input.items,
      index,
      relation: "below",
      boundaryIndex: input.boundaryIndex,
      boundaryItem: input.boundaryBelowItem,
    });
    const assistantSpacing = getAssistantBlockSpacing({
      item,
      aboveItem,
      belowItem,
    });
    const completedFooter = resolveCompletedFooter({
      strategy: input.strategy,
      items: input.items,
      index,
      item,
      belowItem,
      timingByAssistantId: input.timingByAssistantId,
      auxiliaryTurnFooter: input.auxiliaryTurnFooter,
      completedTurnItemIds: input.completedTurnItemIds,
      boundaryAboveItems: input.boundaryAboveItems,
      boundaryAboveIndex: input.boundaryAboveIndex,
    });
    const activityFold = input.activityFoldByItemId.get(item.id) ?? null;

    return {
      item,
      index,
      items: input.items,
      aboveItem,
      belowItem,
      gapBelow: completedFooter ? 0 : getGapBetweenStreamItems(item, belowItem),
      assistantSpacing,
      completedFooter,
      activityFold,
      isActivityFoldHost: activityFold?.hostItemId === item.id,
      toolSequence: getToolSequence({ item, aboveItem, belowItem }),
      isFirstInUserGroup: item.kind === "user_message" && aboveItem?.kind !== "user_message",
      isLastInUserGroup: item.kind === "user_message" && belowItem?.kind !== "user_message",
      isLastInToolSequence: isToolSequenceItem(item) && !isToolSequenceItem(belowItem),
      frameOrder: input.frameOrder,
    };
  });
}

// Keyed by history array identity; inner key encodes the inputs that affect history layout.
// History layout is stable across text-chunk flushes because the liveHead boundary item's
// kind and id don't change when only its text grows.
const historyLayoutCache = new WeakMap<StreamItem[], Map<string, StreamLayoutItem[]>>();

export function layoutStream(input: StreamLayoutInput): StreamLayout {
  const activityProjection = projectActivityFolds(input);
  const auxiliaryTurnFooter = resolveAuxiliaryTurnFooter(input);
  const historyBoundaryIndex = input.strategy.getHistoryLiveBoundaryIndex(input.history);
  const liveHeadBoundaryIndex = input.strategy.getLiveHeadHistoryBoundaryIndex(input.liveHead);
  const historyBoundaryItem =
    historyBoundaryIndex === null ? null : (input.history[historyBoundaryIndex] ?? null);
  const liveHeadBoundaryItem =
    liveHeadBoundaryIndex === null ? null : (input.liveHead[liveHeadBoundaryIndex] ?? null);
  const frameOrder = input.strategy.getFrameChildOrder();
  const liveCompletion = projectSegmentCompletedTurnItemIds({
    strategy: input.strategy,
    items: input.liveHead,
    latestTurnCompleted: auxiliaryTurnFooter !== null,
    boundaryAboveItem: historyBoundaryItem,
  });
  const historyLatestTurnCompleted =
    input.liveHead.length > 0 ? liveCompletion.boundaryTurnCompleted : auxiliaryTurnFooter !== null;

  let history: StreamLayoutItem[];
  if (input.history.length > 0) {
    // The cache key encodes every input that can change history layout. liveHeadBoundaryItem.id
    // and .kind are stable across text-only flushes (text growth doesn't change what kind of
    // item borders history), so cached layout stays valid between flushes.
    const historyCacheKey = [
      frameOrder,
      historyBoundaryIndex ?? "null",
      liveHeadBoundaryItem?.id ?? "null",
      liveHeadBoundaryItem?.kind ?? "null",
      auxiliaryTurnFooter?.itemId ?? "null",
      historyLatestTurnCompleted,
      activityProjection.historyFoldKey,
    ].join(":");
    let byKey = historyLayoutCache.get(input.history);
    if (!byKey) {
      byKey = new Map();
      historyLayoutCache.set(input.history, byKey);
    }
    const cached = byKey.get(historyCacheKey);
    if (cached) {
      history = cached;
    } else {
      const historyCompletion = projectSegmentCompletedTurnItemIds({
        strategy: input.strategy,
        items: input.history,
        latestTurnCompleted: historyLatestTurnCompleted,
        boundaryAboveItem: null,
      });
      history = layoutSegment({
        strategy: input.strategy,
        items: input.history,
        timingByAssistantId: input.timingByAssistantId,
        auxiliaryTurnFooter,
        completedTurnItemIds: historyCompletion.itemIds,
        activityFoldByItemId: activityProjection.foldByItemId,
        frameOrder,
        boundaryIndex: historyBoundaryIndex,
        boundaryAboveItem: null,
        boundaryBelowItem: liveHeadBoundaryItem,
        boundaryAboveItems: null,
        boundaryAboveIndex: null,
      });
      byKey.set(historyCacheKey, history);
    }
  } else {
    history = [];
  }

  const liveHead = layoutSegment({
    strategy: input.strategy,
    items: input.liveHead,
    timingByAssistantId: input.timingByAssistantId,
    auxiliaryTurnFooter,
    completedTurnItemIds: liveCompletion.itemIds,
    activityFoldByItemId: activityProjection.foldByItemId,
    frameOrder,
    boundaryIndex: liveHeadBoundaryIndex,
    boundaryAboveItem: historyBoundaryItem,
    boundaryBelowItem: null,
    boundaryAboveItems: input.history,
    boundaryAboveIndex: historyBoundaryIndex,
  });

  return {
    history,
    liveHead,
    auxiliaryTurnFooter,
  };
}
