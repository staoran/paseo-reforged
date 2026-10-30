import { afterEach, describe, expect, it, vi } from "vitest";

// These functions receive transport adapters directly and do not boot an Expo runtime
vi.mock("@/runtime/host-runtime", () => ({ getHostRuntimeStore: vi.fn() }));

import { useSessionStore } from "@/stores/session-store";
import { TIMELINE_FETCH_PAGE_SIZE } from "@/timeline/timeline-fetch-policy";
import type { HostRuntimeStore } from "@/runtime/host-runtime";
import type { FetchAgentTimelinePayload } from "@getpaseo/client/internal/daemon-client";
import { getInitDeferred, getInitKey, resolveInitDeferred } from "@/utils/agent-initialization";
import {
  createSetAgentInitializing,
  ensureAgentIsInitialized,
  refreshAgentInitializationTimeout,
  refreshAgent,
} from "./use-agent-initialization";

const serverId = "server-1";
const agentId = "agent-1";

class FakeDaemonClient {
  readonly refreshedAgentIds: string[] = [];

  async refreshAgent(requestedAgentId: string): Promise<void> {
    this.refreshedAgentIds.push(requestedAgentId);
  }
}

class FakeTimelineRuntime {
  /** Optional responses model an overflow followed by the latest bounded snapshot */
  readonly pages: FetchAgentTimelinePayload[] = [];
  readonly requests: Array<{
    serverId: string;
    agentId: string;
    request: Parameters<HostRuntimeStore["fetchAgentTimeline"]>[2];
  }> = [];

  fetchAgentTimeline: HostRuntimeStore["fetchAgentTimeline"] = async (
    requestedServerId,
    requestedAgentId,
    request,
  ) => {
    this.requests.push({ serverId: requestedServerId, agentId: requestedAgentId, request });
    return this.pages.shift() ?? timelinePage();
  };
}

/** A complete protocol page isolates provider transport from initialization policy */
function timelinePage(
  overrides: Partial<FetchAgentTimelinePayload> = {},
): FetchAgentTimelinePayload {
  return {
    requestId: "timeline-request",
    agentId,
    agent: null,
    direction: "tail",
    projection: "projected",
    epoch: "epoch-1",
    reset: false,
    staleCursor: false,
    gap: false,
    window: { minSeq: 0, maxSeq: 0, nextSeq: 1 },
    startCursor: null,
    endCursor: null,
    hasOlder: false,
    hasNewer: false,
    entries: [],
    error: null,
    ...overrides,
  };
}

function bindSetAgentInitializing() {
  return createSetAgentInitializing(serverId, useSessionStore.getState().setInitializingAgents);
}

afterEach(() => {
  resolveInitDeferred(getInitKey(serverId, agentId));
  useSessionStore.setState({ sessions: {}, agentLastActivity: new Map() });
  vi.restoreAllMocks();
});

describe("ensureAgentIsInitialized", () => {
  it("catches up after loaded authoritative history", () => {
    const client = new FakeDaemonClient();
    const runtime = new FakeTimelineRuntime();
    useSessionStore.getState().initializeSession(serverId, client as never);
    useSessionStore
      .getState()
      .setAgentTimelineCursor(
        serverId,
        new Map([[agentId, { epoch: "epoch-1", startSeq: 1, endSeq: 42 }]]),
      );
    useSessionStore.getState().setAgentAuthoritativeHistoryApplied(serverId, agentId, true);

    void ensureAgentIsInitialized({
      serverId,
      agentId,
      client: client as never,
      runtime,
      setAgentInitializing: bindSetAgentInitializing(),
    });

    expect(runtime.requests).toEqual([
      {
        serverId,
        agentId,
        request: {
          direction: "after",
          cursor: { epoch: "epoch-1", seq: 42 },
          limit: TIMELINE_FETCH_PAGE_SIZE,
          projection: "projected",
          wholeTurns: true,
        },
      },
    ]);
    expect(getInitDeferred(getInitKey(serverId, agentId))?.requestDirection).toBe("after");
  });

  it("requests a bounded projected tail when no authoritative cursor is available", () => {
    const client = new FakeDaemonClient();
    const runtime = new FakeTimelineRuntime();
    useSessionStore.getState().initializeSession(serverId, client as never);

    void ensureAgentIsInitialized({
      serverId,
      agentId,
      client: client as never,
      runtime,
      setAgentInitializing: bindSetAgentInitializing(),
    });

    expect(runtime.requests).toEqual([
      {
        serverId,
        agentId,
        request: {
          direction: "tail",
          limit: TIMELINE_FETCH_PAGE_SIZE,
          projection: "projected",
          wholeTurns: true,
        },
      },
    ]);
    expect(getInitDeferred(getInitKey(serverId, agentId))?.requestDirection).toBe("tail");
  });

  it("requests a bounded projected tail after restoring painted replica items", () => {
    const client = new FakeDaemonClient();
    const runtime = new FakeTimelineRuntime();
    useSessionStore.getState().initializeSession(serverId, null);
    useSessionStore.getState().applyAgentTimelineResponseState(serverId, agentId, {
      items: [
        {
          kind: "assistant_message",
          id: "painted-item",
          text: "Painted before hydration",
          timestamp: new Date("2026-07-27T10:00:00.000Z"),
        },
      ],
      head: [],
      range: null,
      older: "none",
      newer: false,
      synchronized: false,
      acknowledgedClientMessageIds: [],
    });

    void ensureAgentIsInitialized({
      serverId,
      agentId,
      client: client as never,
      runtime,
      setAgentInitializing: bindSetAgentInitializing(),
    });

    expect(runtime.requests).toEqual([
      {
        serverId,
        agentId,
        request: {
          direction: "tail",
          limit: TIMELINE_FETCH_PAGE_SIZE,
          projection: "projected",
          wholeTurns: true,
        },
      },
    ]);
  });

  it("catches up after the restored canonical replica range", () => {
    const client = new FakeDaemonClient();
    const runtime = new FakeTimelineRuntime();
    useSessionStore.getState().initializeSession(serverId, null);
    useSessionStore.getState().applyAgentTimelineResponseState(serverId, agentId, {
      items: [
        {
          kind: "assistant_message",
          id: "canonical-item",
          text: "Canonical before restart",
          timelineCursor: { epoch: "epoch-1", seq: 12 },
          timestamp: new Date("2026-07-27T10:00:00.000Z"),
        },
      ],
      head: [],
      range: { epoch: "epoch-1", startSeq: 10, endSeq: 12 },
      older: "available",
      newer: false,
      synchronized: true,
      acknowledgedClientMessageIds: [],
    });

    void ensureAgentIsInitialized({
      serverId,
      agentId,
      client: client as never,
      runtime,
      setAgentInitializing: bindSetAgentInitializing(),
    });

    expect(runtime.requests).toEqual([
      {
        serverId,
        agentId,
        request: {
          direction: "after",
          cursor: { epoch: "epoch-1", seq: 12 },
          limit: TIMELINE_FETCH_PAGE_SIZE,
          projection: "projected",
          wholeTurns: true,
        },
      },
    ]);
    expect(getInitDeferred(getInitKey(serverId, agentId))?.requestDirection).toBe("after");
  });

  it("times out initialization after 65 seconds", async () => {
    vi.useFakeTimers();
    const client = new FakeDaemonClient();
    const runtime = new FakeTimelineRuntime();
    useSessionStore.getState().initializeSession(serverId, client as never);

    const promise = ensureAgentIsInitialized({
      serverId,
      agentId,
      client: client as never,
      runtime,
      setAgentInitializing: bindSetAgentInitializing(),
    });

    vi.advanceTimersByTime(64_999);
    expect(getInitDeferred(getInitKey(serverId, agentId))).toBeDefined();

    vi.advanceTimersByTime(1);

    await expect(promise).rejects.toThrow("History sync timed out after 65s");
    expect(getInitDeferred(getInitKey(serverId, agentId))).toBeUndefined();
    expect(useSessionStore.getState().sessions[serverId]?.initializingAgents.get(agentId)).toBe(
      false,
    );
    vi.useRealTimers();
  });

  it("refreshes the initialization timeout after paged catch-up progress", async () => {
    vi.useFakeTimers();
    const client = new FakeDaemonClient();
    const runtime = new FakeTimelineRuntime();
    useSessionStore.getState().initializeSession(serverId, client as never);
    const setAgentInitializing = bindSetAgentInitializing();
    const key = getInitKey(serverId, agentId);

    const promise = ensureAgentIsInitialized({
      serverId,
      agentId,
      client: client as never,
      runtime,
      setAgentInitializing,
    });

    vi.advanceTimersByTime(64_999);
    refreshAgentInitializationTimeout({ key, agentId, setAgentInitializing });

    vi.advanceTimersByTime(1);
    expect(getInitDeferred(key)).toBeDefined();

    const rejection = expect(promise).rejects.toThrow("History sync timed out after 65s");

    vi.advanceTimersByTime(64_998);
    expect(getInitDeferred(key)).toBeDefined();

    vi.advanceTimersByTime(1);

    await rejection;
    expect(getInitDeferred(key)).toBeUndefined();
    vi.useRealTimers();
  });
});

describe("refreshAgent", () => {
  it("takes one latest snapshot when incremental resume would require multiple pages", async () => {
    /** The local replica has fallen more than one page behind */
    const client = new FakeDaemonClient();
    /** The first page cannot complete restoration on its own */
    const runtime = new FakeTimelineRuntime();
    runtime.pages.push(timelinePage({ direction: "after", hasNewer: true }));
    useSessionStore.getState().initializeSession(serverId, client as never);
    useSessionStore
      .getState()
      .setAgentTimelineCursor(
        serverId,
        new Map([[agentId, { epoch: "epoch-1", startSeq: 1, endSeq: 42 }]]),
      );
    useSessionStore.getState().setAgentAuthoritativeHistoryApplied(serverId, agentId, true);

    await refreshAgent({
      serverId,
      agentId,
      client: client as never,
      runtime,
      setAgentInitializing: bindSetAgentInitializing(),
    });

    expect(runtime.requests.map(({ request }) => request)).toEqual([
      {
        direction: "after",
        cursor: { epoch: "epoch-1", seq: 42 },
        limit: TIMELINE_FETCH_PAGE_SIZE,
        projection: "projected",
      },
      { direction: "tail", limit: TIMELINE_FETCH_PAGE_SIZE, projection: "projected" },
    ]);
  });

  it("keeps cached messages readable and catches up after their cursor when restoring", async () => {
    /** The host has not finished resuming when the cached chat becomes visible */
    let finishResume!: () => void;
    /** Cached presentation must remain unchanged while the provider is starting */
    const items = [
      {
        kind: "assistant_message" as const,
        id: "cached-answer",
        text: "Already visible",
        timestamp: new Date("2026-10-27T10:00:00.000Z"),
      },
    ];
    /** The restore RPC completes independently of the displayed transcript */
    const client = new FakeDaemonClient();
    client.refreshAgent = async () =>
      new Promise<void>((resolve) => {
        finishResume = resolve;
      });
    /** Fetching is isolated from the provider resume gate */
    const runtime = new FakeTimelineRuntime();
    useSessionStore.getState().initializeSession(serverId, client as never);
    useSessionStore.getState().applyAgentTimelineResponseState(serverId, agentId, {
      items,
      head: [],
      range: { epoch: "cached-epoch", startSeq: 1, endSeq: 42 },
      older: "none",
      newer: false,
      synchronized: true,
      acknowledgedClientMessageIds: [],
    });

    /** Starting recovery does not wait for provider startup to display the cache */
    const restoring = refreshAgent({
      serverId,
      agentId,
      client: client as never,
      runtime,
      setAgentInitializing: bindSetAgentInitializing(),
    });
    expect(useSessionStore.getState().sessions[serverId]?.agentStreamTail.get(agentId)).toBe(items);
    expect(runtime.requests).toEqual([]);

    finishResume();
    await restoring;

    expect(runtime.requests).toEqual([
      {
        serverId,
        agentId,
        request: {
          direction: "after",
          cursor: { epoch: "cached-epoch", seq: 42 },
          limit: TIMELINE_FETCH_PAGE_SIZE,
          projection: "projected",
        },
      },
    ]);
  });

  it("fetches a bounded projected tail after refreshing the agent", async () => {
    const client = new FakeDaemonClient();
    const runtime = new FakeTimelineRuntime();
    useSessionStore.getState().initializeSession(serverId, client as never);

    await refreshAgent({
      serverId,
      agentId,
      client: client as never,
      runtime,
      setAgentInitializing: bindSetAgentInitializing(),
    });

    expect(client.refreshedAgentIds).toEqual([agentId]);
    expect(runtime.requests).toEqual([
      {
        serverId,
        agentId,
        request: {
          direction: "tail",
          limit: TIMELINE_FETCH_PAGE_SIZE,
          projection: "projected",
          wholeTurns: true,
        },
      },
    ]);
  });
});
