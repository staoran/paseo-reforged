import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { usePaneContext } from "@/panels/pane-context";
import {
  MODIFIED_STATE_NOT_RECOVERABLE_RETENTION_REASON,
  type RetainedTabReason,
} from "@/workspace-tabs/retention";

export interface PanelInstanceIdentity {
  serverId: string;
  workspaceId: string;
  tabId: string;
}

export interface PanelInstanceAttributes {
  modified: boolean;
  suspendPendingSave?: () => () => void;
}

export const MODIFIED_PANEL_RETAINED_REASON: RetainedTabReason =
  MODIFIED_STATE_NOT_RECOVERABLE_RETENTION_REASON;

const DEFAULT_ATTRIBUTES: PanelInstanceAttributes = { modified: false };
const attributesByPanel = new Map<string, PanelInstanceAttributes>();
const listenersByPanel = new Map<string, Set<() => void>>();
const allListeners = new Set<() => void>();
let attributesRevision = 0;

export function buildPanelInstanceKey(identity: PanelInstanceIdentity): string {
  return `${identity.serverId}:${identity.workspaceId}:${identity.tabId}`;
}

export function getPanelInstanceAttributes(
  identity: PanelInstanceIdentity,
): PanelInstanceAttributes {
  return attributesByPanel.get(buildPanelInstanceKey(identity)) ?? DEFAULT_ATTRIBUTES;
}

export function setPanelInstanceAttributes(
  identity: PanelInstanceIdentity,
  attributes: PanelInstanceAttributes,
): void {
  const key = buildPanelInstanceKey(identity);
  const previous = attributesByPanel.get(key) ?? DEFAULT_ATTRIBUTES;
  if (
    previous.modified === attributes.modified &&
    previous.suspendPendingSave === attributes.suspendPendingSave
  ) {
    return;
  }
  if (attributes.modified) attributesByPanel.set(key, attributes);
  else attributesByPanel.delete(key);
  attributesRevision += 1;
  for (const listener of listenersByPanel.get(key) ?? []) listener();
  for (const listener of allListeners) listener();
}

export function useModifiedPanelTabIds(input: {
  serverId: string;
  workspaceId: string;
  tabIds: string[];
}): Set<string> {
  const reasons = useModifiedPanelTabReasons(input);
  return useMemo(() => new Set(reasons.keys()), [reasons]);
}

export function useModifiedPanelTabReasons(input: {
  serverId: string;
  workspaceId: string;
  tabIds: string[];
}): ReadonlyMap<string, RetainedTabReason> {
  const { serverId, workspaceId, tabIds } = input;
  const revision = useSyncExternalStore(
    useCallback((listener: () => void) => {
      allListeners.add(listener);
      return () => allListeners.delete(listener);
    }, []),
    () => attributesRevision,
    () => attributesRevision,
  );
  return useMemo(() => {
    void revision;
    return getModifiedPanelTabReasons({ serverId, workspaceId, tabIds });
  }, [revision, serverId, tabIds, workspaceId]);
}

export function getModifiedPanelTabReasons(input: {
  serverId: string;
  workspaceId: string;
  tabIds: string[];
}): ReadonlyMap<string, RetainedTabReason> {
  const reasons = new Map<string, RetainedTabReason>();
  for (const tabId of input.tabIds) {
    if (
      getPanelInstanceAttributes({
        serverId: input.serverId,
        workspaceId: input.workspaceId,
        tabId,
      }).modified
    ) {
      reasons.set(tabId, MODIFIED_PANEL_RETAINED_REASON);
    }
  }
  return reasons;
}

export function subscribePanelInstanceAttributes(
  identity: PanelInstanceIdentity,
  listener: () => void,
): () => void {
  const key = buildPanelInstanceKey(identity);
  const listeners = listenersByPanel.get(key) ?? new Set<() => void>();
  listeners.add(listener);
  listenersByPanel.set(key, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) listenersByPanel.delete(key);
  };
}

export function usePanelInstanceAttributes({
  serverId,
  workspaceId,
  tabId,
}: PanelInstanceIdentity): PanelInstanceAttributes {
  const subscribe = useCallback(
    (listener: () => void) =>
      subscribePanelInstanceAttributes({ serverId, workspaceId, tabId }, listener),
    [serverId, tabId, workspaceId],
  );
  const getSnapshot = useCallback(
    () => getPanelInstanceAttributes({ serverId, workspaceId, tabId }),
    [serverId, tabId, workspaceId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function usePublishPanelInstanceAttributes(attributes: PanelInstanceAttributes): void {
  const { serverId, workspaceId, tabId } = usePaneContext();
  const modified = attributes.modified;
  const suspendPendingSave = attributes.suspendPendingSave;
  useEffect(() => {
    const identity = { serverId, workspaceId, tabId };
    setPanelInstanceAttributes(identity, { modified, suspendPendingSave });
    return () => setPanelInstanceAttributes(identity, DEFAULT_ATTRIBUTES);
  }, [modified, serverId, suspendPendingSave, tabId, workspaceId]);
}
