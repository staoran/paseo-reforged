import type { TurnTiming } from "@/timeline/turn-time";
import type { StreamItem } from "@/types/stream";
import { getAssistantBlockSpacing, getGapBetweenStreamItems } from "./spacing";
import { createItemStreamRenderRow, type ActivityFold, type StreamRenderRow } from "./model";
import type { StreamFrameChildOrder, StreamStrategy } from "./strategy";

export type { ActivityFold } from "./model";

export type StreamToolSequence = "single" | "first" | "middle" | "last" | "none";

export interface TurnFooterHost {
  itemId: string;
  items: StreamItem[];
  timing?: TurnTiming;
  startIndex: number;
}

export interface StreamLayoutItem {
  row: StreamRenderRow;
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
  phase: "streaming" | "complete";
}

export interface StreamLayout {
  history: StreamLayoutItem[];
  liveHead: StreamLayoutItem[];
  auxiliaryTurnFooter: TurnFooterHost | null;
}

export interface StreamLayoutInput {
  strategy: StreamStrategy;
  isTurnActive: boolean;
  history: StreamRenderRow[];
  liveHead: StreamRenderRow[];
  timingByAssistantId: Map<string, TurnTiming>;
}

interface LayoutSegmentInput {
  strategy: StreamStrategy;
  rows: StreamRenderRow[];
  items: StreamItem[];
  itemIndexById: ReadonlyMap<string, number>;
  timingByAssistantId: Map<string, TurnTiming>;
  auxiliaryTurnFooter: TurnFooterHost | null;
  completedTurnItemIds: Set<string>;
  frameOrder: StreamFrameChildOrder;
  boundaryIndex: number | null;
  boundaryAboveItem: StreamItem | null;
  boundaryBelowItem: StreamItem | null;
  boundaryAboveItems: StreamItem[] | null;
  boundaryAboveIndex: number | null;
  phase: "streaming" | "complete";
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

function resolveAuxiliaryTurnFooter(input: {
  strategy: StreamStrategy;
  isTurnActive: boolean;
  history: StreamItem[];
  liveHead: StreamItem[];
  timingByAssistantId: Map<string, TurnTiming>;
}): TurnFooterHost | null {
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

function getRowAboveEdgeItem(row: StreamRenderRow): StreamItem {
  return row.kind === "activity" ? (row.fold.members[0] ?? row.item) : row.item;
}

function getRowBelowEdgeItem(row: StreamRenderRow): StreamItem {
  return row.kind === "activity" ? (row.fold.members.at(-1) ?? row.item) : row.item;
}

function getSegmentNeighbor(input: {
  strategy: StreamStrategy;
  rows: StreamRenderRow[];
  index: number;
  relation: "above" | "below";
  boundaryIndex: number | null;
  boundaryItem: StreamItem | null;
}): StreamItem | null {
  const neighbor = input.strategy.getNeighborItem(input.rows, input.index, input.relation);
  if (neighbor) {
    return input.relation === "above"
      ? getRowBelowEdgeItem(neighbor)
      : getRowAboveEdgeItem(neighbor);
  }
  if (input.index === input.boundaryIndex) {
    return input.boundaryItem;
  }
  return null;
}

function getOrderedRowItems(row: StreamRenderRow, strategy: StreamStrategy): StreamItem[] {
  return row.kind === "activity" ? strategy.orderTail(row.fold.members) : [row.item];
}

function flattenRows(rows: StreamRenderRow[], strategy: StreamStrategy): StreamItem[] {
  return rows.flatMap((row) => getOrderedRowItems(row, strategy));
}

function indexItemsById(items: StreamItem[]): Map<string, number> {
  return new Map(items.map((item, index) => [item.id, index]));
}

function layoutSegment(input: LayoutSegmentInput): StreamLayoutItem[] {
  return input.rows.map((row, rowIndex) => {
    const aboveItem = getSegmentNeighbor({
      strategy: input.strategy,
      rows: input.rows,
      index: rowIndex,
      relation: "above",
      boundaryIndex: input.boundaryIndex,
      boundaryItem: input.boundaryAboveItem,
    });
    const belowItem = getSegmentNeighbor({
      strategy: input.strategy,
      rows: input.rows,
      index: rowIndex,
      relation: "below",
      boundaryIndex: input.boundaryIndex,
      boundaryItem: input.boundaryBelowItem,
    });
    const footerItem = getRowBelowEdgeItem(row);
    const footerIndex = input.itemIndexById.get(footerItem.id) ?? -1;
    const completedFooter =
      footerIndex < 0
        ? null
        : resolveCompletedFooter({
            strategy: input.strategy,
            items: input.items,
            index: footerIndex,
            item: footerItem,
            belowItem,
            timingByAssistantId: input.timingByAssistantId,
            auxiliaryTurnFooter: input.auxiliaryTurnFooter,
            completedTurnItemIds: input.completedTurnItemIds,
            boundaryAboveItems: input.boundaryAboveItems,
            boundaryAboveIndex: input.boundaryAboveIndex,
          });
    const item = row.item;
    const itemIndex = input.itemIndexById.get(item.id) ?? footerIndex;

    return {
      row,
      item,
      index: itemIndex,
      items: input.items,
      aboveItem,
      belowItem,
      gapBelow: completedFooter ? 0 : getGapBetweenStreamItems(footerItem, belowItem),
      assistantSpacing:
        row.kind === "activity"
          ? "default"
          : getAssistantBlockSpacing({ item, aboveItem, belowItem }),
      completedFooter,
      activityFold: row.kind === "activity" ? row.fold : null,
      isActivityFoldHost: row.kind === "activity",
      toolSequence:
        row.kind === "activity" ? "none" : getToolSequence({ item, aboveItem, belowItem }),
      isFirstInUserGroup:
        row.kind === "item" && item.kind === "user_message" && aboveItem?.kind !== "user_message",
      isLastInUserGroup:
        row.kind === "item" && item.kind === "user_message" && belowItem?.kind !== "user_message",
      isLastInToolSequence:
        row.kind === "item" && isToolSequenceItem(item) && !isToolSequenceItem(belowItem),
      frameOrder: input.frameOrder,
      phase: input.phase,
    };
  });
}

const historyLayoutCache = new WeakMap<StreamRenderRow[], Map<string, StreamLayoutItem[]>>();

/** Produces member layout only for the activity row currently being expanded. */
export function layoutActivityFoldMembers(input: {
  strategy: StreamStrategy;
  fold: ActivityFold;
  aboveItem: StreamItem | null;
  belowItem: StreamItem | null;
  phase: StreamLayoutItem["phase"];
}): StreamLayoutItem[] {
  const items = input.strategy.orderTail(input.fold.members);
  const frameOrder = input.strategy.getFrameChildOrder();
  return items.map((item, index) => {
    const aboveItem = input.strategy.getNeighborItem(items, index, "above") ?? input.aboveItem;
    const internalBelowItem = input.strategy.getNeighborItem(items, index, "below") ?? null;
    const belowItem = internalBelowItem ?? input.belowItem;
    return {
      row: createItemStreamRenderRow(item),
      item,
      index,
      items,
      aboveItem,
      belowItem,
      gapBelow: internalBelowItem ? getGapBetweenStreamItems(item, internalBelowItem) : 0,
      assistantSpacing: getAssistantBlockSpacing({ item, aboveItem, belowItem }),
      completedFooter: null,
      activityFold: null,
      isActivityFoldHost: false,
      toolSequence: getToolSequence({ item, aboveItem, belowItem }),
      isFirstInUserGroup: item.kind === "user_message" && aboveItem?.kind !== "user_message",
      isLastInUserGroup: item.kind === "user_message" && belowItem?.kind !== "user_message",
      isLastInToolSequence: isToolSequenceItem(item) && !isToolSequenceItem(belowItem),
      frameOrder,
      phase: input.phase,
    };
  });
}

/** Lays out only top-level rows; activity members stay as lightweight fold references. */
export function layoutStream(input: StreamLayoutInput): StreamLayout {
  const historyItems = flattenRows(input.history, input.strategy);
  const liveHeadItems = flattenRows(input.liveHead, input.strategy);
  const historyItemIndexById = indexItemsById(historyItems);
  const liveHeadItemIndexById = indexItemsById(liveHeadItems);
  const auxiliaryTurnFooter = resolveAuxiliaryTurnFooter({
    strategy: input.strategy,
    isTurnActive: input.isTurnActive,
    history: historyItems,
    liveHead: liveHeadItems,
    timingByAssistantId: input.timingByAssistantId,
  });
  const historyBoundaryIndex = input.strategy.getHistoryLiveBoundaryIndex(input.history);
  const liveHeadBoundaryIndex = input.strategy.getLiveHeadHistoryBoundaryIndex(input.liveHead);
  const historyBoundaryRow =
    historyBoundaryIndex === null ? null : (input.history[historyBoundaryIndex] ?? null);
  const liveHeadBoundaryRow =
    liveHeadBoundaryIndex === null ? null : (input.liveHead[liveHeadBoundaryIndex] ?? null);
  const historyBoundaryItem = historyBoundaryRow ? getRowBelowEdgeItem(historyBoundaryRow) : null;
  const liveHeadBoundaryItem = liveHeadBoundaryRow
    ? getRowAboveEdgeItem(liveHeadBoundaryRow)
    : null;
  const frameOrder = input.strategy.getFrameChildOrder();
  const liveCompletion = projectSegmentCompletedTurnItemIds({
    strategy: input.strategy,
    items: liveHeadItems,
    latestTurnCompleted: auxiliaryTurnFooter !== null,
    boundaryAboveItem: historyBoundaryItem,
  });
  const historyLatestTurnCompleted =
    liveHeadItems.length > 0 ? liveCompletion.boundaryTurnCompleted : auxiliaryTurnFooter !== null;

  let history: StreamLayoutItem[];
  if (input.history.length > 0) {
    const historyCacheKey = [
      frameOrder,
      historyBoundaryIndex ?? "null",
      liveHeadBoundaryItem?.id ?? "null",
      liveHeadBoundaryItem?.kind ?? "null",
      auxiliaryTurnFooter?.itemId ?? "null",
      historyLatestTurnCompleted,
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
        items: historyItems,
        latestTurnCompleted: historyLatestTurnCompleted,
        boundaryAboveItem: null,
      });
      history = layoutSegment({
        strategy: input.strategy,
        rows: input.history,
        items: historyItems,
        itemIndexById: historyItemIndexById,
        timingByAssistantId: input.timingByAssistantId,
        auxiliaryTurnFooter,
        completedTurnItemIds: historyCompletion.itemIds,
        frameOrder,
        boundaryIndex: historyBoundaryIndex,
        boundaryAboveItem: null,
        boundaryBelowItem: liveHeadBoundaryItem,
        boundaryAboveItems: null,
        boundaryAboveIndex: null,
        phase: "complete",
      });
      byKey.set(historyCacheKey, history);
    }
  } else {
    history = [];
  }

  const liveHead = layoutSegment({
    strategy: input.strategy,
    rows: input.liveHead,
    items: liveHeadItems,
    itemIndexById: liveHeadItemIndexById,
    timingByAssistantId: input.timingByAssistantId,
    auxiliaryTurnFooter,
    completedTurnItemIds: liveCompletion.itemIds,
    frameOrder,
    boundaryIndex: liveHeadBoundaryIndex,
    boundaryAboveItem: historyBoundaryItem,
    boundaryBelowItem: null,
    boundaryAboveItems: historyItems,
    boundaryAboveIndex: input.strategy.getHistoryLiveBoundaryIndex(historyItems),
    phase: input.isTurnActive ? "streaming" : "complete",
  });

  return {
    history,
    liveHead,
    auxiliaryTurnFooter,
  };
}
