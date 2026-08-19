import { z } from "zod";
import type { Agent } from "@/stores/session-store";
import { isWorkspaceRootAgent } from "@/subagents/policies";

/** Browser-local key containing workspace markers from prior desktop exits. */
export const LAST_EXIT_ACTIVE_WORKSPACES_STORAGE_KEY = "paseo:last-exit-active-workspaces";

/** Stable workspace identity persisted for a one-time return marker. */
export interface LastExitActiveWorkspace {
  /** Host whose Agent was running when the desktop app exited. */
  serverId: string;
  /** Opaque workspace identity owned by that host. */
  workspaceId: string;
}

/** Session fields required to derive last-exit workspace markers. */
export interface LastExitActiveWorkspaceSession {
  /** Authoritative Agent directory for one connected host. */
  agents: ReadonlyMap<
    string,
    Pick<Agent, "id" | "workspaceId" | "status" | "archivedAt" | "parentAgentId">
  >;
}

/** Synchronous persistence required during Electron's final quit boundary. */
export interface LastExitActiveWorkspaceStorage {
  /** Reads a serialized marker document. */
  getItem(key: string): string | null;
  /** Writes a serialized marker document before the renderer exits. */
  setItem(key: string, value: string): void;
  /** Removes the marker document when no entries remain. */
  removeItem(key: string): void;
}

/** Mutable marker collection shared by the quit lifecycle and sidebar rows. */
export interface LastExitActiveWorkspaceStore {
  /** Merges workspaces observed at exit into the persisted unread set. */
  record(workspaces: readonly LastExitActiveWorkspace[]): void;
  /** Reports whether one workspace still carries a last-exit marker. */
  has(workspace: LastExitActiveWorkspace): boolean;
  /** Clears the marker after the user opens that workspace. */
  dismiss(workspace: LastExitActiveWorkspace): void;
  /** Subscribes to marker changes for sidebar rendering. */
  subscribe(listener: () => void): () => void;
  /** Stable scalar used by useSyncExternalStore to observe marker changes. */
  getRevision(): number;
}

/** Rejects blank identities while preserving the opaque value exactly as supplied. */
const NonBlankWorkspaceIdentitySchema = z.string().refine((value) => value.trim().length > 0, {
  message: "Workspace identity must not be blank.",
});

/** Valid persisted workspace identity. */
const LastExitActiveWorkspaceSchema = z.strictObject({
  serverId: NonBlankWorkspaceIdentitySchema,
  workspaceId: NonBlankWorkspaceIdentitySchema,
});

/** Versioned local document so future formats can fail closed. */
const PersistedLastExitActiveWorkspacesSchema = z.strictObject({
  version: z.literal(1),
  workspaces: z.array(LastExitActiveWorkspaceSchema),
});

/** Produces a collision-free in-memory key without parsing opaque identities later. */
function workspaceIdentityKey(workspace: LastExitActiveWorkspace): string {
  return JSON.stringify([workspace.serverId, workspace.workspaceId]);
}

/** Reads and validates the current marker document. */
function readStoredWorkspaces(storage: LastExitActiveWorkspaceStorage): LastExitActiveWorkspace[] {
  const raw = storage.getItem(LAST_EXIT_ACTIVE_WORKSPACES_STORAGE_KEY);
  if (raw === null) return [];

  try {
    const result = PersistedLastExitActiveWorkspacesSchema.safeParse(JSON.parse(raw));
    if (result.success) return result.data.workspaces;
  } catch {
    // Invalid non-critical UI state must never cross the persistence boundary.
  }
  storage.removeItem(LAST_EXIT_ACTIVE_WORKSPACES_STORAGE_KEY);
  return [];
}

/** Writes the canonical versioned marker document. */
function writeStoredWorkspaces(
  storage: LastExitActiveWorkspaceStorage,
  workspaces: readonly LastExitActiveWorkspace[],
): void {
  if (workspaces.length === 0) {
    storage.removeItem(LAST_EXIT_ACTIVE_WORKSPACES_STORAGE_KEY);
    return;
  }
  storage.setItem(
    LAST_EXIT_ACTIVE_WORKSPACES_STORAGE_KEY,
    JSON.stringify({ version: 1, workspaces }),
  );
}

/** Creates a synchronous marker store backed by the provided storage boundary. */
export function createLastExitActiveWorkspaceStore(
  storage: LastExitActiveWorkspaceStorage,
): LastExitActiveWorkspaceStore {
  let workspacesByKey = new Map(
    readStoredWorkspaces(storage).map((workspace) => [workspaceIdentityKey(workspace), workspace]),
  );
  const listeners = new Set<() => void>();
  let revision = 0;

  /** Publishes one changed revision to every current subscriber. */
  function notify(): void {
    for (const listener of listeners) listener();
  }

  return {
    record(workspaces): void {
      const merged = new Map(
        readStoredWorkspaces(storage).map((workspace) => [
          workspaceIdentityKey(workspace),
          workspace,
        ]),
      );
      for (const workspace of workspaces) {
        const parsed = LastExitActiveWorkspaceSchema.safeParse(workspace);
        if (!parsed.success) continue;
        merged.set(workspaceIdentityKey(parsed.data), parsed.data);
      }
      workspacesByKey = merged;
      writeStoredWorkspaces(storage, [...merged.values()]);
      revision += 1;
      notify();
    },
    has(workspace): boolean {
      return workspacesByKey.has(workspaceIdentityKey(workspace));
    },
    dismiss(workspace): void {
      const key = workspaceIdentityKey(workspace);
      const latest = new Map(
        readStoredWorkspaces(storage).map((storedWorkspace) => [
          workspaceIdentityKey(storedWorkspace),
          storedWorkspace,
        ]),
      );
      if (!latest.has(key)) return;
      latest.delete(key);
      workspacesByKey = latest;
      writeStoredWorkspaces(storage, [...latest.values()]);
      revision += 1;
      notify();
    },
    subscribe(listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getRevision(): number {
      return revision;
    },
  };
}

/** Stable no-op boundary used by native, SSR, and restricted browser runtimes. */
const EMPTY_LAST_EXIT_ACTIVE_WORKSPACE_STORE: LastExitActiveWorkspaceStore = {
  record: () => {},
  has: () => false,
  dismiss: () => {},
  subscribe: () => () => {},
  getRevision: () => 0,
};

/** Lazily initialized renderer-local store backed by the current browser profile. */
let browserLastExitActiveWorkspaceStore: LastExitActiveWorkspaceStore | null = null;

/** Reads browser storage without allowing restricted-environment getters to escape. */
function getBrowserLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Returns the renderer-local marker store, or a no-op store outside a browser runtime. */
export function getLastExitActiveWorkspaceStore(): LastExitActiveWorkspaceStore {
  if (browserLastExitActiveWorkspaceStore) {
    return browserLastExitActiveWorkspaceStore;
  }
  const browserStorage = getBrowserLocalStorage();
  if (!browserStorage) {
    return EMPTY_LAST_EXIT_ACTIVE_WORKSPACE_STORE;
  }

  browserLastExitActiveWorkspaceStore = createLastExitActiveWorkspaceStore({
    getItem: (key) => {
      try {
        return browserStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem: (key, value) => {
      try {
        browserStorage.setItem(key, value);
      } catch {
        // A storage failure must not block app startup or quit.
      }
    },
    removeItem: (key) => {
      try {
        browserStorage.removeItem(key);
      } catch {
        // A storage failure must not block app startup or quit.
      }
    },
  });
  return browserLastExitActiveWorkspaceStore;
}

/**
 * Returns workspaces whose unarchived root Agent was running at the snapshot boundary.
 * Multiple running roots in one workspace collapse to one structured identity.
 */
export function collectLastExitActiveWorkspaces(
  sessions: Readonly<Record<string, LastExitActiveWorkspaceSession | undefined>>,
): LastExitActiveWorkspace[] {
  const workspaces: LastExitActiveWorkspace[] = [];

  for (const [serverId, session] of Object.entries(sessions)) {
    if (!session) continue;
    const workspaceIds = new Set<string>();

    for (const agent of session.agents.values()) {
      const workspaceId = agent.workspaceId;
      if (agent.status !== "running" || agent.archivedAt || !workspaceId) {
        continue;
      }
      const parentAgent = agent.parentAgentId ? session.agents.get(agent.parentAgentId) : undefined;
      if (!isWorkspaceRootAgent(agent, parentAgent)) {
        continue;
      }
      workspaceIds.add(workspaceId);
    }

    for (const workspaceId of workspaceIds) {
      workspaces.push({ serverId, workspaceId });
    }
  }

  return workspaces;
}
