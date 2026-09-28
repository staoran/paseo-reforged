import { useCallback, useMemo } from "react";
import type { SidebarWorkspaceEntry } from "@/hooks/sidebar-workspaces-view-model";
import { i18n } from "@/i18n/i18next";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { deriveWorkspaceReadActionAvailability } from "@/utils/workspace-agent-activity";
import { markWorkspaceUnread } from "@/workspace/mark-unread";

export interface WorkspaceReadStateController {
  hasClearableAttention: boolean;
  canMarkUnread: boolean;
  clearAttention: () => Promise<void>;
  markUnread: () => Promise<void>;
}

/** Uses the sidebar collection's effective status and Agent read facts for row actions */
export function useWorkspaceReadState(
  workspace: SidebarWorkspaceEntry,
): WorkspaceReadStateController {
  const { serverId, workspaceId } = workspace;
  const { hasClearableAttention, canMarkUnread } = deriveWorkspaceReadActionAvailability({
    status: workspace.statusBucket,
    activity: workspace,
    supportsMarkUnread: workspace.supportsMarkUnread,
  });

  const clearAttention = useCallback(async () => {
    if (!hasClearableAttention) {
      return;
    }
    const client = getHostRuntimeStore().getClient(serverId);
    if (!client) {
      throw new Error(i18n.t("workspace.terminal.hostDisconnected"));
    }
    await client.clearWorkspaceAttention(workspaceId);
  }, [hasClearableAttention, serverId, workspaceId]);

  const markUnread = useCallback(async () => {
    if (!canMarkUnread) {
      return;
    }
    await markWorkspaceUnread(serverId, workspaceId);
  }, [canMarkUnread, serverId, workspaceId]);

  return useMemo(
    () => ({ hasClearableAttention, canMarkUnread, clearAttention, markUnread }),
    [canMarkUnread, clearAttention, hasClearableAttention, markUnread],
  );
}
