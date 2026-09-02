import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

import pino from "pino";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import type { NegotiatedEncryptedTransport } from "@getpaseo/relay/e2ee";
import { createRelayE2eeTransportFactory } from "@getpaseo/client/internal/daemon-client-relay-e2ee-transport";
import { createWebSocketTransportFactory } from "@getpaseo/client/internal/daemon-client-websocket-transport";
import {
  DaemonClient,
  type TerminalStreamEvent,
  type WebSocketFactory,
  type WebSocketLike,
} from "@getpaseo/client/internal/daemon-client";
import { buildRelayWebSocketUrl } from "@getpaseo/protocol/daemon-endpoints";
import {
  parseConnectionOfferFromUrl,
  type ConnectionOffer,
} from "@getpaseo/protocol/connection-offer";
import { generateLocalPairingOffer } from "@server/server/pairing-offer.js";
import { resolveDaemonVersion } from "@server/server/daemon-version.js";
import {
  createTestPaseoDaemon,
  type TestPaseoDaemon,
} from "@server/server/test-utils/paseo-daemon.js";
import { MockLoadTestAgentClient } from "@server/server/agent/providers/mock-load-test-agent.js";
import type { AgentSnapshotPayload, SessionOutboundMessage } from "@getpaseo/protocol/messages";
import type { WaitForFinishResult } from "@getpaseo/client/internal/daemon-client";

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
/** Stable branch labels for the two large state-sync requests in each realtime probe. */
const REALTIME_STATE_SYNC_BRANCHES = ["state-sync 1", "state-sync 2"] as const;
/** Number of large state-sync requests issued before each realtime probe. */
const REALTIME_STATE_SYNC_REQUESTS = REALTIME_STATE_SYNC_BRANCHES.length;
/** Number of uniquely identifiable incremental agent-stream rows per probe. */
const REALTIME_AGENT_STREAM_EVENTS = 32;
/** Maximum wait for one realtime probe to receive all required observations. */
const REALTIME_SAMPLE_TIMEOUT_MS = 45_000;
/** Minimum serialized canonical timeline bytes required for the concurrent sync load. */
const REALTIME_MIN_TIMELINE_BYTES = 512 * 1024;
/** Absolute p95 regression allowance required by Spec 0084 section 6.2. */
const REALTIME_REGRESSION_ABSOLUTE_MS = 2;
/** Relative p95 regression allowance required by Spec 0084 section 6.2. */
const REALTIME_REGRESSION_RELATIVE = 0.05;
/** Current synchronized package version advertised by every relay measurement connection. */
const MEASUREMENT_CLIENT_APP_VERSION = resolveDaemonVersion(import.meta.url);
/** Node program run inside the PTY so the marker measures the terminal byte path only. */
const TERMINAL_ECHO_PROGRAM = [
  "if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(true);",
  "process.stdin.resume();",
  "process.stdin.on('data', chunk => process.stdout.write(chunk));",
  "setInterval(() => undefined, 60_000);",
].join(" ");

type RelayMeasurementMode = "weak-network" | "realtime-only";

interface RelayPerformanceCliOptions {
  /** Hosted relay authority in host or host:port form. */
  relayEndpoint: string;
  /** Independent measurements collected per wire representation and profile. */
  measuredRuns: number;
  /** Selects the historical weak-network workload or the realtime-only gate. */
  mode: RelayMeasurementMode;
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

interface RelayClientOptions {
  /** Authenticated pairing offer used by the client. */
  offer: ConnectionOffer;
  /** Stable client identifier unique within one measurement profile. */
  clientId: string;
  /** Authenticated wire representation intentionally selected by this measurement. */
  wire: "legacy" | "framed";
}

/** Relay client plus the authenticated mode observation required before sampling. */
interface RelayMeasurementClient {
  /** Shared daemon client used by the workload. */
  client: DaemonClient;
  /** Wire representation intentionally selected by this measurement. */
  wire: "legacy" | "framed";
  /** Authenticated transport selection observed during the E2EE handshake. */
  negotiated: Promise<NegotiatedEncryptedTransport>;
}

/** Minimum connected-client seam used by the pre-sampling transport assertion. */
export interface ConnectRelayMeasurementClientOptions {
  /** Client whose public connect promise must settle before it can be sampled. */
  client: Pick<DaemonClient, "connect">;
  /** Wire representation intentionally selected by this measurement. */
  wire: "legacy" | "framed";
  /** Authenticated transport selection observed during the E2EE handshake. */
  negotiated: Promise<NegotiatedEncryptedTransport>;
}

interface SeededWorkloads {
  /** Fake agent whose completed timeline is measured. */
  agentId: string;
  /** Separate fake agent used only for incremental stream pressure. */
  realtimeAgentId: string;
  /** Persistent terminal used for the interactive echo measurement. */
  terminalId: string;
  /** SHA-256 of the exact canonical timeline page seeded through the direct connection. */
  timelineDigest: string;
  /** Serialized canonical page size used to prove the sync workload is substantial. */
  timelineBytes: number;
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

interface RealtimeMeasurementTarget {
  /** Connected relay client used for this representation. */
  client: DaemonClient;
  /** Sample bucket receiving this representation's observations. */
  samples: RealtimeLatencySamples;
  /** Wire representation under measurement. */
  wire: "legacy" | "framed";
}

interface RealtimePhaseOptions<TResult> {
  /** Human-readable operation used only in failure diagnostics. */
  phase: string;
  /** Active network profile included in every failure. */
  profile: string;
  /** Async operation whose original error remains the cause. */
  run: () => Promise<TResult>;
}

/** Content-free relay control readiness observed from the isolated daemon logger. */
export interface RelayControlReadyProbe {
  /** Logger passed to the isolated daemon so control lifecycle records remain local. */
  logger: pino.Logger;
  /** Waits until the current control socket has received a valid hosted relay message. */
  waitForReady(timeoutMs: number): Promise<void>;
  /** Returns a bounded content-free summary of daemon relay control and data sockets. */
  snapshot(): RelayLifecycleSummary;
}

/** Bounded lifecycle state retained for the daemon relay control socket. */
export interface RelayControlLifecycleSummary {
  /** Whether the latest control socket has received a valid relay message. */
  ready: boolean;
  /** Number of control sockets that reached protocol readiness. */
  connectedCount: number;
  /** Number of control socket close events observed. */
  disconnectedCount: number;
  /** Number of control lifecycle error events observed. */
  errorCount: number;
  /** Most recent bounded control lifecycle event. */
  lastEvent: RelayLifecycleEvent;
  /** Most recent numeric control close code, cleared by a later ready socket. */
  lastCloseCode: number | null;
}

/** Bounded lifecycle state retained for daemon relay data sockets. */
export interface RelayDataLifecycleSummary {
  /** Number of data sockets currently known to be connected. */
  activeCount: number;
  /** Number of data socket open events observed. */
  connectedCount: number;
  /** Number of data socket close events observed. */
  disconnectedCount: number;
  /** Number of data socket error events observed. */
  errorCount: number;
  /** Most recent bounded data lifecycle event. */
  lastEvent: RelayLifecycleEvent;
  /** Most recent numeric data close code, cleared by a later connected socket. */
  lastCloseCode: number | null;
}

/** Content-free daemon relay lifecycle snapshot used only in measurement failures. */
export interface RelayLifecycleSummary {
  /** Control socket lifecycle summary. */
  control: RelayControlLifecycleSummary;
  /** Per-client data socket lifecycle summary. */
  data: RelayDataLifecycleSummary;
}

/** Bounded lifecycle event names retained by the measurement logger. */
export type RelayLifecycleEvent = "none" | "connected" | "disconnected" | "error";

interface RelayControlReadyWaiter {
  /** Settles one pending readiness wait. */
  resolve(): void;
  /** Deadline cleared when readiness is observed. */
  timeoutHandle: ReturnType<typeof setTimeout>;
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

export interface DirectClientOptions {
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
  /** Optional request timeout used by the concurrent realtime probe. */
  timeout?: number;
  /** Minimum serialized response size required by the caller. */
  minimumSerializedBytes?: number;
}

interface RealtimeProbeOptions {
  /** Relay client whose realtime path is measured. */
  client: DaemonClient;
  /** Seeded agent and terminal identifiers shared by all probes. */
  workloads: SeededWorkloads;
  /** Wire representation label included in the marker and diagnostics. */
  wire: "legacy" | "framed";
  /** Profile label used to make terminal markers unique. */
  profile: string;
  /** Per-wire sample ordinal. */
  run: number;
  /** Returns the latest bounded daemon relay control/data lifecycle state. */
  getRelayLifecycle: () => RelayLifecycleSummary;
}

interface RealtimeProbeResult {
  /** Terminal marker latency for this probe. */
  terminalEchoMs: number;
  /** Incremental agent-stream latencies observed in this probe. */
  agentStreamMs: number[];
}

/** Concurrent operation labels retained in realtime probe failure diagnostics. */
export type RealtimeProbeBranch =
  | "observation"
  | (typeof REALTIME_STATE_SYNC_BRANCHES)[number]
  | "stress turn";

/** Public, content-free state captured when one realtime probe branch fails. */
export interface RealtimeProbeDiagnostic {
  /** Shared client state at the time the branch rejected. */
  connectionState: ReturnType<DaemonClient["getConnectionState"]>;
  /** Last shared-client transport or liveness error. */
  lastError: string | null;
  /** Most recent successful liveness round-trip, when one exists. */
  lastLivenessRttMs: number | null;
  /** Bounded daemon relay control/data lifecycle summary. */
  relayLifecycle: RelayLifecycleSummary;
}

/** Inputs for attributing one concurrent realtime probe branch failure. */
export interface RunRealtimeProbeBranchOptions<TResult> {
  /** Stable branch name included in the failure. */
  branch: RealtimeProbeBranch;
  /** Concurrent operation whose original rejection remains the cause. */
  run: () => Promise<TResult>;
  /** Captures public client and bounded relay state only after a rejection. */
  getDiagnostic: () => RealtimeProbeDiagnostic;
}

/** Attributes one concurrent branch failure and appends bounded runtime diagnostics. */
export async function runRealtimeProbeBranch<TResult>(
  options: RunRealtimeProbeBranchOptions<TResult>,
): Promise<TResult> {
  try {
    return await options.run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const diagnostic = options.getDiagnostic();
    throw new Error(
      `Realtime ${options.branch} failed: ${message}; diagnostic=${JSON.stringify(diagnostic)}`,
      { cause: error },
    );
  }
}

/** Minimal public wait result fields retained when a realtime stress turn fails. */
export interface RealtimeTurnDiagnosticInput {
  /** Terminal status returned by the wait-for-finish RPC. */
  status: WaitForFinishResult["status"];
  /** RPC or Agent terminal error, when supplied. */
  error: string | null;
  /** Last canonical assistant message observed by the daemon. */
  lastMessage: string | null;
  /** Public final Agent fields needed to distinguish lifecycle and active-turn failures. */
  final: Pick<AgentSnapshotPayload, "status" | "lastError" | "activeTurn"> | null;
}

type AgentStreamMessage = Extract<SessionOutboundMessage, { type: "agent_stream" }>;

interface RealtimeObservation {
  /** Resolves after the terminal marker and all expected stream events arrive. */
  promise: Promise<RealtimeProbeResult>;
  /** Records the exact local send time used by the terminal latency calculation. */
  markTerminalSent(startedAt: number): void;
  /** Removes listeners and timers after the probe settles or another operation fails. */
  dispose(): void;
}

/** Formats all public terminal fields without retaining the full Agent snapshot. */
export function formatRealtimeTurnFailure(result: RealtimeTurnDiagnosticInput): string {
  const diagnostic = {
    status: result.status,
    error: result.error,
    lastMessage: result.lastMessage,
    finalStatus: result.final?.status ?? null,
    finalLastError: result.final?.lastError ?? null,
    activeTurnId: result.final?.activeTurn?.turnId ?? null,
    activeTurnStartedAt: result.final?.activeTurn?.startedAt ?? null,
  };
  return `Realtime mock turn did not finish idle: ${JSON.stringify(diagnostic)}`;
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

/** Raw terminal and incremental-agent latencies collected for one wire representation. */
export interface RealtimeLatencySamples {
  /** Time from terminal marker send until its matching output reaches the client. */
  terminalEchoMs: number[];
  /** Time from daemon canonical agent-event timestamp until client receipt. */
  agentStreamMs: number[];
}

/** p95 values and threshold verdict for one realtime network profile. */
export interface RealtimeGateSummary {
  /** Profile identifier. */
  profile: string;
  /** Legacy baseline p95 values. */
  legacy: RealtimeLatencySummary;
  /** Framed candidate p95 values. */
  framed: RealtimeLatencySummary;
  /** Per-metric maximum candidate p95 accepted by the Spec gate. */
  allowed: RealtimeLatencySummary;
  /** Metrics whose candidate p95 exceeded the allowed regression. */
  failures: RealtimeMetric[];
  /** Whether both realtime p95 metrics passed. */
  passed: boolean;
}

/** Realtime latency metrics compared by the p95 gate. */
export type RealtimeMetric = "terminalEcho" | "agentStream";

/** Two p95 values used in the realtime report and threshold calculation. */
export interface RealtimeLatencySummary {
  /** Terminal echo p95 in milliseconds. */
  terminalEchoP95Ms: number;
  /** Incremental agent-stream p95 in milliseconds. */
  agentStreamP95Ms: number;
}

/** Inputs for the pure realtime threshold summarizer. */
export interface SummarizeRealtimeGateOptions {
  /** Stable network profile label. */
  profile: string;
  /** Legacy baseline samples. */
  legacy: RealtimeLatencySamples;
  /** Framed candidate samples. */
  framed: RealtimeLatencySamples;
}

/** Machine-readable report emitted by the realtime-only measurement mode. */
export interface RelayRealtimeReport {
  /** Measurement output schema version. */
  schemaVersion: 1;
  /** Explicit mode marker preventing confusion with weak-network summaries. */
  mode: "realtime-only";
  /** Samples collected per wire representation and profile. */
  measuredRuns: number;
  /** Large state-sync requests issued before each probe. */
  stateSyncRequestsPerSample: number;
  /** Incremental stream events expected from each stress turn. */
  agentStreamEventsPerSample: number;
  /** Aggregate profile results. */
  summaries: RealtimeGateSummary[];
  /** Whether every profile passed both p95 metrics. */
  passed: boolean;
}

/** Inputs for the measurement-only authenticated transport assertion. */
export interface AssertRelayMeasurementNegotiatedTransportOptions {
  /** Wire representation the measurement intentionally requested. */
  wire: "legacy" | "framed";
  /** Mode observed by the authenticated E2EE channel before sampling. */
  negotiated: NegotiatedEncryptedTransport;
}

/** Rejects a measurement that silently fell back to a different authenticated mode. */
export function assertRelayMeasurementNegotiatedTransport(
  options: AssertRelayMeasurementNegotiatedTransportOptions,
): void {
  const { wire, negotiated } = options;
  let actual: string;
  if (negotiated.mode === "legacy") {
    actual = "legacy-" + negotiated.ciphertextEncoding;
  } else {
    actual = "framed-v1-" + negotiated.ciphertextEncoding;
  }
  const expected = wire === "framed" ? "framed-v1-binary" : "legacy-hybrid";
  if (actual !== expected) {
    throw new Error(wire + " measurement negotiated " + actual + "; expected " + expected);
  }
  if (wire === "framed" && !negotiated.compressionAlgorithms.includes("deflate-raw")) {
    throw new Error("framed measurement negotiated without deflate-raw");
  }
}

/** Connects one measurement client and verifies its authenticated mode before any workload. */
export async function connectRelayMeasurementClient(
  options: ConnectRelayMeasurementClientOptions,
): Promise<void> {
  await options.client.connect();
  const negotiated = await options.negotiated;
  assertRelayMeasurementNegotiatedTransport({ wire: options.wire, negotiated });
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
  /** Historical weak-network workload remains the default mode. */
  let mode: RelayMeasurementMode = "weak-network";

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
    if (argument === "--realtime-only") {
      mode = "realtime-only";
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (relayEndpoint === null) {
    throw new Error("--relay-endpoint is required");
  }
  return { relayEndpoint, measuredRuns, mode };
}

/** Prints the explicit manual-measurement contract. */
function printHelp(): void {
  process.stdout
    .write(`Usage: npm run measure:live-relay-performance -- --relay-endpoint=<host[:port]> [options]

Measures legacy and framed state catch-up through a hosted relay and local weak-network shaper.
The default mode validates exact payload integrity and emits one aggregate JSON report without enforcing thresholds.
Realtime-only mode applies the Spec 0084 p95 gate, emits its report, and exits non-zero on regression.

Options:
  --relay-endpoint=<host[:port]>  Required hosted relay authority. The connection uses TLS.
  --runs=<count>                  Samples per wire/profile, 1-${MAX_MEASURED_RUNS}. Defaults to ${DEFAULT_MEASURED_RUNS}.
  --realtime-only                 Gate terminal echo and incremental agent_stream p95 while state-sync is active.
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

/** Computes the maximum candidate p95 accepted by the Spec absolute/relative rule. */
function allowedRealtimeP95(baseline: number): number {
  return Math.max(
    baseline + REALTIME_REGRESSION_ABSOLUTE_MS,
    baseline * (1 + REALTIME_REGRESSION_RELATIVE),
  );
}

/** Summarizes realtime p95 samples and applies the exact Spec 0084 regression gate. */
export function summarizeRealtimeGate(options: SummarizeRealtimeGateOptions): RealtimeGateSummary {
  const legacyTerminalEchoP95Ms = percentile({
    values: options.legacy.terminalEchoMs,
    fraction: 0.95,
  });
  const legacyAgentStreamP95Ms = percentile({
    values: options.legacy.agentStreamMs,
    fraction: 0.95,
  });
  const framedTerminalEchoP95Ms = percentile({
    values: options.framed.terminalEchoMs,
    fraction: 0.95,
  });
  const framedAgentStreamP95Ms = percentile({
    values: options.framed.agentStreamMs,
    fraction: 0.95,
  });
  const legacy = {
    terminalEchoP95Ms: legacyTerminalEchoP95Ms,
    agentStreamP95Ms: legacyAgentStreamP95Ms,
  } satisfies RealtimeLatencySummary;
  const framed = {
    terminalEchoP95Ms: framedTerminalEchoP95Ms,
    agentStreamP95Ms: framedAgentStreamP95Ms,
  } satisfies RealtimeLatencySummary;
  const allowed = {
    terminalEchoP95Ms: allowedRealtimeP95(legacyTerminalEchoP95Ms),
    agentStreamP95Ms: allowedRealtimeP95(legacyAgentStreamP95Ms),
  } satisfies RealtimeLatencySummary;
  const failures: RealtimeMetric[] = [];
  if (framedTerminalEchoP95Ms > allowed.terminalEchoP95Ms) failures.push("terminalEcho");
  if (framedAgentStreamP95Ms > allowed.agentStreamP95Ms) failures.push("agentStream");
  return {
    profile: options.profile,
    legacy,
    framed,
    allowed,
    failures,
    passed: failures.length === 0,
  };
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

/** Creates a content-free logger probe for the daemon relay control lifecycle. */
export function createRelayControlReadyProbe(): RelayControlReadyProbe {
  /** Whether the current control socket has received at least one valid relay message. */
  let ready = false;
  /** Mutable bounded control lifecycle counters updated by daemon log records. */
  const control: RelayControlLifecycleSummary = {
    ready: false,
    connectedCount: 0,
    disconnectedCount: 0,
    errorCount: 0,
    lastEvent: "none",
    lastCloseCode: null,
  };
  /** Mutable bounded data lifecycle counters updated by daemon log records. */
  const data: RelayDataLifecycleSummary = {
    activeCount: 0,
    connectedCount: 0,
    disconnectedCount: 0,
    errorCount: 0,
    lastEvent: "none",
    lastCloseCode: null,
  };
  /** Pending callers waiting for the next ready control socket. */
  const waiters = new Set<RelayControlReadyWaiter>();
  /** Resolves all callers waiting for the current control socket. */
  const resolveWaiters = (): void => {
    for (const waiter of waiters) {
      clearTimeout(waiter.timeoutHandle);
      waiter.resolve();
    }
    waiters.clear();
  };
  /** Local sink that observes only stable content-free relay lifecycle messages. */
  const logger = pino(
    { level: "info" },
    {
      write(serialized: string): void {
        try {
          /** Parsed pino record before its message field is narrowed. */
          const record: unknown = JSON.parse(serialized);
          if (!isJsonRecord(record) || typeof record.msg !== "string") return;
          if (record.msg === "relay_control_connected") {
            ready = true;
            control.ready = true;
            control.connectedCount += 1;
            control.lastEvent = "connected";
            control.lastCloseCode = null;
            resolveWaiters();
            return;
          }
          if (record.msg === "relay_control_disconnected") {
            ready = false;
            control.ready = false;
            control.disconnectedCount += 1;
            control.lastEvent = "disconnected";
            control.lastCloseCode = typeof record.code === "number" ? record.code : null;
            return;
          }
          if (
            record.msg === "relay_error" ||
            (record.msg.startsWith("relay_control_") && record.msg.endsWith("_failed"))
          ) {
            control.errorCount += 1;
            control.lastEvent = "error";
            return;
          }
          if (record.msg === "relay_data_connected") {
            data.activeCount += 1;
            data.connectedCount += 1;
            data.lastEvent = "connected";
            data.lastCloseCode = null;
            return;
          }
          if (record.msg === "relay_data_disconnected") {
            data.activeCount = Math.max(0, data.activeCount - 1);
            data.disconnectedCount += 1;
            data.lastEvent = "disconnected";
            data.lastCloseCode = typeof record.code === "number" ? record.code : null;
            return;
          }
          if (
            record.msg === "relay_data_error" ||
            record.msg === "relay_data_open_timeout_terminating"
          ) {
            data.errorCount += 1;
            data.lastEvent = "error";
          }
        } catch {
          // The daemon owns logger payload construction; malformed diagnostics do not imply ready.
        }
      },
    },
  );

  return {
    logger,
    waitForReady(timeoutMs) {
      if (ready) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        /** Waiter retained until a valid control message or the explicit deadline. */
        const waiter: RelayControlReadyWaiter = {
          resolve,
          timeoutHandle: setTimeout(() => {
            waiters.delete(waiter);
            reject(new Error("Relay control did not become ready after " + timeoutMs + "ms"));
          }, timeoutMs),
        };
        waiters.add(waiter);
      });
    },
    snapshot() {
      return {
        control: { ...control, ready },
        data: { ...data },
      };
    },
  };
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
export function createWebSocketFactory(options: RelayWebSocketFactoryOptions): WebSocketFactory {
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
        const shouldForwardUnmodified = !stripFramedCapability || typeof data !== "string";
        if (shouldForwardUnmodified) {
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
      addEventListener: (event, listener) => {
        socket.addEventListener(event as keyof WebSocket.WebSocketEventMap, listener as never);
      },
      removeEventListener: (event, listener) => {
        socket.removeEventListener(event as keyof WebSocket.WebSocketEventMap, listener as never);
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

/** Creates one validation-only relay client and its authenticated mode observation. */
function createRelayClient(options: RelayClientOptions): RelayMeasurementClient {
  const { offer, clientId, wire } = options;
  /** Shared logger used by both the physical and encrypted transports. */
  const logger = pino({ level: "silent" });
  /** Promise callbacks assigned before the E2EE transport can begin its handshake. */
  let resolveNegotiated!: (negotiated: NegotiatedEncryptedTransport) => void;
  /** Authenticated selection emitted before the encrypted transport opens publicly. */
  const negotiated = new Promise<NegotiatedEncryptedTransport>((resolve) => {
    resolveNegotiated = resolve;
  });
  /** Physical WebSocket transport kept separate so DaemonClient does not wrap E2EE twice. */
  const baseFactory = createWebSocketTransportFactory(
    createWebSocketFactory({ stripFramedCapability: false }),
  );
  /** Validation-only E2EE wrapper; ordinary DaemonClient configuration cannot enable this gate. */
  const transportFactory = createRelayE2eeTransportFactory({
    baseFactory,
    daemonPublicKeyB64: offer.daemonPublicKeyB64,
    logger,
    validation: {
      enableFramedCiphertextV1: wire === "framed",
      onNegotiatedTransport: resolveNegotiated,
    },
  });
  const client = new DaemonClient({
    url: buildRelayWebSocketUrl({
      endpoint: offer.relay.endpoint,
      useTls: false,
      serverId: offer.serverId,
      role: "client",
    }),
    clientId,
    clientType: "cli",
    appVersion: MEASUREMENT_CLIENT_APP_VERSION,
    connectTimeoutMs: 30_000,
    reconnect: { enabled: false },
    logger,
    transportFactory,
  });
  return { client, wire, negotiated };
}

/** Creates a direct client used only to seed isolated daemon state before relay measurements. */
export function createDirectClient(options: DirectClientOptions): DaemonClient {
  const { daemon, clientId } = options;
  return new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    clientId,
    clientType: "cli",
    appVersion: MEASUREMENT_CLIENT_APP_VERSION,
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

/** Rejects any mock turn that lacks a client-visible idle terminal snapshot. */
function assertRealtimeTurnCompleted(result: WaitForFinishResult): void {
  if (result.status !== "idle" || result.final === null) {
    throw new Error(formatRealtimeTurnFailure(result));
  }
}

/** Seeds the canonical state page, realtime agent and PTY used by every profile. */
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
    const workspace = await seedClient.openProject(daemon.staticDir);
    if (!workspace.workspace) {
      throw new Error(workspace.error ?? "Relay performance seed workspace was not created");
    }
    const agent = await seedClient.createAgent({
      provider: "mock",
      cwd: daemon.staticDir,
      title: "Live relay performance seed",
      modeId: "load-test",
      model: "five-minute-stream",
    });
    await seedClient.sendMessage(agent.id, "emit 40 agent stream updates");
    /** First seed turn result proving the mock Agent remains client-visible. */
    const firstSeedResult = await seedClient.waitForFinish(agent.id, 30_000);
    assertRealtimeTurnCompleted(firstSeedResult);
    await seedClient.sendMessage(
      agent.id,
      `emit ${TIMELINE_PAYLOAD_BYTES} byte large file agent stream update`,
    );
    /** Large-payload seed result checked before its canonical timeline is measured. */
    const largePayloadSeedResult = await seedClient.waitForFinish(agent.id, 30_000);
    assertRealtimeTurnCompleted(largePayloadSeedResult);
    const timeline = await seedClient.fetchAgentTimeline(agent.id, {
      direction: "tail",
      limit: 40,
      projection: "canonical",
    });
    if (timeline.entries.length < 40) {
      throw new Error(`Relay performance seed timeline was ${timeline.entries.length} items`);
    }
    const timelineSerialized = JSON.stringify(timeline.entries);
    const timelineBytes = Buffer.byteLength(timelineSerialized, "utf8");
    if (timelineBytes < REALTIME_MIN_TIMELINE_BYTES) {
      throw new Error(
        `Realtime state-sync seed was only ${timelineBytes} bytes; expected at least ${REALTIME_MIN_TIMELINE_BYTES}`,
      );
    }

    const realtimeAgent = await seedClient.createAgent({
      provider: "mock",
      cwd: daemon.staticDir,
      title: "Live relay realtime stream seed",
      modeId: "load-test",
      model: "five-minute-stream",
    });
    const terminalResponse = await seedClient.createTerminal(
      daemon.staticDir,
      "Live relay realtime echo",
      undefined,
      {
        workspaceId: workspace.workspace.id,
        command: process.execPath,
        args: ["-e", TERMINAL_ECHO_PROGRAM],
        size: { rows: 24, cols: 80 },
      },
    );
    if (terminalResponse.error || !terminalResponse.terminal) {
      throw new Error(terminalResponse.error ?? "Realtime terminal seed was not created");
    }
    return {
      agentId: agent.id,
      realtimeAgentId: realtimeAgent.id,
      terminalId: terminalResponse.terminal.id,
      timelineDigest: payloadDigest(timelineSerialized),
      timelineBytes,
      fileName,
      fileDigest: payloadDigest(filePayload),
    };
  } finally {
    await seedClient.close();
  }
}

/** Measures one timeline catch-up without retaining its payload. */
async function measureTimeline(options: MeasureTimelineOptions): Promise<number> {
  const { client, agentId, expectedDigest, timeout, minimumSerializedBytes } = options;
  const startedAt = performance.now();
  const result = await client.fetchAgentTimeline(agentId, {
    direction: "tail",
    limit: 40,
    projection: "canonical",
    ...(timeout === undefined ? {} : { timeout }),
  });
  if (result.entries.length < 40) {
    throw new Error(`Measured relay timeline returned ${result.entries.length} items; expected 40`);
  }
  const durationMs = performance.now() - startedAt;
  const serialized = JSON.stringify(result.entries);
  const serializedBytes = Buffer.byteLength(serialized, "utf8");
  if (minimumSerializedBytes !== undefined && serializedBytes < minimumSerializedBytes) {
    throw new Error(
      `Measured relay timeline was only ${serializedBytes} bytes; expected at least ${minimumSerializedBytes}`,
    );
  }
  const actualDigest = payloadDigest(serialized);
  if (actualDigest !== expectedDigest) {
    throw new Error("Measured relay timeline did not match the seeded payload");
  }
  return durationMs;
}

/** Extracts one uniquely indexed mock activity event and its daemon timestamp. */
function parseRealtimeAgentSample(
  message: AgentStreamMessage,
  agentId: string,
): { index: number; timestampMs: number; messageId: string } | null {
  if (message.payload.agentId !== agentId) return null;
  const event = message.payload.event;
  if (event.type !== "timeline" || event.item.type !== "assistant_message") return null;
  if (event.item.phase !== "commentary" || !event.item.messageId) return null;
  const match = /^stress-update-(\d+)$/.exec(event.item.text);
  const index = Number(match?.[1]);
  const isExpectedIndex = Number.isSafeInteger(index) && index < REALTIME_AGENT_STREAM_EVENTS;
  if (!isExpectedIndex) return null;
  const timestampMs = Date.parse(message.payload.timestamp);
  if (!Number.isFinite(timestampMs)) return null;
  return { index, timestampMs, messageId: event.item.messageId };
}

/** Installs terminal and agent listeners before a realtime probe sends any work. */
function createRealtimeObservation(options: {
  client: DaemonClient;
  workloads: SeededWorkloads;
  marker: string;
}): RealtimeObservation {
  const { client, workloads, marker } = options;
  /** Incremental event latencies retained for this probe only. */
  const agentStreamMs: number[] = [];
  /** Event indexes already counted, preventing duplicate delivery from skewing p95. */
  const seenIndexes = new Set<number>();
  /** Canonical message ids already counted, independently guarding duplicate delivery. */
  const seenMessageIds = new Set<string>();
  /** Streaming decoder preserving a marker split across terminal output frames. */
  const terminalDecoder = new TextDecoder();
  /** Small rolling terminal suffix used only to locate this probe's marker. */
  let terminalSuffix = "";
  /** Local monotonic send time, assigned immediately before the terminal input call. */
  let terminalStartedAt: number | null = null;
  /** Terminal echo duration once the marker is observed. */
  let terminalEchoMs: number | null = null;
  /** Prevents timeout and listeners from settling the observation twice. */
  let settled = false;
  /** Promise callbacks assigned synchronously below. */
  let resolveObservation!: (result: RealtimeProbeResult) => void;
  let rejectObservation!: (error: Error) => void;
  const promise = new Promise<RealtimeProbeResult>((resolve, reject) => {
    resolveObservation = resolve;
    rejectObservation = reject;
  });

  /** Completes only after both realtime paths have produced the required evidence. */
  const maybeComplete = (): void => {
    if (settled || terminalEchoMs === null || seenIndexes.size !== REALTIME_AGENT_STREAM_EVENTS) {
      return;
    }
    settled = true;
    resolveObservation({ terminalEchoMs, agentStreamMs: [...agentStreamMs] });
  };
  /** Fails the observation with a single diagnostic. */
  const fail = (error: Error): void => {
    if (settled) return;
    settled = true;
    rejectObservation(error);
  };
  /** Handles only output for the shared marker terminal. */
  const onTerminalEvent = (event: TerminalStreamEvent): void => {
    if (settled || event.terminalId !== workloads.terminalId || event.type !== "output") return;
    terminalSuffix += terminalDecoder.decode(event.data, { stream: true });
    terminalSuffix = terminalSuffix.slice(-Math.max(marker.length * 2, 256));
    if (!terminalSuffix.includes(marker) || terminalStartedAt === null) return;
    terminalEchoMs = performance.now() - terminalStartedAt;
    maybeComplete();
  };
  /** Handles the 32 unique activity rows emitted by the mock provider. */
  const onAgentStream = (message: AgentStreamMessage): void => {
    if (settled) return;
    const sample = parseRealtimeAgentSample(message, workloads.realtimeAgentId);
    if (!sample) return;
    if (seenIndexes.has(sample.index) || seenMessageIds.has(sample.messageId)) return;
    seenIndexes.add(sample.index);
    seenMessageIds.add(sample.messageId);
    agentStreamMs.push(Math.max(0, Date.now() - sample.timestampMs));
    maybeComplete();
  };
  /** Listener cleanup callbacks owned by this observation. */
  const unsubscribeTerminal = client.onTerminalStreamEvent(onTerminalEvent);
  const unsubscribeAgent = client.on("agent_stream", onAgentStream);
  /** Hard timeout preventing a lost event from hanging a manual gate indefinitely. */
  const timeoutHandle = setTimeout(() => {
    fail(
      new Error(
        `Realtime probe timed out: terminal=${terminalEchoMs !== null} agentEvents=${seenIndexes.size}/${REALTIME_AGENT_STREAM_EVENTS}`,
      ),
    );
  }, REALTIME_SAMPLE_TIMEOUT_MS);

  return {
    promise,
    markTerminalSent(startedAt) {
      terminalStartedAt = startedAt;
    },
    dispose() {
      clearTimeout(timeoutHandle);
      unsubscribeTerminal();
      unsubscribeAgent();
      settled = true;
    },
  };
}

/** Runs one terminal/agent probe after placing two canonical responses ahead of it. */
async function measureRealtimeProbe(options: RealtimeProbeOptions): Promise<RealtimeProbeResult> {
  const { client, workloads, wire, profile, run, getRelayLifecycle } = options;
  /** Unique marker preventing delayed output from an earlier sample from matching. */
  const marker = `paseo_echo_${profile.replaceAll(/[^a-zA-Z0-9]/g, "_")}_${wire}_${run}_${randomUUID()}`;
  /** Listeners installed before any request or terminal input is sent. */
  const observation = createRealtimeObservation({ client, workloads, marker });
  /** Public, content-free diagnostic captured independently by each failing branch. */
  const getDiagnostic = (): RealtimeProbeDiagnostic => ({
    connectionState: client.getConnectionState(),
    lastError: client.lastError,
    lastLivenessRttMs: client.getLastLivenessRttMs(),
    relayLifecycle: getRelayLifecycle(),
  });
  /** Observation result labeled independently from the concurrent load operations. */
  const observationResult = runRealtimeProbeBranch({
    branch: "observation",
    run: () => observation.promise,
    getDiagnostic,
  });
  /** Concurrent state-sync requests deliberately sent before both realtime triggers. */
  const stateSyncRequests = REALTIME_STATE_SYNC_BRANCHES.map((branch) =>
    runRealtimeProbeBranch({
      branch,
      run: () =>
        measureTimeline({
          client,
          agentId: workloads.agentId,
          expectedDigest: workloads.timelineDigest,
          timeout: REALTIME_SAMPLE_TIMEOUT_MS,
          minimumSerializedBytes: workloads.timelineBytes,
        }),
      getDiagnostic,
    }),
  );

  try {
    const terminalStartedAt = performance.now();
    observation.markTerminalSent(terminalStartedAt);
    client.sendTerminalInput(workloads.terminalId, { type: "input", data: marker });
    /** Mock turn whose 32 uniquely identified activity rows exercise incremental delivery. */
    const stressTurn = runRealtimeProbeBranch({
      branch: "stress turn",
      run: async () => {
        await client.sendMessage(
          workloads.realtimeAgentId,
          `emit ${REALTIME_AGENT_STREAM_EVENTS} activity agent stream updates`,
        );
        const result = await client.waitForFinish(
          workloads.realtimeAgentId,
          REALTIME_SAMPLE_TIMEOUT_MS,
        );
        assertRealtimeTurnCompleted(result);
        return undefined;
      },
      getDiagnostic,
    });
    const [result] = await Promise.all([observationResult, ...stateSyncRequests, stressTurn]);
    return result;
  } finally {
    observation.dispose();
  }
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
      agentClients: { mock: new MockLoadTestAgentClient() },
      isDev: true,
      relayEnabled: true,
      relayEndpoint: proxy.endpoint,
      relayUseTls: false,
      relayPublicUseTls: false,
      logger: pino({ level: "silent" }),
      relayTransportValidation: { enableFramedCiphertextV1: true },
    });
    daemon = runningDaemon;
    /** Seed identifiers reused by both wire representations. */
    const workloads = await seedWorkloads(runningDaemon);
    /** Authenticated offer routed through the local shaping proxy. */
    const offer = await pairingOfferFor({
      daemon: runningDaemon,
      proxyEndpoint: proxy.endpoint,
    });
    const legacyMeasurement = createRelayClient({
      offer,
      clientId: `clid_legacy_${profile.label}`,
      wire: "legacy",
    });
    legacyClient = legacyMeasurement.client;
    const framedMeasurement = createRelayClient({
      offer,
      clientId: `clid_framed_${profile.label}`,
      wire: "framed",
    });
    framedClient = framedMeasurement.client;
    await Promise.all([
      connectRelayMeasurementClient(legacyMeasurement),
      connectRelayMeasurementClient(framedMeasurement),
    ]);
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

/** Subscribes one relay client to both realtime paths and validates terminal setup. */
async function subscribeRealtimeWorkloads(
  client: DaemonClient,
  workloads: SeededWorkloads,
): Promise<void> {
  await client.setAgentTimelineSubscription([workloads.realtimeAgentId]);
  /** Correlated terminal subscription response proving the stream slot is installed. */
  const terminalSubscription = await client.subscribeTerminal(workloads.terminalId);
  if (terminalSubscription.error !== null) {
    throw new Error(`Realtime terminal subscription failed: ${terminalSubscription.error}`);
  }
}

/** Appends one complete realtime probe to the selected wire representation. */
function appendRealtimeProbe(samples: RealtimeLatencySamples, result: RealtimeProbeResult): void {
  samples.terminalEchoMs.push(result.terminalEchoMs);
  samples.agentStreamMs.push(...result.agentStreamMs);
}

/** Adds stable profile and phase context without changing the underlying failure. */
async function runRealtimePhase<TResult>(options: RealtimePhaseOptions<TResult>): Promise<TResult> {
  try {
    return await options.run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Realtime ${options.profile} ${options.phase} failed: ${message}`, {
      cause: error,
    });
  }
}

/** Measures one realtime profile and always releases its isolated daemon and sockets. */
async function runRealtimeProfile(options: RunProfileOptions): Promise<RealtimeGateSummary> {
  const { profile, relayEndpoint, measuredRuns } = options;
  /** Local transparent proxy applying the selected weak-network profile. */
  const proxy = new ShapedRelayProxy({ profile, relayEndpoint });
  /** Isolated daemon owned by this profile run. */
  let daemon: TestPaseoDaemon | null = null;
  /** Legacy client owned by this profile run. */
  let legacyClient: DaemonClient | null = null;
  /** Framed client owned by this profile run. */
  let framedClient: DaemonClient | null = null;
  /** Content-free probe proving the daemon control socket is registered with the hosted relay. */
  const relayControlReady = createRelayControlReadyProbe();
  try {
    await runRealtimePhase({
      profile: profile.label,
      phase: "proxy start",
      run: () => proxy.start(),
    });
    /** Running daemon retained separately so later calls remain non-nullable. */
    const runningDaemon = await runRealtimePhase({
      profile: profile.label,
      phase: "daemon start",
      run: () =>
        createTestPaseoDaemon({
          listen: "127.0.0.1",
          agentClients: { mock: new MockLoadTestAgentClient() },
          isDev: true,
          relayEnabled: true,
          relayEndpoint: proxy.endpoint,
          relayUseTls: false,
          relayPublicUseTls: false,
          logger: relayControlReady.logger,
          relayTransportValidation: { enableFramedCiphertextV1: true },
        }),
    });
    daemon = runningDaemon;
    /** Seed identifiers reused by both wire representations. */
    const workloads = await runRealtimePhase({
      profile: profile.label,
      phase: "workload seed",
      run: () => seedWorkloads(runningDaemon),
    });
    /** Authenticated offer routed through the local shaping proxy. */
    const offer = await pairingOfferFor({
      daemon: runningDaemon,
      proxyEndpoint: proxy.endpoint,
    });
    await runRealtimePhase({
      profile: profile.label,
      phase: "relay control ready",
      run: () => relayControlReady.waitForReady(30_000),
    });
    /** Non-null legacy client used by measurement closures. */
    const legacyMeasurement = createRelayClient({
      offer,
      clientId: `clid_realtime_legacy_${profile.label}`,
      wire: "legacy",
    });
    const connectedLegacyClient = legacyMeasurement.client;
    legacyClient = connectedLegacyClient;
    /** Non-null framed client used by measurement closures. */
    const framedMeasurement = createRelayClient({
      offer,
      clientId: `clid_realtime_framed_${profile.label}`,
      wire: "framed",
    });
    const connectedFramedClient = framedMeasurement.client;
    framedClient = connectedFramedClient;
    await runRealtimePhase({
      profile: profile.label,
      phase: "legacy relay client connect",
      run: () => connectRelayMeasurementClient(legacyMeasurement),
    });
    await runRealtimePhase({
      profile: profile.label,
      phase: "framed relay client connect",
      run: () => connectRelayMeasurementClient(framedMeasurement),
    });
    await runRealtimePhase({
      profile: profile.label,
      phase: "agent inventory",
      run: () =>
        Promise.all([connectedLegacyClient.fetchAgents(), connectedFramedClient.fetchAgents()]),
    });
    await runRealtimePhase({
      profile: profile.label,
      phase: "realtime subscription",
      run: () =>
        Promise.all([
          subscribeRealtimeWorkloads(connectedLegacyClient, workloads),
          subscribeRealtimeWorkloads(connectedFramedClient, workloads),
        ]),
    });

    /** Legacy Base64 realtime measurements for this profile. */
    const legacy: RealtimeLatencySamples = { terminalEchoMs: [], agentStreamMs: [] };
    /** Framed realtime measurements for this profile. */
    const framed: RealtimeLatencySamples = { terminalEchoMs: [], agentStreamMs: [] };
    for (let run = 0; run < measuredRuns; run += 1) {
      /** Legacy target for this sample. */
      const legacyTarget: RealtimeMeasurementTarget = {
        client: connectedLegacyClient,
        samples: legacy,
        wire: "legacy",
      };
      /** Framed target for this sample. */
      const framedTarget: RealtimeMeasurementTarget = {
        client: connectedFramedClient,
        samples: framed,
        wire: "framed",
      };
      /** Alternating first representation limits systematic ordering bias. */
      const targets = run % 2 === 0 ? [legacyTarget, framedTarget] : [framedTarget, legacyTarget];
      for (const target of targets) {
        /** One terminal observation plus all unique agent-stream observations. */
        const result = await runRealtimePhase({
          profile: profile.label,
          phase: `${target.wire} probe ${run + 1}`,
          run: () =>
            measureRealtimeProbe({
              client: target.client,
              workloads,
              wire: target.wire,
              profile: profile.label,
              run,
              getRelayLifecycle: () => relayControlReady.snapshot(),
            }),
        });
        appendRealtimeProbe(target.samples, result);
      }
    }

    return summarizeRealtimeGate({ profile: profile.label, legacy, framed });
  } finally {
    await legacyClient?.close().catch(() => undefined);
    await framedClient?.close().catch(() => undefined);
    await daemon?.close();
    await proxy.close();
  }
}

/** Runs every fixed profile and builds one machine-readable realtime gate report. */
async function measureRealtimePerformance(
  options: RelayPerformanceCliOptions,
): Promise<RelayRealtimeReport> {
  /** Profile summaries emitted together after every run completes. */
  const summaries: RealtimeGateSummary[] = [];
  for (const profile of RELAY_NETWORK_PROFILES) {
    summaries.push(await runRealtimeProfile({ ...options, profile }));
  }
  return {
    schemaVersion: 1,
    mode: "realtime-only",
    measuredRuns: options.measuredRuns,
    stateSyncRequestsPerSample: REALTIME_STATE_SYNC_REQUESTS,
    agentStreamEventsPerSample: REALTIME_AGENT_STREAM_EVENTS,
    summaries,
    passed: summaries.every((summary) => summary.passed),
  };
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
  if (options.mode === "realtime-only") {
    /** Completed realtime report including the aggregate threshold verdict. */
    const realtimeReport = await measureRealtimePerformance(options);
    process.stdout.write(`${JSON.stringify(realtimeReport, null, 2)}\n`);
    if (!realtimeReport.passed) process.exitCode = 1;
    return;
  }
  /** Completed aggregate report without payload contents or relay credentials. */
  const report = await measureRelayPerformance(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

/** Returns whether this module is the process entrypoint rather than a test import. */
function isMainModule(): boolean {
  /** Executed script path supplied by Node or tsx. */
  const entry = process.argv[1];
  return Boolean(entry && pathToFileURL(resolvePath(entry)).href === import.meta.url);
}

if (isMainModule()) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
