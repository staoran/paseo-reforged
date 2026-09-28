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
    getState: () => ({ sessions: { host: { agents: new Map([[agent.id, agent]]) } } }),
  },
}));
vi.mock("@/utils/agent-directory-readiness", () => ({
  isCurrentAgentDirectory: () => true,
}));
vi.mock("@/utils/confirm-dialog", () => ({ confirmDialog: confirmClose }));

beforeEach(() => {
  closeRpc.mockReset();
  closeRpc.mockResolvedValue(undefined);
  confirmClose.mockReset();
  confirmClose.mockResolvedValue(true);
  showToast.mockClear();
});

describe("useCloseIdleAgentRuntime", () => {
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
