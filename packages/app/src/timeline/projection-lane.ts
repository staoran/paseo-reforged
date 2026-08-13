import type {
  AgentTimelineActivityDescriptorPayload,
  AgentTimelineEntryPayload,
  AgentTimelineProjectionPayload,
  AgentStreamEventPayload,
} from "@getpaseo/protocol/messages";
import { hydrateStreamState, type StreamItem } from "@/types/stream";
import type { ActivityFold } from "@/agent-stream/model";

interface AgentTimelineCursor {
  epoch: string;
  seq: number;
}

export type ActivityDetailStatus = "idle" | "loading" | "ready" | "error";

export interface ActivityProjectionState {
  descriptor: AgentTimelineActivityDescriptorPayload;
  status: ActivityDetailStatus;
  error: string | null;
  members: StreamItem[];
  rawEntries: AgentTimelineEntryPayload[];
  nextCursor: AgentTimelineCursor | null;
  generation: number;
}

export interface AgentTimelineProjectionLane {
  agentId: string;
  epoch: string;
  timelineRevision: string;
  summaryEntries: AgentTimelineEntryPayload[];
  activities: Map<string, ActivityProjectionState>;
  hasOlderTurns: boolean;
  generation: number;
  canonicalReplacementPending: boolean;
}

export interface ProjectionDisplay {
  items: StreamItem[];
  activityFolds: ActivityFold[];
}

export interface ActivityDetailRequest {
  activityId: string;
  epoch: string;
  timelineRevision: string;
  sourceSeqRanges: AgentTimelineActivityDescriptorPayload["sourceSeqRanges"];
  cursor?: AgentTimelineCursor;
  limit: number;
  generation: number;
}

export interface TimelineProjectionAgentState {
  status: "initializing" | "idle" | "running" | "error" | "closed";
  pendingPermissions?: readonly unknown[];
  lastError?: string | null;
  attentionReason?: string | null;
}

export function isTimelineProjectionAgentStateCompatible(
  agent: TimelineProjectionAgentState | undefined,
): boolean {
  if (!agent) return true;
  return (
    (agent.status === "idle" || agent.status === "closed") &&
    !(typeof agent.lastError === "string" && agent.lastError.trim().length > 0) &&
    agent.attentionReason !== "permission" &&
    (agent.pendingPermissions?.length ?? 0) === 0
  );
}

type ActivityDetailPayload = Extract<AgentTimelineProjectionPayload, { kind: "activity_detail" }>;

function nextActivitySeq(
  ranges: AgentTimelineActivityDescriptorPayload["sourceSeqRanges"],
  afterSeq: number,
): number | null {
  for (const range of ranges) {
    if (afterSeq < range.startSeq) return range.startSeq;
    if (afterSeq < range.endSeq) return afterSeq + 1;
  }
  return null;
}

// Identity, range, and cursor checks intentionally form one validation gate.
// eslint-disable-next-line complexity
export function getActivityDetailPageValidationError(
  request: ActivityDetailRequest,
  payload: ActivityDetailPayload,
): string | null {
  if (
    payload.activityId !== request.activityId ||
    payload.epoch !== request.epoch ||
    payload.timelineRevision !== request.timelineRevision
  ) {
    return "Activity detail projection identity changed";
  }
  if (payload.error) return null;
  if (payload.entries.length > request.limit) {
    return "Activity detail projection exceeded its page limit";
  }

  let previousSeq =
    request.cursor?.seq ?? Math.min(...request.sourceSeqRanges.map((range) => range.startSeq)) - 1;
  for (const entry of payload.entries) {
    const expectedSeq = nextActivitySeq(request.sourceSeqRanges, previousSeq);
    const canonicalRange = entry.sourceSeqRanges[0];
    if (
      expectedSeq === null ||
      entry.seqStart !== expectedSeq ||
      entry.seqEnd !== expectedSeq ||
      entry.sourceSeqRanges.length !== 1 ||
      canonicalRange?.startSeq !== expectedSeq ||
      canonicalRange?.endSeq !== expectedSeq ||
      entry.item.type === "user_message" ||
      (entry.item.type === "assistant_message" && entry.item.phase === "final_answer")
    ) {
      return "Activity detail projection rows are invalid";
    }
    previousSeq = expectedSeq;
  }

  const descriptorHasMore = nextActivitySeq(request.sourceSeqRanges, previousSeq) !== null;
  if (payload.hasMore !== descriptorHasMore) {
    return "Activity detail projection range is incomplete";
  }
  if (
    payload.hasMore &&
    (!payload.nextCursor ||
      payload.nextCursor.epoch !== request.epoch ||
      payload.nextCursor.seq !== previousSeq)
  ) {
    return "Activity detail projection cursor did not advance";
  }
  if (!payload.hasMore && payload.nextCursor !== null) {
    return "Activity detail projection cursor is invalid";
  }
  return null;
}

function toTimelineEvent(entry: AgentTimelineEntryPayload): {
  event: AgentStreamEventPayload;
  timestamp: Date;
} {
  return {
    event: {
      type: "timeline",
      provider: entry.provider,
      item: entry.item,
    } as AgentStreamEventPayload,
    timestamp: new Date(entry.timestamp),
  };
}

function hydrateEntries(
  entries: readonly AgentTimelineEntryPayload[],
  epoch: string,
): StreamItem[] {
  return hydrateStreamState(
    entries.map((entry) => ({
      ...toTimelineEvent(entry),
      timelineCursor: { epoch, seq: entry.seqEnd },
    })),
    { source: "canonical" },
  );
}

function createActivityPlaceholder(
  descriptor: AgentTimelineActivityDescriptorPayload,
  epoch: string,
): StreamItem {
  return {
    kind: "thought",
    id: descriptor.activityId,
    text: "",
    status: "ready",
    timestamp: new Date(descriptor.timestamp),
    timelineCursor: { epoch, seq: descriptor.seqEnd },
  };
}

function sortBySequence<T extends { seqStart: number; seqEnd: number }>(entries: T[]): T[] {
  return [...entries].sort(
    (left, right) => left.seqStart - right.seqStart || left.seqEnd - right.seqEnd,
  );
}

function copyActivities(
  activities: ReadonlyMap<string, ActivityProjectionState>,
): Map<string, ActivityProjectionState> {
  return new Map(
    [...activities.entries()].map(([activityId, activity]) => [
      activityId,
      {
        ...activity,
        descriptor: {
          ...activity.descriptor,
          sourceSeqRanges: activity.descriptor.sourceSeqRanges.map((range) => ({ ...range })),
        },
        members: [...activity.members],
        rawEntries: [...activity.rawEntries],
        nextCursor: activity.nextCursor ? { ...activity.nextCursor } : null,
      },
    ]),
  );
}

export function createAgentTimelineProjectionLane(input: {
  agentId: string;
  payload: Extract<AgentTimelineProjectionPayload, { kind: "summary" }>;
}): AgentTimelineProjectionLane {
  const activities = new Map<string, ActivityProjectionState>();
  for (const descriptor of input.payload.activities) {
    activities.set(descriptor.activityId, {
      descriptor,
      status: "idle",
      error: null,
      members: [],
      rawEntries: [],
      nextCursor: null,
      generation: 0,
    });
  }
  return {
    agentId: input.agentId,
    epoch: input.payload.epoch,
    timelineRevision: input.payload.timelineRevision,
    summaryEntries: sortBySequence(input.payload.entries),
    activities,
    hasOlderTurns: input.payload.hasOlderTurns,
    generation: 1,
    canonicalReplacementPending: false,
  };
}

export function beginActivityDetail(
  lane: AgentTimelineProjectionLane,
  activityId: string,
  limit: number,
): { lane: AgentTimelineProjectionLane; request: ActivityDetailRequest } | null {
  const current = lane.activities.get(activityId);
  if (!current || current.status === "loading") return null;
  const generation = current.generation + 1;
  const activities = copyActivities(lane.activities);
  activities.set(activityId, {
    ...current,
    status: "loading",
    error: null,
    members: [],
    rawEntries: [],
    nextCursor: null,
    generation,
  });
  const nextLane = { ...lane, activities, generation: lane.generation + 1 };
  return {
    lane: nextLane,
    request: {
      activityId,
      epoch: lane.epoch,
      timelineRevision: lane.timelineRevision,
      sourceSeqRanges: current.descriptor.sourceSeqRanges,
      limit,
      generation,
    },
  };
}

export function applyActivityDetail(
  lane: AgentTimelineProjectionLane,
  input: {
    activityId: string;
    generation: number;
    payload: ActivityDetailPayload;
  },
): AgentTimelineProjectionLane {
  const current = lane.activities.get(input.activityId);
  if (
    !current ||
    current.generation !== input.generation ||
    input.payload.activityId !== input.activityId ||
    input.payload.epoch !== lane.epoch ||
    input.payload.timelineRevision !== lane.timelineRevision
  ) {
    return lane;
  }
  const activities = copyActivities(lane.activities);
  if (input.payload.error) {
    activities.set(input.activityId, {
      ...current,
      status: "error",
      error: input.payload.error,
      members: [],
      rawEntries: [],
      nextCursor: null,
    });
    return { ...lane, activities, generation: lane.generation + 1 };
  }

  const bySeq = new Map<string, AgentTimelineEntryPayload>();
  for (const entry of [...current.rawEntries, ...input.payload.entries]) {
    bySeq.set(`${entry.seqStart}:${entry.seqEnd}`, entry);
  }
  const rawEntries = sortBySequence([...bySeq.values()]);
  if (input.payload.hasMore) {
    activities.set(input.activityId, {
      ...current,
      status: "loading",
      error: null,
      members: [],
      rawEntries,
      nextCursor: input.payload.nextCursor,
    });
    return { ...lane, activities, generation: lane.generation + 1 };
  }

  activities.set(input.activityId, {
    ...current,
    status: "ready",
    error: null,
    members: hydrateEntries(rawEntries, lane.epoch),
    rawEntries,
    nextCursor: null,
  });
  return { ...lane, activities, generation: lane.generation + 1 };
}

export function failActivityDetail(
  lane: AgentTimelineProjectionLane,
  input: { activityId: string; generation: number; error: string },
): AgentTimelineProjectionLane {
  const current = lane.activities.get(input.activityId);
  if (!current || current.generation !== input.generation) {
    return lane;
  }
  const activities = copyActivities(lane.activities);
  activities.set(input.activityId, {
    ...current,
    status: "error",
    error: input.error,
    members: [],
    rawEntries: [],
    nextCursor: null,
  });
  return { ...lane, activities, generation: lane.generation + 1 };
}

export function markProjectionCanonicalReplacementPending(
  lane: AgentTimelineProjectionLane,
): AgentTimelineProjectionLane {
  return lane.canonicalReplacementPending ? lane : { ...lane, canonicalReplacementPending: true };
}

export function buildProjectionDisplay(lane: AgentTimelineProjectionLane): ProjectionDisplay {
  const positioned: Array<{ seqStart: number; seqEnd: number; item: StreamItem }> = [];
  for (const entry of lane.summaryEntries) {
    for (const item of hydrateEntries([entry], lane.epoch)) {
      positioned.push({ seqStart: entry.seqStart, seqEnd: entry.seqEnd, item });
    }
  }
  const activityFolds: ActivityFold[] = [];
  for (const activity of lane.activities.values()) {
    positioned.push({
      seqStart: activity.descriptor.seqStart,
      seqEnd: activity.descriptor.seqEnd,
      item: createActivityPlaceholder(activity.descriptor, lane.epoch),
    });
    activityFolds.push({
      id: activity.descriptor.activityId,
      completed: true,
      hostItemId: activity.descriptor.activityId,
      memberIds: activity.members.map((item) => item.id),
      members: activity.members,
      detailStatus: activity.status,
      detailError: activity.error,
    });
  }
  positioned.sort((left, right) => left.seqStart - right.seqStart || left.seqEnd - right.seqEnd);
  return { items: positioned.map(({ item }) => item), activityFolds };
}
