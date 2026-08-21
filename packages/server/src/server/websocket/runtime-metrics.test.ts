import { describe, expect, it } from "vitest";
import type { SessionOutboundMessage, WSOutboundMessage } from "../messages.js";
import { wrapSessionMessage } from "../messages.js";
import { WebSocketRuntimeMetricsWindow } from "./runtime-metrics.js";

function createMetricsWindow(): {
  metrics: WebSocketRuntimeMetricsWindow;
  advanceClock(ms: number): void;
} {
  let now = 1_000;
  return {
    metrics: new WebSocketRuntimeMetricsWindow(() => now),
    advanceClock(ms: number) {
      now += ms;
    },
  };
}

function agentStreamMessage(params: {
  agentId: string;
  event: Extract<SessionOutboundMessage, { type: "agent_stream" }>["payload"]["event"];
}): WSOutboundMessage {
  return wrapSessionMessage({
    type: "agent_stream",
    payload: {
      agentId: params.agentId,
      event: params.event,
      timestamp: "2026-04-17T00:00:00.000Z",
    },
  });
}

describe("WebSocketRuntimeMetricsWindow", () => {
  it("reports content-free relay transport aggregates with bounded labels", () => {
    const { metrics } = createMetricsWindow();

    metrics.relayTransport.setConfiguredPolicy({
      ciphertextEncoding: "auto",
      compressionEnabled: true,
    });
    const closeConnection = metrics.relayTransport.recordConnectionOpened({
      mode: "framed-v1",
      ciphertextEncoding: "binary",
      compressionAlgorithms: ["deflate-raw"],
    });
    metrics.relayTransport.recordCompressionAttempt("state-sync");
    metrics.relayTransport.recordPreparedFrame({
      ciphertextEncoding: "binary",
      trafficClass: "state-sync",
      codec: "deflate-raw",
      originalByteLength: 16_384,
      encodedByteLength: 1_024,
      wireByteLength: 1_072,
      skipReason: null,
      prepareMs: 3,
      codecMs: 2,
    });
    metrics.relayTransport.recordQueueMs({ trafficClass: "state-sync", durationMs: 4 });
    metrics.relayTransport.recordInboundFrame({
      ciphertextEncoding: "binary",
      codec: "identity",
      originalByteLength: 256,
      encodedByteLength: 256,
      wireByteLength: 304,
      decodeMs: 1,
    });
    metrics.relayTransport.recordFramedProtocolError("invalid-envelope");
    metrics.relayTransport.recordPendingPreparedBytes(1_072);
    metrics.relayTransport.recordPendingReceiveWireBytes(304);

    const snapshot = metrics.snapshotAndReset().relayTransport;

    expect(snapshot).toEqual({
      configuredPolicy: {
        ciphertextEncoding: "auto",
        compressionEnabled: true,
      },
      negotiatedModeCount: {
        "legacy-base64": 0,
        "legacy-hybrid": 0,
        "framed-v1-base64": 0,
        "framed-v1-binary": 1,
      },
      activeConnectionCount: [
        {
          mode: "framed-v1",
          ciphertextEncoding: "binary",
          codec: "deflate-raw",
          effectiveReason: null,
          count: 1,
        },
      ],
      effectiveCompressionCount: [
        {
          enabled: true,
          algorithm: "deflate-raw",
          reason: null,
          count: 1,
        },
      ],
      compressionAttemptCount: {
        realtime: 0,
        "state-sync": 1,
        bulk: 0,
        "bulk-live": 0,
      },
      outboundFrames: [
        {
          ciphertextEncoding: "binary",
          trafficClass: "state-sync",
          codec: "deflate-raw",
          frameCount: 1,
          originalBytes: 16_384,
          encodedBytes: 1_024,
          wireBytes: 1_072,
        },
      ],
      compressionSkipCount: {
        "configured-disabled": 0,
        "legacy-mode": 0,
        "peer-unsupported": 0,
        "traffic-ineligible": 0,
        "too-small": 0,
        "too-large": 0,
        "no-gain": 0,
        ratio: 0,
        busy: 0,
        error: 0,
      },
      compressionPrepareMs: [{ algorithm: "deflate-raw", p50: 3, p95: 3, max: 3 }],
      compressionQueueMs: [{ trafficClass: "state-sync", p50: 4, p95: 4, max: 4 }],
      compressionCodecMs: [{ algorithm: "deflate-raw", p50: 2, p95: 2, max: 2 }],
      inboundDecodeMs: [
        {
          ciphertextEncoding: "binary",
          codec: "identity",
          p50: 1,
          p95: 1,
          max: 1,
        },
      ],
      inboundFrames: [
        {
          ciphertextEncoding: "binary",
          codec: "identity",
          frameCount: 1,
          originalBytes: 256,
          encodedBytes: 256,
          wireBytes: 304,
        },
      ],
      framedProtocolErrorCount: {
        "invalid-wire": 0,
        "decrypt-failed": 0,
        "invalid-envelope": 1,
        "decode-failed": 0,
        "receive-high-water": 0,
      },
      pendingPreparedBytes: { p95: 1_072, max: 1_072 },
      pendingReceiveWireBytes: { p95: 304, max: 304 },
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /connectionId|peerKey|payload|pathname|filename|secret/i,
    );

    closeConnection();
  });

  it("reports current effective compression reasons for active relay connections", () => {
    const { metrics } = createMetricsWindow();
    /** Active legacy connection that can never use framed compression. */
    const closeLegacy = metrics.relayTransport.recordConnectionOpened({
      mode: "legacy",
      ciphertextEncoding: "hybrid",
      compressionAlgorithms: [],
    });
    /** Active framed connection whose peer did not negotiate the fixed codec. */
    const closeUnsupported = metrics.relayTransport.recordConnectionOpened({
      mode: "framed-v1",
      ciphertextEncoding: "base64",
      compressionAlgorithms: [],
    });
    /** Active framed connection whose peer negotiated the fixed codec. */
    const closeSupported = metrics.relayTransport.recordConnectionOpened({
      mode: "framed-v1",
      ciphertextEncoding: "binary",
      compressionAlgorithms: ["deflate-raw"],
    });

    expect(metrics.relayTransport.snapshotAndReset().effectiveCompressionCount).toEqual([
      {
        enabled: false,
        algorithm: null,
        reason: "legacy-mode",
        count: 1,
      },
      {
        enabled: false,
        algorithm: null,
        reason: "peer-unsupported",
        count: 1,
      },
      {
        enabled: true,
        algorithm: "deflate-raw",
        reason: null,
        count: 1,
      },
    ]);

    metrics.relayTransport.setConfiguredPolicy({
      ciphertextEncoding: "auto",
      compressionEnabled: false,
    });

    expect(metrics.relayTransport.snapshotAndReset().effectiveCompressionCount).toEqual([
      {
        enabled: false,
        algorithm: null,
        reason: "configured-disabled",
        count: 2,
      },
      {
        enabled: false,
        algorithm: null,
        reason: "legacy-mode",
        count: 1,
      },
    ]);

    closeLegacy();
    closeUnsupported();
    closeSupported();
  });

  it("keeps relay percentile samples bounded while counters retain every frame", () => {
    const { metrics } = createMetricsWindow();
    /** First slow sample that must age out of the bounded percentile window. */
    metrics.relayTransport.recordPreparedFrame({
      ciphertextEncoding: "binary",
      trafficClass: "state-sync",
      codec: "deflate-raw",
      originalByteLength: 8_192,
      encodedByteLength: 1_024,
      wireByteLength: 1_072,
      skipReason: null,
      prepareMs: 999,
      codecMs: 999,
    });
    metrics.relayTransport.recordQueueMs({ trafficClass: "state-sync", durationMs: 999 });
    metrics.relayTransport.recordInboundFrame({
      ciphertextEncoding: "binary",
      codec: "identity",
      originalByteLength: 1,
      encodedByteLength: 1,
      wireByteLength: 49,
      decodeMs: 999,
    });
    metrics.relayTransport.recordPendingPreparedBytes(999);
    metrics.relayTransport.recordPendingReceiveWireBytes(999);

    for (let index = 0; index < 2_048; index += 1) {
      metrics.relayTransport.recordPreparedFrame({
        ciphertextEncoding: "binary",
        trafficClass: "state-sync",
        codec: "deflate-raw",
        originalByteLength: 8_192,
        encodedByteLength: 1_024,
        wireByteLength: 1_072,
        skipReason: null,
        prepareMs: 0,
        codecMs: 0,
      });
      metrics.relayTransport.recordQueueMs({ trafficClass: "state-sync", durationMs: 0 });
      metrics.relayTransport.recordInboundFrame({
        ciphertextEncoding: "binary",
        codec: "identity",
        originalByteLength: 1,
        encodedByteLength: 1,
        wireByteLength: 49,
        decodeMs: 0,
      });
      metrics.relayTransport.recordPendingPreparedBytes(0);
      metrics.relayTransport.recordPendingReceiveWireBytes(0);
    }

    const snapshot = metrics.snapshotAndReset().relayTransport;
    expect(snapshot.outboundFrames[0]?.frameCount).toBe(2_049);
    expect(snapshot.inboundFrames[0]?.frameCount).toBe(2_049);
    expect(snapshot.compressionPrepareMs[0]?.max).toBe(0);
    expect(snapshot.compressionCodecMs[0]?.max).toBe(0);
    expect(snapshot.compressionQueueMs[0]?.max).toBe(0);
    expect(snapshot.inboundDecodeMs[0]?.max).toBe(0);
    expect(snapshot.pendingPreparedBytes.max).toBe(0);
    expect(snapshot.pendingReceiveWireBytes.max).toBe(0);
  });

  it("records outbound message type counts in the runtime metrics window", () => {
    const { metrics } = createMetricsWindow();

    metrics.recordOutboundMessage(
      agentStreamMessage({
        agentId: "agent-1",
        event: {
          type: "turn_completed",
          provider: "codex",
        },
      }),
      0,
    );
    metrics.recordOutboundMessage(
      wrapSessionMessage({
        type: "status",
        payload: {
          status: "ok",
          message: "ready",
        },
      }),
      0,
    );
    metrics.recordOutboundMessage({ type: "pong" }, 0);

    const snapshot = metrics.snapshotAndReset();

    expect(snapshot.outboundMessageTypesTop).toEqual([
      ["session_message", 2],
      ["pong", 1],
    ]);
    expect(snapshot.outboundSessionMessageTypesTop).toEqual([
      ["agent_stream", 1],
      ["status", 1],
    ]);
  });

  it("records agent_stream subtypes and top agents", () => {
    const { metrics } = createMetricsWindow();

    metrics.recordOutboundMessage(
      agentStreamMessage({
        agentId: "agent-1",
        event: {
          type: "timeline",
          provider: "codex",
          item: { type: "assistant_message", text: "hello" },
        },
      }),
      0,
    );
    metrics.recordOutboundMessage(
      agentStreamMessage({
        agentId: "agent-1",
        event: {
          type: "timeline",
          provider: "codex",
          item: { type: "reasoning", text: "thinking" },
        },
      }),
      0,
    );
    metrics.recordOutboundMessage(
      agentStreamMessage({
        agentId: "agent-1",
        event: {
          type: "turn_completed",
          provider: "codex",
        },
      }),
      0,
    );
    metrics.recordOutboundMessage(
      agentStreamMessage({
        agentId: "agent-2",
        event: {
          type: "timeline",
          provider: "codex",
          item: { type: "assistant_message", text: "there" },
        },
      }),
      0,
    );

    const snapshot = metrics.snapshotAndReset();

    expect(snapshot.outboundAgentStreamTypesTop).toEqual([
      ["timeline:assistant_message", 2],
      ["timeline:reasoning", 1],
      ["turn_completed", 1],
    ]);
    expect(snapshot.outboundAgentStreamAgentsTop).toEqual([
      ["agent-1", 3],
      ["agent-2", 1],
    ]);
  });

  it("records bufferedAmount p95 and max from samples taken after send", () => {
    const { metrics } = createMetricsWindow();

    metrics.recordOutboundMessage(
      agentStreamMessage({
        agentId: "agent-1",
        event: {
          type: "turn_completed",
          provider: "codex",
        },
      }),
      0,
    );
    metrics.recordOutboundMessage(
      wrapSessionMessage({
        type: "status",
        payload: { status: "ok" },
      }),
      10,
    );
    metrics.recordOutboundMessage({ type: "pong" }, 50);
    metrics.recordOutboundBinaryFrame(100);

    const snapshot = metrics.snapshotAndReset();

    expect(snapshot.bufferedAmount).toEqual({
      p95: 100,
      max: 100,
    });
  });

  it("counts binary frames without decoding", () => {
    const { metrics } = createMetricsWindow();

    metrics.recordOutboundBinaryFrame(24);

    const snapshot = metrics.snapshotAndReset();
    expect(snapshot.outboundBinaryFrameTypesTop).toEqual([["binary", 1]]);
  });

  it("resets the runtime window after producing a snapshot", () => {
    const { metrics, advanceClock } = createMetricsWindow();
    metrics.incrementCounter("helloNew");
    metrics.recordInboundMessage("session");
    metrics.recordInboundSessionRequest("send");
    metrics.recordRequestLatency("send", 12.4);
    advanceClock(250);

    const firstSnapshot = metrics.snapshotAndReset();
    const secondSnapshot = metrics.snapshotAndReset();

    expect(firstSnapshot.windowMs).toBe(250);
    expect(firstSnapshot.counters.helloNew).toBe(1);
    expect(firstSnapshot.inboundMessageTypesTop).toEqual([["session", 1]]);
    expect(firstSnapshot.inboundSessionRequestTypesTop).toEqual([["send", 1]]);
    expect(firstSnapshot.latency).toEqual([
      {
        type: "send",
        count: 1,
        minMs: 12,
        maxMs: 12,
        p50Ms: 12,
        totalMs: 12,
      },
    ]);
    expect(secondSnapshot.windowMs).toBe(0);
    expect(secondSnapshot.counters.helloNew).toBe(0);
    expect(secondSnapshot.inboundMessageTypesTop).toEqual([]);
    expect(secondSnapshot.inboundSessionRequestTypesTop).toEqual([]);
    expect(secondSnapshot.latency).toEqual([]);
  });
});
