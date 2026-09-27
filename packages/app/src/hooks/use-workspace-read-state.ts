import { useCallback, useMemo } from "react";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { i18n } from "@/i18n/i18next";
import { useHostFeature } from "@/runtime/host-features";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { deriveWorkspaceReadActionAvailability } from "@/utils/workspace-agent-activity";
import { markWorkspaceUnread } from "@/workspace/mark-unread";

export interface WorkspaceReadStateController {
  hasClearableAttention: boolean;
  canMarkUnread: boolean;
  clearAttention: () => Promise<void>;
  markUnread: () => Promise<void>;
}

/** Reads Agent attention separately from the Workspace work-state bucket */
export function useWorkspaceReadState({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}): WorkspaceReadStateController {
  const status = useWorkspaceFields(serverId, workspaceId, (workspace) => workspace.status);
  const activity = useStoreWithEqualityFn(
    useSessionStore,
    (state) => state.sessions[serverId]?.workspaceAgentActivity.get(workspaceId) ?? null,
    Object.is,
  );
  const supportsMarkUnread = useHostFeature(serverId, "workspaceMarkUnread");
  const { hasClearableAttention, canMarkUnread } = deriveWorkspaceReadActionAvailability({
    status,
    activity,
    supportsMarkUnread,
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
