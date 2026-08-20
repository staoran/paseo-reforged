import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";

import pino from "pino";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { describe, expect, test } from "vitest";

import {
  DaemonClient,
  type WebSocketFactory,
  type WebSocketLike,
} from "@getpaseo/client/internal/daemon-client";
import { buildRelayWebSocketUrl } from "@getpaseo/protocol/daemon-endpoints";
import {
  parseConnectionOfferFromUrl,
  type ConnectionOffer,
} from "@getpaseo/protocol/connection-offer";
import { generateLocalPairingOffer } from "../pairing-offer.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";

const upstreamRelayEndpoint =
  process.env.PASEO_LIVE_RELAY_ENDPOINT ?? "paseo-relay-next.fly.dev:443";
const performanceTest = process.env.RUN_LIVE_RELAY_PERF_E2E === "1" ? test : test.skip;
const measuredRuns = 5;
const fileBytes = 10 * 1024 * 1024;
/** Representative completed timeline payload kept below the v1 4 MiB compression ceiling. */
const timelinePayloadBytes = 1_000_000;
/** Stable operation labels mixed into the synthetic structured text corpus. */
const corpusOperations = ["replace", "insert", "delete"] as const;

interface RelayNetworkProfile {
  /** Stable label used in the aggregate output and assertion messages. */
  label: string;
  /** Available downstream bandwidth in bits per second. */
  bandwidthBitsPerSecond: number;
  /** Profile round-trip latency; each shaped direction uses half. */
  roundTripLatencyMs: number;
}

const profiles: readonly RelayNetworkProfile[] = [
  { label: "2Mbps/150ms", bandwidthBitsPerSecond: 2_000_000, roundTripLatencyMs: 150 },
  { label: "10Mbps/80ms", bandwidthBitsPerSecond: 10_000_000, roundTripLatencyMs: 80 },
];

interface WorkloadMeasurements {
  /** Completion times for the 40-item timeline catch-up. */
  timelineMs: number[];
  /** Completion times for the 10 MiB UTF-8 file read. */
  fileMs: number[];
}

interface RelayPerformanceSummary {
  /** Profile identifier. */
  profile: string;
  /** Legacy baseline p50/p95 values. */
  legacy: { timelineP50Ms: number; timelineP95Ms: number; fileP50Ms: number; fileP95Ms: number };
  /** Framed compression p50/p95 values. */
  framed: { timelineP50Ms: number; timelineP95Ms: number; fileP50Ms: number; fileP95Ms: number };
  /** Relative completion-time reductions, bounded to two decimals. */
  improvement: { timelineP50: number; timelineP95: number; fileP50: number; fileP95: number };
}

interface RelayProxyConnection {
  /** Downstream local socket. */
  downstream: WebSocket;
  /** Upstream production relay socket. */
  upstream: WebSocket;
}

/** Converts a WebSocket raw message to an exact byte buffer without retaining pooled storage. */
function rawDataToBuffer(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.from(data);
}

/** Computes a deterministic percentile from independent measured durations. */
function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? 0;
}

/** Builds a repeatable structured text corpus with enough variation to avoid ratio-cap skips. */
function buildTextCorpus(bytes: number): Uint8Array {
  let state = 0x13579bdf;
  let text = "";
  let index = 0;
  while (text.length < bytes) {
    state = Math.imul(state, 1_664_525) + 1_013_904_223;
    const token = (state >>> 0).toString(16).padStart(8, "0");
    text += JSON.stringify({
      index,
      path: `src/modules/module-${index % 97}.ts`,
      operation: corpusOperations[index % corpusOperations.length],
      token,
      context: "state-sync benchmark line with stable protocol fields",
    });
    text += "\n";
    index += 1;
  }
  return new TextEncoder().encode(text.slice(0, bytes));
}

/** Schedules one message through a deterministic bandwidth/latency shaper. */
function scheduleShapedSend(
  send: () => void,
  byteLength: number,
  profile: RelayNetworkProfile,
  availableAt: { value: number },
): ReturnType<typeof setTimeout> {
  const now = performance.now();
  const oneWayLatencyMs = profile.roundTripLatencyMs / 2;
  const serializationMs = (byteLength * 8 * 1_000) / profile.bandwidthBitsPerSecond;
  const startAt = Math.max(now + oneWayLatencyMs, availableAt.value);
  const finishAt = startAt + serializationMs;
  availableAt.value = finishAt;
  return setTimeout(send, Math.max(0, finishAt - now));
}

/**
 * Forwards WebSocket frames to the production relay while shaping only client-side traffic.
 * The relay itself remains an opaque upstream hop; no frame contents are inspected.
 */
class ShapedRelayProxy {
  private readonly server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  private readonly connections = new Set<RelayProxyConnection>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private port: number | null = null;

  constructor(private readonly profile: RelayNetworkProfile) {}

  /** Starts the local proxy and waits for its ephemeral TCP port. */
  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        this.server.off("listening", onListening);
        reject(error);
      };
      const onListening = (): void => {
        this.server.off("error", onError);
        const address = this.server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Relay performance proxy did not bind a TCP port"));
          return;
        }
        this.port = address.port;
        resolve();
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.on("connection", (downstream, request) => {
        void this.attach(downstream, request.url ?? "/ws");
      });
    });
  }

  /** Returns the local host:port endpoint after start. */
  get endpoint(): string {
    if (this.port === null) throw new Error("Relay performance proxy has not started");
    return `127.0.0.1:${this.port}`;
  }

  /** Closes all local/upstream sockets and the proxy listener. */
  async close(): Promise<void> {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const connection of this.connections) {
      connection.downstream.terminate();
      connection.upstream.terminate();
    }
    this.connections.clear();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** Attaches one local socket to the matching production relay URL. */
  private async attach(downstream: WebSocket, requestPath: string): Promise<void> {
    const upstream = new WebSocket(`wss://${upstreamRelayEndpoint}${requestPath}`);
    const connection = { downstream, upstream } satisfies RelayProxyConnection;
    this.connections.add(connection);
    const role = new URL(`ws://relay.invalid${requestPath}`).searchParams.get("role");
    const shouldShape = role === "client";
    const clientToRelayAvailable = { value: 0 };
    const relayToClientAvailable = { value: 0 };
    const pending: Array<{ data: Buffer; isBinary: boolean }> = [];
    let closed = false;

    const closePair = (): void => {
      if (closed) return;
      closed = true;
      this.connections.delete(connection);
      if (downstream.readyState === WebSocket.OPEN) downstream.close();
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
        upstream.close();
      }
    };
    const forward = (
      target: WebSocket,
      data: Buffer,
      isBinary: boolean,
      availableAt: { value: number },
    ): void => {
      const send = (): void => {
        this.timers.delete(timer);
        if (closed || target.readyState !== WebSocket.OPEN) return;
        target.send(data, { binary: isBinary });
      };
      const timer = shouldShape
        ? scheduleShapedSend(send, data.byteLength, this.profile, availableAt)
        : setTimeout(send, 0);
      this.timers.add(timer);
    };

    downstream.on("message", (data, isBinary) => {
      const message = { data: rawDataToBuffer(data), isBinary };
      if (upstream.readyState !== WebSocket.OPEN) {
        pending.push(message);
        return;
      }
      forward(upstream, message.data, message.isBinary, clientToRelayAvailable);
    });
    downstream.once("close", closePair);
    downstream.once("error", closePair);
    upstream.on("open", () => {
      for (const message of pending.splice(0)) {
        forward(upstream, message.data, message.isBinary, clientToRelayAvailable);
      }
    });
    upstream.on("message", (data, isBinary) => {
      forward(downstream, rawDataToBuffer(data), isBinary, relayToClientAvailable);
    });
    upstream.once("close", closePair);
    upstream.once("error", closePair);
  }
}

/** Creates a Node WebSocket factory that optionally emulates a pre-framed legacy client hello. */
function createWebSocketFactory(stripFramedCapability: boolean): WebSocketFactory {
  return (url, options) => {
    const socket = new WebSocket(url, options?.protocols, {
      headers: options?.headers,
    });
    const send = socket.send.bind(socket);
    const wrapper: WebSocketLike = {
      get readyState() {
        return socket.readyState;
      },
      send(data) {
        if (stripFramedCapability && typeof data === "string") {
          try {
            const message = JSON.parse(data) as {
              type?: string;
              capabilities?: Record<string, unknown>;
            };
            if (message.type === "e2ee_hello" && message.capabilities) {
              const { framedCiphertextV1: _framed, ...capabilities } = message.capabilities;
              send(JSON.stringify({ ...message, capabilities }));
              return;
            }
          } catch {
            // Application ciphertext is opaque at this layer; send it unchanged.
          }
        }
        send(data);
      },
      close: (code, reason) => socket.close(code, reason),
      get binaryType() {
        return socket.binaryType;
      },
      set binaryType(value) {
        socket.binaryType = value as typeof socket.binaryType;
      },
      on: (event, listener) => {
        socket.on(event, listener as (...args: never[]) => void);
      },
      off: (event, listener) => {
        socket.off(event, listener as (...args: never[]) => void);
      },
      removeListener: (event, listener) => {
        socket.removeListener(event, listener as (...args: never[]) => void);
      },
    };
    return wrapper;
  };
}

/** Creates one client for a relay offer through either the legacy or framed wire. */
function createRelayClient(
  offer: ConnectionOffer,
  clientId: string,
  stripFramedCapability: boolean,
): DaemonClient {
  return new DaemonClient({
    url: buildRelayWebSocketUrl({
      endpoint: offer.relay.endpoint,
      useTls: false,
      serverId: offer.serverId,
      role: "client",
    }),
    clientId,
    clientType: "cli",
    connectTimeoutMs: 30_000,
    e2ee: { enabled: true, daemonPublicKeyB64: offer.daemonPublicKeyB64 },
    reconnect: { enabled: false },
    logger: pino({ level: "silent" }),
    webSocketFactory: createWebSocketFactory(stripFramedCapability),
  });
}

/** Creates a direct client used only to seed isolated daemon state before relay measurements. */
function createDirectClient(daemon: TestPaseoDaemon, clientId: string): DaemonClient {
  return new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    clientId,
    clientType: "cli",
    reconnect: { enabled: false },
    logger: pino({ level: "silent" }),
    webSocketFactory: createWebSocketFactory(false),
  });
}

/** Creates one relay pairing offer pointing at the local shaping proxy. */
async function pairingOfferFor(
  daemon: TestPaseoDaemon,
  proxyEndpoint: string,
): Promise<ConnectionOffer> {
  const pairing = await generateLocalPairingOffer({
    paseoHome: daemon.paseoHome,
    relayEnabled: true,
    relayEndpoint: proxyEndpoint,
    relayPublicEndpoint: proxyEndpoint,
    relayUseTls: false,
    relayPublicUseTls: false,
    includeQr: false,
  });
  if (!pairing.url) throw new Error("Relay performance pairing did not produce an offer");
  const offer = parseConnectionOfferFromUrl(pairing.url);
  if (!offer) throw new Error("Relay performance pairing offer was invalid");
  return offer;
}

/** Seeds one 40-item fake timeline and a 10 MiB UTF-8 file through the isolated daemon. */
async function seedWorkloads(
  daemon: TestPaseoDaemon,
): Promise<{ agentId: string; fileName: string }> {
  const seedClient = createDirectClient(daemon, "clid_live_relay_performance_seed");
  const fileName = "relay-performance-10MiB.txt";
  await writeFile(`${daemon.staticDir}/${fileName}`, buildTextCorpus(fileBytes));
  try {
    await seedClient.connect();
    const agent = await seedClient.createAgent({
      provider: "codex",
      cwd: daemon.staticDir,
      title: "Live relay performance seed",
      modeId: "full-access",
    });
    await seedClient.sendMessage(agent.id, "emit 40 agent stream updates");
    await seedClient.waitForFinish(agent.id, 30_000);
    await seedClient.sendMessage(
      agent.id,
      `emit ${timelinePayloadBytes} byte large file agent stream update`,
    );
    await seedClient.waitForFinish(agent.id, 30_000);
    const timeline = await seedClient.fetchAgentTimeline(agent.id, {
      direction: "tail",
      limit: 40,
      projection: "canonical",
    });
    if (timeline.entries.length < 40) {
      throw new Error(`Relay performance seed timeline was ${timeline.entries.length} items`);
    }
    return { agentId: agent.id, fileName };
  } finally {
    await seedClient.close();
  }
}

/** Measures one timeline catch-up without retaining its payload. */
async function measureTimeline(client: DaemonClient, agentId: string): Promise<number> {
  const startedAt = performance.now();
  const result = await client.fetchAgentTimeline(agentId, {
    direction: "tail",
    limit: 40,
    projection: "canonical",
  });
  expect(result.entries.length).toBeGreaterThanOrEqual(40);
  return performance.now() - startedAt;
}

/** Measures one complete 10 MiB file read without retaining the returned bytes. */
async function measureFile(client: DaemonClient, cwd: string, fileName: string): Promise<number> {
  const startedAt = performance.now();
  const result = await client.readFile(cwd, fileName);
  expect(result.size).toBe(fileBytes);
  expect(result.bytes.byteLength).toBe(fileBytes);
  return performance.now() - startedAt;
}

/** Summarizes measured durations and computes relative framed improvement. */
function summarizeProfile(
  profile: string,
  legacy: WorkloadMeasurements,
  framed: WorkloadMeasurements,
): RelayPerformanceSummary {
  const legacyTimelineP50Ms = percentile(legacy.timelineMs, 0.5);
  const legacyTimelineP95Ms = percentile(legacy.timelineMs, 0.95);
  const legacyFileP50Ms = percentile(legacy.fileMs, 0.5);
  const legacyFileP95Ms = percentile(legacy.fileMs, 0.95);
  const framedTimelineP50Ms = percentile(framed.timelineMs, 0.5);
  const framedTimelineP95Ms = percentile(framed.timelineMs, 0.95);
  const framedFileP50Ms = percentile(framed.fileMs, 0.5);
  const framedFileP95Ms = percentile(framed.fileMs, 0.95);
  const reduction = (baseline: number, candidate: number): number =>
    Math.round((1 - candidate / Math.max(1, baseline)) * 100) / 100;
  return {
    profile,
    legacy: {
      timelineP50Ms: Math.round(legacyTimelineP50Ms),
      timelineP95Ms: Math.round(legacyTimelineP95Ms),
      fileP50Ms: Math.round(legacyFileP50Ms),
      fileP95Ms: Math.round(legacyFileP95Ms),
    },
    framed: {
      timelineP50Ms: Math.round(framedTimelineP50Ms),
      timelineP95Ms: Math.round(framedTimelineP95Ms),
      fileP50Ms: Math.round(framedFileP50Ms),
      fileP95Ms: Math.round(framedFileP95Ms),
    },
    improvement: {
      timelineP50: reduction(legacyTimelineP50Ms, framedTimelineP50Ms),
      timelineP95: reduction(legacyTimelineP95Ms, framedTimelineP95Ms),
      fileP50: reduction(legacyFileP50Ms, framedFileP50Ms),
      fileP95: reduction(legacyFileP95Ms, framedFileP95Ms),
    },
  };
}

describe("live hosted relay weak-network profiles", () => {
  performanceTest(
    "improves state-sync and UTF-8 file completion under shaped relay links",
    async () => {
      const summaries: RelayPerformanceSummary[] = [];
      for (const profile of profiles) {
        const proxy = new ShapedRelayProxy(profile);
        let daemon: TestPaseoDaemon | null = null;
        let legacyClient: DaemonClient | null = null;
        let framedClient: DaemonClient | null = null;
        try {
          await proxy.start();
          daemon = await createTestPaseoDaemon({
            listen: "127.0.0.1",
            relayEnabled: true,
            relayEndpoint: proxy.endpoint,
            relayUseTls: false,
            relayPublicUseTls: false,
            logger: pino({ level: "silent" }),
          });
          const workloads = await seedWorkloads(daemon);
          const offer = await pairingOfferFor(daemon, proxy.endpoint);
          legacyClient = createRelayClient(offer, `clid_legacy_${profile.label}`, true);
          framedClient = createRelayClient(offer, `clid_framed_${profile.label}`, false);
          await Promise.all([legacyClient.connect(), framedClient.connect()]);
          await Promise.all([legacyClient.fetchAgents(), framedClient.fetchAgents()]);

          const legacy: WorkloadMeasurements = { timelineMs: [], fileMs: [] };
          const framed: WorkloadMeasurements = { timelineMs: [], fileMs: [] };
          for (let run = 0; run < measuredRuns; run += 1) {
            const first = run % 2 === 0 ? legacy : framed;
            const second = first === legacy ? framed : legacy;
            const firstClient = first === legacy ? legacyClient : framedClient;
            const secondClient = second === legacy ? legacyClient : framedClient;
            first.timelineMs.push(await measureTimeline(firstClient, workloads.agentId));
            first.fileMs.push(await measureFile(firstClient, daemon.staticDir, workloads.fileName));
            second.timelineMs.push(await measureTimeline(secondClient, workloads.agentId));
            second.fileMs.push(
              await measureFile(secondClient, daemon.staticDir, workloads.fileName),
            );
          }

          const summary = summarizeProfile(profile.label, legacy, framed);
          summaries.push(summary);
          process.stdout.write(`${JSON.stringify(summary)}\n`);
          expect(summary.improvement.timelineP50).toBeGreaterThanOrEqual(0.2);
          expect(summary.improvement.timelineP95).toBeGreaterThanOrEqual(0.2);
          expect(summary.improvement.fileP50).toBeGreaterThanOrEqual(0.2);
          expect(summary.improvement.fileP95).toBeGreaterThanOrEqual(0.2);
        } finally {
          await legacyClient?.close().catch(() => undefined);
          await framedClient?.close().catch(() => undefined);
          await daemon?.close();
          await proxy.close();
        }
      }
      expect(summaries).toHaveLength(profiles.length);
    },
    15 * 60_000,
  );
});
