import { createHash } from "node:crypto";
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

  it("bounds working segment files without deleting the active generation", async () => {
    /** Isolated filesystem root for the bounded-growth scenario. */
    const root = await createRoot();
    /** Store under test with a small segment limit that forces tail replacement. */
    const store = new FileAgentTimelineStore(root, { segmentRowLimit: 4 });
    await store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "replace",
      rows: rows(1, 2),
    });
    await store.commit("agent-1");

    /** seq is the next row appended while the working generation remains open. */
    for (let seq = 3; seq <= 6; seq += 1) {
      await store.stageRows("agent-1", {
        epoch: "epoch-1",
        mode: "append",
        rows: rows(seq, seq),
      });
    }

    await expect(listSegmentFiles(root)).resolves.toHaveLength(3);
    await expect(
      store.fetchCommittedPage("agent-1", { direction: "tail", limit: 10 }),
    ).resolves.toMatchObject({ rows: [{ seq: 1 }, { seq: 2 }] });
  });

  it("reclaims a replaced staged segment without deleting active references", async () => {
    /** Isolated filesystem root for the staged-row replacement scenario. */
    const root = await createRoot();
    /** Store under test with one active segment and one mutable working segment. */
    const store = new FileAgentTimelineStore(root, { segmentRowLimit: 2 });
    await store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "replace",
      rows: rows(1, 2),
    });
    await store.commit("agent-1");
    await store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "append",
      rows: rows(3, 3),
    });

    await store.updateStagedRow("agent-1", {
      epoch: "epoch-1",
      row: { ...row(3), providerMessageId: "provider-3" },
    });

    await expect(listSegmentFiles(root)).resolves.toHaveLength(2);
    await expect(
      store.fetchCommittedPage("agent-1", { direction: "tail", limit: 10 }),
    ).resolves.toMatchObject({ rows: [{ seq: 1 }, { seq: 2 }] });
  });

  it("reclaims a superseded working generation after replacement is published", async () => {
    /** Isolated filesystem root for the working-generation replacement scenario. */
    const root = await createRoot();
    /** Store under test with deterministic two-row segment boundaries. */
    const store = new FileAgentTimelineStore(root, { segmentRowLimit: 2 });
    await store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "replace",
      rows: rows(1, 2),
    });
    await store.commit("agent-1");
    await store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "append",
      rows: rows(3, 3),
    });

    await store.stageRows("agent-1", {
      epoch: "epoch-2",
      mode: "replace",
      rows: [row(1, "replacement")],
    });

    await expect(listSegmentFiles(root)).resolves.toHaveLength(2);
    await expect(
      store.fetchCommittedPage("agent-1", { direction: "tail", limit: 10 }),
    ).resolves.toMatchObject({ epoch: "epoch-1", rows: [{ seq: 1 }, { seq: 2 }] });
    await expect(store.getCoverage("agent-1")).resolves.toMatchObject({
      eligible: false,
      working: { epoch: "epoch-2", status: "building" },
    });
  });

  it("keeps a published stage successful when deletion fails and retries next mutation", async () => {
    /** Isolated filesystem root for the deletion-retry scenario. */
    const root = await createRoot();
    /** Number of injected deletion attempts that must fail before retry succeeds. */
    let remainingDeleteFailures = 1;
    /** Store under test with a one-shot segment-deletion fault. */
    const store = new FileAgentTimelineStore(root, {
      segmentRowLimit: 2,
      faultInjector: (point) => {
        if (point === "segment_delete" && remainingDeleteFailures > 0) {
          remainingDeleteFailures -= 1;
          throw new Error("injected segment delete failure");
        }
      },
    });
    await store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "replace",
      rows: rows(1, 2),
    });
    await store.commit("agent-1");
    await store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "append",
      rows: rows(3, 3),
    });

    await expect(
      store.stageRows("agent-1", {
        epoch: "epoch-1",
        mode: "append",
        rows: rows(4, 4),
      }),
    ).resolves.toBeUndefined();
    await expect(listSegmentFiles(root)).resolves.toHaveLength(3);
    await expect(store.getCoverage("agent-1")).resolves.toMatchObject({
      eligible: false,
      working: { status: "building" },
    });

    await store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "append",
      rows: rows(5, 5),
    });
    await expect(listSegmentFiles(root)).resolves.toHaveLength(3);
  });

  it("recovers after interruption between manifest publication and segment reclamation", async () => {
    /** Isolated filesystem root shared across the simulated restart. */
    const root = await createRoot();
    /** Whether the next post-publication boundary should simulate process interruption. */
    let interruptAfterPublication = false;
    /** Store instance interrupted after durable manifest publication. */
    const store = new FileAgentTimelineStore(root, {
      segmentRowLimit: 2,
      faultInjector: (point) => {
        if (point === "working_manifest_published" && interruptAfterPublication) {
          interruptAfterPublication = false;
          throw new Error("injected interruption after working manifest publication");
        }
      },
    });
    await store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "replace",
      rows: rows(1, 2),
    });
    /** Active generation that must remain readable through the interruption. */
    const active = await store.commit("agent-1");
    await store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "append",
      rows: rows(3, 3),
    });

    interruptAfterPublication = true;
    await expect(
      store.stageRows("agent-1", {
        epoch: "epoch-1",
        mode: "append",
        rows: rows(4, 4),
      }),
    ).rejects.toThrow("interruption after working manifest publication");
    await expect(listSegmentFiles(root)).resolves.toHaveLength(3);

    /** Fresh store instance that performs lazy orphan discovery after interruption. */
    const restarted = new FileAgentTimelineStore(root, { segmentRowLimit: 2 });
    await expect(
      restarted.getCoverage("agent-1", { expectedRevision: active.timelineRevision }),
    ).resolves.toMatchObject({
      active,
      eligible: false,
      working: { status: "building" },
    });
    await restarted.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "append",
      rows: rows(5, 5),
    });
    await expect(listSegmentFiles(root)).resolves.toHaveLength(3);

    /** Generation committed after recovery and continued staging. */
    const committed = await restarted.commit("agent-1");
    /** Second restart used to verify durable committed coverage and paging. */
    const reopened = new FileAgentTimelineStore(root, { segmentRowLimit: 2 });
    await expect(
      reopened.getCoverage("agent-1", { expectedRevision: committed.timelineRevision }),
    ).resolves.toMatchObject({ active: committed, eligible: true, working: null });
    await expect(
      reopened.fetchCommittedPage("agent-1", { direction: "tail", limit: 2 }),
    ).resolves.toMatchObject({ rows: [{ seq: 4 }, { seq: 5 }], hasOlder: true });
    await expect(
      reopened.fetchCommittedPage("agent-1", {
        direction: "before",
        cursor: { epoch: "epoch-1", seq: 4 },
        limit: 2,
      }),
    ).resolves.toMatchObject({ rows: [{ seq: 2 }, { seq: 3 }], hasNewer: true });
    await expect(
      reopened.fetchCommittedPage("agent-1", {
        direction: "after",
        cursor: { epoch: "epoch-1", seq: 2 },
        limit: 2,
      }),
    ).resolves.toMatchObject({ rows: [{ seq: 3 }, { seq: 4 }], hasNewer: true });
  });

  it("retries an orphan left by working manifest publication failure", async () => {
    /** Isolated filesystem root for the append publication-failure scenario. */
    const root = await createRoot();
    /** Whether the next working-manifest publication should fail. */
    let failWorkingManifest = false;
    /** Store under test with a one-shot working-manifest fault. */
    const store = new FileAgentTimelineStore(root, {
      segmentRowLimit: 2,
      faultInjector: (point) => {
        if (point === "working_manifest" && failWorkingManifest) {
          failWorkingManifest = false;
          throw new Error("injected working manifest failure");
        }
      },
    });
    await store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "replace",
      rows: rows(1, 2),
    });
    await store.commit("agent-1");
    await store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "append",
      rows: rows(3, 3),
    });

    failWorkingManifest = true;
    await expect(
      store.stageRows("agent-1", {
        epoch: "epoch-1",
        mode: "append",
        rows: rows(4, 4),
      }),
    ).rejects.toThrow("working manifest failure");
    await expect(listSegmentFiles(root)).resolves.toHaveLength(3);
    await expect(store.getCoverage("agent-1")).resolves.toMatchObject({
      eligible: false,
      working: { status: "incomplete" },
    });

    await store.markIncomplete("agent-1");
    await expect(listSegmentFiles(root)).resolves.toHaveLength(2);
  });

  it("retries a staged update orphan after manifest publication failure", async () => {
    /** Isolated filesystem root for the staged-update publication failure. */
    const root = await createRoot();
    /** Whether the next staged-update manifest publication should fail. */
    let failWorkingManifest = false;
    /** Store under test with a one-shot staged-update publication fault. */
    const store = new FileAgentTimelineStore(root, {
      segmentRowLimit: 2,
      faultInjector: (point) => {
        if (point === "working_manifest" && failWorkingManifest) {
          failWorkingManifest = false;
          throw new Error("injected staged update manifest failure");
        }
      },
    });
    await store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "replace",
      rows: rows(1, 2),
    });
    await store.commit("agent-1");
    await store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "append",
      rows: rows(3, 3),
    });

    failWorkingManifest = true;
    await expect(
      store.updateStagedRow("agent-1", {
        epoch: "epoch-1",
        row: { ...row(3), providerMessageId: "provider-3" },
      }),
    ).rejects.toThrow("staged update manifest failure");
    await expect(listSegmentFiles(root)).resolves.toHaveLength(3);

    await store.markIncomplete("agent-1");
    await expect(listSegmentFiles(root)).resolves.toHaveLength(2);
  });

  it("retries old and new orphans after replacement manifest publication fails", async () => {
    /** Isolated filesystem root for the replacement publication failure. */
    const root = await createRoot();
    /** Whether the working pointer currently belongs to the replacement attempt. */
    let replacingWorking = false;
    /** Whether the manifest publication following the replacement pointer should fail. */
    let failNextWorkingManifest = false;
    /** Store under test with coordinated pointer and manifest fault state. */
    const store = new FileAgentTimelineStore(root, {
      segmentRowLimit: 2,
      faultInjector: (point) => {
        if (point === "working_pointer" && replacingWorking) {
          replacingWorking = false;
          failNextWorkingManifest = true;
        } else if (point === "working_manifest" && failNextWorkingManifest) {
          failNextWorkingManifest = false;
          throw new Error("injected replacement manifest failure");
        }
      },
    });
    await store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "replace",
      rows: rows(1, 2),
    });
    await store.commit("agent-1");
    await store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "append",
      rows: rows(3, 3),
    });

    replacingWorking = true;
    await expect(
      store.stageRows("agent-1", {
        epoch: "epoch-2",
        mode: "replace",
        rows: [row(1, "replacement")],
      }),
    ).rejects.toThrow("replacement manifest failure");
    await expect(listSegmentFiles(root)).resolves.toHaveLength(3);

    await store.markIncomplete("agent-1");
    await expect(listSegmentFiles(root)).resolves.toHaveLength(1);
    await expect(
      store.fetchCommittedPage("agent-1", { direction: "tail", limit: 10 }),
    ).resolves.toMatchObject({ epoch: "epoch-1", rows: [{ seq: 1 }, { seq: 2 }] });
  });

  it("lazily sweeps hash-addressed orphans but leaves unknown files untouched", async () => {
    /** Isolated filesystem root for orphan discovery and unknown-file retention. */
    const root = await createRoot();
    /** Seed store that creates the committed reference set before restart. */
    const seed = new FileAgentTimelineStore(root);
    await seed.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "replace",
      rows: rows(1, 1),
    });
    await seed.commit("agent-1");
    /** Hash-addressed orphan expected to be discovered and removed. */
    const orphan = await writeOrphanSegment(root);
    await writeFile(path.join(await findSegmentsDirectory(root), "notes.json"), "{}", "utf8");

    /** Fresh store instance that performs the first lazy sweep. */
    const restarted = new FileAgentTimelineStore(root);
    await restarted.markIncomplete("agent-1");

    /** Physical files remaining after the lazy sweep. */
    const files = await listSegmentFiles(root);
    expect(files).not.toContain(orphan);
    expect(files).toContain("notes.json");
    expect(files).toHaveLength(2);
  });

  it("does not sweep any segment when the Agent state is malformed", async () => {
    /** Isolated filesystem root for malformed-state fail-closed behavior. */
    const root = await createRoot();
    /** Seed store that creates one referenced segment and one later orphan. */
    const seed = new FileAgentTimelineStore(root);
    await seed.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "replace",
      rows: rows(1, 1),
    });
    await seed.commit("agent-1");
    await writeOrphanSegment(root);
    await writeFile(path.join(await findAgentDirectory(root), "state.json"), "{", "utf8");
    /** Physical segment snapshot that must remain unchanged. */
    const before = await listSegmentFiles(root);

    /** Fresh store instance that encounters the malformed state. */
    const restarted = new FileAgentTimelineStore(root);
    await expect(restarted.markIncomplete("agent-1")).rejects.toThrow();
    await expect(listSegmentFiles(root)).resolves.toEqual(before);
  });

  it("does not sweep any segment when the current active manifest is malformed", async () => {
    /** Isolated filesystem root for malformed-active-manifest behavior. */
    const root = await createRoot();
    /** Seed store that creates the active manifest before corruption. */
    const seed = new FileAgentTimelineStore(root);
    await seed.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "replace",
      rows: rows(1, 1),
    });
    await seed.commit("agent-1");
    await writeOrphanSegment(root);
    /** Path to the manifest selected by the active generation pointer. */
    const activeManifest = await findCurrentManifest(root, "activeGenerationId");
    /** Parsed active manifest used to introduce a deterministic range defect. */
    const manifest = JSON.parse(await readFile(activeManifest, "utf8")) as Record<string, unknown>;
    await writeFile(activeManifest, JSON.stringify({ ...manifest, nextSeq: 99 }, null, 2), "utf8");
    /** Physical segment snapshot that must remain unchanged. */
    const before = await listSegmentFiles(root);

    /** Fresh store instance that encounters the malformed active manifest. */
    const restarted = new FileAgentTimelineStore(root);
    await restarted.markIncomplete("agent-1");
    await expect(listSegmentFiles(root)).resolves.toEqual(before);
  });

  it("does not sweep any segment when the current working manifest is malformed", async () => {
    /** Isolated filesystem root for malformed-working-manifest behavior. */
    const root = await createRoot();
    /** Seed store that creates distinct active and working segments. */
    const seed = new FileAgentTimelineStore(root, { segmentRowLimit: 1 });
    await seed.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "replace",
      rows: rows(1, 1),
    });
    await seed.commit("agent-1");
    await seed.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "append",
      rows: rows(2, 2),
    });
    await writeOrphanSegment(root);
    await writeFile(await findCurrentManifest(root, "workingGenerationId"), "{", "utf8");
    /** Physical segment snapshot that must remain unchanged. */
    const before = await listSegmentFiles(root);

    /** Fresh store instance that encounters the malformed working manifest. */
    const restarted = new FileAgentTimelineStore(root, { segmentRowLimit: 1 });
    await restarted.markIncomplete("agent-1");
    await expect(listSegmentFiles(root)).resolves.toEqual(before);
  });

  it("starts a fresh lazy sweep lifecycle after an Agent is deleted and recreated", async () => {
    /** Isolated filesystem root reused by the deleted and recreated Agent. */
    const root = await createRoot();
    /** Store under test whose per-Agent sweep marker must reset on deletion. */
    const store = new FileAgentTimelineStore(root);
    await store.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "replace",
      rows: rows(1, 1),
    });
    await store.commit("agent-1");
    await store.deleteAgent("agent-1");

    await store.stageRows("agent-1", {
      epoch: "epoch-2",
      mode: "replace",
      rows: rows(1, 1),
    });
    await writeOrphanSegment(root);
    await store.commit("agent-1");

    await expect(listSegmentFiles(root)).resolves.toHaveLength(1);
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

  it("sweeps an orphan written before a later segment in the same append fails", async () => {
    /** Isolated filesystem root for the partial multi-segment append failure. */
    const root = await createRoot();
    /** Seed store that creates the active generation before the failing append. */
    const seed = new FileAgentTimelineStore(root, { segmentRowLimit: 1 });
    await seed.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "replace",
      rows: rows(1, 1),
    });
    await seed.commit("agent-1");

    /** Number of segment write boundaries observed by the fault injector. */
    let segmentWrites = 0;
    /** Store instance that fails the second segment write in one append. */
    const failing = new FileAgentTimelineStore(root, {
      segmentRowLimit: 1,
      faultInjector: (point) => {
        if (point === "segment") {
          segmentWrites += 1;
          if (segmentWrites === 2) throw new Error("injected second segment failure");
        }
      },
    });
    await expect(
      failing.stageRows("agent-1", {
        epoch: "epoch-1",
        mode: "append",
        rows: rows(2, 3),
      }),
    ).rejects.toThrow("second segment failure");
    await expect(listSegmentFiles(root)).resolves.toHaveLength(2);

    await failing.markIncomplete("agent-1");
    await expect(listSegmentFiles(root)).resolves.toHaveLength(1);
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

  it("retries a superseded working orphan after replacement pointer failure", async () => {
    /** Isolated filesystem root for the replacement-pointer failure. */
    const root = await createRoot();
    /** Seed store that creates both active and working generations. */
    const seed = new FileAgentTimelineStore(root, { segmentRowLimit: 1 });
    await seed.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "replace",
      rows: rows(1, 1),
    });
    await seed.commit("agent-1");
    await seed.stageRows("agent-1", {
      epoch: "epoch-1",
      mode: "append",
      rows: rows(2, 2),
    });

    /** Whether the next replacement working-pointer publication should fail. */
    let failWorkingPointer = true;
    /** Store instance that injects the one-shot replacement pointer failure. */
    const failing = new FileAgentTimelineStore(root, {
      segmentRowLimit: 1,
      faultInjector: (point) => {
        if (point === "working_pointer" && failWorkingPointer) {
          failWorkingPointer = false;
          throw new Error("injected replacement pointer failure");
        }
      },
    });
    await expect(
      failing.stageRows("agent-1", {
        epoch: "epoch-2",
        mode: "replace",
        rows: rows(1, 1),
      }),
    ).rejects.toThrow("replacement pointer failure");
    await expect(listSegmentFiles(root)).resolves.toHaveLength(2);

    await failing.markIncomplete("agent-1");
    await expect(listSegmentFiles(root)).resolves.toHaveLength(1);
    await expect(
      failing.fetchCommittedPage("agent-1", { direction: "tail", limit: 1 }),
    ).resolves.toMatchObject({ epoch: "epoch-1", rows: [{ seq: 1 }] });
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
  /** Physical segment directory belonging to the test Agent. */
  const segmentsDirectory = await findSegmentsDirectory(root);
  /** First physical segment entry selected for corruption tests. */
  const [segment] = await readdir(segmentsDirectory);
  if (!segment) throw new Error("expected timeline segment");
  return path.join(segmentsDirectory, segment);
}

/** Lists the physical segment files for the single Agent created by each test. */
async function listSegmentFiles(root: string): Promise<string[]> {
  return (await readdir(await findSegmentsDirectory(root))).sort();
}

/** Resolves the single Agent directory created by each isolated test. */
async function findAgentDirectory(root: string): Promise<string> {
  /** Single content-addressed Agent directory created under the test root. */
  const [agentDirectory] = await readdir(root);
  if (!agentDirectory) throw new Error("expected timeline agent directory");
  return path.join(root, agentDirectory);
}

/** Resolves the physical segment directory for the test Agent. */
async function findSegmentsDirectory(root: string): Promise<string> {
  return path.join(await findAgentDirectory(root), "segments");
}

/** Writes a valid content-addressed file that no generation references. */
async function writeOrphanSegment(root: string): Promise<string> {
  /** Canonical JSON bytes used to derive a valid content-addressed file name. */
  const content = JSON.stringify([row(99, "orphan")], null, 2);
  /** Hash-addressed segment file name derived from the orphan content. */
  const file = `${createHash("sha256").update(content).digest("hex")}.json`;
  await writeFile(path.join(await findSegmentsDirectory(root), file), content, "utf8");
  return file;
}

/** Resolves the active or working manifest selected by the persisted Agent state. */
async function findCurrentManifest(
  root: string,
  key: "activeGenerationId" | "workingGenerationId",
): Promise<string> {
  /** Physical directory containing the current test Agent state. */
  const agentDirectory = await findAgentDirectory(root);
  /** Parsed persisted state used to resolve the selected generation pointer. */
  const state = JSON.parse(
    await readFile(path.join(agentDirectory, "state.json"), "utf8"),
  ) as Record<string, unknown>;
  /** Generation identifier selected by the requested active or working key. */
  const generationId = state[key];
  if (typeof generationId !== "string") throw new Error(`expected ${key}`);
  return path.join(agentDirectory, "generations", `${generationId}.json`);
}
