import { describe, expect, it } from "vitest";
import {
  canCloseIdleAgentRuntime,
  canRequestAgentRuntimeClose,
} from "@/utils/agent-runtime-close-eligibility";

/** Minimal Agent state used by both runtime close commands */
const idleAgent = {
  archivedAt: null,
  status: "idle" as const,
  turn: { phase: "idle" as const, cancellationRequestId: null },
  pendingPermissions: [],
};

describe("Agent runtime close eligibility", () => {
  it("allows either command for an idle Agent without active work", () => {
    expect(canCloseIdleAgentRuntime(idleAgent)).toBe(true);
    expect(canRequestAgentRuntimeClose(idleAgent, false)).toBe(true);
    expect(canRequestAgentRuntimeClose(idleAgent, true)).toBe(true);
  });

  it("allows a closed Agent only to retry tab cleanup", () => {
    const closedAgent = { ...idleAgent, status: "closed" as const };
    expect(canCloseIdleAgentRuntime(closedAgent)).toBe(false);
    expect(canRequestAgentRuntimeClose(closedAgent, false)).toBe(false);
    expect(canRequestAgentRuntimeClose(closedAgent, true)).toBe(true);
    expect(canRequestAgentRuntimeClose({ ...closedAgent, archivedAt: new Date() }, true)).toBe(
      false,
    );
  });

  it("allows detached historical Agents to be closed without resuming", () => {
    for (const status of ["idle", "running", "error", "initializing"] as const) {
      const detached = { ...idleAgent, status, runtimeAttached: false };
      expect(canCloseIdleAgentRuntime(detached)).toBe(true);
      expect(canRequestAgentRuntimeClose(detached, false)).toBe(true);
    }
  });

  it("rejects missing, archived, busy, and permission-blocked Agents", () => {
    const ineligibleAgents = [
      null,
      { ...idleAgent, archivedAt: new Date() },
      { ...idleAgent, status: "running" as const },
      { ...idleAgent, status: "initializing" as const },
      { ...idleAgent, status: "error" as const },
      {
        ...idleAgent,
        turn: {
          phase: "open" as const,
          turnId: "turn-1",
          startedAt: new Date(),
          cancellationRequestId: null,
        },
      },
      {
        ...idleAgent,
        pendingPermissions: [
          { id: "permission-1", provider: "codex" as const, name: "Shell", kind: "tool" as const },
        ],
      },
    ];
    for (const agent of ineligibleAgents) {
      expect(canRequestAgentRuntimeClose(agent, false)).toBe(false);
      expect(canRequestAgentRuntimeClose(agent, true)).toBe(false);
    }
  });
});
