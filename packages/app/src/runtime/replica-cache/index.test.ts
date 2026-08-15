import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceDescriptorPayload } from "@getpaseo/protocol/messages";
import { normalizeAgentSnapshot } from "@/utils/agent-snapshots";
import {
  normalizeProjectDescriptor,
  normalizeWorkspaceDescriptor,
  selectAgentTimelineState,
  useSessionStore,
} from "@/stores/session-store";
import { createUserMessage, type StreamItem } from "@/types/stream";
import { ReplicaCache, type ReplicaCacheStorage } from ".";

const SERVER_ID = "cached-host";
const LRU_SERVER_IDS = ["host-a", "host-b", "host-c"] as const;

class MemoryStorage implements ReplicaCacheStorage {
  readonly values = new Map<string, string>();
  readonly attempts: string[] = [];
  readonly writes: string[] = [];
  private failuresRemaining = 0;
  private nextWriteGate: Promise<void> | null = null;

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.attempts.push(value);
    const gate = this.nextWriteGate;
    this.nextWriteGate = null;
    if (gate) await gate;
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error("simulated replica write failure");
    }
    this.values.set(key, value);
    this.writes.push(value);
  }

  async removeItem(key: string): Promise<void> {
    this.values.delete(key);
  }

  failNextWrite(): void {
    this.failuresRemaining += 1;
  }

  blockNextWrite(): () => void {
    let release = (): void => undefined;
    this.nextWriteGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => release();
  }

  resetWriteLog(): void {
    this.attempts.length = 0;
    this.writes.length = 0;
  }
}

interface PersistedReplicaPayload {
  hosts: Array<{
    serverId: string;
    agents: Array<{ snapshot: { id: string } }>;
    timeline: { agentId: string; items: Array<{ text?: string }> } | null;
  }>;
}

const startedCaches = new Set<ReplicaCache>();

function readPersistedPayload(value: string): PersistedReplicaPayload {
  return JSON.parse(value) as PersistedReplicaPayload;
}

function persistedHost(value: string, serverId: string) {
  return readPersistedPayload(value).hosts.find((host) => host.serverId === serverId);
}

async function startCleanCache(
  storage: MemoryStorage,
  serverIds: readonly string[] = [SERVER_ID],
): Promise<ReplicaCache> {
  const cache = new ReplicaCache(storage);
  startedCaches.add(cache);
  cache.setHosts(serverIds);
  cache.start();
  await cache.flushDirty();
  storage.resetWriteLog();
  return cache;
}

function workspace(
  id = "workspace-1",
  projectId = "project-1",
  workspaceDirectory = "/repo/paseo",
): WorkspaceDescriptorPayload {
  return {
    id,
    projectId,
    projectDisplayName: "Paseo",
    projectRootPath: workspaceDirectory,
    workspaceDirectory,
    projectKind: "git",
    workspaceKind: "local_checkout",
    name: "main",
    status: "running",
    statusEnteredAt: "2026-07-18T08:00:00.000Z",
    activityAt: null,
    archivingAt: null,
    diffStat: null,
    scripts: [],
  };
}

function agent(id: string, workspaceId = "workspace-1", cwd = "/repo/paseo") {
  return normalizeAgentSnapshot(
    {
      id,
      provider: "codex",
      cwd,
      workspaceId,
      model: null,
      createdAt: "2026-07-18T08:00:00.000Z",
      updatedAt: "2026-07-18T08:01:00.000Z",
      lastUserMessageAt: "2026-07-18T08:01:00.000Z",
      lastMessageAt: "2026-07-18T08:00:30.000Z",
      status: "idle",
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
      title: `Agent ${id}`,
      labels: {},
    },
    SERVER_ID,
  );
}

function message(id: string, text: string): StreamItem {
  return {
    kind: "assistant_message",
    id,
    text,
    timestamp: new Date("2026-07-18T08:02:00.000Z"),
    timelineCursor: { epoch: "epoch-1", seq: 12 },
  };
}

function seedSession(): void {
  const store = useSessionStore.getState();
  store.initializeSession(SERVER_ID, null);
  store.setAgents(SERVER_ID, new Map([["agent-1", agent("agent-1")]]));
  store.setWorkspaces(
    SERVER_ID,
    new Map([
      [
        "workspace-1",
        normalizeWorkspaceDescriptor({
          ...workspace(),
          workspaceKind: "worktree",
          worktreeSlug: "owned-worktree",
        }),
      ],
    ]),
  );
  store.setProjects(SERVER_ID, [
    normalizeProjectDescriptor({
      projectId: "project-1",
      projectKey: "remote:github.com/getpaseo/paseo",
      projectDisplayName: "Paseo",
      projectRootPath: "/repo/paseo",
      projectKind: "git",
    }),
    normalizeProjectDescriptor({
      projectId: "empty-project",
      projectDisplayName: "Empty project",
      projectRootPath: "/repo/empty",
      projectKind: "directory",
    }),
  ]);
  store.setFocusedAgentId(SERVER_ID, "agent-1");
  store.setAgentStreamTail(SERVER_ID, new Map([["agent-1", [message("message-1", "Cached")]]]));
  store.setAgentTimelineCursor(
    SERVER_ID,
    new Map([["agent-1", { epoch: "epoch-1", startSeq: 1, endSeq: 12 }]]),
  );
  store.setAgentTimelineHasOlder(SERVER_ID, new Map([["agent-1", true]]));
  store.setAgentAuthoritativeHistoryApplied(SERVER_ID, "agent-1", true);
}

function seedSecondaryAgent(): void {
  const store = useSessionStore.getState();
  store.setAgents(SERVER_ID, (agents) =>
    new Map(agents).set("agent-2", agent("agent-2", "workspace-2", "/repo/other")),
  );
  store.setWorkspaces(SERVER_ID, (workspaces) =>
    new Map(workspaces).set(
      "workspace-2",
      normalizeWorkspaceDescriptor(workspace("workspace-2", "project-2", "/repo/other")),
    ),
  );
  store.setProjects(SERVER_ID, [
    ...(store.sessions[SERVER_ID]?.projects.values() ?? []),
    normalizeProjectDescriptor({
      projectId: "project-2",
      projectDisplayName: "Other",
      projectRootPath: "/repo/other",
      projectKind: "git",
    }),
  ]);
  store.setAgentStreamTail(SERVER_ID, (timelines) =>
    new Map(timelines).set("agent-2", [message("message-2", "Other")]),
  );
}

function seedTimeline(serverId: string, text: string): void {
  const agentId = `agent-${serverId}`;
  const workspaceId = `workspace-${serverId}`;
  const workspaceDirectory = `/repo/${serverId}`;
  const store = useSessionStore.getState();
  store.initializeSession(serverId, null);
  store.setAgents(serverId, new Map([[agentId, agent(agentId, workspaceId, workspaceDirectory)]]));
  store.setWorkspaces(
    serverId,
    new Map([
      [
        workspaceId,
        normalizeWorkspaceDescriptor(
          workspace(workspaceId, `project-${serverId}`, workspaceDirectory),
        ),
      ],
    ]),
  );
  store.setFocusedAgentId(serverId, agentId);
  store.setAgentStreamTail(serverId, new Map([[agentId, [message(`message-${serverId}`, text)]]]));
}

afterEach(() => {
  for (const cache of startedCaches) cache.stop();
  startedCaches.clear();
  vi.useRealTimers();
  const store = useSessionStore.getState();
  store.clearSession(SERVER_ID);
  for (const serverId of LRU_SERVER_IDS) store.clearSession(serverId);
});

describe("ReplicaCache", () => {
  it("uses one trailing write after a sustained stream becomes quiet", async () => {
    vi.useFakeTimers();
    seedSession();
    const storage = new MemoryStorage();
    await startCleanCache(storage);

    for (let index = 0; index < 5; index += 1) {
      useSessionStore
        .getState()
        .setAgentStreamTail(
          SERVER_ID,
          new Map([["agent-1", [message(`live-${index}`, `${index}`)]]]),
        );
      if (index < 4) await vi.advanceTimersByTimeAsync(500);
    }

    expect(storage.attempts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(749);
    expect(storage.attempts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);

    expect(storage.writes).toHaveLength(1);
    expect(persistedHost(storage.writes[0]!, SERVER_ID)?.timeline?.items).toEqual([
      expect.objectContaining({ text: "4" }),
    ]);
  });

  it("does not write for unrelated, non-focused, or equivalent stable projections", async () => {
    vi.useFakeTimers();
    seedSession();
    seedSecondaryAgent();
    const storage = new MemoryStorage();
    await startCleanCache(storage);
    const store = useSessionStore.getState();

    store.setAgentLastActivity("agent-1", new Date("2026-07-18T09:00:00.000Z"));
    await vi.advanceTimersByTimeAsync(750);
    expect(storage.attempts).toHaveLength(0);

    store.setAgents(SERVER_ID, (agents) => {
      const focused = agents.get("agent-1");
      if (!focused) throw new Error("expected focused agent");
      return new Map(agents).set("agent-1", {
        ...focused,
        pendingPermissions: [{ id: "permission-1", provider: "codex", name: "read", kind: "tool" }],
        providerRetryMessage: "Retrying",
      });
    });
    await vi.advanceTimersByTimeAsync(750);
    expect(storage.attempts).toHaveLength(0);

    store.setAgents(SERVER_ID, (agents) => {
      const next = new Map(agents);
      const focused = next.get("agent-1");
      const background = next.get("agent-2");
      if (!focused || !background) throw new Error("expected seeded agents");
      next.set("agent-1", { ...focused });
      next.set("agent-2", { ...background, title: "Changed in background" });
      return next;
    });
    store.setWorkspaces(SERVER_ID, (workspaces) => {
      const background = workspaces.get("workspace-2");
      if (!background) throw new Error("expected background workspace");
      return new Map(workspaces).set("workspace-2", { ...background, name: "other-branch" });
    });
    store.setAgentStreamTail(SERVER_ID, (timelines) =>
      new Map(timelines).set("agent-2", [message("background-update", "Changed")]),
    );
    await vi.advanceTimersByTimeAsync(750);

    expect(storage.attempts).toHaveLength(0);
  });

  it("flushes the new focused projection immediately and retains the last focus on null", async () => {
    vi.useFakeTimers();
    seedSession();
    seedSecondaryAgent();
    const storage = new MemoryStorage();
    const cache = await startCleanCache(storage);

    useSessionStore.getState().setFocusedAgentId(SERVER_ID, "agent-2");
    await cache.drain();

    expect(storage.writes).toHaveLength(1);
    expect(persistedHost(storage.writes[0]!, SERVER_ID)?.agents[0]?.snapshot.id).toBe("agent-2");

    storage.resetWriteLog();
    useSessionStore.getState().setFocusedAgentId(SERVER_ID, null);
    await vi.advanceTimersByTimeAsync(750);
    expect(storage.attempts).toHaveLength(0);
  });

  it.each([
    ["status then stream", ["status", "stream"] as const],
    ["stream then status", ["stream", "status"] as const],
  ])("flushes terminal state once when final signals arrive %s", async (_name, sources) => {
    vi.useFakeTimers();
    seedSession();
    const storage = new MemoryStorage();
    const cache = await startCleanCache(storage);
    const terminal = message("terminal", "Done");

    for (const source of sources) {
      if (source === "stream") {
        useSessionStore
          .getState()
          .setAgentStreamTail(SERVER_ID, new Map([["agent-1", [terminal]]]));
      }
      cache.notifyFinal(SERVER_ID, "agent-1", source);
    }
    await cache.drain();

    expect(storage.writes).toHaveLength(1);
    expect(persistedHost(storage.writes[0]!, SERVER_ID)?.timeline?.items).toEqual([
      expect.objectContaining({ text: "Done" }),
    ]);
  });

  it("falls back to a bounded final flush when only one final signal arrives", async () => {
    vi.useFakeTimers();
    seedSession();
    const storage = new MemoryStorage();
    const cache = await startCleanCache(storage);
    useSessionStore
      .getState()
      .setAgentStreamTail(SERVER_ID, new Map([["agent-1", [message("terminal", "Done")]]]));

    cache.notifyFinal(SERVER_ID, "agent-1", "stream");
    await vi.advanceTimersByTimeAsync(749);
    expect(storage.attempts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);

    expect(storage.writes).toHaveLength(1);
  });

  it("ignores final signals for a non-focused agent", async () => {
    vi.useFakeTimers();
    seedSession();
    seedSecondaryAgent();
    const storage = new MemoryStorage();
    const cache = await startCleanCache(storage);

    cache.notifyFinal(SERVER_ID, "agent-2", "status");
    cache.notifyFinal(SERVER_ID, "agent-2", "stream");
    await vi.advanceTimersByTimeAsync(750);

    expect(storage.attempts).toHaveLength(0);
  });

  it("keeps another host's dirty window intact during a host-scoped final flush", async () => {
    vi.useFakeTimers();
    seedTimeline("host-a", "A old");
    seedTimeline("host-b", "B old");
    const storage = new MemoryStorage();
    const cache = await startCleanCache(storage, ["host-a", "host-b"]);

    useSessionStore
      .getState()
      .setAgentStreamTail(
        "host-b",
        new Map([["agent-host-b", [message("message-host-b-new", "B new")]]]),
      );
    useSessionStore
      .getState()
      .setAgentStreamTail(
        "host-a",
        new Map([["agent-host-a", [message("message-host-a-final", "A final")]]]),
      );
    cache.notifyFinal("host-a", "agent-host-a", "status");
    cache.notifyFinal("host-a", "agent-host-a", "stream");
    await cache.flushDirtyHost("host-a");

    expect(storage.writes).toHaveLength(1);
    expect(persistedHost(storage.writes[0]!, "host-a")?.timeline?.items[0]?.text).toBe("A final");
    expect(persistedHost(storage.writes[0]!, "host-b")?.timeline?.items[0]?.text).toBe("B old");

    await vi.advanceTimersByTimeAsync(750);
    expect(storage.writes).toHaveLength(2);
    expect(persistedHost(storage.writes[1]!, "host-b")?.timeline?.items[0]?.text).toBe("B new");
  });

  it("coalesces repeated lifecycle flushes and skips clean hosts", async () => {
    seedSession();
    const storage = new MemoryStorage();
    const cache = await startCleanCache(storage);
    useSessionStore
      .getState()
      .setAgentStreamTail(SERVER_ID, new Map([["agent-1", [message("dirty", "Dirty")]]]));

    await Promise.all([cache.flushDirty(), cache.flushDirty(), cache.drain()]);
    expect(storage.writes).toHaveLength(1);

    await Promise.all([cache.flushDirty(), cache.flushDirty(), cache.drain()]);
    expect(storage.writes).toHaveLength(1);
  });

  it("retains dirty revisions after failure and retries on the next lifecycle trigger", async () => {
    seedSession();
    const storage = new MemoryStorage();
    const cache = await startCleanCache(storage);
    storage.failNextWrite();
    useSessionStore
      .getState()
      .setAgentStreamTail(SERVER_ID, new Map([["agent-1", [message("failed", "Retry me")]]]));

    await cache.flushDirty();
    expect(storage.attempts).toHaveLength(1);
    expect(storage.writes).toHaveLength(0);

    await cache.flushDirty();
    expect(storage.attempts).toHaveLength(2);
    expect(storage.writes).toHaveLength(1);
    expect(persistedHost(storage.writes[0]!, SERVER_ID)?.timeline?.items[0]?.text).toBe("Retry me");
  });

  it("does not clear a newer dirty revision captured while a write is in flight", async () => {
    seedSession();
    const storage = new MemoryStorage();
    const cache = await startCleanCache(storage);
    const releaseWrite = storage.blockNextWrite();
    useSessionStore
      .getState()
      .setAgentStreamTail(SERVER_ID, new Map([["agent-1", [message("first", "First")]]]));

    const firstFlush = cache.flushDirty();
    expect(storage.attempts).toHaveLength(1);
    useSessionStore
      .getState()
      .setAgentStreamTail(SERVER_ID, new Map([["agent-1", [message("second", "Second")]]]));
    releaseWrite();
    await firstFlush;

    await cache.flushDirty();
    expect(storage.writes).toHaveLength(2);
    expect(persistedHost(storage.writes[0]!, SERVER_ID)?.timeline?.items[0]?.text).toBe("First");
    expect(persistedHost(storage.writes[1]!, SERVER_ID)?.timeline?.items[0]?.text).toBe("Second");
  });

  it("keeps flush as a force-write compatibility entry point", async () => {
    seedSession();
    const storage = new MemoryStorage();
    const cache = await startCleanCache(storage);

    await cache.flush();
    await cache.flush();

    expect(storage.writes).toHaveLength(2);
  });

  it("persists focused replica changes without writing transient stream head updates", async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const cache = new ReplicaCache(storage);
    startedCaches.add(cache);
    cache.setHosts([SERVER_ID]);
    seedSession();
    await cache.flush();
    cache.start();
    const writesBeforeStream = storage.writes.length;

    useSessionStore
      .getState()
      .setAgentStreamHead(SERVER_ID, new Map([["agent-1", [message("live", "Streaming")]]]));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(storage.writes).toHaveLength(writesBeforeStream);

    useSessionStore
      .getState()
      .setAgentStreamTail(SERVER_ID, new Map([["agent-1", [message("saved", "Committed")]]]));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(storage.writes).toHaveLength(writesBeforeStream + 1);
    cache.setHosts([]);
  });

  it("restores a displayable stale replica without claiming remote hydration", async () => {
    const storage = new MemoryStorage();
    const writer = new ReplicaCache(storage);
    writer.setHosts([SERVER_ID]);
    seedSession();
    await writer.flush();

    useSessionStore.getState().clearSession(SERVER_ID);

    const reader = new ReplicaCache(storage);
    reader.setHosts([SERVER_ID]);
    await reader.restore();

    const session = useSessionStore.getState().sessions[SERVER_ID];
    expect(session).toBeDefined();
    if (!session) throw new Error("Expected restored session");
    expect(session.client).toBeNull();
    expect(session.hasHydratedAgents).toBe(false);
    expect(session.hasHydratedWorkspaces).toBe(false);
    expect(Array.from(session.agents.keys())).toEqual(["agent-1"]);
    expect(Array.from(session.workspaces.keys())).toEqual(["workspace-1"]);
    expect(Array.from(session.projects.keys())).toEqual(["project-1"]);
    expect(session.agents.get("agent-1")?.updatedAt).toBeInstanceOf(Date);
    expect(session.agents.get("agent-1")?.lastMessageAt).toEqual(
      new Date("2026-07-18T08:00:30.000Z"),
    );
    expect(session.workspaces.get("workspace-1")?.statusEnteredAt).toBeInstanceOf(Date);
    expect(session.workspaces.get("workspace-1")?.worktreeSlug).toBe("owned-worktree");
    expect(session.agentStreamTail.get("agent-1")).toEqual([message("message-1", "Cached")]);
    expect(session.agentAuthoritativeHistoryApplied).toEqual(new Map());
    expect(session.agentTimelineCursor).toEqual(new Map());
    expect(session.agentTimelineHasOlder).toEqual(new Map());
    expect(session.agentTimelineHasNewer).toEqual(new Map());
    expect(session.agentHistorySyncGeneration).toEqual(new Map());
    expect(selectAgentTimelineState(session, "agent-1")).toEqual({
      status: "painted",
      items: [message("message-1", "Cached")],
    });
  });

  it("restores legacy cache snapshots without lastMessageAt as null", async () => {
    const storage = new MemoryStorage();
    const writer = new ReplicaCache(storage);
    writer.setHosts([SERVER_ID]);
    seedSession();
    await writer.flush();

    const cacheKey = "@paseo:replica-cache";
    const cached = JSON.parse(storage.values.get(cacheKey) ?? "") as {
      hosts: Array<{ agents: Array<{ snapshot: Record<string, unknown> }> }>;
    };
    delete cached.hosts[0]?.agents[0]?.snapshot.lastMessageAt;
    storage.values.set(cacheKey, JSON.stringify(cached));
    useSessionStore.getState().clearSession(SERVER_ID);

    const reader = new ReplicaCache(storage);
    reader.setHosts([SERVER_ID]);
    await reader.restore();

    expect(
      useSessionStore.getState().sessions[SERVER_ID]?.agents.get("agent-1")?.lastMessageAt,
    ).toBeNull();
  });

  it("persists only the focused agent view with a short timeline tail", async () => {
    const storage = new MemoryStorage();
    const cache = new ReplicaCache(storage);
    cache.setHosts([SERVER_ID]);
    seedSession();

    const store = useSessionStore.getState();
    store.setAgents(SERVER_ID, (agents) =>
      new Map(agents).set("agent-2", agent("agent-2", "workspace-2", "/repo/other")),
    );
    store.setWorkspaces(SERVER_ID, (workspaces) =>
      new Map(workspaces).set(
        "workspace-2",
        normalizeWorkspaceDescriptor(workspace("workspace-2", "project-2", "/repo/other")),
      ),
    );
    const secondTimeline = Array.from({ length: 60 }, (_, index) =>
      message(`message-${index}`, `Second ${index}`),
    );
    store.setAgentStreamTail(
      SERVER_ID,
      new Map([
        ["agent-1", [message("message-1", "First")]],
        ["agent-2", secondTimeline],
      ]),
    );
    store.setFocusedAgentId(SERVER_ID, "agent-2");
    await cache.flush();

    store.clearSession(SERVER_ID);
    const reader = new ReplicaCache(storage);
    reader.setHosts([SERVER_ID]);
    await reader.restore();

    const session = useSessionStore.getState().sessions[SERVER_ID];
    const timelines = session?.agentStreamTail;
    expect(Array.from(session?.agents.keys() ?? [])).toEqual(["agent-2"]);
    expect(Array.from(session?.workspaces.keys() ?? [])).toEqual(["workspace-2"]);
    expect(Array.from(session?.projects.keys() ?? [])).toEqual(["project-2"]);
    expect(Array.from(timelines?.keys() ?? [])).toEqual(["agent-2"]);
    expect(timelines?.get("agent-2")).toEqual(secondTimeline.slice(-50));

    const persisted = JSON.parse(storage.values.get("@paseo:replica-cache") ?? "null") as {
      version: number;
      hosts: Array<{ timeline: Record<string, unknown> | null }>;
    };
    expect(persisted.version).toBe(6);
    expect(Object.keys(persisted.hosts[0]?.timeline ?? {}).sort()).toEqual(["agentId", "items"]);
  });

  it("persists reconciled rows without caching unreconciled local presentations", async () => {
    const storage = new MemoryStorage();
    const cache = new ReplicaCache(storage);
    cache.setHosts([SERVER_ID]);
    seedSession();
    const unreconciled = createUserMessage({
      clientMessageId: "client-pending",
      text: "Pending",
      timestamp: new Date("2026-07-18T08:01:00.000Z"),
    });
    const reconciled = createUserMessage({
      clientMessageId: "client-sent",
      messageId: "provider-sent",
      timelineCursor: { epoch: "epoch-1", seq: 11 },
      text: "Sent",
      timestamp: new Date("2026-07-18T08:01:30.000Z"),
    });
    useSessionStore
      .getState()
      .setAgentStreamTail(SERVER_ID, new Map([["agent-1", [unreconciled, reconciled]]]));

    await cache.flush();
    useSessionStore.getState().clearSession(SERVER_ID);
    await cache.restore();

    expect(useSessionStore.getState().sessions[SERVER_ID]?.agentStreamTail.get("agent-1")).toEqual([
      reconciled,
    ]);
  });

  it("rejects cached provider retry state instead of restoring it", async () => {
    const storage = new MemoryStorage();
    const writer = new ReplicaCache(storage);
    writer.setHosts([SERVER_ID]);
    seedSession();
    useSessionStore.getState().setAgents(SERVER_ID, (agents) => {
      const current = agents.get("agent-1");
      if (!current) throw new Error("expected seeded agent");
      return new Map(agents).set("agent-1", {
        ...current,
        providerRetryMessage: "Reconnecting... 2/5",
      });
    });
    await writer.flush();

    interface CachedPayload {
      version: number;
      hosts: Array<{
        agents: Array<{ snapshot: Record<string, unknown> }>;
      }>;
    }
    const cacheKey = "@paseo:replica-cache";
    const cached: CachedPayload = JSON.parse(storage.values.get(cacheKey) ?? "");
    expect(cached.hosts[0]?.agents[0]?.snapshot).not.toHaveProperty("providerRetryMessage");
    cached.hosts[0]!.agents[0]!.snapshot.providerRetryMessage = "Reconnecting... 5/5";
    storage.values.set(cacheKey, JSON.stringify(cached));

    useSessionStore.getState().clearSession(SERVER_ID);
    const reader = new ReplicaCache(storage);
    reader.setHosts([SERVER_ID]);
    await reader.restore();

    expect(storage.values.has(cacheKey)).toBe(false);
    expect(useSessionStore.getState().sessions[SERVER_ID]).toBeUndefined();
  });

  it("evicts the least recently written host when the cache exceeds its byte budget", async () => {
    const storage = new MemoryStorage();
    const cache = new ReplicaCache(storage, { maxBytes: 7_000 });
    cache.setHosts(LRU_SERVER_IDS.slice(0, 2));
    seedTimeline("host-a", "A".repeat(1_200));
    seedTimeline("host-b", "B".repeat(1_200));
    await cache.flush();

    seedTimeline("host-a", "A".repeat(1_201));
    await cache.flush();

    cache.setHosts(LRU_SERVER_IDS);
    seedTimeline("host-c", "C".repeat(1_200));
    await cache.flush();

    for (const serverId of LRU_SERVER_IDS) {
      useSessionStore.getState().clearSession(serverId);
    }
    const reader = new ReplicaCache(storage, { maxBytes: 7_000 });
    reader.setHosts(LRU_SERVER_IDS);
    await reader.restore();

    expect(Object.keys(useSessionStore.getState().sessions).sort()).toEqual(["host-a", "host-c"]);
  });

  it.each([3, 5])(
    "rejects and clears version %s cache data before overwriting it on flush",
    async (version) => {
      const storage = new MemoryStorage();
      storage.values.set(
        "@paseo:replica-cache",
        JSON.stringify({
          version,
          hosts: [],
        }),
      );
      const cache = new ReplicaCache(storage);
      cache.setHosts([SERVER_ID]);

      await cache.restore();
      expect(storage.values.has("@paseo:replica-cache")).toBe(false);
      await cache.flush();

      expect(useSessionStore.getState().sessions[SERVER_ID]).toBeUndefined();
      expect(JSON.parse(storage.values.get("@paseo:replica-cache") ?? "null")).toEqual({
        version: 6,
        hosts: [],
      });
    },
  );
});
