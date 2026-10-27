import type { ClosedWorkspaceTab } from "@/stores/workspace-layout-storage";
import {
  collectAllPanes,
  collectAllTabs,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-actions";
import { workspaceTabTargetsEqual } from "@/workspace-tabs/identity";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { i18n } from "@/i18n/i18next";

/** Bound local view snapshots while the daemon retains durable agent history */
export const WORKSPACE_TAB_HISTORY_LIMIT = 100;

/** Keep one recent snapshot for each target without recording empty launchers */
export function rememberClosedWorkspaceTab(
  history: readonly ClosedWorkspaceTab[],
  tab: ClosedWorkspaceTab,
): ClosedWorkspaceTab[] {
  if (tab.target.kind === "new_tab") return [...history];
  /** Older snapshots of this target are replaced by its latest panel state */
  const otherTabs = history.filter((entry) => !workspaceTabTargetsEqual(entry.target, tab.target));
  return [tab, ...otherTabs].slice(0, WORKSPACE_TAB_HISTORY_LIMIT);
}

/** Explorer chrome and empty launcher panes do not keep a closed workspace foregrounded */
export function hasWorkspaceContentTabs(input: {
  /** Layout after the user's close operation */
  layout: WorkspaceLayout;
  /** Explorer tabs belong to the sidebar rather than the workspace tab strip */
  explorerSidebarPaneId: string | null;
}): boolean {
  /** Pane ids identify layout ownership without exposing internal tab storage */
  const ordinaryPanes = collectAllPanes(input.layout.root).filter(
    (pane) => pane.id !== input.explorerSidebarPaneId,
  );
  /** Empty launcher views represent an empty pane rather than retained content */
  const ordinaryTabIds = new Set(ordinaryPanes.flatMap((pane) => pane.tabIds));
  return collectAllTabs(input.layout.root).some(
    (tab) => ordinaryTabIds.has(tab.tabId) && tab.target.kind !== "new_tab",
  );
}

/** Recreate released resources while retaining the identity of a managed agent */
export async function restoreClosedWorkspaceTab(input: {
  /** Closed panel snapshot selected by the user */
  tab: ClosedWorkspaceTab;
  /** Host lifecycle operations used by managed agent and terminal tabs */
  client: Pick<DaemonClient, "refreshAgent" | "createTerminal"> | null;
  /** Original workspace ownership for a replacement terminal */
  workspaceId: string;
  /** Working directory for a fresh shell */
  workspaceDirectory: string | null;
  /** Browser creation belongs to the platform-specific caller */
  createBrowser: (url: string | undefined) => string;
  /** Reveals the target before a slow runtime resume completes */
  onTargetReady?: (target: WorkspaceTabTarget) => void;
}): Promise<WorkspaceTabTarget> {
  /** Passive targets can be reopened with their existing state */
  const target = input.tab.target;
  if (target.kind === "agent") {
    if (!input.client) throw new Error(i18n.t("common.errors.daemonClientDisconnected"));
    /** Publish shared pending state before mounting the cached conversation */
    const restoring = input.client.refreshAgent(target.agentId);
    input.onTargetReady?.(target);
    await restoring;
    return target;
  }
  if (target.kind === "terminal") {
    if (!input.client || !input.workspaceDirectory) {
      throw new Error(i18n.t("common.errors.daemonClientDisconnected"));
    }
    /** Restoring a terminal starts a shell without rerunning its previous command */
    const payload = await input.client.createTerminal(
      input.workspaceDirectory,
      input.tab.title,
      undefined,
      { workspaceId: input.workspaceId },
    );
    if (!payload.terminal) {
      throw new Error(payload.error ?? i18n.t("workspace.tabs.history.restoreFailed"));
    }
    const restoredTarget = { kind: "terminal", terminalId: payload.terminal.id } as const;
    input.onTargetReady?.(restoredTarget);
    return restoredTarget;
  }
  if (target.kind === "browser") {
    const restoredTarget = {
      kind: "browser",
      browserId: input.createBrowser(input.tab.browserUrl),
    } as const;
    input.onTargetReady?.(restoredTarget);
    return restoredTarget;
  }
  input.onTargetReady?.(target);
  return target;
}
