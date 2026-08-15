import { describe, expect, it, vi } from "vitest";
import {
  buildBulkCloseConfirmationMessage,
  classifyBulkClosableTabs,
  closeBulkWorkspaceTabs,
} from "@/screens/workspace/workspace-bulk-close";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

function makeAgentTab(id: string): WorkspaceTabDescriptor {
  return {
    key: `agent_${id}`,
    tabId: `agent_${id}`,
    kind: "agent",
    target: { kind: "agent", agentId: id },
  };
}

function makeTerminalTab(id: string): WorkspaceTabDescriptor {
  return {
    key: `terminal_${id}`,
    tabId: `terminal_${id}`,
    kind: "terminal",
    target: { kind: "terminal", terminalId: id },
  };
}

function makeFileTab(path: string): WorkspaceTabDescriptor {
  return {
    key: `file_${path}`,
    tabId: `file_${path}`,
    kind: "file",
    target: { kind: "file", path },
  };
}

describe("workspace bulk close helpers", () => {
  it("classifies agent, terminal, and passive tabs for shared bulk close handling", () => {
    const groups = classifyBulkClosableTabs([
      makeAgentTab("a1"),
      makeTerminalTab("t1"),
      makeFileTab("/repo/README.md"),
    ]);

    expect(groups).toEqual({
      archiveAgentTabs: [{ tabId: "agent_a1", agentId: "a1" }],
      layoutOnlyAgentTabs: [],
      terminalTabs: [{ tabId: "terminal_t1", terminalId: "t1" }],
      otherTabs: [
        {
          tabId: "file_/repo/README.md",
          target: { kind: "file", path: "/repo/README.md" },
        },
      ],
    });
  });

  it("separates subagent tabs from agents that archive on close", () => {
    const groups = classifyBulkClosableTabs(
      [makeAgentTab("root"), makeAgentTab("child")],
      (agentId) => (agentId === "child" ? "layout-only" : "archive"),
    );

    expect(groups).toMatchObject({
      archiveAgentTabs: [{ tabId: "agent_root", agentId: "root" }],
      layoutOnlyAgentTabs: [{ tabId: "agent_child", agentId: "child" }],
    });
    expect(buildBulkCloseConfirmationMessage(groups)).toBe(
      "This will stop 1 agent runtime(s) and close their tabs, and close 1 other tab(s). Agent sessions will remain available.",
    );
  });

  it("describes mixed destructive bulk close operations in the confirmation copy", () => {
    const message = buildBulkCloseConfirmationMessage(
      classifyBulkClosableTabs([
        makeAgentTab("a1"),
        makeAgentTab("a2"),
        makeTerminalTab("t1"),
        makeFileTab("/repo/README.md"),
      ]),
    );

    expect(message).toBe(
      "This will stop 2 agent runtime(s) and close their tabs, close 1 terminal(s), and close 1 other tab(s). Agent sessions will remain available. Any running process in a closed terminal will be stopped immediately.",
    );
  });

  it("keeps terminal-only confirmations explicit about stopping running processes", () => {
    const message = buildBulkCloseConfirmationMessage(
      classifyBulkClosableTabs([makeTerminalTab("t1")]),
    );

    expect(message).toBe(
      "This will close 1 terminal(s). Any running process in a closed terminal will be stopped immediately.",
    );
  });

  it("closes agent runtimes authoritatively while batching terminal shutdown", async () => {
    const groups = classifyBulkClosableTabs([
      makeAgentTab("a1"),
      makeTerminalTab("t1"),
      makeTerminalTab("t2"),
      makeFileTab("/repo/README.md"),
    ]);
    const closedTabIds: string[] = [];
    const cleanupCalls: Array<{ tabId: string; target?: WorkspaceTabDescriptor["target"] }> = [];
    const closeItems = vi.fn(async () => ({
      agents: [],
      terminals: [
        { terminalId: "t1", success: true },
        { terminalId: "t2", success: false },
      ],
      requestId: "req-1",
    }));
    const closeAgentRuntime = vi.fn(async () => ({
      requestId: "runtime-close-1",
      agentId: "a1",
      closed: true as const,
      warning: null,
    }));

    await closeBulkWorkspaceTabs({
      groups,
      client: { closeAgentRuntime, closeItems },
      supportsAgentRuntimeClose: true,
      closeTab: async (tabId, action) => {
        closedTabIds.push(tabId);
        await action();
      },
      closeWorkspaceTabWithCleanup: (input) => {
        cleanupCalls.push(input);
      },
      closeLayoutOnlyAgent: async () => {},
      logLabel: "all tabs",
    });

    expect(closeAgentRuntime).toHaveBeenCalledTimes(1);
    expect(closeAgentRuntime).toHaveBeenCalledWith("a1");
    expect(closeItems).toHaveBeenCalledTimes(1);
    expect(closeItems).toHaveBeenCalledWith({
      agentIds: [],
      terminalIds: ["t1", "t2"],
    });
    expect(closedTabIds).toEqual([
      "agent_a1",
      "terminal_t1",
      "terminal_t2",
      "file_/repo/README.md",
    ]);
    expect(cleanupCalls).toEqual([
      { tabId: "agent_a1", target: { kind: "agent", agentId: "a1" } },
      { tabId: "terminal_t1", target: { kind: "terminal", terminalId: "t1" } },
      { tabId: "terminal_t2", target: { kind: "terminal", terminalId: "t2" } },
      { tabId: "file_/repo/README.md", target: { kind: "file", path: "/repo/README.md" } },
    ]);
  });

  it("keeps a failed agent tab without blocking other bulk close items", async () => {
    const groups = classifyBulkClosableTabs([
      makeAgentTab("a1"),
      makeAgentTab("a2"),
      makeTerminalTab("t1"),
      makeFileTab("/repo/README.md"),
    ]);
    const cleanupCalls: Array<{ tabId: string; target?: WorkspaceTabDescriptor["target"] }> = [];
    const outcomes: Array<{ agentId: string; kind: string }> = [];
    const runtimeResults = new Map([
      [
        "a1",
        {
          requestId: "runtime-close-a1",
          agentId: "a1",
          closed: false as const,
          error: "runtime is still resident",
        },
      ],
      [
        "a2",
        {
          requestId: "runtime-close-a2",
          agentId: "a2",
          closed: true as const,
          warning: null,
        },
      ],
    ]);

    await closeBulkWorkspaceTabs({
      groups,
      client: {
        closeAgentRuntime: async (agentId) => {
          const result = runtimeResults.get(agentId);
          if (!result) {
            throw new Error(`Missing runtime-close result for ${agentId}`);
          }
          return result;
        },
        closeItems: async () => ({
          agents: [],
          terminals: [{ terminalId: "t1", success: true }],
          requestId: "terminal-close",
        }),
      },
      supportsAgentRuntimeClose: true,
      closeTab: async (_tabId, action) => action(),
      closeWorkspaceTabWithCleanup: (input) => {
        cleanupCalls.push(input);
      },
      closeLayoutOnlyAgent: async () => {},
      onAgentRuntimeCloseOutcome: (agentId, outcome) => {
        outcomes.push({ agentId, kind: outcome.kind });
      },
      logLabel: "others",
    });

    expect(cleanupCalls).toEqual([
      { tabId: "agent_a2", target: { kind: "agent", agentId: "a2" } },
      { tabId: "terminal_t1", target: { kind: "terminal", terminalId: "t1" } },
      { tabId: "file_/repo/README.md", target: { kind: "file", path: "/repo/README.md" } },
    ]);
    expect(outcomes).toEqual([
      { agentId: "a1", kind: "failed" },
      { agentId: "a2", kind: "closed" },
    ]);
  });

  it("closes subagent tabs without sending them to runtime close or closeItems", async () => {
    const groups = classifyBulkClosableTabs(
      [makeAgentTab("root"), makeAgentTab("child")],
      (agentId) => (agentId === "child" ? "layout-only" : "archive"),
    );
    const closeItems = vi.fn(async () => ({ agents: [], terminals: [], requestId: "req-1" }));
    const closeAgentRuntime = vi.fn(async () => ({
      requestId: "runtime-close-root",
      agentId: "root",
      closed: true as const,
      warning: null,
    }));
    const preparedSubagents: string[] = [];
    const cleanedTabs: string[] = [];

    await closeBulkWorkspaceTabs({
      groups,
      client: { closeAgentRuntime, closeItems },
      supportsAgentRuntimeClose: true,
      closeTab: async (_tabId, action) => action(),
      closeLayoutOnlyAgent: async (agentId) => {
        preparedSubagents.push(agentId);
      },
      closeWorkspaceTabWithCleanup: ({ tabId }) => {
        cleanedTabs.push(tabId);
      },
      logLabel: "others",
    });

    expect(closeAgentRuntime).toHaveBeenCalledWith("root");
    expect(closeItems).not.toHaveBeenCalled();
    expect(preparedSubagents).toEqual(["child"]);
    expect(cleanedTabs).toEqual(["agent_child", "agent_root"]);
  });
});
