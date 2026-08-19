import { useMemo, useRef, useSyncExternalStore } from "react";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useCreateFlowStore } from "@/stores/create-flow-store";
import { useSessionStore } from "@/stores/session-store";
import { getLastExitActiveWorkspaceStore } from "@/desktop/last-exit-active-workspaces";
import {
  areSidebarWorkspaceSessionsEqual,
  buildSidebarWorkspaceEntries,
  selectSidebarWorkspaceSessions,
  type SidebarWorkspaceEntry,
  type SidebarWorkspacePlacement,
  type SidebarWorkspaceSession,
} from "./sidebar-workspaces-view-model";

const EMPTY_ENTRIES = new Map<string, SidebarWorkspaceEntry>();
const EMPTY_SESSIONS: SidebarWorkspaceSession[] = [];
const EMPTY_PENDING_CREATE_ATTEMPTS: Record<string, never> = {};

export function useSidebarWorkspaceEntries(
  placements: readonly SidebarWorkspacePlacement[],
  enabled = true,
): ReadonlyMap<string, SidebarWorkspaceEntry> {
  const serverIds = useMemo(
    () => Array.from(new Set(placements.map((placement) => placement.serverId))),
    [placements],
  );
  const sessions = useStoreWithEqualityFn(
    useSessionStore,
    (state) =>
      enabled ? selectSidebarWorkspaceSessions(state.sessions, serverIds) : EMPTY_SESSIONS,
    areSidebarWorkspaceSessionsEqual,
  );
  const pendingCreateAttempts = useCreateFlowStore((state) =>
    enabled ? state.pendingByDraftId : EMPTY_PENDING_CREATE_ATTEMPTS,
  );
  const lastExitActiveWorkspaceStore = getLastExitActiveWorkspaceStore();
  const lastExitActiveWorkspaceRevision = useSyncExternalStore(
    lastExitActiveWorkspaceStore.subscribe,
    lastExitActiveWorkspaceStore.getRevision,
    () => 0,
  );
  const previousEntriesRef = useRef<ReadonlyMap<string, SidebarWorkspaceEntry>>(EMPTY_ENTRIES);

  // Collection ownership is intentional: retained sidebars have one cheap
  // subscription to structurally shared indexes, never one session-store
  // subscription per mounted row.
  return useMemo(() => {
    // Reading the revision makes marker changes an explicit recomputation input
    // even though the projection consumes the store lookup.
    void lastExitActiveWorkspaceRevision;
    if (!enabled) {
      return previousEntriesRef.current;
    }
    if (placements.length === 0 || sessions.length === 0) {
      previousEntriesRef.current = EMPTY_ENTRIES;
      return EMPTY_ENTRIES;
    }
    const entries = buildSidebarWorkspaceEntries({
      placements,
      sessions,
      pendingCreateAttempts,
      previousEntries: previousEntriesRef.current,
      lastExitActiveWorkspaceStore,
    });
    previousEntriesRef.current = entries;
    return entries;
  }, [
    enabled,
    lastExitActiveWorkspaceRevision,
    lastExitActiveWorkspaceStore,
    pendingCreateAttempts,
    placements,
    sessions,
  ]);
}
