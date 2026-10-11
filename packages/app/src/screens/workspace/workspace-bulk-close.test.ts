import { describe, expect, it } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import {
  buildBulkCloseConfirmationMessage,
  classifyBulkClosableTabs,
  closeBulkWorkspaceTabs,
} from "@/screens/workspace/workspace-bulk-close";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

/** A managed agent tab may belong to either a root agent or a subagent */
function makeAgentTab(id: string): WorkspaceTabDescriptor {
  return {
    key: `agent_${id}`,
    tabId: `agent_${id}`,
    kind: "agent",
    target: { kind: "agent", agentId: id },
  };
}

/** Terminal tabs require an acknowledged process stop */
function makeTerminalTab(id: string): WorkspaceTabDescriptor {
  return {
    key: `terminal_${id}`,
    tabId: `terminal_${id}`,
    kind: "terminal",
    target: { kind: "terminal", terminalId: id },
  };
}

/** A file view has no host runtime to stop */
function makeFileTab(path: string): WorkspaceTabDescriptor {
  return {
    key: `file_${path}`,
    tabId: `file_${path}`,
    kind: "file",
    target: { kind: "file", path },
  };
}

/** Acknowledgement payload from the existing host close operation */
type ClosePayload = Awaited<ReturnType<DaemonClient["closeItems"]>>;

/** Exercise teardown through the same pending and error ownership as the workspace */
function makeCloseHarness(client: Pick<DaemonClient, "closeItems"> | null) {
  /** Visible pending tab ids */
  const pending = new Set<string>();
  /** Successfully released views */
  const cleaned: string[] = [];
  /** Errors that the workspace can render and retry */
  const errors = new Map<string, string>();
  /** Acknowledged durable archives */
  const archived: ClosePayload["agents"] = [];
  return {
    pending,
    cleaned,
    errors,
    archived,
    options: {
      client,
      closeTab: async (tabId: string, action: () => Promise<void>) => {
        pending.add(tabId);
        try {
          await action();
          return true;
        } catch (error) {
          errors.set(tabId, error instanceof Error ? error.message : String(error));
          return false;
        } finally {
          pending.delete(tabId);
        }
      },
      closeWorkspaceTabWithCleanup: ({ tabId }: { tabId: string }) => {
        cleaned.push(tabId);
      },
      onAgentsClosed: (agents: ClosePayload["agents"]) => {
        archived.push(...agents);
      },
    },
  };
}

describe("workspace bulk close helpers", () => {
  it("archives every managed agent while keeping provider subagent views passive", () => {
    const providerChild: WorkspaceTabDescriptor = {
      key: "provider-child",
      tabId: "provider-child",
      kind: "provider_subagent",
      target: { kind: "provider_subagent", parentAgentId: "root", subagentId: "native-child" },
    };
    expect(
      classifyBulkClosableTabs([
        makeAgentTab("root"),
        makeAgentTab("child"),
        makeTerminalTab("t1"),
        providerChild,
      ]),
    ).toEqual({
      archiveAgentTabs: [
        { tabId: "agent_root", agentId: "root" },
        { tabId: "agent_child", agentId: "child" },
      ],
      terminalTabs: [{ tabId: "terminal_t1", terminalId: "t1" }],
      otherTabs: [{ tabId: providerChild.tabId, target: providerChild.target }],
    });
  });

  it("keeps mixed and terminal-only confirmations explicit about stopping processes", () => {
    expect(
      buildBulkCloseConfirmationMessage(
        classifyBulkClosableTabs([
          makeAgentTab("a1"),
          makeAgentTab("a2"),
          makeTerminalTab("t1"),
          makeFileTab("/repo/README.md"),
        ]),
      ),
    ).toBe(
      "This will archive 2 agent(s), close 1 terminal(s), and close 1 tab(s). Any running process in a closed terminal will be stopped immediately.",
    );
    expect(
      buildBulkCloseConfirmationMessage(classifyBulkClosableTabs([makeTerminalTab("t1")])),
    ).toBe(
      "This will close 1 terminal(s). Any running process in a closed terminal will be stopped immediately.",
    );
  });

  it("waits for one host acknowledgement before removing runtime tabs", async () => {
    /** Resolve the real pending edge without timers or fake clocks */
    const acknowledgement = Promise.withResolvers<ClosePayload>();
    const requests: Parameters<DaemonClient["closeItems"]>[0][] = [];
    const harness = makeCloseHarness({
      closeItems: async (request) => {
        requests.push(request);
        return acknowledgement.promise;
      },
    });
    const closing = closeBulkWorkspaceTabs({
      ...harness.options,
      groups: classifyBulkClosableTabs([makeAgentTab("a1"), makeTerminalTab("t1")]),
    });
    expect([...harness.pending]).toEqual(["agent_a1", "terminal_t1"]);
    expect(harness.cleaned).toEqual([]);
    await Promise.resolve();
    expect(requests).toEqual([{ agentIds: ["a1"], terminalIds: ["t1"] }]);
    acknowledgement.resolve({
      agents: [{ agentId: "a1", archivedAt: "2026-10-11T04:00:00.000Z" }],
      terminals: [{ terminalId: "t1", success: true }],
      requestId: "close",
    });
    expect(await closing).toBe(true);
    expect(harness.cleaned).toEqual(["agent_a1", "terminal_t1"]);
    expect(harness.archived).toEqual([{ agentId: "a1", archivedAt: "2026-10-11T04:00:00.000Z" }]);
    expect(harness.errors.size).toBe(0);
    expect(harness.pending.size).toBe(0);
  });

  it("excludes already-pending tabs from another bulk teardown request", async () => {
    /** The single-tab close owner already holds the first agent */
    const requests: Parameters<DaemonClient["closeItems"]>[0][] = [];
    const harness = makeCloseHarness({
      closeItems: async (request) => {
        requests.push(request);
        return {
          agents: [{ agentId: "a2", archivedAt: "2026-10-11T04:00:00.000Z" }],
          terminals: [],
          requestId: "close",
        };
      },
    });
    expect(
      await closeBulkWorkspaceTabs({
        ...harness.options,
        closeTab: async (tabId, action) => {
          if (tabId === "agent_a1") return false;
          return harness.options.closeTab(tabId, action);
        },
        groups: classifyBulkClosableTabs([makeAgentTab("a1"), makeAgentTab("a2")]),
      }),
    ).toBe(false);
    expect(requests).toEqual([{ agentIds: ["a2"], terminalIds: [] }]);
    expect(harness.cleaned).toEqual(["agent_a2"]);
  });

  it("retains a failed terminal while closing acknowledged agents and passive views", async () => {
    const harness = makeCloseHarness({
      closeItems: async () => ({
        agents: [{ agentId: "a1", archivedAt: "2026-10-11T04:00:00.000Z" }],
        terminals: [{ terminalId: "t1", success: false }],
        requestId: "close",
      }),
    });
    expect(
      await closeBulkWorkspaceTabs({
        ...harness.options,
        groups: classifyBulkClosableTabs([
          makeAgentTab("a1"),
          makeTerminalTab("t1"),
          makeFileTab("/repo/README.md"),
        ]),
      }),
    ).toBe(false);
    expect(harness.cleaned).toEqual(["file_/repo/README.md", "agent_a1"]);
    expect([...harness.errors.keys()]).toEqual(["terminal_t1"]);
  });

  it("keeps failed host tabs available for retry when a close request rejects", async () => {
    const harness = makeCloseHarness({
      closeItems: async () => {
        throw new Error("Host disconnected");
      },
    });
    expect(
      await closeBulkWorkspaceTabs({
        ...harness.options,
        groups: classifyBulkClosableTabs([
          makeAgentTab("a1"),
          makeTerminalTab("t1"),
          makeFileTab("/repo/README.md"),
        ]),
      }),
    ).toBe(false);
    expect(harness.cleaned).toEqual(["file_/repo/README.md"]);
    expect([...harness.errors]).toEqual([
      ["agent_a1", "Host disconnected"],
      ["terminal_t1", "Host disconnected"],
    ]);
    expect(harness.archived).toEqual([]);
  });

  it("does not silently close an agent omitted from the host result", async () => {
    const harness = makeCloseHarness({
      closeItems: async () => ({ agents: [], terminals: [], requestId: "close" }),
    });
    expect(
      await closeBulkWorkspaceTabs({
        ...harness.options,
        groups: classifyBulkClosableTabs([makeAgentTab("missing")]),
      }),
    ).toBe(false);
    expect(harness.cleaned).toEqual([]);
    expect([...harness.errors.keys()]).toEqual(["agent_missing"]);
  });

  it("closes passive tabs offline while retaining agent tabs", async () => {
    const harness = makeCloseHarness(null);
    expect(
      await closeBulkWorkspaceTabs({
        ...harness.options,
        groups: classifyBulkClosableTabs([makeAgentTab("a1"), makeFileTab("/repo/README.md")]),
      }),
    ).toBe(false);
    expect(harness.cleaned).toEqual(["file_/repo/README.md"]);
    expect([...harness.errors.keys()]).toEqual(["agent_a1"]);
  });
});
