import { buildDraftStoreKey, generateDraftId } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

export function openSeededDraftWindow(input: {
  serverId: string;
  workspaceId: string;
  text: string;
  splitRight: boolean;
}): boolean {
  const workspaceKey = buildWorkspaceTabPersistenceKey(input);
  if (!workspaceKey) return false;

  const layout = useWorkspaceLayoutStore.getState();
  const draftId = generateDraftId();
  const draftKey = buildDraftStoreKey({ serverId: input.serverId, agentId: "", draftId });
  useDraftStore.getState().saveDraftInput({
    draftKey,
    draft: { text: input.text, attachments: [] },
  });

  if (input.splitRight) {
    const focusedPaneId = layout.layoutByWorkspace[workspaceKey]?.focusedPaneId ?? null;
    if (focusedPaneId) {
      layout.splitPaneEmpty(workspaceKey, { targetPaneId: focusedPaneId, position: "right" });
    }
  }

  return layout.openTabFocused(workspaceKey, { kind: "draft", draftId }) !== null;
}
