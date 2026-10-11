import { describe, expect, it } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ClosedWorkspaceTab } from "@/stores/workspace-layout-storage";
import {
  closeTabInLayout,
  createWorkspaceLayoutWithExplorerSidebar,
  EXPLORER_SIDEBAR_PANE_ID,
  revealTargetInLayout,
} from "@/stores/workspace-layout-actions";
import {
  hasWorkspaceContentTabs,
  rememberClosedWorkspaceTab,
  restoreClosedWorkspaceTab,
  WORKSPACE_TAB_HISTORY_LIMIT,
} from "./history";

/** Deterministic closed view used by the persistence and restoration policy */
function closedTab(input: Partial<ClosedWorkspaceTab> = {}): ClosedWorkspaceTab {
  return {
    tabId: "agent_original",
    target: { kind: "agent", agentId: "original" },
    title: "Original conversation",
    createdAt: 1,
    closedAt: 2,
    ...input,
  };
}

/** Typed lifecycle adapter keeps these tests free of a daemon or component mocks */
function historyClient(): Pick<DaemonClient, "refreshAgent" | "createTerminal"> {
  return {
    refreshAgent: async (agentId) => ({ status: "agent_refreshed", agentId, requestId: "restore" }),
    createTerminal: async (_cwd, name) => ({
      terminal: { id: "new-shell", name: name ?? "Terminal", cwd: "/repo", workspaceId: "ws-1" },
      error: null,
      requestId: "restore-shell",
    }),
  };
}

describe("workspace tab history", () => {
  it("replaces an older view of the same target and keeps its latest panel state", () => {
    const other = closedTab({ tabId: "other", target: { kind: "file", path: "/repo/README.md" } });
    const latest = closedTab({
      tabId: "retargeted-draft-id",
      title: "Renamed conversation",
      closedAt: 3,
      state: { scrollOffset: 80 },
    });
    expect(rememberClosedWorkspaceTab([other, closedTab()], latest)).toEqual([latest, other]);
  });

  it("bounds recent snapshots and excludes empty launchers", () => {
    const history = Array.from({ length: WORKSPACE_TAB_HISTORY_LIMIT }, (_, index) =>
      closedTab({
        tabId: `agent_${index}`,
        target: { kind: "agent", agentId: String(index) },
      }),
    );
    expect(rememberClosedWorkspaceTab(history, closedTab()).map((tab) => tab.tabId)).toEqual([
      "agent_original",
      ...history.slice(0, -1).map((tab) => tab.tabId),
    ]);
    expect(rememberClosedWorkspaceTab(history, closedTab({ target: { kind: "new_tab" } }))).toEqual(
      history,
    );
  });

  it("treats the final closed main tab as empty even with Explorer tools present", () => {
    const base = createWorkspaceLayoutWithExplorerSidebar();
    const opened = revealTargetInLayout({
      layout: base,
      target: { kind: "agent", agentId: "original" },
      placement: { mode: "prefer", paneId: "main" },
      createTabId: () => "agent_original",
      now: 1,
      explorerSidebarPaneId: EXPLORER_SIDEBAR_PANE_ID,
    });
    if (!opened) throw new Error("Expected an agent tab");
    expect(
      hasWorkspaceContentTabs({
        layout: opened.layout,
        explorerSidebarPaneId: EXPLORER_SIDEBAR_PANE_ID,
      }),
    ).toBe(true);
    const closed = closeTabInLayout({
      layout: opened.layout,
      tabId: "agent_original",
      explorerSidebarPaneId: EXPLORER_SIDEBAR_PANE_ID,
    });
    if (!closed) throw new Error("Expected the tab to close");
    expect(
      hasWorkspaceContentTabs({ layout: closed, explorerSidebarPaneId: EXPLORER_SIDEBAR_PANE_ID }),
    ).toBe(false);
  });

  it("keeps another main content tab in the workspace after a close", () => {
    const base = createWorkspaceLayoutWithExplorerSidebar();
    const opened = revealTargetInLayout({
      layout: base,
      target: { kind: "file", path: "/repo/README.md" },
      placement: { mode: "prefer", paneId: "main" },
      createTabId: () => "file_readme",
      now: 1,
      explorerSidebarPaneId: EXPLORER_SIDEBAR_PANE_ID,
    });
    if (!opened) throw new Error("Expected a file tab");
    expect(
      hasWorkspaceContentTabs({
        layout: opened.layout,
        explorerSidebarPaneId: EXPLORER_SIDEBAR_PANE_ID,
      }),
    ).toBe(true);
  });

  it("restores the same agent identity through the host's existing unarchive operation", async () => {
    const refreshed: string[] = [];
    const client = historyClient();
    client.refreshAgent = async (agentId) => {
      refreshed.push(agentId);
      return { status: "agent_refreshed", agentId, requestId: "restore" };
    };
    expect(
      await restoreClosedWorkspaceTab({
        tab: closedTab(),
        client,
        workspaceId: "ws-1",
        workspaceDirectory: "/repo",
        createBrowser: () => "browser",
      }),
    ).toEqual({ kind: "agent", agentId: "original" });
    expect(refreshed).toEqual(["original"]);
  });

  it("propagates a failed resume without replacing the durable agent target", async () => {
    const client = historyClient();
    client.refreshAgent = async () => {
      throw new Error("Provider resume failed");
    };
    const tab = closedTab();
    await expect(
      restoreClosedWorkspaceTab({
        tab,
        client,
        workspaceId: "ws-1",
        workspaceDirectory: "/repo",
        createBrowser: () => "browser",
      }),
    ).rejects.toThrow("Provider resume failed");
    expect(tab.target).toEqual({ kind: "agent", agentId: "original" });
  });

  it("recreates a terminal in its original workspace without replaying a command", async () => {
    const client = historyClient();
    const launches: Parameters<DaemonClient["createTerminal"]>[] = [];
    client.createTerminal = async (...args) => {
      launches.push(args);
      return {
        terminal: { id: "new-shell", name: "Build logs", cwd: "/repo", workspaceId: "ws-1" },
        error: null,
        requestId: "restore",
      };
    };
    expect(
      await restoreClosedWorkspaceTab({
        tab: closedTab({
          target: { kind: "terminal", terminalId: "old-shell" },
          title: "Build logs",
        }),
        client,
        workspaceId: "ws-1",
        workspaceDirectory: "/repo",
        createBrowser: () => "browser",
      }),
    ).toEqual({ kind: "terminal", terminalId: "new-shell" });
    expect(launches).toEqual([["/repo", "Build logs", undefined, { workspaceId: "ws-1" }]]);
  });

  it("reopens passive files offline and recreates browsers at their saved URL", async () => {
    const urls: Array<string | undefined> = [];
    const options = {
      client: null,
      workspaceId: "ws-1",
      workspaceDirectory: "/repo",
      createBrowser: (url: string | undefined) => {
        urls.push(url);
        return "new-browser";
      },
    };
    expect(
      await restoreClosedWorkspaceTab({
        ...options,
        tab: closedTab({ target: { kind: "file", path: "/repo/README.md", lineStart: 12 } }),
      }),
    ).toEqual({ kind: "file", path: "/repo/README.md", lineStart: 12 });
    expect(
      await restoreClosedWorkspaceTab({
        ...options,
        tab: closedTab({
          target: { kind: "browser", browserId: "old-browser" },
          browserUrl: "http://localhost:8081",
        }),
      }),
    ).toEqual({ kind: "browser", browserId: "new-browser" });
    expect(urls).toEqual(["http://localhost:8081"]);
  });
});
