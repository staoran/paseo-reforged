/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@/stores/session-store";
import { useCloseIdleAgentRuntime } from "./use-close-idle-agent-runtime";

const { closeRpc, confirmClose, showToast } = vi.hoisted(() => ({
  closeRpc: vi.fn(async (_agentId: string): Promise<void> => undefined),
  confirmClose: vi.fn(async (): Promise<boolean> => true),
  showToast: vi.fn(),
}));

/** The close action only reads these Agent fields */
const agent = {
  id: "agent-1",
  title: "Build",
  archivedAt: null,
  status: "idle",
  turn: { phase: "complete" },
  pendingPermissions: [],
} as unknown as Agent;
/** Additional records let batch tests cover a real user selection */
const agents = new Map<string, Agent>();
const client = { supportsAgentRuntimeClose: () => true, closeIdleAgentRuntime: closeRpc };

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/contexts/toast-context", () => ({
  useToast: () => ({ show: showToast }),
}));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({ getSnapshot: () => ({ client }) }),
}));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: {
    getState: () => ({ sessions: { host: { agents } } }),
  },
}));
vi.mock("@/utils/agent-directory-readiness", () => ({
  isCurrentAgentDirectory: () => true,
}));
vi.mock("@/utils/confirm-dialog", () => ({ confirmDialog: confirmClose }));

beforeEach(() => {
  agents.clear();
  agents.set(agent.id, agent);
  closeRpc.mockReset();
  closeRpc.mockResolvedValue(undefined);
  confirmClose.mockReset();
  confirmClose.mockResolvedValue(true);
  showToast.mockClear();
});

describe("useCloseIdleAgentRuntime", () => {
  it("confirms once and closes only the selected Agents including detached historical records", async () => {
    const detached = {
      ...agent,
      id: "detached",
      status: "running" as const,
      runtimeAttached: false,
    };
    agents.set(detached.id, detached);
    agents.set("unselected", { ...agent, id: "unselected" });
    const { result } = renderHook(() => useCloseIdleAgentRuntime());

    await act(async () => {
      expect(
        await result.current.closeIdleAgentRuntimes({
          serverId: "host",
          agentIds: [agent.id, detached.id],
        }),
      ).toBe(true);
    });

    expect(confirmClose).toHaveBeenCalledTimes(1);
    expect(closeRpc.mock.calls.map(([id]) => id)).toEqual([agent.id, detached.id]);
    expect(result.current.pendingAgentIds.size).toBe(0);
  });

  it("keeps the picker open and leaves runtimes untouched when batch confirmation is canceled", async () => {
    confirmClose.mockResolvedValueOnce(false);
    const { result } = renderHook(() => useCloseIdleAgentRuntime());

    await act(async () => {
      expect(
        await result.current.closeIdleAgentRuntimes({
          serverId: "host",
          agentIds: [agent.id],
        }),
      ).toBe(false);
    });

    expect(closeRpc).not.toHaveBeenCalled();
    expect(result.current.pendingAgentIds.size).toBe(0);
  });

  it("rechecks live work after batch confirmation before sending close requests", async () => {
    confirmClose.mockImplementationOnce(async () => {
      agents.set(agent.id, { ...agent, status: "running" });
      return true;
    });
    const { result } = renderHook(() => useCloseIdleAgentRuntime());

    await act(async () => {
      expect(
        await result.current.closeIdleAgentRuntimes({
          serverId: "host",
          agentIds: [agent.id],
        }),
      ).toBe(false);
    });

    expect(closeRpc).not.toHaveBeenCalled();
    expect(result.current.errorByAgentId.get(agent.id)).toBe(
      "sidebar.workspace.agentRuntime.idleRequired",
    );
  });

  it("reports batch failures and still closes the other selected runtimes", async () => {
    agents.set("other", { ...agent, id: "other" });
    closeRpc.mockRejectedValueOnce(new Error("Provider close failed"));
    const { result } = renderHook(() => useCloseIdleAgentRuntime());

    await act(async () => {
      expect(
        await result.current.closeIdleAgentRuntimes({
          serverId: "host",
          agentIds: [agent.id, "other"],
        }),
      ).toBe(false);
    });

    expect(closeRpc.mock.calls.map(([id]) => id)).toEqual([agent.id, "other"]);
    expect(result.current.errorByAgentId.get(agent.id)).toBe("Provider close failed");
    expect(result.current.pendingAgentIds.size).toBe(0);
  });

  it("keeps a failed close visible until the user dismisses the error", async () => {
    closeRpc.mockRejectedValueOnce(new Error("Provider close failed"));
    const { result } = renderHook(() => useCloseIdleAgentRuntime());

    await act(async () => {
      await result.current.closeIdleAgentRuntime({ serverId: "host", agentId: agent.id });
    });

    expect(result.current.pendingAgentIds.size).toBe(0);
    expect(result.current.errorByAgentId.get(agent.id)).toBe("Provider close failed");
    expect(showToast).toHaveBeenNthCalledWith(1, "sidebar.workspace.agentRuntime.pending", {
      durationMs: null,
    });
    expect(showToast).toHaveBeenNthCalledWith(
      2,
      "Provider close failed",
      expect.objectContaining({ variant: "error", durationMs: null }),
    );

    const dismiss = showToast.mock.calls[1]?.[1]?.onDismiss as (() => void) | undefined;
    expect(dismiss).toBeTypeOf("function");
    act(() => dismiss?.());
    expect(result.current.errorByAgentId.has(agent.id)).toBe(false);
  });

  it("clears the prior error after confirmation and prevents duplicate closes while pending", async () => {
    let finishClose: (() => void) | undefined;
    const pendingClose = new Promise<void>((resolve) => {
      finishClose = resolve;
    });
    closeRpc
      .mockRejectedValueOnce(new Error("Provider close failed"))
      .mockImplementationOnce(() => pendingClose);
    const { result } = renderHook(() => useCloseIdleAgentRuntime());

    await act(async () => {
      await result.current.closeIdleAgentRuntime({ serverId: "host", agentId: agent.id });
    });
    expect(result.current.errorByAgentId.get(agent.id)).toBe("Provider close failed");

    let retry: Promise<void> | undefined;
    act(() => {
      retry = result.current.closeIdleAgentRuntime({ serverId: "host", agentId: agent.id });
    });
    await waitFor(() => expect(closeRpc).toHaveBeenCalledTimes(2));
    expect(result.current.pendingAgentIds.has(agent.id)).toBe(true);
    expect(result.current.errorByAgentId.has(agent.id)).toBe(false);
    expect(showToast).toHaveBeenLastCalledWith("sidebar.workspace.agentRuntime.pending", {
      durationMs: null,
    });

    await act(async () => {
      await result.current.closeIdleAgentRuntime({ serverId: "host", agentId: agent.id });
    });
    expect(closeRpc).toHaveBeenCalledTimes(2);

    await act(async () => {
      finishClose?.();
      await retry;
    });
    expect(result.current.pendingAgentIds.size).toBe(0);
    expect(result.current.errorByAgentId.size).toBe(0);
    expect(showToast).toHaveBeenLastCalledWith("sidebar.workspace.agentRuntime.closed", {
      variant: "success",
    });
  });

  it("keeps the prior error when the user cancels a retry", async () => {
    closeRpc.mockRejectedValueOnce(new Error("Provider close failed"));
    confirmClose.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const { result } = renderHook(() => useCloseIdleAgentRuntime());

    await act(async () => {
      await result.current.closeIdleAgentRuntime({ serverId: "host", agentId: agent.id });
      await result.current.closeIdleAgentRuntime({ serverId: "host", agentId: agent.id });
    });

    expect(closeRpc).toHaveBeenCalledTimes(1);
    expect(result.current.pendingAgentIds.size).toBe(0);
    expect(result.current.errorByAgentId.get(agent.id)).toBe("Provider close failed");
    expect(showToast).toHaveBeenCalledTimes(2);
  });
});
