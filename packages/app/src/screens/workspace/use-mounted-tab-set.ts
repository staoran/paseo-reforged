import { useLayoutEffect, useMemo, useRef } from "react";
import type { RetainedTabReason } from "@/workspace-tabs/retention";

export type { RetainedTabReason } from "@/workspace-tabs/retention";

interface UseMountedTabSetInput {
  activeTabId: string | null;
  allTabIds: string[];
  cap: number;
  retainedTabReasons?: ReadonlyMap<string, RetainedTabReason>;
}

export interface UseMountedTabSetResult {
  mountedTabIds: Set<string>;
  ordinaryMountedTabIds: Set<string>;
  retainedExceptionTabIds: Set<string>;
  retainedExceptionCount: number;
  retainedExceptionReasons: ReadonlyMap<string, RetainedTabReason>;
}

interface DeriveMountedTabLruInput {
  activeTabId: string | null;
  availableTabIds: Set<string>;
  cap: number;
  previousLru: string[];
  retainedTabReasons: ReadonlyMap<string, RetainedTabReason>;
}

interface DerivedMountedTabState {
  mountedTabIds: Set<string>;
  ordinaryMountedTabIds: Set<string>;
  retainedExceptionTabIds: Set<string>;
  retainedExceptionReasons: ReadonlyMap<string, RetainedTabReason>;
  ordinaryLru: string[];
}

function createInitialMountedTabLru(input: UseMountedTabSetInput): string[] {
  if (
    !input.activeTabId ||
    !input.allTabIds.includes(input.activeTabId) ||
    input.retainedTabReasons?.has(input.activeTabId)
  ) {
    return [];
  }
  return [input.activeTabId];
}

// Ordinary LRU and correctness exceptions are derived together to preserve deterministic order.
// eslint-disable-next-line complexity
function deriveMountedTabState(input: DeriveMountedTabLruInput): DerivedMountedTabState {
  const { activeTabId, availableTabIds, cap, previousLru, retainedTabReasons } = input;
  const maxSize = Math.max(1, cap);

  const retainedExceptionReasons = new Map<string, RetainedTabReason>();
  for (const tabId of availableTabIds) {
    const reason = retainedTabReasons.get(tabId);
    if (reason) {
      retainedExceptionReasons.set(tabId, reason);
    }
  }

  const ordinaryLru: string[] = [];
  if (
    activeTabId &&
    availableTabIds.has(activeTabId) &&
    !retainedExceptionReasons.has(activeTabId)
  ) {
    ordinaryLru.push(activeTabId);
  }

  for (const tabId of previousLru) {
    if (ordinaryLru.length >= maxSize) break;
    if (
      tabId !== activeTabId &&
      availableTabIds.has(tabId) &&
      !retainedExceptionReasons.has(tabId) &&
      !ordinaryLru.includes(tabId)
    ) {
      ordinaryLru.push(tabId);
    }
  }

  const retainedExceptionTabIds = new Set<string>();
  const exceptionOrder: string[] = [];
  if (activeTabId && retainedExceptionReasons.has(activeTabId)) {
    exceptionOrder.push(activeTabId);
  }
  for (const tabId of availableTabIds) {
    if (retainedExceptionReasons.has(tabId) && tabId !== activeTabId) {
      exceptionOrder.push(tabId);
    }
  }
  for (const tabId of exceptionOrder) retainedExceptionTabIds.add(tabId);

  const mountedOrder: string[] = [];
  if (activeTabId && availableTabIds.has(activeTabId)) {
    mountedOrder.push(activeTabId);
  }
  for (const tabId of exceptionOrder) {
    if (tabId !== activeTabId) mountedOrder.push(tabId);
  }
  for (const tabId of ordinaryLru) {
    if (tabId !== activeTabId) mountedOrder.push(tabId);
  }

  return {
    mountedTabIds: new Set(mountedOrder),
    ordinaryMountedTabIds: new Set(ordinaryLru),
    retainedExceptionTabIds,
    retainedExceptionReasons,
    ordinaryLru,
  };
}

export function useMountedTabSet(input: UseMountedTabSetInput): UseMountedTabSetResult {
  const { activeTabId, allTabIds, cap } = input;
  const allTabIdsKey = allTabIds.join("\u0000");
  const availableTabIds = useMemo(() => {
    void allTabIdsKey;
    return new Set(allTabIds);
  }, [allTabIds, allTabIdsKey]);
  const committedLruRef = useRef(createInitialMountedTabLru(input));
  const mountedTabState = useMemo(
    () =>
      deriveMountedTabState({
        activeTabId,
        availableTabIds,
        cap,
        previousLru: committedLruRef.current,
        retainedTabReasons: input.retainedTabReasons ?? new Map(),
      }),
    [activeTabId, availableTabIds, cap, input.retainedTabReasons],
  );

  useLayoutEffect(() => {
    committedLruRef.current = mountedTabState.ordinaryLru;
  }, [mountedTabState.ordinaryLru]);

  return {
    mountedTabIds: mountedTabState.mountedTabIds,
    ordinaryMountedTabIds: mountedTabState.ordinaryMountedTabIds,
    retainedExceptionTabIds: mountedTabState.retainedExceptionTabIds,
    retainedExceptionCount: mountedTabState.retainedExceptionTabIds.size,
    retainedExceptionReasons: mountedTabState.retainedExceptionReasons,
  };
}
