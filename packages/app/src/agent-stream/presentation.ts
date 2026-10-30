import { createActivityProjection } from "./activity";
import type { ChatDisplay } from "@/hooks/use-settings";
import type { TimelineItemTransform } from "@/plugins/timeline/model";
import { projectPluginTimelineItems } from "@/plugins/timeline/projection";
import {
  prepareToolCallHistory,
  projectToolCallDetailLevel,
  type PreparedToolCallHistory,
  type ToolCallDetailLevel,
  type ToolCallDetailProjection,
} from "@/tool-calls/detail-level/projection";
import type { StreamItem, UserMessageItem } from "@/types/stream";
import { collapseTurns, type TurnCollapse } from "./turn-collapse/model";
import type { ReadingRowReplacements } from "./reading-anchor";

interface PresentationInput {
  tail: StreamItem[];
  head: StreamItem[];
  transform: TimelineItemTransform | undefined;
  display: ChatDisplay;
  /** Conversation identity scopes stable process headers */
  agentId?: string;
  /** Default expansion remains independent of thinking */
  autoExpandActivity?: boolean;
  /** Existing tool grouping remains meaningful inside process mode */
  toolCallDetailLevel?: ToolCallDetailLevel;
  /** Manual choices live only in the current view */
  turnExpansionOverrides?: ReadonlyMap<string, boolean>;
  autoExpandReasoning?: boolean;
  /** User messages whose collapsed turn the reader opened. */
  expandedTurnHostIds: ReadonlySet<string>;
  isTurnActive: boolean;
  activeTurnId?: string | null;
}

export interface StreamPresentation extends ToolCallDetailProjection {
  turns: Omit<TurnCollapse, "tail" | "head">;
  readingRowReplacements: ReadingRowReplacements;
}

function groupedRowHosts(
  rows: readonly StreamItem[],
  groups: ToolCallDetailProjection["groupsByHostId"],
): ReadonlyMap<string, string> {
  const hosts = new Map<string, string>();
  for (const row of rows) {
    const group = groups.get(row.id);
    if (!group) continue;
    for (const call of group.run.calls) {
      if (call.id !== row.id) hosts.set(call.id, row.id);
    }
  }
  return hosts;
}

const NO_COLLAPSED_TURNS: StreamPresentation["turns"] = collapseTurns({
  tail: [],
  head: [],
  activityFolds: new Map(),
  expandedHostIds: new Set(),
  getGroupedCalls: () => undefined,
});

/** Source messages reach plugins before display projection. */
export function createStreamPresentation() {
  const userMessageCache = new WeakMap<UserMessageItem, UserMessageItem>();

  function presentUserMessage(item: UserMessageItem): UserMessageItem {
    const cached = userMessageCache.get(item);
    if (cached) return cached;

    // Recognize the complete voice envelope, including older messages without the
    // instruction suffix. Leave quoted examples and unrelated XML untouched.
    const spokenInput =
      /^\s*<spoken-input>([\s\S]*?)<\/spoken-input>(?:\s*<instruction>This message was spoken by the user\.[\s\S]*?<\/instruction>)?\s*$/.exec(
        item.text,
      );
    const projected = spokenInput ? { ...item, text: spokenInput[1].trim() } : item;
    userMessageCache.set(item, projected);
    return projected;
  }

  let historySource: StreamItem[] | undefined;
  let historyTransform: TimelineItemTransform | undefined;
  let historyRows: StreamItem[] = [];
  let preparedTail: StreamItem[] | undefined;
  let preparedAutoExpandReasoning: boolean | undefined;
  let preparedLevel: ToolCallDetailLevel | undefined;
  let preparedHistory: PreparedToolCallHistory | null = null;
  let historyGroupHosts: ReadonlyMap<string, string> = new Map();
  /** Phase detection feeds the shared row projection rather than a second renderer */
  const projectActivities = createActivityProjection();

  function presentRows(item: StreamItem): StreamItem[] {
    if (item.kind === "tool_call" && item.payload.source === "agent") {
      const message = item.payload.data.agentMessage;
      if (message?.event === "message") {
        return [
          {
            kind: "user_message",
            id: item.id,
            turnId: item.turnId,
            timelineCursor: item.timelineCursor,
            timestamp: item.timestamp,
            text: message.text,
            sender: message.sender,
          },
        ];
      }
    }
    return [item.kind === "user_message" ? presentUserMessage(item) : item];
  }

  function collapse(
    projection: ToolCallDetailProjection,
    input: PresentationInput,
  ): Omit<StreamPresentation, "readingRowReplacements"> {
    if (input.display !== "collapseTurns") {
      return { ...projection, turns: NO_COLLAPSED_TURNS };
    }
    const getGroupedCalls = (itemId: string) => projection.groupsByHostId.get(itemId)?.run.calls;
    const expandRows = (rows: StreamItem[]) =>
      rows.flatMap((item) => [...(getGroupedCalls(item.id) ?? [item])]);
    const activityFolds = projectActivities({
      agentId: input.agentId ?? "presentation",
      tail: expandRows(projection.tail),
      head: expandRows(projection.head),
      isTurnActive:
        input.isTurnActive && !(input.activeTurnId === null && projection.head.length === 0),
      activeTurnId: input.activeTurnId ?? null,
    });
    const collapsed = collapseTurns({
      tail: projection.tail,
      head: projection.head,
      activityFolds,
      expandedHostIds: input.expandedTurnHostIds,
      expansionOverrides: input.turnExpansionOverrides,
      defaultExpanded: input.autoExpandActivity,
      getGroupedCalls,
    });
    const { tail, head, ...turns } = collapsed;
    if (turns.nestedItemIds.size === 0) return { ...projection, tail, head, turns };
    // Opening a turn reveals its raw calls; those rows must not become group hosts again.
    const withoutExpandedRows = (groups: StreamPresentation["groupsByHostId"]) => ({
      size: groups.size - [...turns.nestedItemIds].filter((id) => groups.has(id)).length,
      get: (id: string) => (turns.nestedItemIds.has(id) ? undefined : groups.get(id)),
      has: (id: string) => !turns.nestedItemIds.has(id) && groups.has(id),
    });
    return {
      ...projection,
      tail,
      head,
      turns,
      groupsByHostId: withoutExpandedRows(projection.groupsByHostId),
      historyGroupUpdatesByHostId: withoutExpandedRows(projection.historyGroupUpdatesByHostId),
    };
  }

  return (input: PresentationInput): StreamPresentation => {
    /** Process mode preserves the existing independent tool preference */
    let level: ToolCallDetailLevel = "overview";
    if (input.display === "collapseTurns") level = input.toolCallDetailLevel ?? "detailed";
    else if (input.display === "full") level = "detailed";
    // Retained history is not reprojected or regrouped on each live text update.
    if (historySource !== input.tail || historyTransform !== input.transform) {
      historyRows = projectPluginTimelineItems(input.tail, input.transform).flatMap<StreamItem>(
        (item) => presentRows(item),
      );
      historySource = input.tail;
      historyTransform = input.transform;
    }
    const head: StreamItem[] = [];
    for (const item of projectPluginTimelineItems(input.head, input.transform, "streaming")) {
      const blocks = presentRows(item);
      head.push(...blocks);
    }
    if (
      preparedTail !== historyRows ||
      preparedLevel !== level ||
      preparedAutoExpandReasoning !== input.autoExpandReasoning
    ) {
      preparedHistory = prepareToolCallHistory(level, historyRows, input.autoExpandReasoning);
      historyGroupHosts = preparedHistory
        ? groupedRowHosts(preparedHistory.grouped.tail, preparedHistory.grouped.groupsByHostId)
        : new Map();
      preparedTail = historyRows;
      preparedLevel = level;
      preparedAutoExpandReasoning = input.autoExpandReasoning;
    }
    const projection = projectToolCallDetailLevel({
      level,
      tail: historyRows,
      head,
      preparedHistory,
      isTurnActive: input.isTurnActive,
    });
    const result = collapse(projection, input);
    // Only the trailing retained group can absorb head rows. Reuse the retained
    // index across streaming updates rather than walking the full history again.
    const last = projection.tail.at(-1);
    const liveGroupHosts = groupedRowHosts(
      last ? [last, ...projection.head] : projection.head,
      projection.groupsByHostId,
    );
    const retainedGroupHosts = historyGroupHosts;
    return {
      ...result,
      readingRowReplacements: {
        get(id) {
          if (result.turns.nestedItemIds.has(id)) return undefined;
          const groupHost = liveGroupHosts.get(id) ?? retainedGroupHosts.get(id) ?? id;
          return (
            result.turns.hostIdByHiddenRowId.get(id) ??
            result.turns.hostIdByHiddenRowId.get(groupHost) ??
            (groupHost === id ? undefined : groupHost)
          );
        },
      },
    };
  };
}
