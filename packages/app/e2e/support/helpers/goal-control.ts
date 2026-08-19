import type { Page, WebSocketRoute } from "@playwright/test";
import type {
  AgentGoalSnapshot,
  AgentGoalStepSnapshot,
  AgentGoalSyncStatus,
} from "@getpaseo/protocol/agent-types";
import { daemonWsRoutePattern } from "./daemon-port";

/** One Goal request observed at the browser-to-daemon boundary. */
export interface ObservedGoalRequest {
  /** Provider-neutral operation selected by the App. */
  operation: "get" | "pause" | "resume" | "replace_objective" | "terminate";
  /** Optimistic-concurrency generation sent by mutations. */
  expectedGeneration?: string;
}

/** Initial state for the browser Goal-control adapter. */
export interface GoalControlFixtureOptions {
  /** Agent whose snapshots and Goal RPCs are adapted. */
  agentId: string;
  /** Initial provider-owned Goal projection. */
  goal: AgentGoalSnapshot;
  /** Initial current step for the same Goal generation. */
  goalStep: AgentGoalStepSnapshot | null;
  /** Whether the proxy advertises the Goal-control capability. */
  supported?: boolean;
}

/** Controls and observations exposed to a Goal browser test. */
export interface GoalControlFixture {
  /** Makes the next matching update return a retryable provider failure. */
  failNextUpdate(operation: "pause" | "resume" | "replace_objective", message: string): void;
  /** Drops all current App WebSockets and rejects reconnects until restored. */
  drop(): Promise<void>;
  /** Allows the App's normal reconnect loop to establish a fresh WebSocket. */
  restore(): void;
  /** Changes freshness injected into subsequent agent snapshots. */
  setSnapshotSync(status: AgentGoalSyncStatus): void;
  /** Returns an immutable copy of requests observed so far. */
  requests(): ObservedGoalRequest[];
}

/** Non-sensitive partial-success error returned by the terminate fixture. */
export const PARTIAL_TERMINATE_MESSAGE =
  "The Goal was cleared, but its active turn could not be interrupted.";

/** Returns whether an unknown JSON value can be safely inspected by key. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses a Paseo session envelope and returns its inner message. */
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

/** Serializes one namespaced response through the normal session envelope. */
function sendSessionResponse(
  socket: WebSocketRoute,
  type: string,
  payload: Record<string, unknown>,
): void {
  socket.send(JSON.stringify({ type: "session", message: { type, payload } }));
}

/** Installs a real-network Goal adapter in front of the isolated E2E daemon. */
export async function installGoalControlFixture(
  page: Page,
  options: GoalControlFixtureOptions,
): Promise<GoalControlFixture> {
  let goal: AgentGoalSnapshot | null = options.goal;
  let goalStep: AgentGoalStepSnapshot | null = options.goalStep;
  let snapshotSync: AgentGoalSyncStatus = "synced";
  let generationSequence = 0;
  let acceptingConnections = true;
  /** One queued provider failure consumed by the next matching Goal update. */
  let nextUpdateFailure: {
    operation: "pause" | "resume" | "replace_objective";
    message: string;
  } | null = null;
  const activeSockets = new Set<WebSocketRoute>();
  const observedRequests: ObservedGoalRequest[] = [];

  /** Returns a monotonic ISO timestamp derived from the current Goal generation. */
  function nextTimestamp(): string {
    const current = goal ? Date.parse(goal.updatedAt) : Date.parse(options.goal.updatedAt);
    generationSequence += 1;
    return new Date(current + generationSequence * 1_000).toISOString();
  }

  /** Adds the current Goal projection to one target Agent snapshot in place. */
  function projectAgentSnapshot(value: unknown): void {
    if (!isRecord(value) || value.id !== options.agentId) return;
    value.goal = goal;
    value.goalStep = goalStep;
    value.goalSync = snapshotSync;
  }

  /** Adds Goal fields to the supported daemon message projections. */
  function projectSessionPayload(
    sessionMessage: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): void {
    switch (sessionMessage.type) {
      case "status": {
        if (payload.status !== "server_info") return;
        const features = isRecord(payload.features) ? payload.features : {};
        payload.features = { ...features, agentGoalControl: options.supported !== false };
        return;
      }
      case "agent_update":
        if (payload.kind === "upsert") projectAgentSnapshot(payload.agent);
        return;
      case "fetch_agents_response":
        if (!Array.isArray(payload.entries)) return;
        for (const entry of payload.entries) {
          if (isRecord(entry)) projectAgentSnapshot(entry.agent);
        }
        return;
      case "fetch_agent_response":
      case "fetch_agent_timeline_response":
        projectAgentSnapshot(payload.agent);
        return;
      case "agent_status":
        projectAgentSnapshot(payload.info);
        return;
      case "agent_list":
        if (!Array.isArray(payload.agents)) return;
        for (const agent of payload.agents) projectAgentSnapshot(agent);
        return;
      default:
        return;
    }
  }

  /** Adds the Goal capability and projection to one server-to-App message. */
  function projectServerMessage(message: string | Buffer): string | Buffer {
    if (typeof message !== "string") return message;
    let envelope: unknown;
    try {
      envelope = JSON.parse(message);
    } catch {
      return message;
    }
    if (!isRecord(envelope)) return message;
    const sessionMessage =
      envelope.type === "session" && isRecord(envelope.message) ? envelope.message : envelope;
    const payload = isRecord(sessionMessage.payload) ? sessionMessage.payload : null;
    if (!payload) return message;
    projectSessionPayload(sessionMessage, payload);
    return JSON.stringify(envelope);
  }

  /** Sends a structured conflict without mutating the authoritative fixture Goal. */
  function sendConflict(socket: WebSocketRoute, request: Record<string, unknown>): void {
    const payload: Record<string, unknown> = {
      requestId: request.requestId,
      agentId: options.agentId,
      ok: false,
      goal,
      goalStep,
      goalSync: "synced",
      error: {
        code: "conflict",
        retryable: true,
        message: "The Goal changed before this action was applied.",
      },
    };
    if (request.type === "agent.goal.terminate.request") {
      payload.clear = "failed";
      payload.interrupt = "skipped";
      payload.outcome = "failed";
      delete payload.goalSync;
    }
    sendSessionResponse(socket, String(request.type).replace(".request", ".response"), payload);
  }

  /** Validates the request generation and emits a conflict response when stale. */
  function hasCurrentGeneration(socket: WebSocketRoute, request: Record<string, unknown>): boolean {
    if (goal && request.expectedGeneration === goal.createdAt) return true;
    sendConflict(socket, request);
    return false;
  }

  /** Handles one authoritative Goal read request. */
  function handleGoalGetRequest(socket: WebSocketRoute, request: Record<string, unknown>): boolean {
    observedRequests.push({ operation: "get" });
    snapshotSync = "synced";
    sendSessionResponse(socket, "agent.goal.get.response", {
      requestId: request.requestId,
      agentId: options.agentId,
      ok: true,
      goal,
      goalStep,
      goalSync: "synced",
      error: null,
    });
    return true;
  }

  /** Handles one Goal update and mutates the fixture's provider-owned projection. */
  function handleGoalUpdateRequest(
    socket: WebSocketRoute,
    request: Record<string, unknown>,
  ): boolean {
    if (!isRecord(request.mutation)) return false;
    const kind = request.mutation.kind;
    if (kind !== "pause" && kind !== "resume" && kind !== "replace_objective") return false;
    observedRequests.push({
      operation: kind,
      ...(typeof request.expectedGeneration === "string"
        ? { expectedGeneration: request.expectedGeneration }
        : {}),
    });
    if (nextUpdateFailure?.operation === kind) {
      const failure = nextUpdateFailure;
      nextUpdateFailure = null;
      sendSessionResponse(socket, "agent.goal.update.response", {
        requestId: request.requestId,
        agentId: options.agentId,
        ok: false,
        goal,
        goalStep,
        goalSync: "synced",
        error: {
          code: "provider_error",
          retryable: true,
          message: failure.message,
        },
      });
      return true;
    }
    if (!hasCurrentGeneration(socket, request) || !goal) return true;

    const updatedAt = nextTimestamp();
    if (kind === "replace_objective") {
      if (goal.status !== "paused" || typeof request.mutation.objective !== "string") {
        return false;
      }
      goal = {
        ...goal,
        objective: request.mutation.objective,
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: updatedAt,
        updatedAt,
      };
      goalStep = null;
    } else {
      goal = {
        ...goal,
        status: kind === "pause" ? "paused" : "active",
        updatedAt,
      };
    }
    sendSessionResponse(socket, "agent.goal.update.response", {
      requestId: request.requestId,
      agentId: options.agentId,
      ok: true,
      goal,
      goalStep,
      goalSync: "synced",
      error: null,
    });
    return true;
  }

  /** Handles Goal termination with an intentional interrupt partial failure. */
  function handleGoalTerminateRequest(
    socket: WebSocketRoute,
    request: Record<string, unknown>,
  ): boolean {
    observedRequests.push({
      operation: "terminate",
      ...(typeof request.expectedGeneration === "string"
        ? { expectedGeneration: request.expectedGeneration }
        : {}),
    });
    if (!hasCurrentGeneration(socket, request)) return true;
    goal = null;
    goalStep = null;
    sendSessionResponse(socket, "agent.goal.terminate.response", {
      requestId: request.requestId,
      agentId: options.agentId,
      ok: false,
      goal: null,
      goalStep: null,
      clear: "cleared",
      interrupt: "failed",
      outcome: "goal_cleared_turn_running",
      error: {
        code: "interrupt_failed",
        retryable: true,
        message: PARTIAL_TERMINATE_MESSAGE,
      },
    });
    return true;
  }

  /** Handles one Goal request and returns true when it was consumed. */
  function handleGoalRequest(socket: WebSocketRoute, request: Record<string, unknown>): boolean {
    if (request.agentId !== options.agentId || typeof request.requestId !== "string") return false;
    switch (request.type) {
      case "agent.goal.get.request":
        return handleGoalGetRequest(socket, request);
      case "agent.goal.update.request":
        return handleGoalUpdateRequest(socket, request);
      case "agent.goal.terminate.request":
        return handleGoalTerminateRequest(socket, request);
      default:
        return false;
    }
  }

  await page.routeWebSocket(daemonWsRoutePattern(), (socket) => {
    if (!acceptingConnections) {
      void socket.close({ code: 1008, reason: "Blocked by Goal reconnect test." });
      return;
    }
    activeSockets.add(socket);
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      if (!acceptingConnections) return;
      const request = readSessionMessage(message);
      if (request && handleGoalRequest(socket, request)) return;
      server.send(message);
    });
    server.onMessage((message) => {
      if (!acceptingConnections || !activeSockets.has(socket)) return;
      socket.send(projectServerMessage(message));
    });
  });

  return {
    failNextUpdate(operation, message) {
      nextUpdateFailure = { operation, message };
    },
    async drop() {
      acceptingConnections = false;
      const sockets = Array.from(activeSockets);
      activeSockets.clear();
      await Promise.all(
        sockets.map((socket) =>
          socket
            .close({ code: 1008, reason: "Dropped by Goal reconnect test." })
            .catch(() => undefined),
        ),
      );
    },
    restore() {
      acceptingConnections = true;
    },
    setSnapshotSync(status) {
      snapshotSync = status;
    },
    requests() {
      return structuredClone(observedRequests);
    },
  };
}
