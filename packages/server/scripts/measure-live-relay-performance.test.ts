import { describe, expect, test, vi } from "vitest";
import { WebSocketServer } from "ws";

import { MockLoadTestAgentClient } from "@server/server/agent/providers/mock-load-test-agent.js";
import { createTestPaseoDaemon } from "@server/server/test-utils/paseo-daemon.js";

import {
  createDirectClient,
  createRelayControlReadyProbe,
  createWebSocketFactory,
  assertRelayMeasurementNegotiatedTransport,
  connectRelayMeasurementClient,
  formatRealtimeTurnFailure,
  runRealtimeProbeBranch,
  summarizeRealtimeGate,
  type RealtimeLatencySamples,
} from "./measure-live-relay-performance.js";

/** Builds independent latency samples for one wire representation. */
function samples(terminalEchoMs: number[], agentStreamMs: number[]): RealtimeLatencySamples {
  return { terminalEchoMs, agentStreamMs };
}

describe("realtime relay p95 gate", () => {
  test("stops a framed measurement connection before sampling after legacy fallback", async () => {
    /** Public connect seam that has already completed the underlying transport handshake. */
    const connect = vi.fn().mockResolvedValue(undefined);

    await expect(
      connectRelayMeasurementClient({
        client: { connect },
        wire: "framed",
        negotiated: Promise.resolve({
          mode: "legacy",
          ciphertextEncoding: "hybrid",
          compressionAlgorithms: [],
        }),
      }),
    ).rejects.toThrow("framed measurement negotiated legacy-hybrid; expected framed-v1-binary");
    expect(connect).toHaveBeenCalledOnce();
  });

  test("rejects a framed sample that silently negotiated the legacy fallback", () => {
    expect(() =>
      assertRelayMeasurementNegotiatedTransport({
        wire: "framed",
        negotiated: {
          mode: "legacy",
          ciphertextEncoding: "hybrid",
          compressionAlgorithms: [],
        },
      }),
    ).toThrow("framed measurement negotiated legacy-hybrid; expected framed-v1-binary");
  });

  test("preserves Node WebSocket close code and reason for client diagnostics", async () => {
    /** Local relay stand-in that closes with a diagnostic code after the handshake. */
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
      });
      /** Ephemeral listener address used by the measurement WebSocket wrapper. */
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Realtime close diagnostic server did not bind a TCP port");
      }
      server.once("connection", (socket) => {
        socket.close(1013, "relay overloaded");
      });

      /** Exact WebSocket wrapper supplied to every hosted measurement client. */
      const socket = createWebSocketFactory({ stripFramedCapability: false })(
        `ws://127.0.0.1:${address.port}`,
      );
      /** First close event observed at the client transport boundary. */
      const closeEvent = new Promise<unknown>((resolve, reject) => {
        /** Deadline preventing a broken listener adapter from hanging the regression. */
        const timeoutHandle = setTimeout(
          () => reject(new Error("Timed out waiting for measurement WebSocket close")),
          5_000,
        );
        if (typeof socket.addEventListener !== "function") {
          clearTimeout(timeoutHandle);
          reject(new Error("Measurement WebSocket does not expose EventTarget listeners"));
          return;
        }
        socket.addEventListener("error", (event) => {
          clearTimeout(timeoutHandle);
          reject(event);
        });
        socket.addEventListener("close", (event) => {
          clearTimeout(timeoutHandle);
          resolve(event);
        });
      });

      await expect(closeEvent).resolves.toMatchObject({ code: 1013, reason: "relay overloaded" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("waits for a valid relay control message and tracks later disconnects", async () => {
    /** Content-free readiness probe used by the measurement daemon logger. */
    const probe = createRelayControlReadyProbe();
    /** First readiness wait, which must not settle for a socket-open diagnostic. */
    const firstReady = probe.waitForReady(5_000);

    probe.logger.info("relay_control_open_waiting_for_ready");
    await expect(
      Promise.race([firstReady.then(() => "ready"), Promise.resolve("pending")]),
    ).resolves.toBe("pending");

    probe.logger.info("relay_control_connected");
    await expect(firstReady).resolves.toBeUndefined();

    probe.logger.warn("relay_control_disconnected");
    /** A disconnect must force the next caller to wait for a fresh ready signal. */
    const secondReady = probe.waitForReady(5_000);
    await expect(
      Promise.race([secondReady.then(() => "ready"), Promise.resolve("pending")]),
    ).resolves.toBe("pending");

    probe.logger.info("relay_control_connected");
    await expect(secondReady).resolves.toBeUndefined();

    probe.logger.info({ connectionId: "opaque-data-1" }, "relay_data_connected");
    probe.logger.warn({ connectionId: "opaque-data-1", code: 1013 }, "relay_data_disconnected");
    expect(probe.snapshot()).toEqual({
      control: {
        ready: true,
        connectedCount: 2,
        disconnectedCount: 1,
        errorCount: 0,
        lastEvent: "connected",
        lastCloseCode: null,
      },
      data: {
        activeCount: 0,
        connectedCount: 1,
        disconnectedCount: 1,
        errorCount: 0,
        lastEvent: "disconnected",
        lastCloseCode: 1013,
      },
    });
    expect(JSON.stringify(probe.snapshot())).not.toContain("opaque-data-1");
  });

  test("attributes every concurrent probe failure with client and relay lifecycle state", async () => {
    const branches = ["observation", "state-sync 1", "state-sync 2", "stress turn"] as const;
    for (const branch of branches) {
      await expect(
        runRealtimeProbeBranch({
          branch,
          run: () => Promise.reject(new Error("transport dropped")),
          getDiagnostic: () => ({
            connectionState: {
              status: "disconnected",
              reason: "Liveness check timed out",
            },
            lastError: "Timeout waiting for pong",
            lastLivenessRttMs: 149,
            relayLifecycle: {
              control: {
                ready: true,
                connectedCount: 1,
                disconnectedCount: 0,
                errorCount: 0,
                lastEvent: "connected",
                lastCloseCode: null,
              },
              data: {
                activeCount: 1,
                connectedCount: 1,
                disconnectedCount: 0,
                errorCount: 0,
                lastEvent: "connected",
                lastCloseCode: null,
              },
            },
          }),
        }),
      ).rejects.toThrow(
        `Realtime ${branch} failed: transport dropped; diagnostic={"connectionState":{"status":"disconnected","reason":"Liveness check timed out"},"lastError":"Timeout waiting for pong","lastLivenessRttMs":149,"relayLifecycle":`,
      );
    }
  });

  test("measurement client observes a completed mock stress turn through a real daemon", async () => {
    /** Isolated daemon exposing the same mock provider used by the manual harness. */
    const daemon = await createTestPaseoDaemon({
      agentClients: { mock: new MockLoadTestAgentClient() },
      isDev: true,
    });
    /** Direct measurement client under regression test. */
    const client = createDirectClient({
      daemon,
      clientId: "clid_realtime_measurement_regression",
    });

    try {
      await client.connect();
      /** Explicit workspace required by the public Agent creation contract. */
      const workspace = await client.openProject(daemon.staticDir);
      expect(workspace.workspace).not.toBeNull();
      /** Mock Agent whose completed snapshot must remain visible to this client version. */
      const agent = await client.createAgent({
        provider: "mock",
        cwd: daemon.staticDir,
        title: "Realtime measurement regression",
        modeId: "load-test",
        model: "five-minute-stream",
      });

      await client.sendMessage(agent.id, "emit 32 activity agent stream updates");
      /** Public terminal result that previously misreported the live Agent as disappeared. */
      const result = await client.waitForFinish(agent.id, 30_000);

      expect(result).toMatchObject({
        status: "idle",
        error: null,
        final: {
          id: agent.id,
          provider: "mock",
          status: "idle",
        },
      });
      expect(result.lastMessage).toContain("Synthetic activity stress complete");
    } finally {
      await client.close();
      await daemon.close();
    }
  });

  test("retains public wait-for-finish fields in stress-turn failures", () => {
    const message = formatRealtimeTurnFailure({
      status: "error",
      error: "durable timeline failed",
      lastMessage: "Synthetic activity stress complete",
      final: {
        status: "error",
        lastError: "durable timeline failed",
        activeTurn: {
          turnId: "turn-realtime-1",
          startedAt: "2026-09-01T00:00:00.000Z",
        },
      },
    });

    expect(message).toBe(
      'Realtime mock turn did not finish idle: {"status":"error","error":"durable timeline failed","lastMessage":"Synthetic activity stress complete","finalStatus":"error","finalLastError":"durable timeline failed","activeTurnId":"turn-realtime-1","activeTurnStartedAt":"2026-09-01T00:00:00.000Z"}',
    );
  });

  test("allows a candidate exactly at the max absolute or relative regression", () => {
    const summary = summarizeRealtimeGate({
      profile: "test",
      legacy: samples([10, 10, 10, 10, 10], [40, 40, 40, 40, 40]),
      framed: samples([12, 12, 12, 12, 12], [42, 42, 42, 42, 42]),
    });

    expect(summary.allowed.terminalEchoP95Ms).toBe(12);
    expect(summary.allowed.agentStreamP95Ms).toBe(42);
    expect(summary.passed).toBe(true);
  });

  test("fails when terminal echo exceeds both regression limits", () => {
    const summary = summarizeRealtimeGate({
      profile: "test",
      legacy: samples([10, 10, 10, 10, 10], [40, 40, 40, 40, 40]),
      framed: samples([13, 13, 13, 13, 13], [40, 40, 40, 40, 40]),
    });

    expect(summary.passed).toBe(false);
    expect(summary.failures).toEqual(["terminalEcho"]);
  });

  test("reports an agent stream regression independently of terminal echo", () => {
    const summary = summarizeRealtimeGate({
      profile: "test",
      legacy: samples([20, 20, 20, 20, 20], [40, 40, 40, 40, 40]),
      framed: samples([20, 20, 20, 20, 20], [43, 43, 43, 43, 43]),
    });

    expect(summary.passed).toBe(false);
    expect(summary.failures).toEqual(["agentStream"]);
  });
});
