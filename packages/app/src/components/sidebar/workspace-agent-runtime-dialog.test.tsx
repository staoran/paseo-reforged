/** @vitest-environment jsdom */
import { fireEvent, render, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { type ReactNode } from "react";
import type { Agent } from "@/stores/session-store";
import type { AdaptiveModalSheetProps } from "@/components/adaptive-modal-sheet";
import { WorkspaceAgentRuntimeDialog } from "./workspace-agent-runtime-dialog";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({ children, footer }: AdaptiveModalSheetProps) => (
    <>
      {children}
      {footer}
    </>
  ),
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  TooltipContent: () => null,
}));

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Supplies only the directory facts used by the picker */
function createAgent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    title: id,
    status: "idle",
    turn: { phase: "idle", cancellationRequestId: null },
    pendingPermissions: [],
    archivedAt: null,
    ...overrides,
  } as Agent;
}

/** Renders the real picker controls with a recorded lifecycle command */
function renderPicker(agents: Agent[], closed = true) {
  const closeIdleAgentRuntimes = vi.fn(async () => closed);
  const onClose = vi.fn();
  const actions = {
    closeIdleAgentRuntimes,
    closeIdleAgentRuntime: vi.fn(),
    pendingAgentIds: new Set<string>(),
    errorByAgentId: new Map<string, string>(),
  };
  return {
    ...render(
      React.createElement(WorkspaceAgentRuntimeDialog, {
        serverId: "host",
        agents,
        directoryCurrent: true,
        supportsClose: true,
        actions,
        onClose,
      }),
    ),
    closeIdleAgentRuntimes,
    onClose,
  };
}

describe("Workspace Agent runtime picker", () => {
  it("closes a chosen detached record and leaves a busy live Agent untouched", async () => {
    const picker = renderPicker([
      createAgent("detached", { runtimeAttached: false, status: "running" }),
      createAgent("busy", { status: "running" }),
    ]);

    expect(
      picker.getByTestId("sidebar-workspace-menu-close-all-agents").getAttribute("aria-disabled"),
    ).toBe("true");
    expect(
      picker.getByTestId("workspace-agent-runtime-select-busy").getAttribute("aria-disabled"),
    ).toBe("true");
    fireEvent.click(picker.getByTestId("workspace-agent-runtime-select-detached"));
    fireEvent.click(picker.getByTestId("workspace-agent-runtime-close-selected"));

    await waitFor(() => expect(picker.onClose).toHaveBeenCalledTimes(1));
    expect(picker.closeIdleAgentRuntimes).toHaveBeenCalledWith({
      serverId: "host",
      agentIds: ["detached"],
    });
  });

  it("closes all eligible current records while excluding closed records", async () => {
    const picker = renderPicker([
      createAgent("first"),
      createAgent("second", { runtimeAttached: false, status: "error" }),
      createAgent("closed", { status: "closed" }),
    ]);

    expect(picker.queryByTestId("workspace-agent-runtime-select-closed")).toBeNull();
    fireEvent.click(picker.getByTestId("sidebar-workspace-menu-close-all-agents"));

    await waitFor(() => expect(picker.onClose).toHaveBeenCalledTimes(1));
    expect(picker.closeIdleAgentRuntimes).toHaveBeenCalledWith({
      serverId: "host",
      agentIds: ["first", "second"],
    });
  });

  it("retains the user's selection when confirmation is canceled or closure fails", async () => {
    const picker = renderPicker([createAgent("retry")], false);

    fireEvent.click(picker.getByTestId("workspace-agent-runtime-select-retry"));
    fireEvent.click(picker.getByTestId("workspace-agent-runtime-close-selected"));

    await waitFor(() => expect(picker.closeIdleAgentRuntimes).toHaveBeenCalledTimes(1));
    expect(picker.onClose).not.toHaveBeenCalled();
    expect(
      picker.getByTestId("workspace-agent-runtime-select-retry").getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("keeps the picker locked while a closed Agent still has a pending request", () => {
    const pendingAgent = createAgent("pending", { status: "closed" });
    const onClose = vi.fn();
    const picker = render(
      React.createElement(WorkspaceAgentRuntimeDialog, {
        serverId: "host",
        agents: [pendingAgent, createAgent("available")],
        directoryCurrent: true,
        supportsClose: true,
        actions: {
          closeIdleAgentRuntimes: vi.fn(async () => true),
          closeIdleAgentRuntime: vi.fn(),
          pendingAgentIds: new Set([pendingAgent.id]),
          errorByAgentId: new Map(),
        },
        onClose,
      }),
    );

    expect(
      picker.getByTestId("workspace-agent-runtime-select-available").getAttribute("aria-disabled"),
    ).toBe("true");
    expect(
      picker.getByTestId("sidebar-workspace-menu-close-all-agents").getAttribute("aria-disabled"),
    ).toBe("true");
    fireEvent.click(picker.getByText("common.actions.cancel"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
