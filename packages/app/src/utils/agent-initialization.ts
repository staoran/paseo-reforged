import { createAppTimelineRequestId } from "@/timeline/timeline-response-ownership";

export type InitRequestSource = "direct" | "viewed";

export interface DeferredInit {
  /** Promise observed by the Agent screen while history is loading. */
  promise: Promise<void>;
  /** Completes this exact initialization attempt. */
  resolve: () => void;
  /** Fails this exact initialization attempt. */
  reject: (error: Error) => void;
  /** Current deadline owned by this initialization attempt. */
  timeoutId: ReturnType<typeof setTimeout> | null;
  /** Direction whose response is allowed to settle this initialization. */
  requestDirection: "tail" | "after";
  /** Current wire request allowed to settle this initialization. */
  requestId: string;
  /** Entry point that started the first wire request. */
  requestSource: InitRequestSource;
  /** Daemon client instance allowed to disconnect this initialization. */
  connectionOwner: object | null;
}

/** Active initialization attempts keyed by daemon and Agent identity. */
const initPromises = new Map<string, DeferredInit>();
export const INIT_TIMEOUT_MS = 65_000;

/** Builds the stable map key for one Agent initialization. */
export function getInitKey(serverId: string, agentId: string): string {
  return `${serverId}:${agentId}`;
}

/** Returns the currently active initialization attempt for a key. */
export function getInitDeferred(key: string): DeferredInit | undefined {
  return initPromises.get(key);
}

/** Creates and installs a new initialization attempt. */
export function createInitDeferred(
  key: string,
  requestDirection: "tail" | "after",
  requestSource: InitRequestSource = "direct",
  connectionOwner: object | null = null,
): DeferredInit {
  let resolve!: () => void;
  let reject!: (error: Error) => void;

  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const deferred: DeferredInit = {
    promise,
    resolve,
    reject,
    timeoutId: null,
    requestDirection,
    requestId: createAppTimelineRequestId(requestSource === "direct" ? "initialization" : "viewed"),
    requestSource,
    connectionOwner,
  };
  initPromises.set(key, deferred);
  return deferred;
}

/** Transfers an active initialization to a viewed request generation. */
export function claimInitDeferredRequest(input: {
  key: string;
  deferred: DeferredInit;
  requestDirection: "tail" | "after";
  reuseCurrentRequest?: boolean;
  connectionOwner?: object;
}): string | null {
  if (initPromises.get(input.key) !== input.deferred) return null;

  const canReuseCurrentRequest =
    input.reuseCurrentRequest === true &&
    input.connectionOwner !== undefined &&
    input.deferred.connectionOwner === input.connectionOwner &&
    input.deferred.requestDirection === input.requestDirection;
  if (!canReuseCurrentRequest) {
    input.deferred.requestId = createAppTimelineRequestId("viewed");
  }
  input.deferred.requestDirection = input.requestDirection;
  input.deferred.requestSource = "viewed";
  if (input.connectionOwner !== undefined) {
    input.deferred.connectionOwner = input.connectionOwner;
  }
  return input.deferred.requestId;
}

/** Rejects only an initialization owned by the supplied daemon client instance. */
export function rejectInitDeferredForConnection(
  key: string,
  error: Error,
  connectionOwner: object,
): boolean {
  const deferred = initPromises.get(key);
  if (!deferred || deferred.connectionOwner !== connectionOwner) return false;
  return rejectInitDeferred(key, error, deferred, deferred.requestId);
}

/** Replaces the deadline only while the supplied attempt still owns the key. */
export function refreshInitTimeout(input: {
  key: string;
  deferred: DeferredInit;
  requestId: string;
  onTimeout: () => void;
  timeoutMs?: number;
}): boolean {
  const deferred = initPromises.get(input.key);
  if (deferred !== input.deferred || deferred.requestId !== input.requestId) return false;

  const timeoutId = setTimeout(() => {
    if (initPromises.get(input.key) !== deferred || deferred.requestId !== input.requestId) return;
    input.onTimeout();
  }, input.timeoutMs ?? INIT_TIMEOUT_MS);
  if (deferred.timeoutId) {
    clearTimeout(deferred.timeoutId);
  }
  deferred.timeoutId = timeoutId;
  return true;
}

/** Resolves the current attempt, optionally requiring an exact owner. */
export function resolveInitDeferred(
  key: string,
  expected?: DeferredInit,
  expectedRequestId?: string,
): boolean {
  const deferred = initPromises.get(key);
  if (
    !deferred ||
    (expected && deferred !== expected) ||
    (expectedRequestId && deferred.requestId !== expectedRequestId)
  ) {
    return false;
  }
  if (deferred.timeoutId) {
    clearTimeout(deferred.timeoutId);
  }
  initPromises.delete(key);
  deferred.resolve();
  return true;
}

/** Rejects the current attempt, optionally requiring an exact owner. */
export function rejectInitDeferred(
  key: string,
  error: Error,
  expected?: DeferredInit,
  expectedRequestId?: string,
): boolean {
  const deferred = initPromises.get(key);
  if (
    !deferred ||
    (expected && deferred !== expected) ||
    (expectedRequestId && deferred.requestId !== expectedRequestId)
  ) {
    return false;
  }
  if (deferred.timeoutId) {
    clearTimeout(deferred.timeoutId);
  }
  initPromises.delete(key);
  deferred.reject(error);
  return true;
}
