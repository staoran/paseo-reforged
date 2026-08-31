import { afterEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@/stores/session-store";
import { TIMELINE_FETCH_PAGE_SIZE } from "@/timeline/timeline-fetch-policy";
import type { HostRuntimeStore } from "@/runtime/host-runtime";
import {
  claimInitDeferredRequest,
  createInitDeferred,
  getInitDeferred,
  getInitKey,
  rejectInitDeferredForConnection,
  resolveInitDeferred,
} from "@/utils/agent-initialization";
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
    return undefined as never;
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
  it("does not let a replaced timeline request reject the newer initialization", async () => {
    /** Number of timeline requests started by the two initialization attempts. */
    let requestCount = 0;
    /** Rejects the first request after its deferred has already been replaced. */
    let rejectFirstRequest!: (error: Error) => void;
    /** Runtime whose first request can fail after a second initialization starts. */
    const runtime = {
      fetchAgentTimeline: () => {
        requestCount += 1;
        if (requestCount === 1) {
          return new Promise<never>((_resolve, reject) => {
            rejectFirstRequest = reject;
          });
        }
        return new Promise<never>(() => undefined);
      },
    } as Pick<HostRuntimeStore, "fetchAgentTimeline">;
    /** Connected client marker required by initialization preflight. */
    const client = new FakeDaemonClient();
    useSessionStore.getState().initializeSession(serverId, client as never);
    /** Stable key shared by the replaced and replacement deferreds. */
    const key = getInitKey(serverId, agentId);

    const first = ensureAgentIsInitialized({
      serverId,
      agentId,
      client: client as never,
      runtime,
      setAgentInitializing: bindSetAgentInitializing(),
    });
    /** Deferred owned by the request that will fail late. */
    const firstDeferred = getInitDeferred(key);
    expect(firstDeferred).toBeDefined();
    resolveInitDeferred(key, firstDeferred);
    await first;

    const second = ensureAgentIsInitialized({
      serverId,
      agentId,
      client: client as never,
      runtime,
      setAgentInitializing: bindSetAgentInitializing(),
    });
    /** Deferred that must survive the first request's late failure. */
    const secondDeferred = getInitDeferred(key);
    expect(secondDeferred).toBeDefined();
    /** Observable replacement outcome with rejection handled inside the test. */
    const secondOutcome = second.then(
      () => "resolved" as const,
      () => "rejected" as const,
    );

    rejectFirstRequest(new Error("stale timeline request failed"));
    await Promise.resolve();

    expect(getInitDeferred(key)).toBe(secondDeferred);
    resolveInitDeferred(key, secondDeferred);
    await expect(secondOutcome).resolves.toBe("resolved");
  });

  it("does not let an old request reject a newer generation of the same initialization", async () => {
    /** Rejects the direct request after a viewed generation takes ownership. */
    let rejectDirectRequest!: (error: Error) => void;
    /** Runtime whose direct request remains pending across the owner transfer. */
    const runtime = {
      fetchAgentTimeline: () =>
        new Promise<never>((_resolve, reject) => {
          rejectDirectRequest = reject;
        }),
    } as Pick<HostRuntimeStore, "fetchAgentTimeline">;
    /** Connected client marker required by initialization preflight. */
    const client = new FakeDaemonClient();
    useSessionStore.getState().initializeSession(serverId, client as never);
    /** Stable key whose deferred survives the request-generation replacement. */
    const key = getInitKey(serverId, agentId);

    const initialization = ensureAgentIsInitialized({
      serverId,
      agentId,
      client: client as never,
      runtime,
      setAgentInitializing: bindSetAgentInitializing(),
    });
    /** Deferred first owned by the direct request. */
    const deferred = getInitDeferred(key);
    expect(deferred).toBeDefined();
    /** Direct request ID that must lose settlement ownership. */
    const directRequestId = deferred!.requestId;
    /** Replacement viewed request ID installed on the same deferred. */
    const replacementRequestId = claimInitDeferredRequest({
      key,
      deferred: deferred!,
      requestDirection: "tail",
    });
    expect(replacementRequestId).not.toBe(directRequestId);
    /** Observable initialization outcome with rejection handled inside the test. */
    const outcome = initialization.then(
      () => "resolved" as const,
      () => "rejected" as const,
    );

    rejectDirectRequest(new Error("stale direct request failed"));
    await Promise.resolve();

    expect(getInitDeferred(key)).toBe(deferred);
    resolveInitDeferred(key, deferred);
    await expect(outcome).resolves.toBe("resolved");
  });

  it("does not let an old connection cleanup reject a replacement initialization", async () => {
    /** Client whose late disconnect cleanup no longer owns initialization. */
    const oldClient = new FakeDaemonClient();
    /** Client that owns the replacement initialization. */
    const replacementClient = new FakeDaemonClient();
    /** Stable key reused across the reconnect boundary. */
    const key = getInitKey(serverId, agentId);
    /** Replacement deferred installed after the old connection became stale. */
    const replacement = createInitDeferred(key, "tail", "viewed", replacementClient);
    /** Observable replacement outcome with rejection handled inside the test. */
    const outcome = replacement.promise.then(
      () => "resolved" as const,
      () => "rejected" as const,
    );

    expect(
      rejectInitDeferredForConnection(key, new Error("old connection disconnected"), oldClient),
    ).toBe(false);
    expect(getInitDeferred(key)).toBe(replacement);
    resolveInitDeferred(key, replacement, replacement.requestId);
    await expect(outcome).resolves.toBe("resolved");
  });

  it("reuses a direct request only for the same connection and direction", () => {
    /** Client that owns the direct initialization request. */
    const client = new FakeDaemonClient();
    /** Stable key used by both viewed request claims. */
    const key = getInitKey(serverId, agentId);
    /** Direct tail deferred whose request may be shared by the first viewed claim. */
    const deferred = createInitDeferred(key, "tail", "direct", client);
    /** Wire request already in flight before the viewed catch-up starts. */
    const directRequestId = deferred.requestId;

    expect(
      claimInitDeferredRequest({
        key,
        deferred,
        requestDirection: "tail",
        reuseCurrentRequest: true,
        connectionOwner: client,
      }),
    ).toBe(directRequestId);

    const afterRequestId = claimInitDeferredRequest({
      key,
      deferred,
      requestDirection: "after",
      reuseCurrentRequest: true,
      connectionOwner: client,
    });
    expect(afterRequestId).not.toBe(directRequestId);
  });

  it("requests a bounded projected tail when authoritative history is loaded", () => {
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
          direction: "tail",
          limit: TIMELINE_FETCH_PAGE_SIZE,
          projection: "projected",
          requestId: getInitDeferred(getInitKey(serverId, agentId))?.requestId,
        },
      },
    ]);
    expect(getInitDeferred(getInitKey(serverId, agentId))?.requestDirection).toBe("tail");
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
          requestId: getInitDeferred(getInitKey(serverId, agentId))?.requestId,
        },
      },
    ]);
    expect(getInitDeferred(getInitKey(serverId, agentId))?.requestDirection).toBe("tail");
  });

  it("requests a bounded projected tail after restoring painted replica items", () => {
    const client = new FakeDaemonClient();
    const runtime = new FakeTimelineRuntime();
    useSessionStore.getState().restoreSessionReplica(serverId, {
      agents: new Map(),
      workspaces: new Map(),
      projects: new Map(),
      timeline: {
        agentId,
        items: [
          {
            kind: "assistant_message",
            id: "painted-item",
            text: "Painted before hydration",
            timestamp: new Date("2026-07-27T10:00:00.000Z"),
          },
        ],
      },
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
          requestId: getInitDeferred(getInitKey(serverId, agentId))?.requestId,
        },
      },
    ]);
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
    const deferred = getInitDeferred(key);
    expect(deferred).toBeDefined();
    refreshAgentInitializationTimeout({
      key,
      agentId,
      deferred: deferred!,
      setAgentInitializing,
    });

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
        },
      },
    ]);
  });
});
