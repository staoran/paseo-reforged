import { describe, expect, it } from "vitest";
import {
  InMemoryAgentTimelineStore,
  InMemoryDurableAgentTimelineStore,
} from "./agent-timeline-store.js";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";

describe("InMemoryAgentTimelineStore", () => {
  it("clamps an overshooting before cursor into the bounded tail window", () => {
    const store = new InMemoryAgentTimelineStore();
    store.initialize("agent-1", {
      epoch: "epoch-1",
      nextSeq: 8,
      rows: [
        {
          seq: 5,
          timestamp: "2026-01-01T00:00:00.000Z",
          item: { type: "assistant_message", text: "five" },
        },
        {
          seq: 6,
          timestamp: "2026-01-01T00:00:01.000Z",
          item: { type: "assistant_message", text: "six" },
        },
        {
          seq: 7,
          timestamp: "2026-01-01T00:00:02.000Z",
          item: { type: "assistant_message", text: "seven" },
        },
      ],
    });

    const result = store.fetch("agent-1", {
      direction: "before",
      cursor: { epoch: "epoch-1", seq: 100 },
      limit: 2,
    });

    expect(result).toEqual({
      epoch: "epoch-1",
      direction: "before",
      reset: false,
      staleCursor: false,
      gap: false,
      window: { minSeq: 5, maxSeq: 7, nextSeq: 8 },
      hasOlder: true,
      hasNewer: false,
      rows: [
        {
          seq: 6,
          timestamp: "2026-01-01T00:00:01.000Z",
          item: { type: "assistant_message", text: "six" },
        },
        {
          seq: 7,
          timestamp: "2026-01-01T00:00:02.000Z",
          item: { type: "assistant_message", text: "seven" },
        },
      ],
    });
  });

  it("returns a bounded reset window when an after cursor is behind retained history", () => {
    const store = new InMemoryAgentTimelineStore();
    store.initialize("agent-1", {
      epoch: "epoch-1",
      nextSeq: 8,
      rows: [
        {
          seq: 5,
          timestamp: "2026-01-01T00:00:00.000Z",
          item: { type: "assistant_message", text: "five" },
        },
        {
          seq: 6,
          timestamp: "2026-01-01T00:00:01.000Z",
          item: { type: "assistant_message", text: "six" },
        },
        {
          seq: 7,
          timestamp: "2026-01-01T00:00:02.000Z",
          item: { type: "assistant_message", text: "seven" },
        },
      ],
    });

    const result = store.fetch("agent-1", {
      direction: "after",
      cursor: { epoch: "epoch-1", seq: 1 },
      limit: 1,
    });

    expect(result).toEqual({
      epoch: "epoch-1",
      direction: "after",
      reset: true,
      staleCursor: false,
      gap: true,
      window: { minSeq: 5, maxSeq: 7, nextSeq: 8 },
      hasOlder: true,
      hasNewer: false,
      rows: [
        {
          seq: 7,
          timestamp: "2026-01-01T00:00:02.000Z",
          item: { type: "assistant_message", text: "seven" },
        },
      ],
    });
  });
});

describe("InMemoryDurableAgentTimelineStore", () => {
  it("matches durable generation eligibility and bounded page semantics", async () => {
    const store = new InMemoryDurableAgentTimelineStore();
    await store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "replace",
      rows: durableRows(1, 4),
    });
    const committed = await store.commit("agent-1");

    await expect(
      store.getCoverage("agent-1", { expectedRevision: committed.timelineRevision }),
    ).resolves.toMatchObject({ eligible: true, active: committed, working: null });
    await expect(
      store.fetchCommittedPage("agent-1", {
        direction: "after",
        cursor: { epoch: "epoch-1", seq: 4 },
        limit: 2,
      }),
    ).resolves.toMatchObject({ rows: [], hasOlder: true, hasNewer: false });
    await expect(
      store.fetchCommittedPage("agent-1", {
        direction: "before",
        cursor: { epoch: "epoch-1", seq: 4 },
        limit: 2,
      }),
    ).resolves.toMatchObject({ rows: [{ seq: 2 }, { seq: 3 }], hasOlder: true, hasNewer: true });
  });

  it("keeps an incomplete generation blocked until an explicit replacement", async () => {
    const store = new InMemoryDurableAgentTimelineStore();
    await store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "replace",
      rows: durableRows(1, 1),
    });
    const committed = await store.commit("agent-1");
    await store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "append",
      rows: durableRows(2, 2),
    });
    await store.markIncomplete("agent-1");

    await expect(
      store.stageRows("agent-1", { epoch: "epoch-1", mode: "append", rows: [] }),
    ).rejects.toThrow("incomplete");
    await expect(
      store.getCoverage("agent-1", { expectedRevision: committed.timelineRevision }),
    ).resolves.toMatchObject({ eligible: false, working: { status: "incomplete" } });

    await store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "replace",
      rows: durableRows(1, 2),
    });
    const replacement = await store.commit("agent-1");
    await expect(
      store.getCoverage("agent-1", { expectedRevision: replacement.timelineRevision }),
    ).resolves.toMatchObject({ eligible: true, working: null });
  });
});

function durableRows(first: number, last: number): AgentTimelineRow[] {
  return Array.from({ length: last - first + 1 }, (_, index) => {
    const seq = first + index;
    return {
      seq,
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(),
      item: { type: "assistant_message", text: `row-${seq}` },
    };
  });
}
