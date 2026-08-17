import type { ActivityFold } from "@/agent-stream/model";
import type { ToolCallDetailLevel } from "@/hooks/use-settings/storage";
import type { StreamItem } from "@/types/stream";
import {
  groupLiveToolCalls,
  prepareGroupedHistory,
  type GroupedHistory,
  type GroupedToolCalls,
  type ToolCallGroupLookup,
} from "./grouping";
import {
  buildOverviewGroup,
  getToolCallGroupKind,
  type OverviewToolCallGroup,
} from "./overview/model";

export type { ToolCallDetailLevel } from "@/hooks/use-settings/storage";
export type ToolCallDetailGroup = OverviewToolCallGroup;

export interface PreparedToolCallHistory {
  mode: ToolCallDetailLevel;
  grouped: GroupedHistory<ToolCallDetailGroup>;
  activityFolds: ActivityFold[];
  activityGroupsByHostId: ToolCallGroupLookup<ToolCallDetailGroup>;
}

export interface ToolCallDetailProjection extends GroupedToolCalls<ToolCallDetailGroup> {
  activityFolds: ActivityFold[];
}

const EMPTY_TOOL_CALL_GROUPS = new Map<string, ToolCallDetailGroup>();
const combinedLookupCache = new WeakMap<
  object,
  WeakMap<object, ToolCallGroupLookup<ToolCallDetailGroup>>
>();

/** Creates a group builder that preserves the selected detail mode. */
function buildGroupForLevel(level: ToolCallDetailLevel) {
  return (run: Parameters<typeof buildOverviewGroup>[0]) => buildOverviewGroup(run, level);
}

/** Combines top-level and Activity group lookups while preserving stable identities. */
function combineGroupLookups(
  first: ToolCallGroupLookup<ToolCallDetailGroup>,
  second: ToolCallGroupLookup<ToolCallDetailGroup>,
): ToolCallGroupLookup<ToolCallDetailGroup> {
  if (first.size === 0) return second;
  if (second.size === 0) return first;

  let bySecond = combinedLookupCache.get(first);
  if (!bySecond) {
    bySecond = new WeakMap();
    combinedLookupCache.set(first, bySecond);
  }
  const cached = bySecond.get(second);
  if (cached) return cached;

  const combined: ToolCallGroupLookup<ToolCallDetailGroup> = {
    size: first.size + second.size,
    get: (id) => first.get(id) ?? second.get(id),
    has: (id) => first.has(id) || second.has(id),
    *keys() {
      yield* first.keys();
      yield* second.keys();
    },
  };
  bySecond.set(second, combined);
  return combined;
}

/** Projects loaded Activity members into the same grouped representation as the main timeline. */
function prepareActivityFolds(
  level: ToolCallDetailLevel,
  activityFolds: readonly ActivityFold[],
): {
  activityFolds: ActivityFold[];
  groupsByHostId: ToolCallGroupLookup<ToolCallDetailGroup>;
} {
  if (activityFolds.length === 0) {
    return { activityFolds: [], groupsByHostId: EMPTY_TOOL_CALL_GROUPS };
  }

  const buildGroup = buildGroupForLevel(level);
  const groupsByHostId = new Map<string, ToolCallDetailGroup>();
  let changed = false;
  const projectedFolds = activityFolds.map((fold) => {
    const grouped = prepareGroupedHistory({
      tail: fold.members,
      buildGroup,
      getGroupKey: getToolCallGroupKind,
    });
    if (grouped.groupsByHostId.size === 0) return fold;
    changed = true;
    for (const [hostId, group] of grouped.groupsByHostId) {
      groupsByHostId.set(hostId, group);
    }
    return { ...fold, members: grouped.tail };
  });

  return {
    activityFolds: changed ? projectedFolds : [...activityFolds],
    groupsByHostId,
  };
}

/** Prepares retained timeline and loaded Activity history for one detail mode. */
export function prepareToolCallHistory(
  level: ToolCallDetailLevel,
  tail: StreamItem[],
  activityFolds: readonly ActivityFold[] = [],
): PreparedToolCallHistory {
  const buildGroup = buildGroupForLevel(level);
  const preparedActivity = prepareActivityFolds(level, activityFolds);
  return {
    mode: level,
    grouped: prepareGroupedHistory({ tail, buildGroup, getGroupKey: getToolCallGroupKind }),
    activityFolds: preparedActivity.activityFolds,
    activityGroupsByHostId: preparedActivity.groupsByHostId,
  };
}

/** Projects the live head and combines it with prepared retained and Activity groups. */
export function projectToolCallDetailLevel(input: {
  level: ToolCallDetailLevel;
  tail: StreamItem[];
  head: StreamItem[];
  preparedHistory: PreparedToolCallHistory;
  isTurnActive: boolean;
}): ToolCallDetailProjection {
  if (input.preparedHistory.mode !== input.level) {
    throw new Error(`Missing prepared ${input.level} tool call history`);
  }
  const projected = groupLiveToolCalls({
    history: input.preparedHistory.grouped,
    head: input.head,
    isTurnActive: input.isTurnActive,
    buildGroup: buildGroupForLevel(input.level),
    getGroupKey: getToolCallGroupKind,
  });
  return {
    ...projected,
    groupsByHostId: combineGroupLookups(
      projected.groupsByHostId,
      input.preparedHistory.activityGroupsByHostId,
    ),
    activityFolds: input.preparedHistory.activityFolds,
  };
}
