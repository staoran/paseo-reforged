import type { StreamItem } from "@/types/stream";
import { getStreamItemMessageId } from "./presentation";

/** One explicit final answer closes this process segment */
export interface ActivityFold {
  /** Stable display identity independent from source row hydration */
  id: string;
  /** Source row that occupies the host's position in the timeline */
  hostMemberId: string;
  /** Process rows in chronological order */
  members: StreamItem[];
  /** The ending final answer has stopped streaming */
  completed: boolean;
  /** Elapsed time from the preceding boundary */
  durationMs: number | null;
}

/** Fold identity is the render signal for a retained top-level history row */
const hostItemsByFold = new WeakMap<ActivityFold, StreamItem>();

/** Keeps required user actions and errors visible when the process is collapsed */
export function isActivityMemberAlwaysVisible(item: StreamItem): boolean {
  return (
    item.kind === "plugin" ||
    (item.kind === "notification" && item.level === "error") ||
    (item.kind === "tool_call" &&
      item.payload.source === "agent" &&
      (item.payload.data.status === "running" ||
        item.payload.data.name === "request_user_input_async" ||
        item.payload.data.name === "request_user_input"))
  );
}

/** Retained history hosts rerender only when their content or completion changes */
function areActivityFoldsEqual(previous: ActivityFold, next: ActivityFold): boolean {
  return (
    previous.hostMemberId === next.hostMemberId &&
    previous.completed === next.completed &&
    previous.durationMs === next.durationMs &&
    previous.members.length === next.members.length &&
    previous.members.every((member, index) => member === next.members[index])
  );
}

interface RetainActivityFoldInput {
  agentId: string;
  boundaryKey: string | null;
  fallbackKey: string;
  members: StreamItem[];
  retained: ActivityFold | undefined;
  completed: boolean;
  durationMs: number | null;
}

/** Keeps one display identity while the source host changes during hydration */
function retainActivityFold(input: RetainActivityFoldInput): ActivityFold | null {
  const host =
    input.members.find((member) => member.id === input.retained?.hostMemberId) ?? input.members[0];
  if (!host) return null;
  const id =
    input.retained?.id ?? `activity:${input.agentId}:${input.boundaryKey ?? input.fallbackKey}`;
  const next = {
    id,
    hostMemberId: host.id,
    members: input.members,
    completed: input.completed,
    durationMs: input.durationMs,
  };
  return input.retained && areActivityFoldsEqual(input.retained, next) ? input.retained : next;
}

interface FinalCompletionInput {
  isTurnActive: boolean;
  hasLaterSegment: boolean;
  activeTurnId: string | null;
  finalTurnId: string | undefined;
}

/** An active final stays open until it stops streaming or a later segment appears */
function isActivityFinalComplete(input: FinalCompletionInput): boolean {
  return (
    !input.isTurnActive ||
    input.hasLaterSegment ||
    (input.activeTurnId !== null &&
      input.finalTurnId !== undefined &&
      input.finalTurnId !== input.activeTurnId)
  );
}

interface PendingMatchInput {
  previous: ActivityFold | null;
  boundaryAt: Date | null;
  completedAt: Date | null;
}

/** Newly loaded earlier boundaries must not claim the currently running host */
function getMatchingPending(input: PendingMatchInput): ActivityFold | undefined {
  if (!input.previous) return undefined;
  const lastMemberAt = input.previous.members.at(-1)!.timestamp.getTime();
  if (input.boundaryAt !== null && input.boundaryAt.getTime() > lastMemberAt) return undefined;
  if (input.completedAt !== null && input.completedAt.getTime() < lastMemberAt) return undefined;
  return input.previous;
}

/** Builds display folds without changing the source timeline or its lane ownership */
export function createActivityProjection() {
  /** Previous folds retain host identity when unrelated live text changes */
  let previous = new Map<string, ActivityFold>();
  /** The ending message preserves the host when older members are paginated in */
  let previousByFinal = new Map<string, ActivityFold>();
  /** The open segment can gain a final without replacing its display row */
  let previousPending: ActivityFold | null = null;
  /** Provider message IDs are scoped to the current conversation */
  let previousAgentId: string | null = null;
  return (input: {
    agentId: string;
    tail: StreamItem[];
    head: StreamItem[];
    isTurnActive: boolean;
    activeTurnId: string | null;
  }) => {
    if (previousAgentId !== input.agentId) {
      previous = new Map();
      previousByFinal = new Map();
      previousPending = null;
      previousAgentId = input.agentId;
    }
    /** Chronological presentation rows across the history/live boundary */
    const items = [...input.tail, ...input.head];
    /** Folds indexed by their stable display row */
    const folds = new Map<string, ActivityFold>();
    /** Final boundaries identify segments independently of their loaded start */
    const foldsByFinal = new Map<string, ActivityFold>();
    /** Last row for each source message keeps final lookup linear */
    const lastIndexByMessageId = new Map(
      items.map((item, index) => [getStreamItemMessageId(item), index]),
    );
    /** Non-final rows since the previous visible boundary */
    let members: StreamItem[] = [];
    /** Start time supplied by the user or preceding final answer */
    let startedAt: Date | null = null;
    /** A user message or prior final identifies the visible segment */
    let boundaryKey: string | null = null;
    /** Boundary time distinguishes prepended history from a newly started response */
    let boundaryAt: Date | null = null;
    /** A final message can own several Markdown block rows */
    let finalMessageId: string | null = null;
    /** A running host can be claimed by only one final in this projection */
    let unmatchedPending = previousPending;
    for (const item of items) {
      if (item.kind === "user_message") {
        members = [];
        startedAt = item.timestamp;
        boundaryKey = `user:${item.id}`;
        boundaryAt = item.timestamp;
        finalMessageId = null;
        continue;
      }
      if (item.kind !== "assistant_message" || item.phase !== "final_answer") {
        members.push(item);
        continue;
      }
      /** Source final identity, independent of Markdown block identity */
      const messageId = getStreamItemMessageId(item);
      if (messageId === finalMessageId) continue;
      finalMessageId = messageId;
      /** Retain the host across final arrival, hydration and pagination */
      const cached = previousByFinal.get(messageId);
      /** Later output proves an earlier final is no longer streaming */
      const lastFinalIndex = lastIndexByMessageId.get(messageId)!;
      const hasLaterSegment = lastFinalIndex < items.length - 1;
      /** Only the active ending final forces this segment open */
      const completed = isActivityFinalComplete({
        isTurnActive: input.isTurnActive,
        hasLaterSegment,
        activeTurnId: input.activeTurnId,
        finalTurnId: item.turnId,
      });
      /** Process duration ends at the latest block of this final */
      const completedAt = items[lastFinalIndex]!.timestamp;
      const matchedPending = getMatchingPending({
        previous: unmatchedPending,
        boundaryAt,
        completedAt,
      });
      const retained = cached ?? matchedPending;
      if (matchedPending && !cached) unmatchedPending = null;
      /** Unknown starts remain unknown on paginated history */
      const durationMs = startedAt
        ? Math.max(0, completedAt.getTime() - startedAt.getTime())
        : null;
      const fold = retainActivityFold({
        agentId: input.agentId,
        boundaryKey,
        fallbackKey: `initial-final:${messageId}`,
        members,
        retained,
        completed,
        durationMs,
      });
      if (fold) {
        folds.set(fold.id, fold);
        foldsByFinal.set(messageId, fold);
      }
      members = [];
      startedAt = completedAt;
      boundaryKey = `final:${messageId}`;
      boundaryAt = completedAt;
    }
    /** A reliable live commentary phase opens the host before the final arrives */
    let pending: ActivityFold | null = null;
    const isPendingActivity =
      input.isTurnActive &&
      members.some(
        (member) => member.kind === "assistant_message" && member.phase === "commentary",
      );
    if (isPendingActivity) {
      const cached = getMatchingPending({
        previous: unmatchedPending,
        boundaryAt,
        completedAt: null,
      });
      const fold = retainActivityFold({
        agentId: input.agentId,
        boundaryKey,
        fallbackKey: "pending",
        members,
        retained: cached,
        completed: false,
        durationMs: null,
      });
      if (fold) {
        folds.set(fold.id, fold);
        pending = fold;
      }
    }
    previousPending = pending;
    previousByFinal = foldsByFinal;
    if (
      folds.size === previous.size &&
      [...folds].every(([id, fold]) => previous.get(id) === fold)
    ) {
      return previous;
    }
    previous = folds;
    return previous;
  };
}

/** Projects a lane to one host per fold while retaining all ordinary rows */
export function projectActivityLane(
  items: StreamItem[],
  folds: ReadonlyMap<string, ActivityFold>,
): StreamItem[] {
  /** Members are removed only from the displayed top-level list */
  const hidden = new Set<string>();
  /** The source host row locates each fold in either history or live head */
  const foldsByMemberId = new Map<string, ActivityFold>();
  for (const fold of folds.values()) {
    foldsByMemberId.set(fold.hostMemberId, fold);
    for (const member of fold.members) {
      if (member.id !== fold.hostMemberId) hidden.add(member.id);
    }
  }
  if (folds.size === 0) return items;
  /** Ordinary rows keep identity while each changed fold revises only its host */
  const projected: StreamItem[] = [];
  for (const item of items) {
    if (hidden.has(item.id)) continue;
    const fold = foldsByMemberId.get(item.id);
    if (!fold) {
      projected.push(item);
      continue;
    }
    let host = hostItemsByFold.get(fold);
    if (!host) {
      host = { ...item, id: fold.id };
      hostItemsByFold.set(fold, host);
    }
    projected.push(host);
  }
  return projected.length === items.length &&
    projected.every((item, index) => item === items[index])
    ? items
    : projected;
}
