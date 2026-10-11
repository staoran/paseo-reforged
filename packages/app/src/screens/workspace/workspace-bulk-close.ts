import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ArchivedAgentCloseResult } from "@/hooks/use-archive-agent";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { i18n } from "@/i18n/i18next";

export interface BulkClosableTabGroups {
  archiveAgentTabs: Array<{ tabId: string; agentId: string }>;
  terminalTabs: Array<{ tabId: string; terminalId: string }>;
  otherTabs: Array<{ tabId: string; target: WorkspaceTabDescriptor["target"] }>;
}

export interface BulkCloseConfirmationLabels {
  all: (input: { agents: number; terminals: number; tabs: number }) => string;
  agentsAndTerminals: (input: { agents: number; terminals: number }) => string;
  terminalsAndTabs: (input: { terminals: number; tabs: number }) => string;
  agentsAndTabs: (input: { agents: number; tabs: number }) => string;
  terminals: (input: { terminals: number }) => string;
  tabs: (input: { tabs: number }) => string;
  agents: (input: { agents: number }) => string;
}

export const DEFAULT_BULK_CLOSE_CONFIRMATION_LABELS: BulkCloseConfirmationLabels = {
  all: ({ agents, terminals, tabs }) =>
    `This will archive ${agents} agent(s), close ${terminals} terminal(s), and close ${tabs} tab(s). Any running process in a closed terminal will be stopped immediately.`,
  agentsAndTerminals: ({ agents, terminals }) =>
    `This will archive ${agents} agent(s) and close ${terminals} terminal(s). Any running process in a closed terminal will be stopped immediately.`,
  terminalsAndTabs: ({ terminals, tabs }) =>
    `This will close ${terminals} terminal(s) and close ${tabs} tab(s). Any running process in a closed terminal will be stopped immediately.`,
  agentsAndTabs: ({ agents, tabs }) =>
    `This will archive ${agents} agent(s) and close ${tabs} tab(s).`,
  terminals: ({ terminals }) =>
    `This will close ${terminals} terminal(s). Any running process in a closed terminal will be stopped immediately.`,
  tabs: ({ tabs }) => `This will close ${tabs} tab(s).`,
  agents: ({ agents }) => `This will archive ${agents} agent(s).`,
};

interface CloseWorkspaceTabWithCleanupInput {
  tabId: string;
  target?: WorkspaceTabDescriptor["target"];
}

interface CloseBulkWorkspaceTabsInput {
  client: Pick<DaemonClient, "closeItems"> | null;
  groups: BulkClosableTabGroups;
  closeTab: (tabId: string, action: () => Promise<void>) => Promise<boolean>;
  closeWorkspaceTabWithCleanup: (input: CloseWorkspaceTabWithCleanupInput) => void;
  /** Applies acknowledged archive results to the client directory and history */
  onAgentsClosed: (agents: ArchivedAgentCloseResult[]) => void;
}

export function classifyBulkClosableTabs(tabs: WorkspaceTabDescriptor[]): BulkClosableTabGroups {
  const groups: BulkClosableTabGroups = {
    archiveAgentTabs: [],
    terminalTabs: [],
    otherTabs: [],
  };

  for (const tab of tabs) {
    if (tab.target.kind === "agent") {
      const agentTab = { tabId: tab.tabId, agentId: tab.target.agentId };
      groups.archiveAgentTabs.push(agentTab);
      continue;
    }
    if (tab.target.kind === "terminal") {
      groups.terminalTabs.push({ tabId: tab.tabId, terminalId: tab.target.terminalId });
      continue;
    }
    groups.otherTabs.push({ tabId: tab.tabId, target: tab.target });
  }

  return groups;
}

export function buildBulkCloseConfirmationMessage(
  input: BulkClosableTabGroups,
  labels: BulkCloseConfirmationLabels = DEFAULT_BULK_CLOSE_CONFIRMATION_LABELS,
): string {
  const { archiveAgentTabs, terminalTabs, otherTabs } = input;
  const tabCount = otherTabs.length;
  if (archiveAgentTabs.length > 0 && terminalTabs.length > 0 && tabCount > 0) {
    return labels.all({
      agents: archiveAgentTabs.length,
      terminals: terminalTabs.length,
      tabs: tabCount,
    });
  }
  if (archiveAgentTabs.length > 0 && terminalTabs.length > 0) {
    return labels.agentsAndTerminals({
      agents: archiveAgentTabs.length,
      terminals: terminalTabs.length,
    });
  }
  if (terminalTabs.length > 0 && tabCount > 0) {
    return labels.terminalsAndTabs({
      terminals: terminalTabs.length,
      tabs: tabCount,
    });
  }
  if (archiveAgentTabs.length > 0 && tabCount > 0) {
    return labels.agentsAndTabs({
      agents: archiveAgentTabs.length,
      tabs: tabCount,
    });
  }
  if (terminalTabs.length > 0) {
    return labels.terminals({ terminals: terminalTabs.length });
  }
  if (tabCount > 0) {
    return labels.tabs({ tabs: tabCount });
  }
  return labels.agents({ agents: archiveAgentTabs.length });
}

/** Keep runtime-backed tabs until the host acknowledges their teardown */
export async function closeBulkWorkspaceTabs(input: CloseBulkWorkspaceTabsInput): Promise<boolean> {
  /** One lazy request is shared by every runtime tab participating in this close */
  let closeRequest: ReturnType<DaemonClient["closeItems"]> | null = null;
  /** Already-pending tabs never join a second teardown request */
  const acquiredAgentIds: string[] = [];
  /** Terminal acquisition follows the same per-tab duplicate suppression */
  const acquiredTerminalIds: string[] = [];

  /** The pending-tab owner invokes this only for tabs it actually acquired */
  function closeItems(): ReturnType<DaemonClient["closeItems"]> {
    if (closeRequest) return closeRequest;
    if (!input.client) {
      return Promise.reject(new Error(i18n.t("common.errors.daemonClientUnavailable")));
    }
    /** Defer the request until every synchronous close owner has acquired its tab */
    const client = input.client;
    closeRequest = Promise.resolve()
      .then(() =>
        client.closeItems({
          agentIds: acquiredAgentIds,
          terminalIds: acquiredTerminalIds,
        }),
      )
      .then((payload) => {
        input.onAgentsClosed(payload.agents);
        return payload;
      });
    return closeRequest;
  }

  /** All tabs acquire pending state before waiting for the shared host response */
  const closed = await Promise.all([
    ...input.groups.archiveAgentTabs.map(({ tabId, agentId }) =>
      input.closeTab(tabId, async () => {
        acquiredAgentIds.push(agentId);
        /** Missing results leave this tab available for retry */
        const payload = await closeItems();
        if (!payload.agents.some((agent) => agent.agentId === agentId)) {
          throw new Error(i18n.t("workspace.tabs.toasts.failedToCloseAgent"));
        }
        input.closeWorkspaceTabWithCleanup({ tabId, target: { kind: "agent", agentId } });
      }),
    ),
    ...input.groups.terminalTabs.map(({ tabId, terminalId }) =>
      input.closeTab(tabId, async () => {
        acquiredTerminalIds.push(terminalId);
        /** A stopped terminal is the only terminal that can leave the live layout */
        const payload = await closeItems();
        if (
          !payload.terminals.some(
            (terminal) => terminal.terminalId === terminalId && terminal.success,
          )
        ) {
          throw new Error(i18n.t("workspace.tabs.history.closeFailed"));
        }
        input.closeWorkspaceTabWithCleanup({ tabId, target: { kind: "terminal", terminalId } });
      }),
    ),
    ...input.groups.otherTabs.map(({ tabId, target }) =>
      input.closeTab(tabId, async () => {
        input.closeWorkspaceTabWithCleanup({ tabId, target });
      }),
    ),
  ]);
  return closed.every(Boolean);
}
