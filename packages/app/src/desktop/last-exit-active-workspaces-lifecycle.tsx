import { useEffect } from "react";
import { getIsElectronRuntime } from "@/constants/layout";
import { listenToDesktopEvent } from "@/desktop/electron/events";
import {
  collectLastExitActiveWorkspaces,
  getLastExitActiveWorkspaceStore,
} from "@/desktop/last-exit-active-workspaces";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";

/**
 * Owns the desktop exit snapshot and consumes one-time markers when their workspace opens.
 * It renders no UI; sidebar rows observe the shared marker store through their view-model.
 */
export function LastExitActiveWorkspacesLifecycle() {
  const activeWorkspace = useActiveWorkspaceSelection();
  const activeServerId = activeWorkspace?.serverId;
  const activeWorkspaceId = activeWorkspace?.workspaceId;

  useEffect(() => {
    if (!getIsElectronRuntime()) return;

    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listenToDesktopEvent("before-quit", () => {
      if (disposed) return;
      getLastExitActiveWorkspaceStore().record(
        collectLastExitActiveWorkspaces(useSessionStore.getState().sessions),
      );
    })
      .then((dispose) => {
        if (disposed) {
          dispose();
          return undefined;
        }
        unlisten = dispose;
        return undefined;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!getIsElectronRuntime() || !activeServerId || !activeWorkspaceId) return;
    getLastExitActiveWorkspaceStore().dismiss({
      serverId: activeServerId,
      workspaceId: activeWorkspaceId,
    });
  }, [activeServerId, activeWorkspaceId]);

  return null;
}
