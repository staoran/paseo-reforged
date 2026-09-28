import { describe, expect, it } from "vitest";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { HostRuntimeSnapshot } from "@/runtime/host-runtime";
import { isCurrentAgentDirectory } from "./agent-directory-readiness";

/** Builds a connected Host snapshot with an explicit directory source */
function snapshot(client: DaemonClient): HostRuntimeSnapshot {
  return {
    serverId: "host-a",
    activeConnectionId: "connection-a",
    activeConnection: null,
    connectionStatus: "online",
    client,
    lastError: null,
    lastOnlineAt: "2026-01-01T00:00:00.000Z",
    agentDirectoryStatus: "ready",
    agentDirectoryError: null,
    hasEverLoadedAgentDirectory: true,
    agentDirectorySource: { clientGeneration: 4, connectionEpoch: 8 },
    probeByConnectionId: new Map(),
    clientGeneration: 4,
    connectionEpoch: 8,
  };
}

describe("current Agent directory readiness", () => {
  it("accepts only the complete directory from the connected Session source", () => {
    const client = new DaemonClient({ url: "ws://localhost", clientId: "directory-readiness" });
    const current = snapshot(client);
    const session = { client, clientGeneration: 4 };

    expect(isCurrentAgentDirectory({ snapshot: current, session })).toBe(true);
    expect(
      isCurrentAgentDirectory({
        snapshot: { ...current, connectionEpoch: 9 },
        session,
      }),
    ).toBe(false);
    expect(
      isCurrentAgentDirectory({
        snapshot: { ...current, agentDirectoryStatus: "revalidating" },
        session,
      }),
    ).toBe(false);
    expect(
      isCurrentAgentDirectory({
        snapshot: { ...current, connectionStatus: "offline" },
        session,
      }),
    ).toBe(false);
    expect(
      isCurrentAgentDirectory({
        snapshot: current,
        session: { client, clientGeneration: 3 },
      }),
    ).toBe(false);
  });
});
