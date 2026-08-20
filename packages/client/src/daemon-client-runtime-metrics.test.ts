import type { NegotiatedEncryptedTransport } from "@getpaseo/relay/e2ee";
import { expect, test } from "vitest";

import { DaemonClientRuntimeMetrics } from "./daemon-client-runtime-metrics.js";

test("logs content-free relay decode aggregates with bounded labels", () => {
  /** Logger payloads emitted by the public flush seam. */
  const entries: object[] = [];
  /** Runtime metrics window under test. */
  const metrics = new DaemonClientRuntimeMetrics(
    {
      info: (entry) => entries.push(entry),
    },
    {
      connectionPath: "relay",
      serverId: "existing-generic-context",
      getConnectionStatus: () => "connected",
    },
  );
  /** Authenticated framed selection reported by the relay channel. */
  const negotiated: NegotiatedEncryptedTransport = {
    mode: "framed-v1",
    ciphertextEncoding: "binary",
    compressionAlgorithms: ["deflate-raw"],
  };

  metrics.recordRelayNegotiated(negotiated);
  metrics.recordRelayInboundFrame({
    ciphertextEncoding: "binary",
    codec: "deflate-raw",
    originalByteLength: 16_384,
    encodedByteLength: 1_024,
    wireByteLength: 1_072,
    decodeMs: 2.5,
  });
  metrics.recordRelayFramedProtocolError("decode-failed");
  metrics.recordRelayPendingReceiveWireBytes(1_072);
  metrics.flush({ final: true });

  expect(entries).toHaveLength(1);
  const relayTransport = (entries[0] as { relayTransport: unknown }).relayTransport;
  expect(relayTransport).toEqual({
    negotiatedModeCount: {
      "legacy-base64": 0,
      "legacy-hybrid": 0,
      "framed-v1-base64": 0,
      "framed-v1-binary": 1,
    },
    inboundFrames: [
      {
        ciphertextEncoding: "binary",
        codec: "deflate-raw",
        frameCount: 1,
        originalBytes: 16_384,
        encodedBytes: 1_024,
        wireBytes: 1_072,
      },
    ],
    inboundDecodeMs: [
      {
        ciphertextEncoding: "binary",
        codec: "deflate-raw",
        p50: 2.5,
        p95: 2.5,
        max: 2.5,
      },
    ],
    framedProtocolErrorCount: {
      "invalid-wire": 0,
      "decrypt-failed": 0,
      "invalid-envelope": 0,
      "decode-failed": 1,
      "receive-high-water": 0,
    },
    pendingReceiveWireBytes: { p95: 1_072, max: 1_072 },
  });
  expect(JSON.stringify(relayTransport)).not.toMatch(
    /serverId|clientId|connectionId|peerKey|payload|pathname|filename|secret/i,
  );
});

test("keeps relay percentile samples bounded across rolling buckets", () => {
  /** Logger payloads emitted by the public flush seam. */
  const entries: object[] = [];
  /** Runtime metrics window under test. */
  const metrics = new DaemonClientRuntimeMetrics(
    {
      info: (entry) => entries.push(entry),
    },
    {
      connectionPath: "relay",
      serverId: null,
      getConnectionStatus: () => "connected",
    },
  );
  /** First slow sample sealed into an earlier rolling bucket. */
  metrics.recordRelayInboundFrame({
    ciphertextEncoding: "binary",
    codec: "identity",
    originalByteLength: 1,
    encodedByteLength: 1,
    wireByteLength: 49,
    decodeMs: 999,
  });
  metrics.recordRelayPendingReceiveWireBytes(999);
  metrics.flush();

  for (let index = 0; index < 2_048; index += 1) {
    metrics.recordRelayInboundFrame({
      ciphertextEncoding: "binary",
      codec: "identity",
      originalByteLength: 1,
      encodedByteLength: 1,
      wireByteLength: 49,
      decodeMs: 0,
    });
    metrics.recordRelayPendingReceiveWireBytes(0);
  }
  metrics.flush({ final: true });

  /** Last rolling report after the bounded merge of both buckets. */
  const relayTransport = (
    entries.at(-1) as {
      relayTransport: {
        inboundFrames: Array<{ frameCount: number }>;
        inboundDecodeMs: Array<{ max: number }>;
        pendingReceiveWireBytes: { max: number };
      };
    }
  ).relayTransport;
  expect(relayTransport.inboundFrames[0]?.frameCount).toBe(2_049);
  expect(relayTransport.inboundDecodeMs[0]?.max).toBe(0);
  expect(relayTransport.pendingReceiveWireBytes.max).toBe(0);
});
