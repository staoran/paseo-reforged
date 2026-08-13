import { describe, expect, it } from "vitest";
import type {
  AgentTimelineEntryPayload,
  AgentTimelineProjectionPayload,
} from "@getpaseo/protocol/messages";
import {
  applyActivityDetail,
  beginActivityDetail,
  buildProjectionDisplay,
  createAgentTimelineProjectionLane,
  failActivityDetail,
  getActivityDetailPageValidationError,
} from "./projection-lane";

const REVISION = "43a2674e-081c-4f20-8bca-9de7699dc419";
const EPOCH = "epoch-1";

function entry(seq: number, item: AgentTimelineEntryPayload["item"]): AgentTimelineEntryPayload {
  return {
    provider: "mock",
    item,
    timestamp: new Date(Date.UTC(2026, 7, 9, 0, 0, seq)).toISOString(),
    seqStart: seq,
    seqEnd: seq,
    sourceSeqRanges: [{ startSeq: seq, endSeq: seq }],
    collapsed: [],
  };
}

function summaryPayload(): Extract<AgentTimelineProjectionPayload, { kind: "summary" }> {
  return {
    kind: "summary",
    epoch: EPOCH,
    timelineRevision: REVISION,
    entries: [
      entry(1, { type: "user_message", text: "Question", messageId: "user-1" }),
      entry(4, {
        type: "assistant_message",
        text: "Answer",
        messageId: "assistant-1",
        phase: "final_answer",
      }),
    ],
    activities: [
      {
        activityId: "activity:one",
        timestamp: "2026-08-09T00:00:02.000Z",
        seqStart: 2,
        seqEnd: 3,
        sourceSeqRanges: [{ startSeq: 2, endSeq: 3 }],
      },
    ],
    hasOlderTurns: true,
  };
}

function detailPayload(
  entries: AgentTimelineEntryPayload[],
  input: {
    hasMore: boolean;
    nextCursor: { epoch: string; seq: number } | null;
    error?: string | null;
  },
): Extract<AgentTimelineProjectionPayload, { kind: "activity_detail" }> {
  return {
    kind: "activity_detail",
    epoch: EPOCH,
    timelineRevision: REVISION,
    activityId: "activity:one",
    entries,
    hasMore: input.hasMore,
    nextCursor: input.nextCursor,
    error: input.error ?? null,
  };
}

describe("agent timeline projection lane", () => {
  it("renders summary entries and a zero-byte Activity fold before expansion", () => {
    const lane = createAgentTimelineProjectionLane({
      agentId: "agent-1",
      payload: summaryPayload(),
    });
    const display = buildProjectionDisplay(lane);

    expect(display.items.map((item) => item.id)).toEqual(["user-1", "activity:one", "assistant-1"]);
    expect(display.activityFolds).toMatchObject([
      {
        id: "activity:one",
        detailStatus: "idle",
        members: [],
      },
    ]);
  });

  it("accumulates bounded pages and hydrates members only on the final page", () => {
    const lane = createAgentTimelineProjectionLane({
      agentId: "agent-1",
      payload: summaryPayload(),
    });
    const started = beginActivityDetail(lane, "activity:one", 200);
    expect(started?.request.cursor).toBeUndefined();
    if (!started) throw new Error("detail request was not created");

    const first = applyActivityDetail(started.lane, {
      activityId: "activity:one",
      generation: started.request.generation,
      payload: detailPayload([entry(2, { type: "reasoning", text: "private" })], {
        hasMore: true,
        nextCursor: { epoch: EPOCH, seq: 2 },
      }),
    });
    expect(first.activities.get("activity:one")?.members).toEqual([]);
    expect(first.activities.get("activity:one")?.status).toBe("loading");

    const second = applyActivityDetail(first, {
      activityId: "activity:one",
      generation: started.request.generation,
      payload: detailPayload(
        [
          entry(3, {
            type: "tool_call",
            callId: "call-1",
            name: "Read",
            status: "completed",
            detail: { type: "read", filePath: "README.md" },
            error: null,
          }),
        ],
        { hasMore: false, nextCursor: null },
      ),
    });
    expect(second.activities.get("activity:one")?.status).toBe("ready");
    expect(second.activities.get("activity:one")?.members.length).toBeGreaterThan(0);
    expect(second.activities.get("activity:one")?.rawEntries.map((item) => item.seqStart)).toEqual([
      2, 3,
    ]);
  });

  it("ignores stale generations and exposes a retryable local error", () => {
    const lane = createAgentTimelineProjectionLane({
      agentId: "agent-1",
      payload: summaryPayload(),
    });
    const first = beginActivityDetail(lane, "activity:one", 200);
    if (!first) throw new Error("detail request was not created");
    const stale = applyActivityDetail(first.lane, {
      activityId: "activity:one",
      generation: first.request.generation - 1,
      payload: detailPayload([], { hasMore: false, nextCursor: null }),
    });
    expect(stale).toBe(first.lane);

    const failed = failActivityDetail(first.lane, {
      activityId: "activity:one",
      generation: first.request.generation,
      error: "revision changed",
    });
    expect(failed.activities.get("activity:one")).toMatchObject({
      status: "error",
      error: "revision changed",
      members: [],
    });
    const retry = beginActivityDetail(failed, "activity:one", 200);
    expect(retry?.request.cursor).toBeUndefined();
  });

  it("rejects detail pages that skip or escape descriptor ranges", () => {
    const lane = createAgentTimelineProjectionLane({
      agentId: "agent-1",
      payload: summaryPayload(),
    });
    const started = beginActivityDetail(lane, "activity:one", 200);
    if (!started) throw new Error("detail request was not created");

    expect(
      getActivityDetailPageValidationError(
        started.request,
        detailPayload([entry(3, { type: "reasoning", text: "skipped seq two" })], {
          hasMore: false,
          nextCursor: null,
        }),
      ),
    ).toBe("Activity detail projection rows are invalid");
    expect(
      getActivityDetailPageValidationError(
        started.request,
        detailPayload([entry(2, { type: "user_message", text: "summary content" })], {
          hasMore: true,
          nextCursor: { epoch: EPOCH, seq: 2 },
        }),
      ),
    ).toBe("Activity detail projection rows are invalid");
  });
});
