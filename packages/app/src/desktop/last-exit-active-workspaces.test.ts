import { describe, expect, it } from "vitest";
import {
  collectLastExitActiveWorkspaces,
  createLastExitActiveWorkspaceStore,
  getLastExitActiveWorkspaceStore,
  type LastExitActiveWorkspaceStorage,
} from "./last-exit-active-workspaces";

interface AgentFixtureInput {
  id: string;
  workspaceId?: string;
  status: "idle" | "running" | "closed";
  archived?: boolean;
  parentAgentId?: string | null;
}

/** Creates the minimal Agent projection consumed by the last-exit marker policy. */
function agent(input: AgentFixtureInput) {
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    status: input.status,
    archivedAt: input.archived ? new Date("2026-08-19T00:00:00.000Z") : null,
    parentAgentId: input.parentAgentId ?? null,
  };
}

/** Creates synchronous storage with state shared across store instances. */
function createMemoryStorage(): LastExitActiveWorkspaceStorage & {
  values: Map<string, string>;
} {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe("last-exit active workspaces", () => {
  it("collects only workspaces with an unarchived running root Agent", () => {
    const runningRoot = agent({
      id: "running-root",
      workspaceId: "workspace-running",
      status: "running",
    });
    const agents = new Map([
      [runningRoot.id, runningRoot],
      ["idle-root", agent({ id: "idle-root", workspaceId: "workspace-idle", status: "idle" })],
      [
        "archived-root",
        agent({
          id: "archived-root",
          workspaceId: "workspace-archived",
          status: "running",
          archived: true,
        }),
      ],
      [
        "running-child",
        agent({
          id: "running-child",
          workspaceId: "workspace-running",
          status: "running",
          parentAgentId: runningRoot.id,
        }),
      ],
      ["missing-workspace", agent({ id: "missing-workspace", status: "running" })],
    ]);

    expect(
      collectLastExitActiveWorkspaces({
        "server-a": { agents },
      }),
    ).toEqual([{ serverId: "server-a", workspaceId: "workspace-running" }]);
  });

  it("restores a recorded workspace from synchronous storage in a new store instance", () => {
    const storage = createMemoryStorage();
    const workspace = { serverId: "server:a", workspaceId: "C:\\repo:feature" };

    createLastExitActiveWorkspaceStore(storage).record([workspace]);

    expect(createLastExitActiveWorkspaceStore(storage).has(workspace)).toBe(true);
  });

  it("preserves opaque workspace identities without trimming them", () => {
    const storage = createMemoryStorage();
    const workspace = { serverId: " server:a ", workspaceId: " C:\\repo:feature " };
    const store = createLastExitActiveWorkspaceStore(storage);

    store.record([workspace]);

    expect(store.has(workspace)).toBe(true);
    expect(createLastExitActiveWorkspaceStore(storage).has(workspace)).toBe(true);
  });

  it("dismisses only the workspace that the user opens", () => {
    const storage = createMemoryStorage();
    const opened = { serverId: "server-a", workspaceId: "workspace-opened" };
    const unread = { serverId: "server-a", workspaceId: "workspace-unread" };
    const store = createLastExitActiveWorkspaceStore(storage);
    store.record([opened, unread]);

    store.dismiss(opened);

    const restored = createLastExitActiveWorkspaceStore(storage);
    expect(restored.has(opened)).toBe(false);
    expect(restored.has(unread)).toBe(true);
  });

  it("merges records written by separate window store instances", () => {
    const storage = createMemoryStorage();
    const first = { serverId: "server-a", workspaceId: "workspace-first" };
    const second = { serverId: "server-b", workspaceId: "workspace-second" };
    const firstWindow = createLastExitActiveWorkspaceStore(storage);
    const secondWindow = createLastExitActiveWorkspaceStore(storage);

    firstWindow.record([first]);
    secondWindow.record([second]);

    const restored = createLastExitActiveWorkspaceStore(storage);
    expect(restored.has(first)).toBe(true);
    expect(restored.has(second)).toBe(true);
  });

  it("preserves another window's newer marker when dismissing an older one", () => {
    const storage = createMemoryStorage();
    const first = { serverId: "server-a", workspaceId: "workspace-first" };
    const second = { serverId: "server-b", workspaceId: "workspace-second" };
    const firstWindow = createLastExitActiveWorkspaceStore(storage);
    const secondWindow = createLastExitActiveWorkspaceStore(storage);
    firstWindow.record([first]);
    secondWindow.record([second]);

    firstWindow.dismiss(first);

    const restored = createLastExitActiveWorkspaceStore(storage);
    expect(restored.has(first)).toBe(false);
    expect(restored.has(second)).toBe(true);
  });

  it("clears a corrupted marker document instead of exposing it", () => {
    const storage = createMemoryStorage();
    storage.values.set("paseo:last-exit-active-workspaces", "{not-json");

    const store = createLastExitActiveWorkspaceStore(storage);

    expect(store.has({ serverId: "server-a", workspaceId: "workspace-a" })).toBe(false);
    expect(storage.values.has("paseo:last-exit-active-workspaces")).toBe(false);
  });

  it("notifies marker subscribers when an opened workspace is dismissed", () => {
    const storage = createMemoryStorage();
    const workspace = { serverId: "server-a", workspaceId: "workspace-a" };
    const store = createLastExitActiveWorkspaceStore(storage);
    const snapshots: boolean[] = [];
    store.record([workspace]);
    const unsubscribe = store.subscribe(() => snapshots.push(store.has(workspace)));

    store.dismiss(workspace);
    unsubscribe();

    expect(snapshots).toEqual([false]);
  });

  it("falls back to a no-op store when the localStorage getter is unavailable", () => {
    const previousWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const restrictedWindow = {};
    Object.defineProperty(restrictedWindow, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("storage denied");
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: restrictedWindow,
    });

    try {
      const store = getLastExitActiveWorkspaceStore();
      const workspace = { serverId: "server-a", workspaceId: "workspace-a" };

      expect(store.has(workspace)).toBe(false);
      expect(() => store.record([workspace])).not.toThrow();
    } finally {
      if (previousWindowDescriptor) {
        Object.defineProperty(globalThis, "window", previousWindowDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, "window");
      }
    }
  });
});
