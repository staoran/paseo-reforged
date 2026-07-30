import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { openSeededDraftWindow } from "./open-seeded-draft-window";

describe("openSeededDraftWindow", () => {
  beforeEach(() => {
    useDraftStore.setState({
      drafts: {},
      createModalDraft: null,
      attachmentFocusRequestByDraftKey: {},
    });
    useWorkspaceLayoutStore.setState({
      layoutByWorkspace: {},
      splitSizesByWorkspace: {},
      pinnedAgentIdsByWorkspace: {},
      pendingAgentIdsByWorkspace: {},
      hiddenAgentIdsByWorkspace: {},
      focusRestorationByWorkspace: {},
    });
  });

  it("opens a draft tab whose composer is already seeded with the selected text", () => {
    const opened = openSeededDraftWindow({
      serverId: "server-1",
      workspaceId: "workspace-1",
      text: "Selected context",
      splitRight: false,
    });

    const workspaceKey = buildWorkspaceTabPersistenceKey({
      serverId: "server-1",
      workspaceId: "workspace-1",
    });
    if (!workspaceKey) throw new Error("Expected workspace key");
    const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey];
    const target = collectAllTabs(layout.root)[0]?.target;
    expect(opened).toBe(true);
    expect(target?.kind).toBe("draft");
    if (target?.kind !== "draft") throw new Error("Expected draft tab");

    const draftKey = buildDraftStoreKey({
      serverId: "server-1",
      agentId: "",
      draftId: target.draftId,
    });
    expect(useDraftStore.getState().getDraftInput(draftKey)).toEqual({
      text: "Selected context",
      attachments: [],
    });
  });
});
