import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import pino from "pino";
import { WebSocket, WebSocketServer, type RawData } from "ws";

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
import { generateLocalPairingOffer } from "@server/server/pairing-offer.js";
import {
  createTestPaseoDaemon,
  type TestPaseoDaemon,
} from "@server/server/test-utils/paseo-daemon.js";

/** Default independent samples collected for each wire representation and profile. */
const DEFAULT_MEASURED_RUNS = 5;
/** Maximum accepted sample count preventing an accidental unbounded manual run. */
const MAX_MEASURED_RUNS = 100;
/** UTF-8 file size used by every relay measurement. */
const FILE_BYTES = 10 * 1024 * 1024;
/** Representative completed timeline payload kept below the v1 4 MiB compression ceiling. */
const TIMELINE_PAYLOAD_BYTES = 1_000_000;
/** Stable operation labels mixed into the synthetic structured text corpus. */
const CORPUS_OPERATIONS = ["replace", "insert", "delete"] as const;

interface RelayPerformanceCliOptions {
  /** Hosted relay authority in host or host:port form. */
  relayEndpoint: string;
  /** Independent measurements collected per wire representation and profile. */
  measuredRuns: number;
}

interface RelayNetworkProfile {
  /** Stable label used in the aggregate output and assertion messages. */
  label: string;
  /** Available downstream bandwidth in bits per second. */
  bandwidthBitsPerSecond: number;
  /** Profile round-trip latency; each shaped direction uses half. */
  roundTripLatencyMs: number;
}

/** Fixed weak-network profiles used for comparable manual measurements. */
const RELAY_NETWORK_PROFILES: readonly RelayNetworkProfile[] = [
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
  legacy: WorkloadDurationSummary;
  /** Framed compression p50/p95 values. */
  framed: WorkloadDurationSummary;
  /** Relative completion-time reductions, bounded to two decimals. */
  improvement: WorkloadImprovementSummary;
}

interface WorkloadDurationSummary {
  /** Timeline completion p50 in milliseconds. */
  timelineP50Ms: number;
  /** Timeline completion p95 in milliseconds. */
  timelineP95Ms: number;
  /** File completion p50 in milliseconds. */
  fileP50Ms: number;
  /** File completion p95 in milliseconds. */
  fileP95Ms: number;
}

interface WorkloadImprovementSummary {
  /** Relative timeline p50 reduction from legacy to framed. */
  timelineP50: number;
  /** Relative timeline p95 reduction from legacy to framed. */
  timelineP95: number;
  /** Relative file p50 reduction from legacy to framed. */
  fileP50: number;
  /** Relative file p95 reduction from legacy to framed. */
  fileP95: number;
}

interface RelayProxyConnection {
  /** Downstream local socket. */
  downstream: WebSocket;
  /** Upstream production relay socket. */
  upstream: WebSocket;
}

interface MutableAvailability {
  /** Monotonic time when the shaped direction can finish another frame. */
  value: number;
}

interface ShapedSendOptions {
  /** Deferred WebSocket send operation. */
  send: () => void;
  /** Exact frame bytes charged to the bandwidth profile. */
  byteLength: number;
  /** Active bandwidth and latency profile. */
  profile: RelayNetworkProfile;
  /** Direction-local serialization availability. */
  availableAt: MutableAvailability;
}

interface ShapedRelayProxyOptions {
  /** Active bandwidth and latency profile. */
  profile: RelayNetworkProfile;
  /** Hosted relay authority reached by the local proxy. */
  relayEndpoint: string;
}

interface ForwardFrameOptions {
  /** Destination WebSocket. */
  target: WebSocket;
  /** Exact frame bytes forwarded without inspection. */
  data: Buffer;
  /** Original WebSocket opcode representation. */
  isBinary: boolean;
  /** Direction-local serialization availability. */
  availableAt: MutableAvailability;
}

interface PendingRelayFrame {
  /** Exact frame bytes retained until the upstream opens. */
  data: Buffer;
  /** Original WebSocket opcode representation. */
  isBinary: boolean;
}

interface RelayWebSocketFactoryOptions {
  /** Removes framed capability advertisement to emulate a legacy client. */
  stripFramedCapability: boolean;
}

interface RelayWebSocketListenerOptions {
  /** Node WebSocket receiving the listener operation. */
  socket: WebSocket;
  /** WebSocket event requested by the shared client transport. */
  event: string;
  /** Shared client listener accepting runtime-specific event arguments. */
  listener: (...args: unknown[]) => void;
  /** Whether the listener is attached or detached. */
  operation: "add" | "remove";
}

interface RelayClientOptions extends RelayWebSocketFactoryOptions {
  /** Authenticated pairing offer used by the client. */
  offer: ConnectionOffer;
  /** Stable client identifier unique within one measurement profile. */
  clientId: string;
}

interface SeededWorkloads {
  /** Fake agent whose completed timeline is measured. */
  agentId: string;
  /** SHA-256 of the exact canonical timeline page seeded through the direct connection. */
  timelineDigest: string;
  /** UTF-8 file name relative to the daemon static directory. */
  fileName: string;
  /** SHA-256 of the exact file bytes written before relay measurement. */
  fileDigest: string;
}

interface MeasureFileOptions {
  /** Connected relay client performing the read. */
  client: DaemonClient;
  /** Root directory containing the seeded file. */
  cwd: string;
  /** Seeded file name relative to the root directory. */
  fileName: string;
  /** Expected SHA-256 proving the returned bytes match the seeded file. */
  expectedDigest: string;
}

interface SummarizeProfileOptions {
  /** Stable network profile label. */
  profile: string;
  /** Legacy Base64 completion measurements. */
  legacy: WorkloadMeasurements;
  /** Framed compression completion measurements. */
  framed: WorkloadMeasurements;
}

interface RunProfileOptions extends RelayPerformanceCliOptions {
  /** Active weak-network profile. */
  profile: RelayNetworkProfile;
}

interface PercentileOptions {
  /** Independent measurements to summarize. */
  values: readonly number[];
  /** Quantile expressed as a fraction from zero through one. */
  fraction: number;
}

interface AttachRelaySocketOptions {
  /** Local client-side socket accepted by the shaping proxy. */
  downstream: WebSocket;
  /** Original relay request path including role and authentication query fields. */
  requestPath: string;
}

interface DirectClientOptions {
  /** Isolated daemon reached without relay shaping. */
  daemon: TestPaseoDaemon;
  /** Stable client identifier for the seeding connection. */
  clientId: string;
}

interface PairingOfferOptions {
  /** Isolated daemon whose identity is placed in the offer. */
  daemon: TestPaseoDaemon;
  /** Local shaping proxy authority placed in the relay fields. */
  proxyEndpoint: string;
}

interface MeasureTimelineOptions {
  /** Connected client requesting one catch-up page. */
  client: DaemonClient;
  /** Seeded agent whose completed timeline is requested. */
  agentId: string;
  /** Expected SHA-256 proving the returned page matches the seeded timeline. */
  expectedDigest: string;
}

interface RelativeReductionOptions {
  /** Legacy completion duration used as the denominator. */
  baseline: number;
  /** Framed completion duration compared with the baseline. */
  candidate: number;
}

interface RelayPerformanceReport {
  /** Measurement output schema version. */
  schemaVersion: 1;
  /** Samples collected per wire representation and profile. */
  measuredRuns: number;
  /** Seeded timeline payload bytes. */
  timelinePayloadBytes: number;
  /** Seeded UTF-8 file bytes. */
  fileBytes: number;
  /** Aggregated profile results. */
  summaries: RelayPerformanceSummary[];
}

/** Validates and normalizes one relay authority without retaining credentials or paths. */
function parseRelayEndpoint(value: string): string {
  const isMissing = value.length === 0;
  const hasScheme = value.includes("://");
  if (isMissing || hasScheme) {
    throw new Error("--relay-endpoint must be a host or host:port authority");
  }
  /** URL parser used only to validate the authority boundary. */
  const parsed = new URL(`wss://${value}`);
  const hasUnsupportedUrlParts =
    !parsed.hostname ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "";
  if (hasUnsupportedUrlParts) {
    throw new Error(
      "--relay-endpoint must not include a scheme, credentials, path, query, or hash",
    );
  }
  return parsed.host;
}

/** Parses explicit manual-measurement CLI options. */
function parseCliOptions(args: readonly string[]): RelayPerformanceCliOptions {
  /** Required hosted relay authority supplied by the operator. */
  let relayEndpoint: string | null = null;
  /** Requested sample count or the fixed default. */
  let measuredRuns = DEFAULT_MEASURED_RUNS;

  for (const argument of args) {
    if (argument === "--help") {
      printHelp();
      process.exit(0);
    }
    if (argument.startsWith("--relay-endpoint=")) {
      relayEndpoint = parseRelayEndpoint(argument.slice("--relay-endpoint=".length));
      continue;
    }
    if (argument.startsWith("--runs=")) {
      /** User-supplied independent sample count. */
      const requestedRuns = Number(argument.slice("--runs=".length));
      const isInteger = Number.isSafeInteger(requestedRuns);
      const isPositive = requestedRuns >= 1;
      const isWithinLimit = requestedRuns <= MAX_MEASURED_RUNS;
      if (!isInteger || !isPositive || !isWithinLimit) {
        throw new Error(`--runs must be an integer from 1 to ${MAX_MEASURED_RUNS}`);
      }
      measuredRuns = requestedRuns;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (relayEndpoint === null) {
    throw new Error("--relay-endpoint is required");
  }
  return { relayEndpoint, measuredRuns };
}

/** Prints the explicit manual-measurement contract. */
function printHelp(): void {
  process.stdout
    .write(`Usage: npm run measure:live-relay-performance -- --relay-endpoint=<host[:port]> [options]

Measures legacy and framed state catch-up through a hosted relay and local weak-network shaper.
The command validates exact payload integrity and emits one aggregate JSON report; it does not enforce latency thresholds.

Options:
  --relay-endpoint=<host[:port]>  Required hosted relay authority. The connection uses TLS.
  --runs=<count>                  Samples per wire/profile, 1-${MAX_MEASURED_RUNS}. Defaults to ${DEFAULT_MEASURED_RUNS}.
  --help                          Show this help.
`);
}

/** Converts a WebSocket raw message to an exact byte buffer without retaining pooled storage. */
function rawDataToBuffer(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.from(data);
}

/** Returns a content-free integrity digest for one measured payload. */
function payloadDigest(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Computes a deterministic percentile from independent measured durations. */
function percentile(options: PercentileOptions): number {
  const { values, fraction } = options;
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
      operation: CORPUS_OPERATIONS[index % CORPUS_OPERATIONS.length],
      token,
      context: "state-sync benchmark line with stable protocol fields",
    });
    text += "\n";
    index += 1;
  }
  return new TextEncoder().encode(text.slice(0, bytes));
}

/** Schedules one message through a deterministic bandwidth/latency shaper. */
function scheduleShapedSend(options: ShapedSendOptions): ReturnType<typeof setTimeout> {
  const { send, byteLength, profile, availableAt } = options;
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
  /** Active bandwidth and latency profile. */
  private readonly profile: RelayNetworkProfile;
  /** Hosted relay authority reached by each upstream socket. */
  private readonly relayEndpoint: string;
  /** Ephemeral local WebSocket listener used as the shaping boundary. */
  private readonly server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  /** Active downstream/upstream socket pairs owned by the proxy. */
  private readonly connections = new Set<RelayProxyConnection>();
  /** Deferred shaped sends cancelled during cleanup. */
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  /** Bound local TCP port, or null until the listener starts. */
  private port: number | null = null;

  /** Creates a local shaper for one network profile and hosted relay. */
  constructor(options: ShapedRelayProxyOptions) {
    this.profile = options.profile;
    this.relayEndpoint = options.relayEndpoint;
  }

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
        const hasNoAddress = address === null;
        const isNamedAddress = typeof address === "string";
        if (hasNoAddress || isNamedAddress) {
          reject(new Error("Relay performance proxy did not bind a TCP port"));
          return;
        }
        this.port = address.port;
        resolve();
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.on("connection", (downstream, request) => {
        this.attach({ downstream, requestPath: request.url ?? "/ws" });
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
  private attach(options: AttachRelaySocketOptions): void {
    const { downstream, requestPath } = options;
    const upstream = new WebSocket(`wss://${this.relayEndpoint}${requestPath}`);
    const connection = { downstream, upstream } satisfies RelayProxyConnection;
    this.connections.add(connection);
    const role = new URL(`ws://relay.invalid${requestPath}`).searchParams.get("role");
    const shouldShape = role === "client";
    const clientToRelayAvailable = { value: 0 };
    const relayToClientAvailable = { value: 0 };
    const pending: PendingRelayFrame[] = [];
    let closed = false;

    const closePair = (): void => {
      if (closed) return;
      closed = true;
      this.connections.delete(connection);
      if (downstream.readyState === WebSocket.OPEN) downstream.close();
      const upstreamCanClose =
        upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING;
      if (upstreamCanClose) {
        upstream.close();
      }
    };
    const forward = (frame: ForwardFrameOptions): void => {
      const { target, data, isBinary, availableAt } = frame;
      const send = (): void => {
        this.timers.delete(timer);
        const targetIsClosed = target.readyState !== WebSocket.OPEN;
        if (closed || targetIsClosed) return;
        target.send(data, { binary: isBinary });
      };
      const timer = shouldShape
        ? scheduleShapedSend({
            send,
            byteLength: data.byteLength,
            profile: this.profile,
            availableAt,
          })
        : setTimeout(send, 0);
      this.timers.add(timer);
    };

    downstream.on("message", (data, isBinary) => {
      const message = { data: rawDataToBuffer(data), isBinary };
      if (upstream.readyState !== WebSocket.OPEN) {
        pending.push(message);
        return;
      }
      forward({
        target: upstream,
        data: message.data,
        isBinary: message.isBinary,
        availableAt: clientToRelayAvailable,
      });
    });
    downstream.once("close", closePair);
    downstream.once("error", closePair);
    upstream.on("open", () => {
      for (const message of pending.splice(0)) {
        forward({
          target: upstream,
          data: message.data,
          isBinary: message.isBinary,
          availableAt: clientToRelayAvailable,
        });
      }
    });
    upstream.on("message", (data, isBinary) => {
      forward({
        target: downstream,
        data: rawDataToBuffer(data),
        isBinary,
        availableAt: relayToClientAvailable,
      });
    });
    upstream.once("close", closePair);
    upstream.once("error", closePair);
  }
}

/** Narrows one parsed JSON value to an indexable object after boundary validation. */
function isJsonRecord(value: unknown): value is Record<string, unknown> {
  const isObject = value !== null && typeof value === "object";
  const isArray = Array.isArray(value);
  return isObject && !isArray;
}

/** Applies one shared-client listener operation to a supported Node WebSocket event. */
function updateWebSocketListener(options: RelayWebSocketListenerOptions): void {
  const { socket, event, listener, operation } = options;
  switch (event) {
    case "open":
      if (operation === "add") socket.on("open", listener);
      else socket.off("open", listener);
      return;
    case "close":
      if (operation === "add") socket.on("close", listener);
      else socket.off("close", listener);
      return;
    case "error":
      if (operation === "add") socket.on("error", listener);
      else socket.off("error", listener);
      return;
    case "message":
      if (operation === "add") socket.on("message", listener);
      else socket.off("message", listener);
      return;
    default:
      throw new Error(`Unsupported relay measurement WebSocket event: ${event}`);
  }
}

/** Creates a Node WebSocket factory that optionally emulates a pre-framed legacy client hello. */
function createWebSocketFactory(options: RelayWebSocketFactoryOptions): WebSocketFactory {
  const { stripFramedCapability } = options;
  return (url, socketOptions) => {
    const socket = new WebSocket(url, socketOptions?.protocols, {
      headers: socketOptions?.headers,
    });
    const send = socket.send.bind(socket);
    const wrapper: WebSocketLike = {
      get readyState() {
        return socket.readyState;
      },
      send(data) {
        if (!stripFramedCapability || typeof data !== "string") {
          send(data);
          return;
        }
        try {
          const message: unknown = JSON.parse(data);
          if (!isJsonRecord(message)) {
            send(data);
            return;
          }
          const isHello = message.type === "e2ee_hello";
          if (!isHello) {
            send(data);
            return;
          }
          const capabilities = message.capabilities;
          if (!isJsonRecord(capabilities)) {
            send(data);
            return;
          }
          const { framedCiphertextV1: _framed, ...legacyCapabilities } = capabilities;
          send(JSON.stringify({ ...message, capabilities: legacyCapabilities }));
          return;
        } catch {
          // Application ciphertext is opaque at this layer; send it unchanged.
        }
        send(data);
      },
      close: (code, reason) => socket.close(code, reason),
      get binaryType() {
        return socket.binaryType;
      },
      set binaryType(value) {
        const isSupportedBinaryType =
          value === "nodebuffer" || value === "arraybuffer" || value === "fragments";
        if (!isSupportedBinaryType) {
          throw new Error(`Unsupported relay measurement binaryType: ${value}`);
        }
        socket.binaryType = value;
      },
      on: (event, listener) => {
        updateWebSocketListener({ socket, event, listener, operation: "add" });
      },
      off: (event, listener) => {
        updateWebSocketListener({ socket, event, listener, operation: "remove" });
      },
      removeListener: (event, listener) => {
        updateWebSocketListener({ socket, event, listener, operation: "remove" });
      },
    };
    return wrapper;
  };
}

/** Creates one client for a relay offer through either the legacy or framed wire. */
function createRelayClient(options: RelayClientOptions): DaemonClient {
  const { offer, clientId, stripFramedCapability } = options;
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
    webSocketFactory: createWebSocketFactory({ stripFramedCapability }),
  });
}

/** Creates a direct client used only to seed isolated daemon state before relay measurements. */
function createDirectClient(options: DirectClientOptions): DaemonClient {
  const { daemon, clientId } = options;
  return new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    clientId,
    clientType: "cli",
    reconnect: { enabled: false },
    logger: pino({ level: "silent" }),
    webSocketFactory: createWebSocketFactory({ stripFramedCapability: false }),
  });
}

/** Creates one relay pairing offer pointing at the local shaping proxy. */
async function pairingOfferFor(options: PairingOfferOptions): Promise<ConnectionOffer> {
  const { daemon, proxyEndpoint } = options;
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
async function seedWorkloads(daemon: TestPaseoDaemon): Promise<SeededWorkloads> {
  const seedClient = createDirectClient({
    daemon,
    clientId: "clid_live_relay_performance_seed",
  });
  const fileName = "relay-performance-10MiB.txt";
  /** Exact deterministic file corpus retained only long enough to seed and hash it. */
  const filePayload = buildTextCorpus(FILE_BYTES);
  await writeFile(`${daemon.staticDir}/${fileName}`, filePayload);
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
      `emit ${TIMELINE_PAYLOAD_BYTES} byte large file agent stream update`,
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
    return {
      agentId: agent.id,
      timelineDigest: payloadDigest(JSON.stringify(timeline.entries)),
      fileName,
      fileDigest: payloadDigest(filePayload),
    };
  } finally {
    await seedClient.close();
  }
}

/** Measures one timeline catch-up without retaining its payload. */
async function measureTimeline(options: MeasureTimelineOptions): Promise<number> {
  const { client, agentId, expectedDigest } = options;
  const startedAt = performance.now();
  const result = await client.fetchAgentTimeline(agentId, {
    direction: "tail",
    limit: 40,
    projection: "canonical",
  });
  if (result.entries.length < 40) {
    throw new Error(`Measured relay timeline returned ${result.entries.length} items; expected 40`);
  }
  const durationMs = performance.now() - startedAt;
  const actualDigest = payloadDigest(JSON.stringify(result.entries));
  if (actualDigest !== expectedDigest) {
    throw new Error("Measured relay timeline did not match the seeded payload");
  }
  return durationMs;
}

/** Computes the relative duration reduction from legacy to framed transport. */
function relativeReduction(options: RelativeReductionOptions): number {
  const { baseline, candidate } = options;
  return Math.round((1 - candidate / Math.max(1, baseline)) * 100) / 100;
}

/** Measures one complete 10 MiB file read without retaining the returned bytes. */
async function measureFile(options: MeasureFileOptions): Promise<number> {
  const { client, cwd, fileName, expectedDigest } = options;
  const startedAt = performance.now();
  const result = await client.readFile(cwd, fileName);
  const hasExpectedSize = result.size === FILE_BYTES && result.bytes.byteLength === FILE_BYTES;
  if (!hasExpectedSize) {
    throw new Error(
      `Measured relay file returned size=${result.size} bytes=${result.bytes.byteLength}; expected ${FILE_BYTES}`,
    );
  }
  const durationMs = performance.now() - startedAt;
  if (payloadDigest(result.bytes) !== expectedDigest) {
    throw new Error("Measured relay file did not match the seeded payload");
  }
  return durationMs;
}

/** Summarizes measured durations and computes relative framed improvement. */
function summarizeProfile(options: SummarizeProfileOptions): RelayPerformanceSummary {
  const { profile, legacy, framed } = options;
  const legacyTimelineP50Ms = percentile({ values: legacy.timelineMs, fraction: 0.5 });
  const legacyTimelineP95Ms = percentile({ values: legacy.timelineMs, fraction: 0.95 });
  const legacyFileP50Ms = percentile({ values: legacy.fileMs, fraction: 0.5 });
  const legacyFileP95Ms = percentile({ values: legacy.fileMs, fraction: 0.95 });
  const framedTimelineP50Ms = percentile({ values: framed.timelineMs, fraction: 0.5 });
  const framedTimelineP95Ms = percentile({ values: framed.timelineMs, fraction: 0.95 });
  const framedFileP50Ms = percentile({ values: framed.fileMs, fraction: 0.5 });
  const framedFileP95Ms = percentile({ values: framed.fileMs, fraction: 0.95 });
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
      timelineP50: relativeReduction({
        baseline: legacyTimelineP50Ms,
        candidate: framedTimelineP50Ms,
      }),
      timelineP95: relativeReduction({
        baseline: legacyTimelineP95Ms,
        candidate: framedTimelineP95Ms,
      }),
      fileP50: relativeReduction({ baseline: legacyFileP50Ms, candidate: framedFileP50Ms }),
      fileP95: relativeReduction({ baseline: legacyFileP95Ms, candidate: framedFileP95Ms }),
    },
  };
}

/** Measures one weak-network profile and always releases its isolated daemon and sockets. */
async function runProfile(options: RunProfileOptions): Promise<RelayPerformanceSummary> {
  const { profile, relayEndpoint, measuredRuns } = options;
  /** Local transparent proxy applying the selected weak-network profile. */
  const proxy = new ShapedRelayProxy({ profile, relayEndpoint });
  /** Isolated daemon owned by this profile run. */
  let daemon: TestPaseoDaemon | null = null;
  /** Legacy client owned by this profile run. */
  let legacyClient: DaemonClient | null = null;
  /** Framed client owned by this profile run. */
  let framedClient: DaemonClient | null = null;
  try {
    await proxy.start();
    /** Running daemon retained separately so later calls remain non-nullable. */
    const runningDaemon = await createTestPaseoDaemon({
      listen: "127.0.0.1",
      relayEnabled: true,
      relayEndpoint: proxy.endpoint,
      relayUseTls: false,
      relayPublicUseTls: false,
      logger: pino({ level: "silent" }),
    });
    daemon = runningDaemon;
    /** Seed identifiers reused by both wire representations. */
    const workloads = await seedWorkloads(runningDaemon);
    /** Authenticated offer routed through the local shaping proxy. */
    const offer = await pairingOfferFor({
      daemon: runningDaemon,
      proxyEndpoint: proxy.endpoint,
    });
    legacyClient = createRelayClient({
      offer,
      clientId: `clid_legacy_${profile.label}`,
      stripFramedCapability: true,
    });
    framedClient = createRelayClient({
      offer,
      clientId: `clid_framed_${profile.label}`,
      stripFramedCapability: false,
    });
    await Promise.all([legacyClient.connect(), framedClient.connect()]);
    await Promise.all([legacyClient.fetchAgents(), framedClient.fetchAgents()]);

    /** Legacy Base64 measurements for this profile. */
    const legacy: WorkloadMeasurements = { timelineMs: [], fileMs: [] };
    /** Framed compression measurements for this profile. */
    const framed: WorkloadMeasurements = { timelineMs: [], fileMs: [] };
    for (let run = 0; run < measuredRuns; run += 1) {
      /** Alternating first wire representation limits systematic ordering bias. */
      const first = run % 2 === 0 ? legacy : framed;
      /** Remaining wire representation measured second in this sample. */
      const second = first === legacy ? framed : legacy;
      /** Client matching the first measurement bucket. */
      const firstClient = first === legacy ? legacyClient : framedClient;
      /** Client matching the second measurement bucket. */
      const secondClient = second === legacy ? legacyClient : framedClient;
      first.timelineMs.push(
        await measureTimeline({
          client: firstClient,
          agentId: workloads.agentId,
          expectedDigest: workloads.timelineDigest,
        }),
      );
      first.fileMs.push(
        await measureFile({
          client: firstClient,
          cwd: runningDaemon.staticDir,
          fileName: workloads.fileName,
          expectedDigest: workloads.fileDigest,
        }),
      );
      second.timelineMs.push(
        await measureTimeline({
          client: secondClient,
          agentId: workloads.agentId,
          expectedDigest: workloads.timelineDigest,
        }),
      );
      second.fileMs.push(
        await measureFile({
          client: secondClient,
          cwd: runningDaemon.staticDir,
          fileName: workloads.fileName,
          expectedDigest: workloads.fileDigest,
        }),
      );
    }

    return summarizeProfile({ profile: profile.label, legacy, framed });
  } finally {
    await legacyClient?.close().catch(() => undefined);
    await framedClient?.close().catch(() => undefined);
    await daemon?.close();
    await proxy.close();
  }
}

/** Runs every fixed profile and builds one machine-readable aggregate report. */
async function measureRelayPerformance(
  options: RelayPerformanceCliOptions,
): Promise<RelayPerformanceReport> {
  /** Profile summaries emitted together after every run completes. */
  const summaries: RelayPerformanceSummary[] = [];
  for (const profile of RELAY_NETWORK_PROFILES) {
    summaries.push(await runProfile({ ...options, profile }));
  }
  return {
    schemaVersion: 1,
    measuredRuns: options.measuredRuns,
    timelinePayloadBytes: TIMELINE_PAYLOAD_BYTES,
    fileBytes: FILE_BYTES,
    summaries,
  };
}

/** Parses the operator boundary, executes the measurement, and emits aggregate JSON. */
async function main(): Promise<void> {
  /** Validated manual-measurement options. */
  const options = parseCliOptions(process.argv.slice(2));
  /** Completed aggregate report without payload contents or relay credentials. */
  const report = await measureRelayPerformance(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
