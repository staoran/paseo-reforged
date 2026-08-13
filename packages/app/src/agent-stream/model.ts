import type { ReactNode } from "react";
import { deriveStreamTurnTiming, type StreamTurnTiming } from "@/timeline/turn-time";
import type { StreamItem } from "@/types/stream";
import {
  findMountedWindowStart,
  getWebMountedRecentStreamItems,
  getWebPartialVirtualizationThreshold,
} from "./web-virtualization";
import { orderHeadForStreamRenderStrategy, orderTailForStreamRenderStrategy } from "./strategy";
import { resolveStreamRenderStrategy } from "./strategy-resolver";

export interface ActivityFold {
  id: string;
  completed: boolean;
  hostItemId: string;
  memberIds: string[];
  members: StreamItem[];
  durationMs?: number;
  detailStatus?: "idle" | "loading" | "ready" | "error";
  detailError?: string | null;
}

export interface StreamRenderItemRow {
  kind: "item";
  id: string;
  item: StreamItem;
}

export interface StreamRenderActivityRow {
  kind: "activity";
  id: string;
  item: StreamItem;
  fold: ActivityFold;
}

export type StreamRenderRow = StreamRenderItemRow | StreamRenderActivityRow;

export interface StreamRenderSegments {
  historyVirtualized: StreamRenderRow[];
  historyMounted: StreamRenderRow[];
  liveHead: StreamRenderRow[];
}

export interface StreamHistoryBoundary {
  hasVirtualizedHistory: boolean;
  hasMountedHistory: boolean;
  hasLiveHead: boolean;
}

export interface StreamRenderAuxiliary {
  pendingPermissions: ReactNode;
  turnFooter: ReactNode;
}

export interface AgentStreamRenderModel {
  history: StreamRenderRow[];
  segments: StreamRenderSegments;
  turnTiming: StreamTurnTiming;
  boundary: StreamHistoryBoundary;
  auxiliary: StreamRenderAuxiliary;
}

export interface BuildAgentStreamRenderModelInput {
  isTurnActive: boolean;
  activeTurnStartedAt: Date | null;
  tail: StreamItem[];
  head: StreamItem[];
  platform: "web" | "native";
  isMobileBreakpoint: boolean;
  activityFolds?: readonly ActivityFold[];
}

interface ActivityTurn {
  userId: string | null;
  items: StreamItem[];
}

const EMPTY_STREAM_ROWS: StreamRenderRow[] = [];
const EMPTY_AUXILIARY: StreamRenderAuxiliary = {
  pendingPermissions: null,
  turnFooter: null,
};

const itemRowCache = new WeakMap<StreamItem, StreamRenderItemRow>();
const plainLaneProjectionCache = new WeakMap<StreamItem[], StreamRenderRow[]>();
const orderedTailCache = new WeakMap<StreamRenderRow[], Map<string, StreamRenderRow[]>>();
const orderedHeadCache = new WeakMap<StreamRenderRow[], Map<string, StreamRenderRow[]>>();
const splitHistoryCache = new WeakMap<
  StreamRenderRow[],
  Map<string, Pick<AgentStreamRenderModel, "history" | "segments">>
>();
const turnTimingCache = new WeakMap<
  StreamItem[],
  WeakMap<StreamItem[], Map<string, StreamTurnTiming>>
>();

export function createItemStreamRenderRow(item: StreamItem): StreamRenderItemRow {
  const cached = itemRowCache.get(item);
  if (cached) {
    return cached;
  }
  const row: StreamRenderItemRow = { kind: "item", id: item.id, item };
  itemRowCache.set(item, row);
  return row;
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

function createActivityFold(input: {
  turn: ActivityTurn;
  isLatestTurn: boolean;
  isTurnActive: boolean;
  turnTiming: StreamTurnTiming;
}): ActivityFold | null {
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
  const members =
    finalAnswerIndex >= 0 ? input.turn.items.slice(0, finalAnswerIndex) : input.turn.items;
  const host = members[0];
  if (!host) {
    return null;
  }

  const durationMs = finalAnswer
    ? input.turnTiming.byAssistantId.get(finalAnswer.id)?.durationMs
    : undefined;
  return {
    id: `activity:${input.turn.userId ?? host.id}`,
    completed: finalAnswerIndex >= 0 && (!input.isLatestTurn || !input.isTurnActive),
    hostItemId: host.id,
    memberIds: members.map((item) => item.id),
    members,
    ...(durationMs === undefined ? {} : { durationMs }),
  };
}

function getPlainLaneRows(items: StreamItem[]): StreamRenderRow[] {
  const cached = plainLaneProjectionCache.get(items);
  if (cached) {
    return cached;
  }
  const rows = items.map(createItemStreamRenderRow);
  plainLaneProjectionCache.set(items, rows);
  return rows;
}

function projectLaneRows(
  items: StreamItem[],
  foldByMemberId: ReadonlyMap<string, ActivityFold>,
  foldByHostId: ReadonlyMap<string, ActivityFold>,
): StreamRenderRow[] {
  if (foldByMemberId.size === 0 && foldByHostId.size === 0) {
    return getPlainLaneRows(items);
  }

  let hasFoldMember = false;
  const rows: StreamRenderRow[] = [];
  for (const item of items) {
    const fold = foldByHostId.get(item.id) ?? foldByMemberId.get(item.id);
    if (!fold) {
      rows.push(createItemStreamRenderRow(item));
      continue;
    }
    hasFoldMember = true;
    if (fold.hostItemId === item.id) {
      rows.push({ kind: "activity", id: fold.hostItemId, item, fold });
    }
  }
  return hasFoldMember ? rows : getPlainLaneRows(items);
}

function projectActivityRows(input: {
  tail: StreamItem[];
  head: StreamItem[];
  isTurnActive: boolean;
  turnTiming: StreamTurnTiming;
  activityFolds: readonly ActivityFold[];
}): { tail: StreamRenderRow[]; head: StreamRenderRow[] } {
  const turns = collectActivityTurns([...input.tail, ...input.head]);
  const foldByMemberId = new Map<string, ActivityFold>();
  const foldByHostId = new Map<string, ActivityFold>();
  for (const [index, turn] of turns.entries()) {
    const fold = createActivityFold({
      turn,
      isLatestTurn: index === turns.length - 1,
      isTurnActive: input.isTurnActive,
      turnTiming: input.turnTiming,
    });
    if (!fold) {
      continue;
    }
    for (const memberId of fold.memberIds) {
      foldByMemberId.set(memberId, fold);
    }
  }
  for (const fold of input.activityFolds) {
    foldByHostId.set(fold.hostItemId, fold);
    for (const memberId of fold.memberIds) {
      foldByMemberId.set(memberId, fold);
    }
  }
  return {
    tail: projectLaneRows(input.tail, foldByMemberId, foldByHostId),
    head: projectLaneRows(input.head, foldByMemberId, foldByHostId),
  };
}

function getOrderedRows(params: {
  cache: WeakMap<StreamRenderRow[], Map<string, StreamRenderRow[]>>;
  source: StreamRenderRow[];
  cacheKey: string;
  order: (rows: StreamRenderRow[]) => StreamRenderRow[];
}): StreamRenderRow[] {
  const { cache, source, cacheKey, order } = params;
  let cachedByKey = cache.get(source);
  if (!cachedByKey) {
    cachedByKey = new Map();
    cache.set(source, cachedByKey);
  }
  const cached = cachedByKey.get(cacheKey);
  if (cached) {
    return cached;
  }
  const ordered = order(source);
  cachedByKey.set(cacheKey, ordered);
  return ordered;
}

function splitOrderedTail(params: {
  orderedTail: StreamRenderRow[];
  platform: "web" | "native";
  isMobileBreakpoint: boolean;
}): Pick<AgentStreamRenderModel, "history" | "segments"> {
  const { orderedTail, platform, isMobileBreakpoint } = params;
  const shouldSplitHistory =
    platform === "web" &&
    !isMobileBreakpoint &&
    orderedTail.length > getWebPartialVirtualizationThreshold();
  const cacheKey = `${platform}:${isMobileBreakpoint}:${getWebMountedRecentStreamItems()}:${shouldSplitHistory}`;
  let cachedByKey = splitHistoryCache.get(orderedTail);
  if (!cachedByKey) {
    cachedByKey = new Map();
    splitHistoryCache.set(orderedTail, cachedByKey);
  }
  const cached = cachedByKey.get(cacheKey);
  if (cached) {
    return cached;
  }

  if (!shouldSplitHistory) {
    const unsplit = {
      history: orderedTail,
      segments: {
        historyVirtualized: EMPTY_STREAM_ROWS,
        historyMounted: orderedTail,
        liveHead: EMPTY_STREAM_ROWS,
      },
    } satisfies Pick<AgentStreamRenderModel, "history" | "segments">;
    cachedByKey.set(cacheKey, unsplit);
    return unsplit;
  }

  const mountedWindowStart = findMountedWindowStart({
    rows: orderedTail,
    minMountedCount: getWebMountedRecentStreamItems(),
  });
  const split = {
    history: orderedTail,
    segments: {
      historyVirtualized: orderedTail.slice(0, mountedWindowStart),
      historyMounted: orderedTail.slice(mountedWindowStart),
      liveHead: EMPTY_STREAM_ROWS,
    },
  } satisfies Pick<AgentStreamRenderModel, "history" | "segments">;
  cachedByKey.set(cacheKey, split);
  return split;
}

function getTurnTiming(params: {
  isTurnActive: boolean;
  activeTurnStartedAt: Date | null;
  tail: StreamItem[];
  head: StreamItem[];
}): StreamTurnTiming {
  let cachedByHead = turnTimingCache.get(params.tail);
  if (!cachedByHead) {
    cachedByHead = new WeakMap();
    turnTimingCache.set(params.tail, cachedByHead);
  }
  let cachedByActivity = cachedByHead.get(params.head);
  if (!cachedByActivity) {
    cachedByActivity = new Map();
    cachedByHead.set(params.head, cachedByActivity);
  }
  const activityKey = `${params.isTurnActive}:${params.activeTurnStartedAt?.getTime() ?? "none"}`;
  const cached = cachedByActivity.get(activityKey);
  if (cached) {
    return cached;
  }
  const timing = deriveStreamTurnTiming(params);
  cachedByActivity.set(activityKey, timing);
  return timing;
}

/** Builds the single top-level row model consumed by both Web and Native stream strategies. */
export function buildAgentStreamRenderModel(
  input: BuildAgentStreamRenderModelInput,
): AgentStreamRenderModel {
  const turnTiming = getTurnTiming({
    isTurnActive: input.isTurnActive,
    activeTurnStartedAt: input.activeTurnStartedAt,
    tail: input.tail,
    head: input.head,
  });
  const projected = projectActivityRows({
    tail: input.tail,
    head: input.head,
    isTurnActive: input.isTurnActive,
    turnTiming,
    activityFolds: input.activityFolds ?? [],
  });
  const strategy = resolveStreamRenderStrategy({
    platform: input.platform === "web" ? "web" : "native",
    isMobileBreakpoint: input.isMobileBreakpoint,
  });
  const orderingCacheKey = `${input.platform}:${input.isMobileBreakpoint}`;
  const orderedTail = getOrderedRows({
    cache: orderedTailCache,
    source: projected.tail,
    cacheKey: orderingCacheKey,
    order: (rows) =>
      orderTailForStreamRenderStrategy({
        strategy,
        streamItems: rows,
      }),
  });
  const orderedHead = getOrderedRows({
    cache: orderedHeadCache,
    source: projected.head,
    cacheKey: orderingCacheKey,
    order: (rows) =>
      orderHeadForStreamRenderStrategy({
        strategy,
        streamHead: rows,
      }),
  });
  const splitHistory = splitOrderedTail({
    orderedTail,
    platform: input.platform,
    isMobileBreakpoint: input.isMobileBreakpoint,
  });

  return {
    history: splitHistory.history,
    segments: {
      ...splitHistory.segments,
      liveHead: orderedHead,
    },
    turnTiming,
    boundary: {
      hasVirtualizedHistory: splitHistory.segments.historyVirtualized.length > 0,
      hasMountedHistory: splitHistory.segments.historyMounted.length > 0,
      hasLiveHead: orderedHead.length > 0,
    },
    auxiliary: EMPTY_AUXILIARY,
  };
}
