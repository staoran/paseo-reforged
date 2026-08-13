import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  FileAgentTimelineStore,
  type FileAgentTimelineStoreFaultPoint,
} from "./file-agent-timeline-store.js";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FileAgentTimelineStore", () => {
  it("commits and restarts with positive-limit tail, before, and after pages", async () => {
    const root = await createRoot();
    const store = new FileAgentTimelineStore(root, { segmentRowLimit: 2 });
    await store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "replace",
      rows: rows(1, 5),
    });
    const committed = await store.commit("agent-1");

    const restarted = new FileAgentTimelineStore(root, { segmentRowLimit: 2 });
    await expect(
      restarted.getCoverage("agent-1", { expectedRevision: committed.timelineRevision }),
    ).resolves.toMatchObject({ eligible: true, active: committed, working: null });
    await expect(
      restarted.fetchCommittedPage("agent-1", { direction: "tail", limit: 2 }),
    ).resolves.toMatchObject({
      epoch: "epoch-1",
      rows: [{ seq: 4 }, { seq: 5 }],
      hasOlder: true,
      hasNewer: false,
    });
    await expect(
      restarted.fetchCommittedPage("agent-1", {
        direction: "before",
        cursor: { epoch: "epoch-1", seq: 4 },
        limit: 2,
      }),
    ).resolves.toMatchObject({ rows: [{ seq: 2 }, { seq: 3 }], hasOlder: true, hasNewer: true });
    await expect(
      restarted.fetchCommittedPage("agent-1", {
        direction: "after",
        cursor: { epoch: "epoch-1", seq: 2 },
        limit: 2,
      }),
    ).resolves.toMatchObject({ rows: [{ seq: 3 }, { seq: 4 }], hasNewer: true });
    await expect(
      restarted.fetchCommittedPage("agent-1", { direction: "tail", limit: 0 }),
    ).rejects.toThrow("positive integer");
  });

  it("keeps the old active page readable but ineligible while a generation is working", async () => {
    const root = await createRoot();
    const store = new FileAgentTimelineStore(root);
    await store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "replace",
      rows: rows(1, 1),
    });
    const first = await store.commit("agent-1");
    await store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "append",
      rows: rows(2, 2),
    });

    await expect(
      store.getCoverage("agent-1", { expectedRevision: first.timelineRevision }),
    ).resolves.toMatchObject({ eligible: false, active: first, working: { status: "building" } });
    await expect(
      store.fetchCommittedPage("agent-1", { direction: "tail", limit: 10 }),
    ).resolves.toMatchObject({ rows: [{ seq: 1 }] });

    await store.markIncomplete("agent-1");
    await expect(store.commit("agent-1")).rejects.toThrow("incomplete");
  });

  it("leaves a fail-closed working marker when a segment write fails", async () => {
    const root = await createRoot();
    const seed = new FileAgentTimelineStore(root);
    await seed.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "replace",
      rows: rows(1, 1),
    });
    const first = await seed.commit("agent-1");

    let failAt: FileAgentTimelineStoreFaultPoint | null = "segment";
    const failing = new FileAgentTimelineStore(root, {
      segmentRowLimit: 1,
      faultInjector: (point) => {
        if (point === failAt) {
          failAt = null;
          throw new Error("injected segment failure");
        }
      },
    });
    await expect(
      failing.stageRows("agent-1", {
        epoch: "epoch-1",
        mode: "append",
        rows: rows(2, 2),
      }),
    ).rejects.toThrow("injected segment failure");

    const restarted = new FileAgentTimelineStore(root);
    await expect(
      restarted.getCoverage("agent-1", { expectedRevision: first.timelineRevision }),
    ).resolves.toMatchObject({
      eligible: false,
      active: first,
      working: { status: "incomplete" },
    });
    await expect(
      restarted.fetchCommittedPage("agent-1", { direction: "tail", limit: 1 }),
    ).resolves.toMatchObject({ rows: [{ seq: 1 }] });
  });

  it("publishes an incomplete working marker when the working pointer boundary fails", async () => {
    const root = await createRoot();
    const seed = new FileAgentTimelineStore(root);
    await seed.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "replace",
      rows: rows(1, 1),
    });
    const first = await seed.commit("agent-1");

    let failAt: FileAgentTimelineStoreFaultPoint | null = "working_pointer";
    const failing = new FileAgentTimelineStore(root, {
      faultInjector: (point) => {
        if (point === failAt) {
          failAt = null;
          throw new Error("injected working pointer failure");
        }
      },
    });
    await expect(
      failing.stageRows("agent-1", {
        epoch: "epoch-1",
        mode: "append",
        rows: rows(2, 2),
      }),
    ).rejects.toThrow("working pointer failure");

    const restarted = new FileAgentTimelineStore(root);
    await expect(
      restarted.getCoverage("agent-1", { expectedRevision: first.timelineRevision }),
    ).resolves.toMatchObject({
      eligible: false,
      active: first,
      working: { status: "incomplete" },
    });
    await expect(
      restarted.fetchCommittedPage("agent-1", { direction: "tail", limit: 1 }),
    ).resolves.toMatchObject({ rows: [{ seq: 1 }] });
  });

  it("invalidates eligibility after a selected segment fails checksum validation", async () => {
    const root = await createRoot();
    const store = new FileAgentTimelineStore(root, { segmentRowLimit: 1 });
    await store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "replace",
      rows: rows(1, 2),
    });
    const committed = await store.commit("agent-1");
    const segmentPath = await findFirstSegment(root);
    const original = await readFile(segmentPath, "utf8");
    await writeFile(segmentPath, original.replace("row-1", "row-X"), "utf8");

    const restarted = new FileAgentTimelineStore(root, { segmentRowLimit: 1 });
    await expect(
      restarted.getCoverage("agent-1", { expectedRevision: committed.timelineRevision }),
    ).resolves.toMatchObject({ eligible: false, active: { valid: false } });
    await expect(
      restarted.fetchCommittedPage("agent-1", { direction: "before", limit: 2 }),
    ).rejects.toThrow();
  });

  it("keeps the old active generation readable but ineligible when active pointer commit fails", async () => {
    const root = await createRoot();
    const seed = new FileAgentTimelineStore(root);
    await seed.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "replace",
      rows: rows(1, 1),
    });
    const first = await seed.commit("agent-1");

    let failAt: FileAgentTimelineStoreFaultPoint | null = "active_pointer";
    const failing = new FileAgentTimelineStore(root, {
      faultInjector: (point) => {
        if (point === failAt) {
          failAt = null;
          throw new Error("injected active pointer failure");
        }
      },
    });
    await failing.stageRows("agent-1", {
      epoch: "epoch-2",
      mode: "replace",
      rows: [row(1, "replacement")],
    });
    await expect(failing.commit("agent-1")).rejects.toThrow("active pointer failure");

    const restarted = new FileAgentTimelineStore(root);
    await expect(
      restarted.getCoverage("agent-1", { expectedRevision: first.timelineRevision }),
    ).resolves.toMatchObject({
      eligible: false,
      active: first,
      working: { status: "incomplete" },
    });
    await expect(
      restarted.fetchCommittedPage("agent-1", { direction: "tail", limit: 1 }),
    ).resolves.toMatchObject({ rows: [{ seq: 1, item: { text: "row-1" } }] });
  });

  it("atomically replaces epochs and resets stale cursors", async () => {
    const root = await createRoot();
    const store = new FileAgentTimelineStore(root);
    await store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "replace",
      rows: rows(1, 2),
    });
    await store.commit("agent-1");
    await store.stageRows("agent-1", {
      epoch: "epoch-2",
      mode: "replace",
      rows: [row(1, "replacement")],
    });
    await store.commit("agent-1");

    await expect(
      store.fetchCommittedPage("agent-1", {
        direction: "after",
        cursor: { epoch: "epoch-1", seq: 2 },
        limit: 10,
      }),
    ).resolves.toMatchObject({
      epoch: "epoch-2",
      reset: true,
      staleCursor: true,
      rows: [{ seq: 1, item: { text: "replacement" } }],
    });
  });

  it("serializes concurrent appends and copy-on-write staged updates", async () => {
    const root = await createRoot();
    const store = new FileAgentTimelineStore(root, { segmentRowLimit: 2 });
    await store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "replace",
      rows: rows(1, 1),
    });
    await store.commit("agent-1");

    const second = store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "append",
      rows: rows(2, 2),
    });
    const third = store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "append",
      rows: rows(3, 3),
    });
    await Promise.all([second, third]);
    await store.updateStagedRow("agent-1", {
      epoch: "epoch-1",
      row: { ...row(2), providerMessageId: "provider-2" },
    });
    await store.commit("agent-1");

    await expect(
      store.fetchCommittedPage("agent-1", { direction: "tail", limit: 3 }),
    ).resolves.toMatchObject({
      rows: [{ seq: 1 }, { seq: 2, providerMessageId: "provider-2" }, { seq: 3 }],
    });
  });

  it("commits empty history and physically deletes all generations", async () => {
    const root = await createRoot();
    const store = new FileAgentTimelineStore(root);
    await store.stageRows("agent-1", { epoch: "epoch-empty", mode: "replace", rows: [] });
    const committed = await store.commit("agent-1");
    await expect(
      store.fetchCommittedPage("agent-1", { direction: "tail", limit: 1 }),
    ).resolves.toMatchObject({
      epoch: "epoch-empty",
      window: { minSeq: 0, maxSeq: 0, nextSeq: 1 },
      rows: [],
    });
    await expect(
      store.getCoverage("agent-1", { expectedRevision: committed.timelineRevision }),
    ).resolves.toMatchObject({ eligible: true });

    await store.deleteAgent("agent-1");
    await expect(store.getCoverage("agent-1")).resolves.toEqual({
      active: null,
      working: null,
      eligible: false,
    });
  });
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-timeline-store-"));
  roots.push(root);
  return root;
}

function rows(first: number, last: number): AgentTimelineRow[] {
  return Array.from({ length: last - first + 1 }, (_, index) => row(first + index));
}

function row(seq: number, text = `row-${seq}`): AgentTimelineRow {
  return {
    seq,
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(),
    item: { type: "assistant_message", text },
  };
}

async function findFirstSegment(root: string): Promise<string> {
  const [agentDirectory] = await readdir(root);
  if (!agentDirectory) throw new Error("expected timeline agent directory");
  const segmentsDirectory = path.join(root, agentDirectory, "segments");
  const [segment] = await readdir(segmentsDirectory);
  if (!segment) throw new Error("expected timeline segment");
  return path.join(segmentsDirectory, segment);
}
