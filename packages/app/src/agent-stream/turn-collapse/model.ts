import { isTurnTrigger } from "../turn-membership";
import { isActivityMemberAlwaysVisible, type ActivityFold } from "../activity";
import {
  getStreamItemMessageId,
  type StreamItem,
  type ThoughtItem,
  type ToolCallItem,
} from "@/types/stream";
import { summarizeToolCalls, type OverviewSummary } from "@/tool-calls/detail-level/overview/model";

export interface TurnSummary {
  /** Action counts remain available to tool presentation consumers */
  tools: OverviewSummary;
}

export interface CollapsedTurn {
  /** Stable process header identity across pagination and completion */
  hostId: string;
  /** Effective expansion includes the independent default and live-work gate */
  expanded: boolean;
  /** Only a stopped explicit final completes a process */
  completed: boolean;
  /** Unknown paginated starts retain an unknown duration */
  durationMs: number | null;
  /** Tools performed before the explicit final */
  summary: TurnSummary;
}

export interface TurnCollapse {
  /** Retained rows remain in their original lane */
  tail: StreamItem[];
  /** Live rows remain live across the history boundary */
  head: StreamItem[];
  /** Process headers rendered by the shared row pipeline */
  turnsByHostId: ReadonlyMap<string, CollapsedTurn>;
  /** Expanded process members use real virtualized rows */
  nestedItemIds: ReadonlySet<string>;
  /** Search reveals the process before locating its source row */
  hostIdByFoldedMessageId: ReadonlyMap<string, string>;
  /** Closed process replacements preserve the reader's anchor */
  hostIdByHiddenRowId: ReadonlyMap<string, string>;
}

export interface CollapseTurnsInput {
  /** Tool-projected retained history */
  tail: StreamItem[];
  /** Tool-projected live output */
  head: StreamItem[];
  /** Explicit phase boundaries from the original presentation rows */
  activityFolds: ReadonlyMap<string, ActivityFold>;
  /** Explicit opens used by search and presentation callers */
  expandedHostIds: ReadonlySet<string>;
  /** View-local manual choices can close a default-open process */
  expansionOverrides?: ReadonlyMap<string, boolean>;
  /** Independent default for completed processes */
  defaultExpanded?: boolean;
  /** A projected tool host can represent several original rows */
  getGroupedCalls: (itemId: string) => readonly (ToolCallItem | ThoughtItem)[] | undefined;
}

/** Header identity changes only with its content or effective expansion */
const headerRows = new WeakMap<ActivityFold, Map<boolean, StreamItem>>();

/** Preserves important actions outside a closed process */
function staysVisible(item: StreamItem): boolean {
  return isTurnTrigger(item) || item.kind === "compaction" || isActivityMemberAlwaysVisible(item);
}

/** Projects F07 phase segments once into the upstream virtualized row contract */
export function collapseTurns(input: CollapseTurnsInput): TurnCollapse {
  const turnsByHostId = new Map<string, CollapsedTurn>();
  const nestedItemIds = new Set<string>();
  const hostIdByFoldedMessageId = new Map<string, string>();
  const hostIdByHiddenRowId = new Map<string, string>();
  const foldsByMember = new Map<string, ActivityFold>();
  for (const fold of input.activityFolds.values()) {
    const expanded =
      !fold.completed ||
      (input.expansionOverrides?.get(fold.id) ??
        (input.expandedHostIds.has(fold.id) || input.defaultExpanded === true));
    const calls = fold.members.filter(
      (item): item is ToolCallItem | ThoughtItem =>
        (item.kind === "tool_call" || item.kind === "thought") && !isTurnTrigger(item),
    );
    turnsByHostId.set(fold.id, {
      hostId: fold.id,
      expanded,
      completed: fold.completed,
      durationMs: fold.durationMs,
      summary: { tools: summarizeToolCalls(calls) },
    });
    for (const member of fold.members) foldsByMember.set(member.id, fold);
  }

  /** Expands grouped calls only where a phase segment owns their source rows */
  function projectLane(lane: StreamItem[]): StreamItem[] {
    const output: StreamItem[] = [];
    for (const row of lane) {
      const members = input.getGroupedCalls(row.id) ?? [row];
      if (!members.some((member) => foldsByMember.has(member.id))) {
        output.push(row);
        continue;
      }
      for (const member of members) {
        const fold = foldsByMember.get(member.id);
        if (!fold) {
          output.push(member);
          continue;
        }
        const turn = turnsByHostId.get(fold.id)!;
        if (member.id === fold.hostMemberId) {
          let variants = headerRows.get(fold);
          if (!variants) {
            variants = new Map();
            headerRows.set(fold, variants);
          }
          let header = variants.get(turn.expanded);
          if (!header) {
            header = { ...member, id: fold.id };
            variants.set(turn.expanded, header);
          }
          output.push(header);
        }
        const alwaysVisible = staysVisible(member);
        if (!alwaysVisible) hostIdByFoldedMessageId.set(getStreamItemMessageId(member), fold.id);
        if (turn.expanded || alwaysVisible) {
          output.push(member);
          nestedItemIds.add(member.id);
        } else {
          hostIdByHiddenRowId.set(member.id, fold.id);
        }
      }
    }
    return output.length === lane.length && output.every((row, index) => row === lane[index])
      ? lane
      : output;
  }

  const tail = projectLane(input.tail);
  const head = projectLane(input.head);
  return { tail, head, turnsByHostId, nestedItemIds, hostIdByFoldedMessageId, hostIdByHiddenRowId };
}
