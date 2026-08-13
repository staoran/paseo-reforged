import { describe, expect, it } from "vitest";

import {
  FetchAgentTimelineRequestMessageSchema,
  FetchAgentTimelineResponseMessageSchema,
} from "./messages.js";

const REVISION = "43a2674e-081c-4f20-8bca-9de7699dc419";

describe("timeline summary/detail wire contract", () => {
  it("keeps the legacy projection field while accepting a summary request", () => {
    const parsed = FetchAgentTimelineRequestMessageSchema.parse({
      type: "fetch_agent_timeline_request",
      agentId: "agent-1",
      requestId: "summary-1",
      projection: "projected",
      projectionRequest: { kind: "summary" },
    });

    expect(parsed.projection).toBe("projected");
    expect(parsed.projectionRequest).toEqual({ kind: "summary" });
  });

  it("requires a positive bounded limit for activity detail", () => {
    const request = {
      type: "fetch_agent_timeline_request",
      agentId: "agent-1",
      requestId: "detail-1",
      projectionRequest: {
        kind: "activity_detail",
        epoch: "epoch-1",
        timelineRevision: REVISION,
        activityId: "activity:abc",
        sourceSeqRanges: [{ startSeq: 2, endSeq: 4 }],
        limit: 200,
      },
    } as const;

    expect(FetchAgentTimelineRequestMessageSchema.parse(request).projectionRequest).toEqual(
      request.projectionRequest,
    );
    expect(() =>
      FetchAgentTimelineRequestMessageSchema.parse({
        ...request,
        projectionRequest: { ...request.projectionRequest, limit: 0 },
      }),
    ).toThrow();
    expect(() =>
      FetchAgentTimelineRequestMessageSchema.parse({
        ...request,
        projectionRequest: { ...request.projectionRequest, limit: 201 },
      }),
    ).toThrow();
  });

  it("parses summary metadata without changing the legacy envelope", () => {
    const parsed = FetchAgentTimelineResponseMessageSchema.parse({
      type: "fetch_agent_timeline_response",
      payload: {
        requestId: "summary-1",
        agentId: "agent-1",
        agent: null,
        direction: "tail",
        projection: "projected",
        epoch: "epoch-1",
        reset: false,
        staleCursor: false,
        gap: false,
        window: { minSeq: 1, maxSeq: 4, nextSeq: 5 },
        startCursor: null,
        endCursor: null,
        hasOlder: false,
        hasNewer: false,
        entries: [],
        projectionPayload: {
          kind: "summary",
          epoch: "epoch-1",
          timelineRevision: REVISION,
          entries: [
            {
              provider: "mock",
              item: { type: "user_message", text: "Question", messageId: "user-1" },
              timestamp: "2026-08-09T00:00:00.000Z",
              seqStart: 1,
              seqEnd: 1,
              sourceSeqRanges: [{ startSeq: 1, endSeq: 1 }],
              collapsed: [],
            },
          ],
          activities: [
            {
              activityId: "activity:abc",
              timestamp: "2026-08-09T00:00:01.000Z",
              seqStart: 2,
              seqEnd: 3,
              sourceSeqRanges: [{ startSeq: 2, endSeq: 3 }],
            },
          ],
          hasOlderTurns: false,
        },
        error: null,
      },
    });

    expect(parsed.payload.entries).toEqual([]);
    expect(parsed.payload.projection).toBe("projected");
    expect(parsed.payload.projectionPayload?.kind).toBe("summary");
  });

  it("keeps detail business errors inside the projection payload", () => {
    const parsed = FetchAgentTimelineResponseMessageSchema.parse({
      type: "fetch_agent_timeline_response",
      payload: {
        requestId: "detail-1",
        agentId: "agent-1",
        agent: null,
        direction: "tail",
        projection: "projected",
        epoch: "epoch-1",
        reset: false,
        staleCursor: false,
        gap: false,
        window: { minSeq: 0, maxSeq: 0, nextSeq: 0 },
        startCursor: null,
        endCursor: null,
        hasOlder: false,
        hasNewer: false,
        entries: [],
        projectionPayload: {
          kind: "activity_detail",
          epoch: "epoch-1",
          timelineRevision: REVISION,
          activityId: "activity:abc",
          entries: [],
          nextCursor: null,
          hasMore: false,
          error: "Timeline revision changed",
        },
        error: null,
      },
    });

    expect(parsed.payload.error).toBeNull();
    expect(parsed.payload.projectionPayload).toMatchObject({
      kind: "activity_detail",
      error: "Timeline revision changed",
    });
  });
});
