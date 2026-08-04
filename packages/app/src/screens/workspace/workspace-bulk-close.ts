import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { i18n } from "@/i18n/i18next";
import {
  closeAgentRuntimeAndCommit,
  type AgentRuntimeCloseOutcome,
} from "@/screens/workspace/agent-runtime-close-transaction";

export interface BulkClosableTabGroups {
  agentTabs: Array<{ tabId: string; agentId: string }>;
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
    `This will stop ${agents} agent runtime(s) and close their tabs, close ${terminals} terminal(s), and close ${tabs} other tab(s). Agent sessions will remain available. Any running process in a closed terminal will be stopped immediately.`,
  agentsAndTerminals: ({ agents, terminals }) =>
    `This will stop ${agents} agent runtime(s) and close their tabs, and close ${terminals} terminal(s). Agent sessions will remain available. Any running process in a closed terminal will be stopped immediately.`,
  terminalsAndTabs: ({ terminals, tabs }) =>
    `This will close ${terminals} terminal(s) and close ${tabs} tab(s). Any running process in a closed terminal will be stopped immediately.`,
  agentsAndTabs: ({ agents, tabs }) =>
    `This will stop ${agents} agent runtime(s) and close their tabs, and close ${tabs} other tab(s). Agent sessions will remain available.`,
  terminals: ({ terminals }) =>
    `This will close ${terminals} terminal(s). Any running process in a closed terminal will be stopped immediately.`,
  tabs: ({ tabs }) => `This will close ${tabs} tab(s).`,
  agents: ({ agents }) =>
    `This will stop ${agents} agent runtime(s) and close their tabs. Agent sessions will remain available.`,
};

interface CloseWorkspaceTabWithCleanupInput {
  tabId: string;
  target?: WorkspaceTabDescriptor["target"];
}

interface CloseBulkWorkspaceTabsInput {
  client: Pick<DaemonClient, "closeAgentRuntime" | "closeItems"> | null;
  supportsAgentRuntimeClose: boolean;
  groups: BulkClosableTabGroups;
  closeTab: (tabId: string, action: () => Promise<void>) => Promise<void>;
  closeWorkspaceTabWithCleanup: (input: CloseWorkspaceTabWithCleanupInput) => void;
  logLabel: string;
  onAgentRuntimeCloseOutcome?: (agentId: string, outcome: AgentRuntimeCloseOutcome) => void;
  warn?: (message: string, payload: object) => void;
}

export function classifyBulkClosableTabs(tabs: WorkspaceTabDescriptor[]): BulkClosableTabGroups {
  const groups: BulkClosableTabGroups = {
    agentTabs: [],
    terminalTabs: [],
    otherTabs: [],
  };

  for (const tab of tabs) {
    if (tab.target.kind === "agent") {
      groups.agentTabs.push({ tabId: tab.tabId, agentId: tab.target.agentId });
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
  const { agentTabs, terminalTabs, otherTabs } = input;
  if (agentTabs.length > 0 && terminalTabs.length > 0 && otherTabs.length > 0) {
    return labels.all({
      agents: agentTabs.length,
      terminals: terminalTabs.length,
      tabs: otherTabs.length,
    });
  }
  if (agentTabs.length > 0 && terminalTabs.length > 0) {
    return labels.agentsAndTerminals({
      agents: agentTabs.length,
      terminals: terminalTabs.length,
    });
  }
  if (terminalTabs.length > 0 && otherTabs.length > 0) {
    return labels.terminalsAndTabs({
      terminals: terminalTabs.length,
      tabs: otherTabs.length,
    });
  }
  if (agentTabs.length > 0 && otherTabs.length > 0) {
    return labels.agentsAndTabs({
      agents: agentTabs.length,
      tabs: otherTabs.length,
    });
  }
  if (terminalTabs.length > 0) {
    return labels.terminals({ terminals: terminalTabs.length });
  }
  if (otherTabs.length > 0) {
    return labels.tabs({ tabs: otherTabs.length });
  }
  return labels.agents({ agents: agentTabs.length });
}

export async function closeBulkWorkspaceTabs(input: CloseBulkWorkspaceTabsInput): Promise<void> {
  const {
    client,
    supportsAgentRuntimeClose,
    groups,
    closeTab,
    closeWorkspaceTabWithCleanup,
    logLabel,
    onAgentRuntimeCloseOutcome,
    warn,
  } = input;

  if (groups.terminalTabs.length > 0 && client) {
    void client
      .closeItems({
        agentIds: [],
        terminalIds: groups.terminalTabs.map((tab) => tab.terminalId),
      })
      .catch((error) => {
        warn?.(`[WorkspaceScreen] Failed to bulk close tabs ${logLabel}`, { error });
      });
  } else if (groups.terminalTabs.length > 0) {
    warn?.(`[WorkspaceScreen] Failed to bulk close tabs ${logLabel}`, {
      error: new Error(i18n.t("common.errors.daemonClientUnavailable")),
    });
  }

  for (const { tabId, agentId } of groups.agentTabs) {
    await closeTab(tabId, async () => {
      const outcome = await closeAgentRuntimeAndCommit({
        client,
        supported: supportsAgentRuntimeClose,
        agentId,
        commitClose: () => {
          closeWorkspaceTabWithCleanup({
            tabId,
            target: { kind: "agent", agentId },
          });
        },
      });
      onAgentRuntimeCloseOutcome?.(agentId, outcome);
    });
  }

  for (const { tabId, terminalId } of groups.terminalTabs) {
    await closeTab(tabId, async () => {
      closeWorkspaceTabWithCleanup({
        tabId,
        target: { kind: "terminal", terminalId },
      });
    });
  }

  for (const { tabId, target } of groups.otherTabs) {
    await closeTab(tabId, async () => {
      closeWorkspaceTabWithCleanup({ tabId, target });
    });
  }
}
