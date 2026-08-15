import { afterEach, describe, expect, it } from "vitest";

import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type {
  AgentTimelineProjectionPayload,
  WorkspaceDescriptorPayload,
} from "@getpaseo/protocol/messages";

import {
  normalizeWorkspaceDescriptor,
  selectAgentTurnPresentation,
  selectAgentTimelineState,
  useSessionStore,
  type Agent,
  type WorkspaceDescriptor,
} from "./session-store";
import type { StreamItem } from "../types/stream";
import { patchWorkspaceScripts } from "../contexts/session-workspace-scripts";

function getStreamItemIds(items: readonly StreamItem[] | undefined): string[] {
  return items?.map((item) => item.id) ?? [];
}

function createWorkspace(
  input: Partial<WorkspaceDescriptor> & Pick<WorkspaceDescriptor, "id">,
): WorkspaceDescriptor {
  return {
    id: input.id,
    projectId: input.projectId ?? "project-1",
    projectDisplayName: input.projectDisplayName ?? "Project 1",
    projectCustomName: input.projectCustomName ?? null,
    projectRootPath: input.projectRootPath ?? "/repo",
    workspaceDirectory: input.workspaceDirectory ?? "/repo",
    projectKind: input.projectKind ?? "git",
    workspaceKind: input.workspaceKind ?? "local_checkout",
    name: input.name ?? "main",
    status: input.status ?? "done",
    statusEnteredAt: input.statusEnteredAt ?? null,
    archivingAt: input.archivingAt ?? null,
    diffStat: input.diffStat ?? null,
    defaultAgentId: input.defaultAgentId ?? null,
    scripts: input.scripts ?? [],
  };
}

function createAgent(input: { id: string; workspaceId: string; status: Agent["status"] }): Agent {
  const timestamp = new Date("2026-08-03T12:00:00.000Z");
  return {
    serverId: "test-server",
    id: input.id,
    provider: "codex",
    status: input.status,
    activeTurn: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastUserMessageAt: null,
    lastMessageAt: null,
    lastActivityAt: timestamp,
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: null,
    cwd: "/repo",
    workspaceId: input.workspaceId,
    model: null,
    providerRetryMessage: null,
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    archivedAt: null,
    parentAgentId: null,
    labels: {},
  };
}

afterEach(() => {
  useSessionStore.getState().clearSession("test-server");
  useSessionStore.getState().clearSession("restore-server");
});

function initializeTestSession(): void {
  useSessionStore.getState().initializeSession("test-server", null as unknown as DaemonClient);
}

function getTestSessionReferences() {
  const state = useSessionStore.getState();
  const session = state.sessions["test-server"];
  if (!session) {
    throw new Error("test session is not initialized");
  }
  return {
    sessions: state.sessions,
    session,
    workspaces: session.workspaces,
  };
}

function submittedMessage(clientMessageId: string): Extract<StreamItem, { kind: "user_message" }> {
  return {
    kind: "user_message",
    id: clientMessageId,
    clientMessageId,
    text: clientMessageId,
    timestamp: new Date("2026-07-31T10:00:00.000Z"),
  };
}

function hasSubmittedMessage(items: readonly StreamItem[] | undefined, clientMessageId: string) {
  return items?.some(
    (item) => item.kind === "user_message" && item.clientMessageId === clientMessageId,
  );
}

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length === 0) return [[]];
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((suffix) =>
      [value].concat(suffix),
    ),
  );
}

function taskTexts(tasks: ReadonlyArray<{ text: string }>): string[] {
  return tasks.map((task) => task.text);
}

describe("agent task state", () => {
  it("notifies the task subscriber only when its task snapshot changes", () => {
    initializeTestSession();
    const snapshots: string[][] = [];
    const unsubscribe = useSessionStore.subscribe(
      (state) => state.sessions["test-server"]?.agentTasks.get("agent-1") ?? [],
      (tasks) => snapshots.push(taskTexts(tasks)),
    );

    const tasks = [{ id: "1", text: "Inspect", status: "pending" as const, completed: false }];
    useSessionStore
      .getState()
      .setAgentStreamState("test-server", "agent-1", { taskSnapshot: tasks });
    useSessionStore.getState().setIsPlayingAudio("test-server", true);
    useSessionStore
      .getState()
      .setAgentStreamState("test-server", "agent-1", { taskSnapshot: [...tasks] });
    useSessionStore.getState().setAgentStreamState("test-server", "agent-1", {
      taskSnapshot: [{ ...tasks[0], status: "completed", completed: true }],
    });
    unsubscribe();

    expect(snapshots).toEqual([["Inspect"], ["Inspect"]]);
  });

  it("restores the latest task snapshot from an authoritative timeline", () => {
    initializeTestSession();
    const todo: StreamItem = {
      kind: "todo_list",
      id: "todo-1",
      provider: "codex",
      timestamp: new Date("2026-08-11T10:00:00.000Z"),
      activity: { type: "started", task: "Verify" },
      items: [{ text: "Verify", status: "in_progress", completed: false }],
    };

    useSessionStore.getState().applyAgentTimelineResponseState("test-server", "agent-1", {
      items: [todo],
      head: [],
      range: null,
      older: "none",
      newer: false,
      synchronized: true,
      acknowledgedClientMessageIds: [],
    });

    expect(useSessionStore.getState().sessions["test-server"]?.agentTasks.get("agent-1")).toEqual(
      todo.items,
    );
  });
});

describe("agent timeline state", () => {
  it("commits canonical items, range, and older availability as one synced state", () => {
    initializeTestSession();
    const items: StreamItem[] = [
      {
        kind: "assistant_message",
        id: "canonical-row",
        text: "canonical",
        timestamp: new Date("2026-07-27T10:00:00.000Z"),
      },
    ];

    useSessionStore.getState().applyAgentTimelineResponseState("test-server", "agent-1", {
      items,
      head: [],
      range: { epoch: "epoch-1", startSeq: 51, endSeq: 100 },
      older: "available",
      newer: false,
      synchronized: true,
      acknowledgedClientMessageIds: [],
    });

    expect(
      selectAgentTimelineState(useSessionStore.getState().sessions["test-server"], "agent-1"),
    ).toEqual({
      status: "synced",
      items,
      range: { epoch: "epoch-1", startSeq: 51, endSeq: 100 },
      older: "available",
      newer: "none",
    });
  });

  it("represents an empty authoritative timeline without inventing a range", () => {
    initializeTestSession();
    useSessionStore.getState().applyAgentTimelineResponseState("test-server", "agent-1", {
      items: [],
      head: [],
      range: null,
      older: "none",
      newer: false,
      synchronized: true,
      acknowledgedClientMessageIds: [],
    });

    expect(
      selectAgentTimelineState(useSessionStore.getState().sessions["test-server"], "agent-1"),
    ).toEqual({ status: "synced", items: [], range: null, older: "none", newer: "none" });
  });

  it("preserves older availability when an applied response leaves it unchanged", () => {
    initializeTestSession();
    const store = useSessionStore.getState();
    store.applyAgentTimelineResponseState("test-server", "agent-1", {
      items: [],
      head: [],
      range: { epoch: "epoch-1", startSeq: 200, endSeq: 240 },
      older: "available",
      newer: false,
      synchronized: true,
      acknowledgedClientMessageIds: [],
    });

    store.applyAgentTimelineResponseState("test-server", "agent-1", {
      items: [],
      head: [],
      range: { epoch: "epoch-1", startSeq: 200, endSeq: 240 },
      older: "unchanged",
      newer: false,
      synchronized: false,
      acknowledgedClientMessageIds: [],
    });

    expect(
      selectAgentTimelineState(useSessionStore.getState().sessions["test-server"], "agent-1"),
    ).toEqual({
      status: "synced",
      items: [],
      range: { epoch: "epoch-1", startSeq: 200, endSeq: 240 },
      older: "available",
      newer: "none",
    });
  });

  it("stores turn liveness transitions without duplicating their policy", () => {
    initializeTestSession();
    const store = useSessionStore.getState();
    store.applyAgentTurnLiveness("test-server", "agent-1", {
      type: "snapshot",
      activeTurn: { turnId: "turn-1", startedAt: null },
    });
    expect(store.getSession("test-server")?.agentTurnLiveness.get("agent-1")).toEqual({
      phase: "open",
      turnId: "turn-1",
      startedAt: null,
      cancellationRequestId: null,
    });

    store.applyAgentTurnLiveness("test-server", "agent-1", {
      type: "snapshot",
      activeTurn: null,
    });
    expect(store.getSession("test-server")?.agentTurnLiveness.has("agent-1")).toBe(false);
  });
});

describe("agent timeline projection state", () => {
  const summary = {
    kind: "summary",
    epoch: "epoch-1",
    timelineRevision: "43a2674e-081c-4f20-8bca-9de7699dc419",
    entries: [],
    activities: [
      {
        activityId: "activity:one",
        timestamp: "2026-08-09T00:00:00.000Z",
        seqStart: 2,
        seqEnd: 3,
        sourceSeqRanges: [{ startSeq: 2, endSeq: 3 }],
      },
    ],
    hasOlderTurns: true,
  } satisfies Extract<AgentTimelineProjectionPayload, { kind: "summary" }>;

  it("keeps projection detail state outside canonical stream and cursor maps", () => {
    initializeTestSession();
    const store = useSessionStore.getState();
    expect(store.installAgentTimelineProjectionSummary("test-server", "agent-1", summary)).toBe(
      true,
    );
    const request = store.beginAgentTimelineProjectionActivityDetail(
      "test-server",
      "agent-1",
      "activity:one",
      200,
    );
    const session = useSessionStore.getState().sessions["test-server"];

    expect(request).toMatchObject({ activityId: "activity:one", limit: 200, generation: 1 });
    expect(
      session?.agentTimelineProjectionLanes.get("agent-1")?.activities.get("activity:one"),
    ).toMatchObject({ status: "loading", members: [] });
    expect(session?.agentStreamTail.has("agent-1")).toBe(false);
    expect(session?.agentTimelineCursor.has("agent-1")).toBe(false);
    expect(session?.agentAuthoritativeHistoryApplied.has("agent-1")).toBe(false);
  });

  it("installs canonical state and removes its projection lane in one store commit", () => {
    initializeTestSession();
    const store = useSessionStore.getState();
    store.installAgentTimelineProjectionSummary("test-server", "agent-1", summary);
    const snapshots: Array<{ hasLane: boolean; tailIds: string[] }> = [];
    const unsubscribe = useSessionStore.subscribe((state) => {
      const session = state.sessions["test-server"];
      snapshots.push({
        hasLane: session?.agentTimelineProjectionLanes.has("agent-1") === true,
        tailIds: getStreamItemIds(session?.agentStreamTail.get("agent-1")),
      });
    });

    store.applyAgentTimelineResponseState("test-server", "agent-1", {
      items: [
        {
          kind: "assistant_message",
          id: "canonical-final",
          text: "Answer",
          timestamp: new Date("2026-08-09T00:00:04.000Z"),
        },
      ],
      head: [],
      range: { epoch: "epoch-1", startSeq: 1, endSeq: 4 },
      older: "available",
      newer: false,
      synchronized: true,
      acknowledgedClientMessageIds: [],
    });
    unsubscribe();

    expect(snapshots).toEqual([{ hasLane: false, tailIds: ["canonical-final"] }]);
  });

  it("rejects a summary install after the Agent becomes live", () => {
    initializeTestSession();
    const store = useSessionStore.getState();
    store.setAgents(
      "test-server",
      new Map([
        ["agent-1", createAgent({ id: "agent-1", workspaceId: "workspace-1", status: "running" })],
      ]),
    );

    expect(store.installAgentTimelineProjectionSummary("test-server", "agent-1", summary)).toBe(
      false,
    );
    expect(store.getSession("test-server")?.agentTimelineProjectionLanes.has("agent-1")).toBe(
      false,
    );
  });

  it("rejects a summary install while the Agent has unresolved permission state", () => {
    initializeTestSession();
    const store = useSessionStore.getState();
    store.setAgents(
      "test-server",
      new Map([
        [
          "agent-1",
          {
            ...createAgent({ id: "agent-1", workspaceId: "workspace-1", status: "idle" }),
            attentionReason: "permission" as const,
          },
        ],
      ]),
    );

    expect(store.installAgentTimelineProjectionSummary("test-server", "agent-1", summary)).toBe(
      false,
    );
    expect(store.getSession("test-server")?.agentTimelineProjectionLanes.has("agent-1")).toBe(
      false,
    );
  });
});

describe("message submission ordering", () => {
  const agentId = "agent-1";
  const clientMessageId = "client-1";
  const startedAt = new Date("2026-07-31T10:00:01.000Z");
  const steps = [
    "accept",
    "canonical-row",
    "stream-open",
    "snapshot-idle",
    "snapshot-open",
    "stream-close",
  ] as const;

  function applyStep(step: (typeof steps)[number]): void {
    const store = useSessionStore.getState();
    if (step === "accept") {
      store.acceptAgentMessageSubmission("test-server", agentId, clientMessageId);
      return;
    }
    if (step === "canonical-row") {
      store.setAgentStreamState("test-server", agentId, {
        acknowledgedClientMessageIds: [clientMessageId],
      });
      return;
    }
    if (step === "stream-open") {
      store.applyAgentTurnLiveness("test-server", agentId, {
        type: "stream_open",
        turn: { turnId: "turn-1", startedAt },
      });
      return;
    }
    if (step === "snapshot-open") {
      store.applyAgentTurnLiveness("test-server", agentId, {
        type: "snapshot",
        activeTurn: { turnId: "turn-1", startedAt },
      });
      return;
    }
    if (step === "snapshot-idle") {
      store.applyAgentTurnLiveness("test-server", agentId, {
        type: "snapshot",
        activeTurn: null,
      });
      return;
    }
    store.applyAgentTurnLiveness("test-server", agentId, {
      type: "stream_close",
      turnId: "turn-1",
    });
  }

  it("keeps every ordering active until its canonical row and settles at quiescence", () => {
    const continuityViolations: string[] = [];
    const settlementViolations: string[] = [];

    for (const ordering of permutations(steps)) {
      useSessionStore.getState().clearSession("test-server");
      initializeTestSession();
      useSessionStore
        .getState()
        .beginAgentMessageSubmission("test-server", agentId, submittedMessage(clientMessageId));
      let canonicalObserved = false;

      for (const step of ordering) {
        applyStep(step);
        canonicalObserved ||= step === "canonical-row";
        const presentation = selectAgentTurnPresentation(
          useSessionStore.getState().sessions["test-server"],
          agentId,
        );
        if (!canonicalObserved && !presentation.isActive) {
          continuityViolations.push(`${ordering.join(" → ")}: inactive after ${step}`);
        }
      }

      const store = useSessionStore.getState();
      store.acceptAgentMessageSubmission("test-server", agentId, clientMessageId);
      store.setAgentStreamState("test-server", agentId, {
        acknowledgedClientMessageIds: [clientMessageId],
      });
      store.applyAgentTurnLiveness("test-server", agentId, [
        { type: "stream_close", turnId: "turn-1" },
        { type: "snapshot", activeTurn: null },
      ]);
      const settled = selectAgentTurnPresentation(
        useSessionStore.getState().sessions["test-server"],
        agentId,
      );
      if (settled.isActive) settlementViolations.push(ordering.join(" → "));
    }

    expect({ continuityViolations, settlementViolations }).toEqual({
      continuityViolations: [],
      settlementViolations: [],
    });
  });

  it("publishes the optimistic row and active presentation in one store notification", () => {
    initializeTestSession();
    const notifications: Array<{ hasOptimisticRow: boolean; isActive: boolean }> = [];
    const unsubscribe = useSessionStore.subscribe((state) => {
      const session = state.sessions["test-server"];
      notifications.push({
        hasOptimisticRow:
          hasSubmittedMessage(session?.agentStreamTail.get(agentId), clientMessageId) === true,
        isActive: selectAgentTurnPresentation(session, agentId).isActive,
      });
    });

    useSessionStore
      .getState()
      .beginAgentMessageSubmission("test-server", agentId, submittedMessage(clientMessageId));
    unsubscribe();

    expect(notifications).toEqual([{ hasOptimisticRow: true, isActive: true }]);
  });

  it("keeps another unacknowledged submission active after one row is acknowledged", () => {
    initializeTestSession();
    const store = useSessionStore.getState();
    store.beginAgentMessageSubmission("test-server", agentId, submittedMessage(clientMessageId));
    store.beginAgentMessageSubmission("test-server", agentId, submittedMessage("client-2"));
    store.acceptAgentMessageSubmission("test-server", agentId, clientMessageId);
    store.setAgentStreamState("test-server", agentId, {
      acknowledgedClientMessageIds: [clientMessageId],
    });

    expect(
      selectAgentTurnPresentation(useSessionStore.getState().sessions["test-server"], agentId)
        .isActive,
    ).toBe(true);
  });

  it("reconciles a created-agent row without creating a submission transaction", () => {
    initializeTestSession();
    const message = submittedMessage(clientMessageId);

    const handedOff = useSessionStore
      .getState()
      .handoffCreatedAgentUserMessage("test-server", agentId, message);

    const session = useSessionStore.getState().sessions["test-server"];
    expect({
      handedOff,
      tail: session?.agentStreamTail.get(agentId),
      head: session?.agentStreamHead.get(agentId) ?? [],
      submissions: session?.messageSubmissions.get(agentId) ?? [],
    }).toEqual({
      handedOff: true,
      tail: [message],
      head: [],
      submissions: [],
    });
  });
});

describe("normalizeWorkspaceDescriptor", () => {
  it("normalizes workspace scripts and invalid activity timestamps", () => {
    const scripts = [
      {
        scriptName: "web",
        type: "service" as const,
        hostname: "web.paseo.localhost",
        port: 3000,
        proxyUrl: "http://web.paseo.localhost:6767",
        lifecycle: "running" as const,
        health: "healthy" as const,
        exitCode: null,
        terminalId: null,
      },
    ];
    const workspace = normalizeWorkspaceDescriptor({
      id: "1",
      projectId: "1",
      projectDisplayName: "Project 1",
      projectRootPath: "/repo",
      workspaceDirectory: "/repo",
      projectKind: "git",
      workspaceKind: "checkout",
      name: "main",
      archivingAt: null,
      status: "running",
      statusEnteredAt: null,
      activityAt: "not-a-date",
      diffStat: null,
      scripts,
    });

    expect(workspace.scripts).toEqual([
      {
        scriptName: "web",
        type: "service",
        hostname: "web.paseo.localhost",
        port: 3000,
        proxyUrl: "http://web.paseo.localhost:6767",
        lifecycle: "running",
        health: "healthy",
        exitCode: null,
        terminalId: null,
      },
    ]);
    expect(workspace.scripts).not.toBe(scripts);
  });

  it("canonicalizes the workspace directory and treats a blank one as empty", () => {
    const canonical = normalizeWorkspaceDescriptor({
      id: "1",
      projectId: "1",
      projectDisplayName: "Project 1",
      projectRootPath: "/repo",
      workspaceDirectory: "/repo/app/",
      projectKind: "git",
      workspaceKind: "checkout",
      name: "main",
      archivingAt: null,
      status: "done",
      statusEnteredAt: null,
      activityAt: null,
      diffStat: null,
      scripts: [],
    });
    expect(canonical.workspaceDirectory).toBe("/repo/app");

    const blank = normalizeWorkspaceDescriptor({
      id: "1",
      projectId: "1",
      projectDisplayName: "Project 1",
      projectRootPath: "/repo",
      workspaceDirectory: "   ",
      projectKind: "git",
      workspaceKind: "checkout",
      name: "main",
      archivingAt: null,
      status: "done",
      statusEnteredAt: null,
      activityAt: null,
      diffStat: null,
      scripts: [],
    });
    expect(blank.workspaceDirectory).toBe("");
  });

  it("defaults missing scripts to an empty array", () => {
    const payload = {
      id: "1",
      projectId: "1",
      projectDisplayName: "Project 1",
      projectRootPath: "/repo",
      workspaceDirectory: "/repo",
      projectKind: "git",
      workspaceKind: "checkout",
      name: "main",
      archivingAt: null,
      status: "done",
      statusEnteredAt: null,
      activityAt: null,
      diffStat: null,
      scripts: [],
    } as WorkspaceDescriptorPayload;

    const workspace = normalizeWorkspaceDescriptor(payload);

    expect(workspace.scripts).toEqual([]);
  });

  it("defaults missing archivingAt to null", () => {
    const payload = {
      id: "1",
      projectId: "1",
      projectDisplayName: "Project 1",
      projectRootPath: "/repo",
      workspaceDirectory: "/repo",
      projectKind: "git",
      workspaceKind: "checkout",
      name: "main",
      status: "done",
      activityAt: null,
      diffStat: null,
      scripts: [],
    } as unknown as WorkspaceDescriptorPayload;

    const workspace = normalizeWorkspaceDescriptor(payload);

    expect(workspace.archivingAt).toBeNull();
  });

  it("normalizes a missing default agent id to null and preserves an explicit id", () => {
    const payload = {
      id: "1",
      projectId: "1",
      projectDisplayName: "Project 1",
      projectRootPath: "/repo",
      workspaceDirectory: "/repo",
      projectKind: "git",
      workspaceKind: "checkout",
      name: "main",
      archivingAt: null,
      status: "done",
      statusEnteredAt: null,
      activityAt: null,
      diffStat: null,
      scripts: [],
    } satisfies WorkspaceDescriptorPayload;

    expect(normalizeWorkspaceDescriptor(payload).defaultAgentId).toBeNull();
    expect(
      normalizeWorkspaceDescriptor({
        ...payload,
        defaultAgentId: "agent-default",
      }).defaultAgentId,
    ).toBe("agent-default");
  });

  it("normalizes statusEnteredAt strings to Date and missing or null values to null", () => {
    const basePayload = {
      id: "1",
      projectId: "1",
      projectDisplayName: "Project 1",
      projectRootPath: "/repo",
      workspaceDirectory: "/repo",
      projectKind: "git",
      workspaceKind: "checkout",
      name: "main",
      status: "running",
      activityAt: null,
      diffStat: null,
      scripts: [],
    } satisfies Omit<WorkspaceDescriptorPayload, "statusEnteredAt" | "archivingAt">;

    const withString = normalizeWorkspaceDescriptor({
      ...basePayload,
      archivingAt: null,
      statusEnteredAt: "2026-05-12T09:30:00.000Z",
    });
    const withNull = normalizeWorkspaceDescriptor({
      ...basePayload,
      archivingAt: null,
      statusEnteredAt: null,
    });
    const missing = normalizeWorkspaceDescriptor({
      ...basePayload,
      archivingAt: null,
    } as unknown as WorkspaceDescriptorPayload);

    expect(withString.statusEnteredAt).toEqual(new Date("2026-05-12T09:30:00.000Z"));
    expect(withNull.statusEnteredAt).toBeNull();
    expect(missing.statusEnteredAt).toBeNull();
  });

  it("preserves project placement from workspace descriptor payloads", () => {
    const workspace = normalizeWorkspaceDescriptor({
      id: "1",
      projectId: "remote:github.com/acme/app",
      projectDisplayName: "acme/app",
      projectRootPath: "/repo/app",
      workspaceDirectory: "/repo/app",
      projectKind: "git",
      workspaceKind: "local_checkout",
      name: "main",
      archivingAt: null,
      status: "done",
      statusEnteredAt: null,
      activityAt: null,
      diffStat: null,
      scripts: [],
      project: {
        projectKey: "remote:github.com/acme/app",
        projectName: "acme/app",
        checkout: {
          cwd: "/repo/app",
          isGit: true,
          currentBranch: "main",
          remoteUrl: "https://github.com/acme/app.git",
          worktreeRoot: "/repo/app",
          isPaseoOwnedWorktree: false,
          mainRepoRoot: null,
        },
      },
    });

    expect(workspace.project).toEqual({
      projectKey: "remote:github.com/acme/app",
      projectName: "acme/app",
      checkout: {
        cwd: "/repo/app",
        isGit: true,
        currentBranch: "main",
        remoteUrl: "https://github.com/acme/app.git",
        worktreeRoot: "/repo/app",
        isPaseoOwnedWorktree: false,
        mainRepoRoot: null,
      },
    });
  });
});

describe("workspace resident Agent count projection", () => {
  it("updates resident counts whenever the session agent map changes", () => {
    initializeTestSession();
    const store = useSessionStore.getState();

    store.setAgents(
      "test-server",
      new Map([
        ["agent-1", createAgent({ id: "agent-1", workspaceId: "workspace-a", status: "idle" })],
      ]),
    );
    expect(
      useSessionStore.getState().sessions["test-server"]?.workspaceResidentAgentCounts,
    ).toEqual(new Map([["workspace-a", 1]]));

    store.setAgents(
      "test-server",
      new Map([
        ["agent-1", createAgent({ id: "agent-1", workspaceId: "workspace-a", status: "closed" })],
      ]),
    );
    expect(
      useSessionStore.getState().sessions["test-server"]?.workspaceResidentAgentCounts,
    ).toEqual(new Map());
  });

  it("rebuilds resident counts when restoring a cached session replica", () => {
    const closedAgent = createAgent({
      id: "agent-1",
      workspaceId: "workspace-a",
      status: "closed",
    });
    useSessionStore.getState().restoreSessionReplica("restore-server", {
      agents: new Map([[closedAgent.id, { ...closedAgent, serverId: "restore-server" }]]),
      workspaces: new Map(),
      projects: new Map(),
      timeline: null,
    });

    expect(
      useSessionStore.getState().sessions["restore-server"]?.workspaceResidentAgentCounts,
    ).toEqual(new Map());
  });
});

describe("mergeWorkspaces", () => {
  it("preserves scripts on merged workspace entries", () => {
    const store = useSessionStore.getState();
    store.initializeSession("test-server", null as unknown as DaemonClient);
    store.setWorkspaces(
      "test-server",
      new Map([["/repo/main", createWorkspace({ id: "/repo/main", scripts: [] })]]),
    );

    store.mergeWorkspaces("test-server", [
      createWorkspace({
        id: "/repo/main",
        scripts: [
          {
            scriptName: "web",
            type: "service",
            hostname: "web.paseo.localhost",
            port: 3000,
            proxyUrl: "http://web.paseo.localhost:6767",
            lifecycle: "running",
            health: "healthy",
            exitCode: null,
            terminalId: null,
          },
        ],
      }),
    ]);

    expect(store.getSession("test-server")?.workspaces.get("/repo/main")?.scripts).toEqual([
      {
        scriptName: "web",
        type: "service",
        hostname: "web.paseo.localhost",
        port: 3000,
        proxyUrl: "http://web.paseo.localhost:6767",
        lifecycle: "running",
        health: "healthy",
        exitCode: null,
        terminalId: null,
      },
    ]);
  });

  it("preserves identity when merging content-equal workspace descriptors", () => {
    const store = useSessionStore.getState();
    initializeTestSession();
    const workspace = createWorkspace({ id: "/repo/main" });

    store.mergeWorkspaces("test-server", [workspace]);
    const first = getTestSessionReferences();

    store.mergeWorkspaces("test-server", [{ ...workspace, scripts: [...workspace.scripts] }]);
    const second = getTestSessionReferences();

    expect(second.sessions).toBe(first.sessions);
    expect(second.session).toBe(first.session);
    expect(second.workspaces).toBe(first.workspaces);
    expect(second.workspaces.get("/repo/main")).toBe(first.workspaces.get("/repo/main"));
  });

  it("preserves unaffected workspace entry identity when one workspace changes", () => {
    const store = useSessionStore.getState();
    initializeTestSession();
    const workspaceA = createWorkspace({ id: "/repo/a", name: "main" });
    const workspaceB = createWorkspace({ id: "/repo/b", name: "feature" });

    store.mergeWorkspaces("test-server", [workspaceA, workspaceB]);
    const before = getTestSessionReferences();
    const beforeA = before.workspaces.get("/repo/a");
    const beforeB = before.workspaces.get("/repo/b");

    store.mergeWorkspaces("test-server", [{ ...workspaceA, status: "running" }]);
    const after = getTestSessionReferences();

    expect(after.sessions).not.toBe(before.sessions);
    expect(after.session).not.toBe(before.session);
    expect(after.workspaces).not.toBe(before.workspaces);
    expect(after.workspaces.get("/repo/a")).not.toBe(beforeA);
    expect(after.workspaces.get("/repo/b")).toBe(beforeB);
  });

  it("uses incoming null diff stat as authoritative", () => {
    const store = useSessionStore.getState();
    initializeTestSession();
    const workspace = createWorkspace({
      id: "/repo/main",
      diffStat: { additions: 2, deletions: 1 },
    });
    store.mergeWorkspaces("test-server", [workspace]);
    const before = getTestSessionReferences();

    store.mergeWorkspaces("test-server", [{ ...workspace, diffStat: null }]);
    const after = getTestSessionReferences();

    expect(after.sessions).not.toBe(before.sessions);
    expect(after.session).not.toBe(before.session);
    expect(after.workspaces).not.toBe(before.workspaces);
    expect(after.workspaces.get(workspace.id)?.diffStat).toBeNull();
  });
});

describe("setWorkspaces", () => {
  it("preserves identity when replacing workspaces with content-equal entries", () => {
    const store = useSessionStore.getState();
    initializeTestSession();
    const workspace = createWorkspace({ id: "/repo/main" });
    store.setWorkspaces("test-server", new Map([[workspace.id, workspace]]));
    const before = getTestSessionReferences();

    store.setWorkspaces(
      "test-server",
      new Map([[workspace.id, { ...workspace, scripts: [...workspace.scripts] }]]),
    );
    const after = getTestSessionReferences();

    expect(after.sessions).toBe(before.sessions);
    expect(after.session).toBe(before.session);
    expect(after.workspaces).toBe(before.workspaces);
    expect(after.workspaces.get(workspace.id)).toBe(before.workspaces.get(workspace.id));
  });
});

describe("removeWorkspace", () => {
  it("preserves identity when removing a missing workspace", () => {
    const store = useSessionStore.getState();
    initializeTestSession();
    const workspace = createWorkspace({ id: "/repo/main" });
    store.setWorkspaces("test-server", new Map([[workspace.id, workspace]]));
    const before = getTestSessionReferences();

    store.removeWorkspace("test-server", "/repo/missing");
    const after = getTestSessionReferences();

    expect(after.sessions).toBe(before.sessions);
    expect(after.session).toBe(before.session);
    expect(after.workspaces).toBe(before.workspaces);
  });
});

describe("patchWorkspaceScripts", () => {
  it("preserves workspace entry identity when scripts are content-equal", () => {
    const script = {
      scriptName: "web",
      type: "service" as const,
      hostname: "web.paseo.localhost",
      port: 3000,
      proxyUrl: "http://web.paseo.localhost:6767",
      lifecycle: "running" as const,
      health: "healthy" as const,
      exitCode: null,
      terminalId: null,
    };
    const workspace = createWorkspace({ id: "/repo/main", scripts: [script] });
    const current = new Map([[workspace.id, workspace]]);

    const next = patchWorkspaceScripts(current, {
      workspaceId: workspace.id,
      scripts: [{ ...script }],
    });

    expect(next).toBe(current);
    expect(next.get(workspace.id)).toBe(workspace);
  });
});
