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
    useDraftStore.setState({ drafts: {}, attachmentFocusRequestByDraftKey: {} });
    useWorkspaceLayoutStore.setState({ layoutByWorkspace: {} });
  });

  it.each([false, true])("opens selected text as a draft with splitRight=%s", (splitRight) => {
    const identity = { serverId: "server-1", workspaceId: "workspace-1" };
    const workspaceKey = buildWorkspaceTabPersistenceKey(identity);
    if (!workspaceKey) throw new Error("Expected workspace key");
    const store = useWorkspaceLayoutStore.getState();
    store.openTab({
      workspaceKey,
      target: { kind: "agent", agentId: "agent-1" },
      intent: "reveal",
    });
    const originalPaneId =
      useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey]!.focusedPaneId;

    expect(openSeededDraftWindow({ ...identity, text: "Selected context", splitRight })).toBe(true);
    const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey]!;
    const target = collectAllTabs(layout.root).find((tab) => tab.target.kind === "draft")?.target;
    if (target?.kind !== "draft") throw new Error("Expected a new draft tab");
    expect(
      useDraftStore.getState().getDraftInput(
        buildDraftStoreKey({
          serverId: identity.serverId,
          agentId: "",
          draftId: target.draftId,
        }),
      ),
    ).toEqual({ text: "Selected context", attachments: [] });
    expect(layout.focusedPaneId === originalPaneId).toBe(!splitRight);
  });
});
