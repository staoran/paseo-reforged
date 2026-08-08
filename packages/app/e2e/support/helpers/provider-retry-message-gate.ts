import { expect, type Page, type WebSocketRoute } from "@playwright/test";
import { daemonWsRoutePattern } from "./daemon-port";

interface RetryAgentSnapshot extends Record<string, unknown> {
  id: string;
  updatedAt: string;
}

interface RetryAgentSource {
  agent: RetryAgentSnapshot;
  project?: unknown;
}

interface HeldMessage {
  socket: WebSocketRoute;
  message: string | Buffer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSessionMessage(message: string | Buffer): Record<string, unknown> | null {
  if (typeof message !== "string") return null;
  try {
    const envelope: unknown = JSON.parse(message);
    if (!isRecord(envelope)) return null;
    return envelope.type === "session" && isRecord(envelope.message) ? envelope.message : envelope;
  } catch {
    return null;
  }
}

function readAgentSource(value: unknown, project?: unknown): RetryAgentSource | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.updatedAt !== "string" ||
    !isRecord(value.capabilities) ||
    !Array.isArray(value.availableModes) ||
    !Array.isArray(value.pendingPermissions) ||
    !("persistence" in value)
  ) {
    return null;
  }
  return {
    agent: { ...value, id: value.id, updatedAt: value.updatedAt },
    ...(project !== undefined ? { project } : {}),
  };
}

export async function installProviderRetryMessageGate(page: Page) {
  const activeSockets = new Set<WebSocketRoute>();
  const sourceByAgentId = new Map<string, RetryAgentSource>();
  const heldMessages: HeldMessage[] = [];
  let acceptingConnections = true;
  let holdAgentRefreshResponses = false;
  let latestTimestamp = 0;

  function captureAgentSources(message: Record<string, unknown>): void {
    if (!isRecord(message.payload)) return;
    const payload = message.payload;
    if (message.type === "agent_update" && payload.kind === "upsert") {
      const source = readAgentSource(payload.agent, payload.project);
      if (source) sourceByAgentId.set(source.agent.id, source);
      return;
    }
    if (message.type === "fetch_agents_response" && Array.isArray(payload.entries)) {
      for (const entry of payload.entries) {
        if (!isRecord(entry)) continue;
        const source = readAgentSource(entry.agent, entry.project);
        if (source) sourceByAgentId.set(source.agent.id, source);
      }
      return;
    }
    if (message.type === "fetch_agent_response") {
      const source = readAgentSource(payload.agent, payload.project);
      if (source) sourceByAgentId.set(source.agent.id, source);
    }
  }

  function shouldHold(message: Record<string, unknown>): boolean {
    return (
      holdAgentRefreshResponses &&
      (message.type === "fetch_agent_response" || message.type === "fetch_agent_timeline_response")
    );
  }

  function sendToActiveSockets(message: string): void {
    let sent = false;
    for (const socket of activeSockets) {
      try {
        socket.send(message);
        sent = true;
      } catch {
        activeSockets.delete(socket);
      }
    }
    if (!sent) throw new Error("No active app WebSocket is available for retry state injection.");
  }

  await page.routeWebSocket(daemonWsRoutePattern(), (socket) => {
    if (!acceptingConnections) {
      void socket.close({ code: 1008, reason: "Blocked by provider retry test." });
      return;
    }
    activeSockets.add(socket);
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      if (acceptingConnections) server.send(message);
    });
    server.onMessage((message) => {
      if (!acceptingConnections) return;
      const sessionMessage = readSessionMessage(message);
      if (sessionMessage) captureAgentSources(sessionMessage);
      if (sessionMessage && shouldHold(sessionMessage)) {
        heldMessages.push({ socket, message });
        return;
      }
      socket.send(message);
    });
  });

  async function waitForAgentSource(agentId: string): Promise<RetryAgentSource> {
    await expect
      .poll(() => activeSockets.size > 0 && sourceByAgentId.has(agentId), { timeout: 30_000 })
      .toBe(true);
    const source = sourceByAgentId.get(agentId);
    if (!source) throw new Error(`No captured snapshot for agent ${agentId}.`);
    return source;
  }

  return {
    async publish(agentId: string, message: string | null): Promise<void> {
      const source = await waitForAgentSource(agentId);
      const currentTimestamp = Date.parse(source.agent.updatedAt);
      latestTimestamp = Math.max(
        Date.now(),
        Number.isNaN(currentTimestamp) ? 0 : currentTimestamp + 1,
        latestTimestamp + 1,
      );
      const agent: RetryAgentSnapshot = {
        ...source.agent,
        updatedAt: new Date(latestTimestamp).toISOString(),
      };
      if (message === null) delete agent.providerRetryMessage;
      else agent.providerRetryMessage = message;
      sourceByAgentId.set(agentId, { ...source, agent });
      sendToActiveSockets(
        JSON.stringify({
          type: "session",
          message: {
            type: "agent_update",
            payload: {
              kind: "upsert",
              agent,
              ...(source.project !== undefined ? { project: source.project } : {}),
            },
          },
        }),
      );
    },
    async remove(agentId: string): Promise<void> {
      await waitForAgentSource(agentId);
      sendToActiveSockets(
        JSON.stringify({
          type: "session",
          message: { type: "agent_update", payload: { kind: "remove", agentId } },
        }),
      );
    },
    holdAgentRefresh(): void {
      holdAgentRefreshResponses = true;
    },
    releaseAgentRefresh(): void {
      holdAgentRefreshResponses = false;
      for (const held of heldMessages.splice(0)) {
        try {
          held.socket.send(held.message);
        } catch {
          activeSockets.delete(held.socket);
        }
      }
    },
    async drop(): Promise<void> {
      acceptingConnections = false;
      const sockets = Array.from(activeSockets);
      activeSockets.clear();
      sourceByAgentId.clear();
      await Promise.all(
        sockets.map((socket) =>
          socket
            .close({ code: 1008, reason: "Dropped by provider retry test." })
            .catch(() => undefined),
        ),
      );
    },
    restore(): void {
      acceptingConnections = true;
    },
  };
}
