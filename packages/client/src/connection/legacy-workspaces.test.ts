import { expect, test } from "vitest";
import { legacyAgent } from "../../test-utils/legacy-agent";
import { LegacyWorkspaces } from "./legacy-workspaces";

test("legacy same-workspace idle child does not lift a read closed root into Ready", () => {
  const workspaces = new LegacyWorkspaces();
  const root = legacyAgent({ id: "root", cwd: "/repo/app", status: "closed" });
  const child = legacyAgent({ id: "child", cwd: "/repo/app", parentAgentId: root.agent.id });
  expect(workspaces.read({ entries: [root, child], reset: true })).toMatchObject([
    { id: "/repo/app", status: "done" },
  ]);

  const runningChild = legacyAgent({
    id: "child",
    cwd: "/repo/app",
    parentAgentId: root.agent.id,
    status: "running",
  });
  expect(workspaces.read({ entries: [root, runningChild], reset: true })).toMatchObject([
    { id: "/repo/app", status: "running" },
  ]);

  const crossWorkspaceChild = legacyAgent({
    id: "child",
    cwd: "/repo/worktree",
    parentAgentId: root.agent.id,
  });
  expect(workspaces.read({ entries: [root, crossWorkspaceChild], reset: true })).toMatchObject([
    { id: "/repo/app", status: "done" },
    { id: "/repo/worktree", status: "attention" },
  ]);
});

test("legacy Working transition uses the active turn start before its later Agent update", () => {
  const workspaces = new LegacyWorkspaces();
  const ready = legacyAgent({
    id: "agent",
    cwd: "/repo/app",
    updatedAt: "2026-06-18T10:00:00.000Z",
  });
  workspaces.read({ entries: [ready], reset: true });
  const startedAt = "2026-06-18T10:05:00.000Z";
  const changed = legacyAgent({
    id: "agent",
    cwd: "/repo/app",
    updatedAt: "2026-06-18T10:10:00.000Z",
  });
  const updates = workspaces.update({
    type: "agent_update",
    payload: {
      kind: "upsert",
      ...changed,
      agent: { ...changed.agent, activeTurn: { turnId: "turn", startedAt } },
    },
  });
  expect(updates).toMatchObject([
    { payload: { workspace: { status: "running", statusEnteredAt: startedAt } } },
  ]);
});

test.each([
  { attentionReason: "permission" as const, maskedStatus: "needs_input" as const },
  { attentionReason: "error" as const, maskedStatus: "failed" as const },
])(
  "legacy Working starts when $maskedStatus clears above an already-running root",
  ({ attentionReason, maskedStatus }) => {
    const turnStartedAt = "2026-06-18T10:00:00.000Z";
    const maskedAt = "2026-06-18T10:05:00.000Z";
    const unmaskedAt = "2026-06-18T10:10:00.000Z";
    const workspaces = new LegacyWorkspaces();
    const runningEntry = legacyAgent({
      id: "running",
      cwd: "/repo/app",
      status: "running",
      updatedAt: turnStartedAt,
    });
    const running = {
      ...runningEntry,
      agent: {
        ...runningEntry.agent,
        activeTurn: { turnId: "turn", startedAt: turnStartedAt },
      },
    };
    const blockerEntry = legacyAgent({
      id: "blocker",
      cwd: "/repo/app",
      updatedAt: maskedAt,
    });
    const blocker = {
      ...blockerEntry,
      agent: {
        ...blockerEntry.agent,
        requiresAttention: true,
        attentionReason,
        attentionTimestamp: maskedAt,
      },
    };
    expect(workspaces.read({ entries: [running, blocker], reset: true })).toMatchObject([
      { status: maskedStatus, statusEnteredAt: maskedAt },
    ]);

    const unmasked = workspaces.update({
      type: "agent_update",
      payload: {
        kind: "upsert",
        ...blocker,
        agent: {
          ...blocker.agent,
          updatedAt: unmaskedAt,
          requiresAttention: false,
          attentionReason: null,
          attentionTimestamp: null,
        },
      },
    });
    expect(unmasked).toMatchObject([
      { payload: { workspace: { status: "running", statusEnteredAt: unmaskedAt } } },
    ]);

    const sameBucket = workspaces.update({
      type: "agent_update",
      payload: {
        kind: "upsert",
        ...running,
        agent: { ...running.agent, updatedAt: "2026-06-18T10:20:00.000Z" },
      },
    });
    expect(sameBucket).toMatchObject([
      { payload: { workspace: { status: "running", statusEnteredAt: unmaskedAt } } },
    ]);
  },
);

test("legacy multi-root Ready uses the remove transition time", () => {
  const transitionAt = "2026-06-18T10:15:00.000Z";
  const workspaces = new LegacyWorkspaces(() => transitionAt);
  workspaces.read({
    entries: [
      legacyAgent({
        id: "running",
        cwd: "/repo/app",
        status: "running",
        updatedAt: "2026-06-18T10:00:00.000Z",
      }),
      legacyAgent({ id: "ready", cwd: "/repo/app", updatedAt: "2026-06-18T09:00:00.000Z" }),
    ],
    reset: true,
  });

  const updates = workspaces.update({
    type: "agent_update",
    payload: { kind: "remove", agentId: "running" },
  });

  expect(updates).toHaveLength(1);
  expect(updates[0]).toMatchObject({
    type: "workspace_update",
    payload: {
      workspace: { status: "attention", statusEnteredAt: transitionAt },
    },
  });
});

test("legacy non-empty reset keeps entry time for the same status bucket", () => {
  const workspaces = new LegacyWorkspaces();
  const initial = legacyAgent({
    id: "agent",
    cwd: "/repo/app",
    updatedAt: "2026-06-18T10:00:00.000Z",
  });
  expect(workspaces.read({ entries: [initial], reset: true })).toMatchObject([
    { status: "attention", statusEnteredAt: "2026-06-18T10:00:00.000Z" },
  ]);

  const refreshed = legacyAgent({
    id: "agent",
    cwd: "/repo/app",
    updatedAt: "2026-06-18T10:20:00.000Z",
  });
  expect(workspaces.read({ entries: [refreshed], reset: true })).toMatchObject([
    { status: "attention", statusEnteredAt: "2026-06-18T10:00:00.000Z" },
  ]);
});

test("legacy full reset uses its transition time when a higher-priority root disappears", () => {
  const transitionAt = "2026-06-18T10:15:00.000Z";
  const workspaces = new LegacyWorkspaces(() => transitionAt);
  const running = legacyAgent({
    id: "running",
    cwd: "/repo/app",
    status: "running",
    updatedAt: "2026-06-18T10:00:00.000Z",
  });
  const ready = legacyAgent({
    id: "ready",
    cwd: "/repo/app",
    updatedAt: "2026-06-18T09:00:00.000Z",
  });
  expect(workspaces.read({ entries: [running, ready], reset: true })).toMatchObject([
    { status: "running", statusEnteredAt: "2026-06-18T10:00:00.000Z" },
  ]);

  expect(workspaces.read({ entries: [ready], reset: true })).toMatchObject([
    { status: "attention", statusEnteredAt: transitionAt },
  ]);
});

test("legacy paged reset does not let live updates rewrite its transition time", () => {
  const transitionAt = "2026-06-18T10:15:00.000Z";
  const workspaces = new LegacyWorkspaces(() => transitionAt);
  const ready = legacyAgent({
    id: "ready",
    cwd: "/repo/app",
    updatedAt: "2026-06-18T09:00:00.000Z",
  });
  workspaces.read({
    entries: [
      legacyAgent({
        id: "running",
        cwd: "/repo/app",
        status: "running",
        updatedAt: "2026-06-18T10:00:00.000Z",
      }),
      ready,
    ],
    reset: true,
  });

  expect(workspaces.read({ entries: [ready], reset: true, complete: false })).toMatchObject([
    { status: "attention", statusEnteredAt: transitionAt },
  ]);

  const duringSnapshot = workspaces.update({
    type: "agent_update",
    payload: {
      kind: "upsert",
      ...legacyAgent({ id: "other", cwd: "/repo/other", updatedAt: "2026-06-18T10:20:00.000Z" }),
    },
  });
  expect(duringSnapshot).toHaveLength(1);
  expect(duringSnapshot).toMatchObject([
    {
      payload: {
        workspace: {
          id: "/repo/other",
          status: "attention",
          statusEnteredAt: "2026-06-18T10:20:00.000Z",
        },
      },
    },
  ]);

  workspaces.read({
    entries: [legacyAgent({ id: "last", cwd: "/repo/last", updatedAt: transitionAt })],
    reset: false,
  });
  const updates = workspaces.update({
    type: "agent_update",
    payload: {
      kind: "upsert",
      ...legacyAgent({ id: "ready", cwd: "/repo/app", updatedAt: "2026-06-18T10:30:00.000Z" }),
    },
  });
  expect(updates).toMatchObject([
    {
      payload: {
        workspace: { id: "/repo/app", status: "attention", statusEnteredAt: transitionAt },
      },
    },
  ]);
});

test("legacy paged reset retains a live bucket transition through its final page", () => {
  const snapshotAt = "2026-06-18T10:15:00.000Z";
  const liveAt = "2026-06-18T10:20:00.000Z";
  const workspaces = new LegacyWorkspaces(() => snapshotAt);
  const ready = legacyAgent({
    id: "ready",
    cwd: "/repo/app",
    updatedAt: "2026-06-18T09:00:00.000Z",
  });
  const closed = legacyAgent({
    id: "closed",
    cwd: "/repo/app",
    status: "closed",
    updatedAt: "2026-06-18T08:00:00.000Z",
  });
  workspaces.read({
    entries: [ready, closed],
    reset: true,
  });
  workspaces.read({ entries: [ready], reset: true, complete: false });

  const live = workspaces.update({
    type: "agent_update",
    payload: {
      kind: "upsert",
      ...legacyAgent({ id: "ready", cwd: "/repo/app", status: "running", updatedAt: liveAt }),
    },
  });
  expect(live).toMatchObject([
    { payload: { workspace: { status: "running", statusEnteredAt: liveAt } } },
  ]);

  workspaces.read({
    entries: [closed, legacyAgent({ id: "last", cwd: "/repo/last", updatedAt: snapshotAt })],
    reset: false,
  });
  const later = workspaces.update({
    type: "agent_update",
    payload: {
      kind: "upsert",
      ...legacyAgent({
        id: "ready",
        cwd: "/repo/app",
        status: "running",
        updatedAt: "2026-06-18T10:30:00.000Z",
      }),
    },
  });
  expect(later).toMatchObject([
    { payload: { workspace: { status: "running", statusEnteredAt: liveAt } } },
  ]);
});

test("legacy paged refresh preserves Working time when another root starts running", () => {
  const snapshotAt = "2026-06-18T10:15:00.000Z";
  const workspaces = new LegacyWorkspaces(() => snapshotAt);
  const ready = legacyAgent({
    id: "ready",
    cwd: "/repo/app",
    updatedAt: "2026-06-18T10:00:00.000Z",
  });
  const running = legacyAgent({
    id: "running",
    cwd: "/repo/app",
    status: "running",
    updatedAt: "2026-06-18T09:00:00.000Z",
  });
  workspaces.read({ entries: [ready, running], reset: true });
  workspaces.read({ entries: [ready], reset: true, complete: false });

  const live = workspaces.update({
    type: "agent_update",
    payload: {
      kind: "upsert",
      ...legacyAgent({
        id: "ready",
        cwd: "/repo/app",
        status: "running",
        updatedAt: "2026-06-18T10:20:00.000Z",
      }),
    },
  });
  expect(live).toMatchObject([
    { payload: { workspace: { status: "running", statusEnteredAt: running.agent.updatedAt } } },
  ]);
  expect(workspaces.read({ entries: [running], reset: false })).toMatchObject([
    { status: "running", statusEnteredAt: running.agent.updatedAt },
  ]);
});
