import { expect, type Page } from "@playwright/test";

/** Browser storage key used by the replica cache */
const STORAGE_KEY = "@paseo:replica-cache";

interface ReplicaCacheTimeline {
  agentId?: string;
  items?: Array<Record<string, unknown>>;
  range?: {
    endSeq?: number;
    epoch?: string;
    startSeq?: number;
  } | null;
}

interface ReplicaCacheHostRecord {
  serverId: string;
  agents: Array<Record<string, unknown>>;
  workspaces: Array<Record<string, unknown>>;
  projects: Array<Record<string, unknown>>;
  emptyProjects?: Array<Record<string, unknown>>;
  timeline?: ReplicaCacheTimeline | null;
  timelines: ReplicaCacheTimeline[];
}

export interface ReplicaCacheRecord {
  version?: number;
  hosts?: ReplicaCacheHostRecord[];
}

interface ReplicaCacheWriteObserverState {
  lastValue: string | null;
  redundantWrites: number;
  serializedChars: number;
  storageDurationMs: number;
  writes: number;
}

interface ReplicaCacheWriteObserverReport {
  redundantWrites: number;
  serializedChars: number;
  storageDurationMs: number;
  writes: number;
}

declare global {
  interface Window {
    __replicaCacheWriteObserver?: ReplicaCacheWriteObserverState;
  }
}

/** Presents the persisted singleton timeline as the test helper's legacy collection */
function addTimelineCompatibility(cache: ReplicaCacheRecord): ReplicaCacheRecord {
  return {
    ...cache,
    hosts: cache.hosts?.map((host) => ({
      ...host,
      timelines: host.timeline ? [host.timeline] : [],
    })),
  };
}

/** Restores the persisted singleton timeline schema before writing browser storage */
function removeTimelineCompatibility(cache: ReplicaCacheRecord): Record<string, unknown> {
  return {
    ...cache,
    hosts: cache.hosts?.map(({ timelines, ...host }) => ({
      ...host,
      timeline: timelines[0] ?? null,
    })),
  };
}

/** Reads the currently persisted replica cache from browser storage */
export async function readReplicaCache(page: Page): Promise<ReplicaCacheRecord | null> {
  const raw = await page.evaluate((storageKey) => localStorage.getItem(storageKey), STORAGE_KEY);
  return raw ? addTimelineCompatibility(JSON.parse(raw) as ReplicaCacheRecord) : null;
}

/** Waits for a workspace to appear in the persisted replica cache */
export async function waitForWorkspaceInReplicaCache(
  page: Page,
  workspaceId: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const cache = await readReplicaCache(page);
        return cache?.hosts?.some((host) =>
          host.workspaces.some((workspace) => workspace.id === workspaceId),
        );
      },
      { timeout: 15_000 },
    )
    .toBe(true);
}

/** Waits for an archived workspace to disappear from the persisted replica cache */
export async function waitForWorkspaceToLeaveReplicaCache(
  page: Page,
  workspaceId: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const cache = await readReplicaCache(page);
        return cache?.hosts?.some((host) =>
          host.workspaces.some((workspace) => workspace.id === workspaceId),
        );
      },
      { timeout: 15_000 },
    )
    .toBe(false);
}

/** Writes a test replica-cache value using the application storage schema */
export async function writeReplicaCache(page: Page, value: ReplicaCacheRecord): Promise<void> {
  await page.evaluate(({ storageKey, raw }) => localStorage.setItem(storageKey, raw), {
    storageKey: STORAGE_KEY,
    raw: JSON.stringify(removeTimelineCompatibility(value)),
  });
}

/** Installs a localStorage observer for replica-cache write assertions */
export async function observeReplicaCacheStorageWrites(page: Page): Promise<void> {
  await page.addInitScript((storageKey) => {
    window.__replicaCacheWriteObserver = {
      lastValue: null,
      redundantWrites: 0,
      serializedChars: 0,
      storageDurationMs: 0,
      writes: 0,
    };
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function measuredSetItem(key: string, value: string) {
      if (this !== localStorage || key !== storageKey) {
        return originalSetItem.call(this, key, value);
      }
      const startedAt = performance.now();
      originalSetItem.call(this, key, value);
      const state = window.__replicaCacheWriteObserver;
      if (!state) return;
      if (state.lastValue === value) state.redundantWrites += 1;
      state.lastValue = value;
      state.writes += 1;
      state.serializedChars += value.length;
      state.storageDurationMs += performance.now() - startedAt;
    };
  }, STORAGE_KEY);
}

/** Resets replica-cache write measurements while retaining the current stored value */
export async function resetReplicaCacheStorageWriteObserver(page: Page): Promise<void> {
  const lastValue = await page.evaluate(
    (storageKey) => localStorage.getItem(storageKey),
    STORAGE_KEY,
  );
  await page.evaluate((value) => {
    window.__replicaCacheWriteObserver = {
      lastValue: value,
      redundantWrites: 0,
      serializedChars: 0,
      storageDurationMs: 0,
      writes: 0,
    };
  }, lastValue);
}

/** Returns the accumulated replica-cache write measurements */
export async function readReplicaCacheStorageWriteObserver(
  page: Page,
): Promise<ReplicaCacheWriteObserverReport> {
  return page.evaluate(() => {
    const state = window.__replicaCacheWriteObserver;
    if (!state) throw new Error("Replica cache write observer is not installed");
    return {
      redundantWrites: state.redundantWrites,
      serializedChars: state.serializedChars,
      storageDurationMs: state.storageDurationMs,
      writes: state.writes,
    };
  });
}
