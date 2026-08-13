import { describe, expect, it, vi } from "vitest";

import type {
  AgentTimelineCommittedFetchOptions,
  AgentTimelineFetchResult,
  AgentTimelineRow,
} from "./agent-timeline-store-types.js";
import {
  SUMMARY_SCAN_MAX_ROWS,
  buildTimelineActivityId,
  readTimelineActivityDetail,
  readTimelineSummary,
} from "./timeline-summary-projection.js";

const REVISION = "43a2674e-081c-4f20-8bca-9de7699dc419";

function row(seq: number, item: AgentTimelineRow["item"]): AgentTimelineRow {
  return {
    seq,
    timestamp: new Date(Date.UTC(2026, 7, 9, 0, 0, seq)).toISOString(),
    item,
  };
}

function result(
  rows: AgentTimelineRow[],
  direction: AgentTimelineFetchResult["direction"] = "tail",
): AgentTimelineFetchResult {
  return {
    epoch: "epoch-1",
    direction,
    reset: false,
    staleCursor: false,
    gap: false,
    window: { minSeq: 1, maxSeq: 4, nextSeq: 5 },
    hasOlder: false,
    hasNewer: false,
    rows,
  };
}

function selectRowsForFetch(
  rows: readonly AgentTimelineRow[],
  options: AgentTimelineCommittedFetchOptions,
): AgentTimelineRow[] {
  const direction = options.direction ?? "tail";
  if (direction === "tail") return rows.slice(-options.limit);
  const cursorSeq = options.cursor?.seq ?? (rows.at(-1)?.seq ?? 0) + 1;
  if (direction === "before") {
    return rows.filter((entry) => entry.seq < cursorSeq).slice(-options.limit);
  }
  return rows.filter((entry) => entry.seq > cursorSeq).slice(0, options.limit);
}

describe("timeline summary projection", () => {
  it("returns only user/final entries and a stable descriptor for Activity rows", async () => {
    const fetchPage = vi.fn().mockResolvedValue(
      result([
        row(1, { type: "user_message", text: "Question", messageId: "user-1" }),
        row(2, { type: "reasoning", text: "private reasoning" }),
        row(3, {
          type: "tool_call",
          callId: "call-1",
          name: "Read",
          status: "completed",
          detail: { type: "read", path: "README.md" },
          error: null,
        }),
        row(4, {
          type: "assistant_message",
          text: "Answer",
          messageId: "assistant-1",
          phase: "final_answer",
        }),
      ]),
    );

    const summary = await readTimelineSummary({
      agentId: "agent-1",
      epoch: "epoch-1",
      timelineRevision: REVISION,
      window: { minSeq: 1, maxSeq: 4, nextSeq: 5 },
      fetchPage,
    });

    expect(summary?.entries.map((entry) => entry.item.type)).toEqual([
      "user_message",
      "assistant_message",
    ]);
    expect(JSON.stringify(summary)).not.toContain("private reasoning");
    expect(summary?.activities).toEqual([
      expect.objectContaining({
        activityId: buildTimelineActivityId({
          epoch: "epoch-1",
          timelineRevision: REVISION,
          sourceSeqRanges: [{ startSeq: 2, endSeq: 3 }],
        }),
        sourceSeqRanges: [{ startSeq: 2, endSeq: 3 }],
      }),
    ]);
  });

  it("fails closed when the bounded tail has no reliable final phase", async () => {
    const summary = await readTimelineSummary({
      agentId: "agent-1",
      epoch: "epoch-1",
      timelineRevision: REVISION,
      window: { minSeq: 1, maxSeq: 2, nextSeq: 3 },
      fetchPage: vi
        .fn()
        .mockResolvedValue(
          result([
            row(1, { type: "user_message", text: "Question" }),
            row(2, { type: "assistant_message", text: "Unphased answer" }),
          ]),
        ),
    });

    expect(summary).toBeNull();
  });

  it("fails closed when the row cap cannot reach twenty turn boundaries", async () => {
    const maxSeq = SUMMARY_SCAN_MAX_ROWS + 1;
    const rows = Array.from({ length: maxSeq }, (_, index) =>
      row(index + 1, { type: "reasoning", text: `reasoning-${index + 1}` }),
    );
    rows[maxSeq - 2] = row(maxSeq - 1, {
      type: "user_message",
      text: "Question",
      messageId: "user-cap",
    });
    rows[maxSeq - 1] = row(maxSeq, {
      type: "assistant_message",
      text: "Answer",
      messageId: "assistant-cap",
      phase: "final_answer",
    });
    const fetchPage = vi.fn(
      async (_agentId: string, options: AgentTimelineCommittedFetchOptions) => {
        const direction = options.direction ?? "tail";
        const selected = selectRowsForFetch(rows, options);
        return {
          epoch: "epoch-1",
          direction,
          reset: false,
          staleCursor: false,
          gap: false,
          window: { minSeq: 1, maxSeq, nextSeq: maxSeq + 1 },
          hasOlder: (selected[0]?.seq ?? 1) > 1,
          hasNewer: false,
          rows: selected,
        } satisfies AgentTimelineFetchResult;
      },
    );

    const summary = await readTimelineSummary({
      agentId: "agent-1",
      epoch: "epoch-1",
      timelineRevision: REVISION,
      window: { minSeq: 1, maxSeq, nextSeq: maxSeq + 1 },
      fetchPage,
    });

    expect(summary).toBeNull();
  });

  it("reads only descriptor rows and emits a bounded local cursor", async () => {
    const rows = [
      row(2, { type: "reasoning", text: "r1" }),
      row(3, { type: "reasoning", text: "r2" }),
      row(4, { type: "reasoning", text: "r3" }),
    ];
    const fetchPage = vi.fn(async (_agentId: string, options: AgentTimelineCommittedFetchOptions) =>
      result(selectRowsForFetch(rows, options), options.direction ?? "tail"),
    );
    const sourceSeqRanges = [{ startSeq: 2, endSeq: 4 }];
    const activityId = buildTimelineActivityId({
      epoch: "epoch-1",
      timelineRevision: REVISION,
      sourceSeqRanges,
    });

    const page = await readTimelineActivityDetail({
      agentId: "agent-1",
      epoch: "epoch-1",
      timelineRevision: REVISION,
      window: { minSeq: 1, maxSeq: 4, nextSeq: 5 },
      activityId,
      sourceSeqRanges,
      limit: 2,
      fetchPage,
    });

    expect(page.error).toBeNull();
    expect(page.entries.map((entry) => entry.seqStart)).toEqual([2, 3]);
    expect(page.nextCursor).toEqual({ epoch: "epoch-1", seq: 3 });
    expect(page.hasMore).toBe(true);
    expect(fetchPage).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({ direction: "after", limit: 2 }),
    );
  });

  it("rejects ranges whose stable activity id does not match", async () => {
    const page = await readTimelineActivityDetail({
      agentId: "agent-1",
      epoch: "epoch-1",
      timelineRevision: REVISION,
      window: { minSeq: 1, maxSeq: 4, nextSeq: 5 },
      activityId: "activity:stale",
      sourceSeqRanges: [{ startSeq: 2, endSeq: 3 }],
      limit: 2,
      fetchPage: vi.fn(),
    });

    expect(page).toMatchObject({ entries: [], hasMore: false, error: "Activity identity changed" });
  });
});
