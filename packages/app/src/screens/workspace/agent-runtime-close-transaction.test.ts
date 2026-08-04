import { describe, expect, it, vi } from "vitest";
import { closeAgentRuntimeAndCommit } from "./agent-runtime-close-transaction";

describe("closeAgentRuntimeAndCommit", () => {
  it("keeps the tab when the host does not support runtime close", async () => {
    const closeAgentRuntime = vi.fn();
    const commitClose = vi.fn();

    await expect(
      closeAgentRuntimeAndCommit({
        client: { closeAgentRuntime },
        supported: false,
        agentId: "agent-1",
        commitClose,
      }),
    ).resolves.toEqual({ kind: "unsupported" });
    expect(closeAgentRuntime).not.toHaveBeenCalled();
    expect(commitClose).not.toHaveBeenCalled();
  });

  it("keeps the tab when the daemon client is unavailable", async () => {
    const commitClose = vi.fn();

    await expect(
      closeAgentRuntimeAndCommit({
        client: null,
        supported: true,
        agentId: "agent-1",
        commitClose,
      }),
    ).resolves.toEqual({ kind: "client-unavailable" });
    expect(commitClose).not.toHaveBeenCalled();
  });

  it("keeps the tab when the runtime-close request rejects", async () => {
    const commitClose = vi.fn();

    await expect(
      closeAgentRuntimeAndCommit({
        client: {
          closeAgentRuntime: async () => {
            throw new Error("transport disconnected");
          },
        },
        supported: true,
        agentId: "agent-1",
        commitClose,
      }),
    ).resolves.toEqual({ kind: "failed", error: "transport disconnected" });
    expect(commitClose).not.toHaveBeenCalled();
  });

  it("keeps the tab when the daemon cannot confirm durable closure", async () => {
    const commitClose = vi.fn();

    await expect(
      closeAgentRuntimeAndCommit({
        client: {
          closeAgentRuntime: async () => ({
            requestId: "request-failed",
            agentId: "agent-1",
            closed: false as const,
            error: "runtime is still resident",
          }),
        },
        supported: true,
        agentId: "agent-1",
        commitClose,
      }),
    ).resolves.toEqual({ kind: "failed", error: "runtime is still resident" });
    expect(commitClose).not.toHaveBeenCalled();
  });

  it.each([null, "provider cleanup reported an error"])(
    "commits the tab once after authoritative closure with warning %s",
    async (warning) => {
      const commitClose = vi.fn(async () => {});

      await expect(
        closeAgentRuntimeAndCommit({
          client: {
            closeAgentRuntime: async () => ({
              requestId: "request-closed",
              agentId: "agent-1",
              closed: true as const,
              warning,
            }),
          },
          supported: true,
          agentId: "agent-1",
          commitClose,
        }),
      ).resolves.toEqual({ kind: "closed", warning });
      expect(commitClose).toHaveBeenCalledTimes(1);
    },
  );
});
