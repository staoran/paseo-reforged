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

  it("discards only the owned working generation while preserving the active page", async () => {
    const store = new InMemoryDurableAgentTimelineStore();
    await store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "replace",
      rows: durableRows(1, 1),
    });
    const active = await store.commit("agent-1");
    await store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "append",
      rows: durableRows(2, 2),
    });
    const working = (await store.getCoverage("agent-1")).working;
    expect(working).not.toBeNull();

    await expect(store.discardWorking("agent-1", crypto.randomUUID())).resolves.toBe(false);
    await expect(store.discardWorking("agent-1", working!.generationId)).resolves.toBe(true);
    await expect(store.getCoverage("agent-1")).resolves.toMatchObject({
      active,
      working: null,
    });
    await expect(
      store.fetchCommittedPage("agent-1", { direction: "tail", limit: 10 }),
    ).resolves.toMatchObject({ rows: [{ seq: 1 }] });
  });

  it("restores complete active and working registration snapshots", async () => {
    /** Durable store under test. */
    const store = new InMemoryDurableAgentTimelineStore();
    /** Stable Agent identity for the registration snapshot. */
    const agentId = "agent-registration-snapshot";
    await store.stageRows(agentId, {
      epoch: "epoch-1",
      mode: "replace",
      rows: durableRows(1, 2),
    });
    /** Active generation visible before registration begins. */
    const active = await store.commit(agentId);
    await store.stageRows(agentId, {
      epoch: "epoch-1",
      mode: "append",
      rows: durableRows(3, 3),
    });
    /** Complete active and working state captured before registration mutates it. */
    const snapshot = await store.captureRegistrationSnapshot(agentId);
    /** Generation identity owned by the provisional registration write. */
    const ownedGenerationId = "00000000-0000-4000-8000-000000000201";
    await store.stageRows(agentId, {
      generationId: ownedGenerationId,
      expectedCurrent: {
        exists: snapshot.exists,
        activeGenerationId: snapshot.active?.generationId ?? null,
        workingGenerationId: snapshot.working?.generationId ?? null,
        invalidGenerationIds: snapshot.invalidGenerationIds,
      },
      epoch: "epoch-registration",
      mode: "replace",
      rows: [durableRows(1, 1)[0]!],
    });

    await store.restoreRegistrationSnapshot(agentId, snapshot, {
      ownedGenerationIds: [ownedGenerationId],
    });
    await expect(store.getCoverage(agentId)).resolves.toMatchObject({
      active,
      working: { generationId: snapshot.working?.generationId, epoch: "epoch-1" },
    });
    await store.commit(agentId, snapshot.working!.generationId);
    await expect(
      store.fetchCommittedPage(agentId, { direction: "tail", limit: 10 }),
    ).resolves.toMatchObject({ rows: [{ seq: 1 }, { seq: 2 }, { seq: 3 }] });
  });

  it("rejects stale registration stage, commit, and rollback ownership", async () => {
    /** Durable store under test. */
    const store = new InMemoryDurableAgentTimelineStore();
    /** Stable Agent identity for all ownership transitions. */
    const agentId = "agent-registration-ownership";
    await store.stageRows(agentId, {
      epoch: "epoch-1",
      mode: "replace",
      rows: durableRows(1, 1),
    });
    /** Baseline active generation captured by registration. */
    const active = await store.commit(agentId);
    /** Registration snapshot used by a later stale rollback attempt. */
    const snapshot = await store.captureRegistrationSnapshot(agentId);
    /** First registration-owned working generation. */
    const ownedGenerationId = "00000000-0000-4000-8000-000000000202";
    await store.stageRows(agentId, {
      generationId: ownedGenerationId,
      expectedCurrent: {
        exists: true,
        activeGenerationId: active.generationId,
        workingGenerationId: null,
        invalidGenerationIds: [],
      },
      epoch: "epoch-owned",
      mode: "replace",
      rows: [durableRows(1, 1)[0]!],
    });
    /** Foreign generation that supersedes the registration-owned working pointer. */
    const foreignGenerationId = "00000000-0000-4000-8000-000000000203";
    await store.stageRows(agentId, {
      generationId: foreignGenerationId,
      epoch: "epoch-foreign",
      mode: "replace",
      rows: [durableRows(1, 1)[0]!],
    });

    await expect(
      store.stageRows(agentId, {
        generationId: "00000000-0000-4000-8000-000000000204",
        expectedCurrent: {
          exists: true,
          activeGenerationId: active.generationId,
          workingGenerationId: ownedGenerationId,
          invalidGenerationIds: [],
        },
        epoch: "epoch-stale",
        mode: "replace",
        rows: [],
      }),
    ).rejects.toThrow("selection changed");
    await expect(store.commit(agentId, ownedGenerationId)).rejects.toThrow("ownership changed");
    await expect(
      store.restoreRegistrationSnapshot(agentId, snapshot, {
        ownedGenerationIds: [ownedGenerationId],
      }),
    ).rejects.toThrow("ownership changed");
    await expect(store.getCoverage(agentId)).resolves.toMatchObject({
      active,
      working: { generationId: foreignGenerationId, epoch: "epoch-foreign" },
    });
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
