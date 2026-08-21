// Node and emitted ESM run without a TypeScript path-alias resolver.
import type { SessionOutboundMessage, WSOutboundMessage } from "../messages.js";
import type { ProcessMemoryDiagnostics } from "../process-diagnostics.js";
import {
  RELAY_TRANSPORT_COMPRESSION_ALGORITHM,
  resolveRelayTransportPolicy,
  type ConfiguredRelayTransportPolicy,
  type EffectiveRelayTransportCompressionPolicy,
  type NegotiatedRelayTransportPolicy,
} from "../relay-transport-policy.js";
import type {
  CompressionSkipReason,
  RelaySendFifoWaitSample,
  RelayTrafficClass,
} from "../relay-frame-compression.js";
import type { FramedCiphertextCodec, FramedCiphertextEncoding } from "@getpaseo/relay/e2ee";

/** Stable negotiated mode labels used by diagnostics and logs. */
export type RelayNegotiatedModeLabel =
  | "legacy-base64"
  | "legacy-hybrid"
  | "framed-v1-base64"
  | "framed-v1-binary";

/** Bounded protocol failure reasons that never retain remote error text. */
export type RelayFramedProtocolErrorReason =
  | "invalid-wire"
  | "decrypt-failed"
  | "invalid-envelope"
  | "decode-failed"
  | "receive-high-water";

/** Connection and frame-level reasons represented by one bounded counter. */
export type RelayCompressionSkipReason = CompressionSkipReason | "legacy-mode";

/** Numeric summary for a bounded collection of duration samples. */
export interface RelayDurationSummary {
  p50: number;
  p95: number;
  max: number;
}

/** Content-free metadata emitted after one daemon frame is prepared. */
export interface RelayPreparedFrameMetric {
  ciphertextEncoding: FramedCiphertextEncoding;
  trafficClass: RelayTrafficClass;
  codec: FramedCiphertextCodec;
  originalByteLength: number;
  encodedByteLength: number;
  wireByteLength: number;
  skipReason: RelayCompressionSkipReason | null;
  prepareMs: number;
  codecMs: number | null;
}

/** Content-free metadata emitted after one framed payload is decoded. */
export interface RelayInboundFrameMetric {
  ciphertextEncoding: FramedCiphertextEncoding;
  codec: FramedCiphertextCodec;
  originalByteLength: number;
  encodedByteLength: number;
  wireByteLength: number;
  decodeMs: number;
}

/** One active connection bucket grouped by immutable selection and effective codec. */
export interface RelayActiveConnectionMetric {
  /** Negotiated legacy or framed mode. */
  mode: NegotiatedRelayTransportPolicy["mode"];
  /** Negotiated ciphertext representation. */
  ciphertextEncoding: NegotiatedRelayTransportPolicy["ciphertextEncoding"];
  /** Effective frame codec represented by this bucket. */
  codec: FramedCiphertextCodec;
  /** Stable reason compression is disabled, or null when enabled. */
  effectiveReason: RelayCompressionSkipReason | null;
  /** Active connections in this bucket. */
  count: number;
}

/** One effective compression-policy bucket and its active connection count. */
export interface RelayEffectiveCompressionMetric extends EffectiveRelayTransportCompressionPolicy {
  /** Active connections with this effective policy. */
  count: number;
}

/** Aggregated outbound frame bytes for one bounded label tuple. */
export interface RelayOutboundFrameAggregateMetric {
  /** Locked ciphertext representation. */
  ciphertextEncoding: FramedCiphertextEncoding;
  /** Sender-side semantic traffic class. */
  trafficClass: RelayTrafficClass;
  /** Authenticated payload codec. */
  codec: FramedCiphertextCodec;
  /** Frames represented by this bucket. */
  frameCount: number;
  /** Original application bytes represented by this bucket. */
  originalBytes: number;
  /** Encoded payload bytes represented by this bucket. */
  encodedBytes: number;
  /** Final WebSocket wire bytes represented by this bucket. */
  wireBytes: number;
}

/** Duration summary for the fixed relay compression algorithm. */
export interface RelayCompressionDurationMetric extends RelayDurationSummary {
  /** Fixed codec measured by this row. */
  algorithm: typeof RELAY_TRANSPORT_COMPRESSION_ALGORITHM;
}

/** Duration summary grouped by sender-side traffic class. */
export interface RelayTrafficClassDurationMetric extends RelayDurationSummary {
  /** Traffic class measured by this row. */
  trafficClass: RelayTrafficClass;
}

/** Decode duration summary grouped by locked representation and codec. */
export interface RelayInboundDecodeDurationMetric extends RelayDurationSummary {
  /** Locked ciphertext representation. */
  ciphertextEncoding: FramedCiphertextEncoding;
  /** Authenticated payload codec. */
  codec: FramedCiphertextCodec;
}

/** Aggregated inbound frame bytes for one bounded label tuple. */
export interface RelayInboundFrameAggregateMetric {
  /** Locked ciphertext representation. */
  ciphertextEncoding: FramedCiphertextEncoding;
  /** Authenticated payload codec. */
  codec: FramedCiphertextCodec;
  /** Frames represented by this bucket. */
  frameCount: number;
  /** Original application bytes represented by this bucket. */
  originalBytes: number;
  /** Encoded payload bytes represented by this bucket. */
  encodedBytes: number;
  /** Final WebSocket wire bytes represented by this bucket. */
  wireBytes: number;
}

/** Percentile and maximum summary for a bounded byte gauge. */
export interface RelayByteSummary {
  /** Nearest-rank 95th percentile. */
  p95: number;
  /** Largest observed byte count. */
  max: number;
}

/** Label-only view restored from one outbound relay aggregate key. */
type RelayOutboundFrameLabels = Pick<
  RelayPreparedFrameMetric,
  "ciphertextEncoding" | "trafficClass" | "codec"
>;

/** Label-only view restored from one inbound relay aggregate key. */
type RelayInboundFrameLabels = Pick<RelayInboundFrameMetric, "ciphertextEncoding" | "codec">;

/** Relay transport aggregates embedded in the existing WebSocket metrics snapshot. */
export interface RelayTransportRuntimeMetricsSnapshot {
  /** Latest fully defaulted relay transport configuration. */
  configuredPolicy: ConfiguredRelayTransportPolicy;
  /** Negotiated connection totals keyed by stable mode label. */
  negotiatedModeCount: Record<RelayNegotiatedModeLabel, number>;
  /** Current active connections grouped by negotiated and effective labels. */
  activeConnectionCount: RelayActiveConnectionMetric[];
  /** Current active connections grouped by effective compression policy. */
  effectiveCompressionCount: RelayEffectiveCompressionMetric[];
  /** Compression attempts grouped by sender-side traffic class. */
  compressionAttemptCount: Record<RelayTrafficClass, number>;
  /** Outbound frame byte aggregates grouped by stable labels. */
  outboundFrames: RelayOutboundFrameAggregateMetric[];
  /** Identity fallback totals grouped by stable reason. */
  compressionSkipCount: Record<RelayCompressionSkipReason, number>;
  /** Full compression preparation duration for attempted frames. */
  compressionPrepareMs: RelayCompressionDurationMetric[];
  /** Encrypted-socket send FIFO wait from invocation until the ordered operation starts. */
  compressionQueueMs: RelayTrafficClassDurationMetric[];
  /** Raw DEFLATE callback wall time, including any libuv worker-pool wait. */
  compressionCodecMs: RelayCompressionDurationMetric[];
  /** Framed decode duration grouped by locked representation and codec. */
  inboundDecodeMs: RelayInboundDecodeDurationMetric[];
  /** Inbound frame byte aggregates grouped by stable labels. */
  inboundFrames: RelayInboundFrameAggregateMetric[];
  /** Framed protocol errors grouped by bounded content-free reason. */
  framedProtocolErrorCount: Record<RelayFramedProtocolErrorReason, number>;
  /** Final wire bytes retained behind preparation and send FIFO work. */
  pendingPreparedBytes: RelayByteSummary;
  /** Raw inbound wire bytes retained by the receive FIFO. */
  pendingReceiveWireBytes: RelayByteSummary;
}

/** Aggregated byte totals for one outbound relay label tuple. */
interface RelayFrameAggregate {
  frameCount: number;
  originalBytes: number;
  encodedBytes: number;
  wireBytes: number;
}

/** Byte fields shared by outbound preparation and inbound decode metrics. */
interface RelayFrameByteMetric {
  originalByteLength: number;
  encodedByteLength: number;
  wireByteLength: number;
}

/** Inputs for accumulating one frame into its bounded label bucket. */
interface AddFrameAggregateOptions {
  /** Aggregate map owned by the runtime metrics window. */
  map: Map<string, RelayFrameAggregate>;
  /** Deterministic bounded-label key. */
  key: string;
  /** Content-free frame byte counts. */
  metric: RelayFrameByteMetric;
}

/** Inputs for adding one duration to a bounded label bucket. */
interface PushMapSampleOptions<TKey> {
  /** Sample map owned by the runtime metrics window. */
  map: Map<TKey, RecentRelayMetricSamples>;
  /** Bounded label selecting one recent-value window. */
  key: TKey;
  /** Duration retained after normalization. */
  durationMs: number;
}

/** Inputs for selecting one percentile from sorted observations. */
interface PercentileOptions {
  /** Numeric observations sorted in ascending order. */
  sorted: readonly number[];
  /** Requested quantile between zero and one. */
  quantile: number;
}

/** Inputs for deterministic ordering of two content-free metric rows. */
interface CompareMetricRowsOptions {
  /** Left metric row supplied by the array comparator. */
  left: object;
  /** Right metric row supplied by the array comparator. */
  right: object;
}

/** Bounded traffic classes in deterministic snapshot order. */
const RELAY_TRAFFIC_CLASSES: readonly RelayTrafficClass[] = [
  "realtime",
  "state-sync",
  "bulk",
  "bulk-live",
];

/** Default relay policy used before bootstrap publishes configured state. */
const DEFAULT_CONFIGURED_RELAY_POLICY: ConfiguredRelayTransportPolicy = {
  ciphertextEncoding: "auto",
  compressionEnabled: true,
};

/** Maximum recent observations retained for any one relay percentile series. */
const MAX_RELAY_PERCENTILE_SAMPLES = 2_048;

/** Fixed-capacity recent-value buffer that bounds metrics memory independently of traffic rate. */
class RecentRelayMetricSamples {
  /** Preallocated numeric slots reused after the buffer reaches capacity. */
  private readonly samples = Array.from({ length: MAX_RELAY_PERCENTILE_SAMPLES }, () => 0);
  /** Number of initialized slots, capped at the fixed capacity. */
  private size = 0;
  /** Slot replaced by the next observation after the buffer fills. */
  private nextIndex = 0;

  /** Current number of retained observations. */
  get length(): number {
    return this.size;
  }

  /** Adds one normalized observation while evicting the oldest value at capacity. */
  push(value: number): void {
    this.samples[this.nextIndex] = value;
    this.nextIndex = (this.nextIndex + 1) % MAX_RELAY_PERCENTILE_SAMPLES;
    if (this.size < MAX_RELAY_PERCENTILE_SAMPLES) this.size += 1;
  }

  /** Copies the retained numeric set for sorting and percentile calculation. */
  values(): number[] {
    return this.samples.slice(0, this.size);
  }

  /** Releases retained observations while preserving the reusable allocation. */
  clear(): void {
    this.size = 0;
    this.nextIndex = 0;
  }
}

/** Content-free recorder shared by relay runtime code and WebSocket diagnostics. */
export class RelayTransportRuntimeMetricsWindow {
  /** Current configured gauge retained across rolling-window resets. */
  private configuredPolicy: ConfiguredRelayTransportPolicy = DEFAULT_CONFIGURED_RELAY_POLICY;
  /** Negotiated connection-open events in the current window. */
  private readonly negotiatedModeCounts = new Map<RelayNegotiatedModeLabel, number>();
  /** Active negotiated connections retained across rolling-window resets. */
  private readonly activeConnections = new Set<NegotiatedRelayTransportPolicy>();
  /** Compression entries by semantic traffic class. */
  private readonly compressionAttemptCounts = new Map<RelayTrafficClass, number>();
  /** Outbound byte aggregates keyed only by bounded labels. */
  private readonly outboundFrames = new Map<string, RelayFrameAggregate>();
  /** Identity fallback events keyed by bounded reason. */
  private readonly compressionSkipCounts = new Map<RelayCompressionSkipReason, number>();
  /** Total preparation duration samples for compressor-entering frames. */
  private readonly compressionPrepareSamples = new RecentRelayMetricSamples();
  /** Encrypted-socket send FIFO wait samples keyed by sender-side traffic class. */
  private readonly compressionQueueSamples = new Map<RelayTrafficClass, RecentRelayMetricSamples>();
  /** Native codec callback wall-time samples, including any libuv worker-pool wait. */
  private readonly compressionCodecSamples = new RecentRelayMetricSamples();
  /** Inbound decode duration samples keyed by encoding and codec. */
  private readonly inboundDecodeSamples = new Map<string, RecentRelayMetricSamples>();
  /** Inbound byte aggregates keyed only by encoding and codec. */
  private readonly inboundFrames = new Map<string, RelayFrameAggregate>();
  /** Framed receive failures mapped to bounded diagnostic reasons. */
  private readonly framedProtocolErrorCounts = new Map<RelayFramedProtocolErrorReason, number>();
  /** Pending prepared-byte gauge samples. */
  private readonly pendingPreparedByteSamples = new RecentRelayMetricSamples();
  /** Pending inbound raw-wire gauge samples. */
  private readonly pendingReceiveWireByteSamples = new RecentRelayMetricSamples();

  /** Replaces the configured gauge without materializing defaults elsewhere. */
  setConfiguredPolicy(policy: ConfiguredRelayTransportPolicy): void {
    this.configuredPolicy = { ...policy };
  }

  /** Registers one negotiated connection and returns its idempotent close callback. */
  recordConnectionOpened(negotiated: NegotiatedRelayTransportPolicy): () => void {
    const connection = cloneNegotiatedRelayPolicy(negotiated);
    this.activeConnections.add(connection);
    incrementCount(this.negotiatedModeCounts, relayNegotiatedModeLabel(connection));
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      this.activeConnections.delete(connection);
    };
  }

  /** Records entry into the compressor after all pre-codec gates pass. */
  recordCompressionAttempt(trafficClass: RelayTrafficClass): void {
    incrementCount(this.compressionAttemptCounts, trafficClass);
  }

  /** Aggregates one prepared frame without retaining its application bytes. */
  recordPreparedFrame(metric: RelayPreparedFrameMetric): void {
    const key = relayOutboundFrameKey(metric);
    addFrameAggregate({ map: this.outboundFrames, key, metric });
    if (metric.skipReason) incrementCount(this.compressionSkipCounts, metric.skipReason);
    if (metric.codecMs !== null) {
      this.compressionPrepareSamples.push(normalizeDuration(metric.prepareMs));
      this.compressionCodecSamples.push(normalizeDuration(metric.codecMs));
    }
  }

  /** Records the ordered-send wait before one prepared frame reaches the FIFO head. */
  recordQueueMs(sample: RelaySendFifoWaitSample): void {
    const { trafficClass, durationMs } = sample;
    pushMapSample({ map: this.compressionQueueSamples, key: trafficClass, durationMs });
  }

  /** Aggregates one decoded framed payload without retaining decoded bytes. */
  recordInboundFrame(metric: RelayInboundFrameMetric): void {
    const key = relayInboundFrameKey(metric);
    addFrameAggregate({ map: this.inboundFrames, key, metric });
    pushMapSample({ map: this.inboundDecodeSamples, key, durationMs: metric.decodeMs });
  }

  /** Increments one bounded framed receive failure reason. */
  recordFramedProtocolError(reason: RelayFramedProtocolErrorReason): void {
    incrementCount(this.framedProtocolErrorCounts, reason);
  }

  /** Samples aggregate final wire bytes retained behind the send FIFO. */
  recordPendingPreparedBytes(bytes: number): void {
    this.pendingPreparedByteSamples.push(normalizeByteCount(bytes));
  }

  /** Samples aggregate raw wire bytes retained by the receive FIFO. */
  recordPendingReceiveWireBytes(bytes: number): void {
    this.pendingReceiveWireByteSamples.push(normalizeByteCount(bytes));
  }

  /** Produces the current aggregate window and clears event samples only. */
  snapshotAndReset(): RelayTransportRuntimeMetricsSnapshot {
    const snapshot: RelayTransportRuntimeMetricsSnapshot = {
      configuredPolicy: { ...this.configuredPolicy },
      negotiatedModeCount: createNegotiatedModeCountRecord(this.negotiatedModeCounts),
      activeConnectionCount: this.computeActiveConnections(),
      effectiveCompressionCount: this.computeEffectiveCompressionCounts(),
      compressionAttemptCount: createTrafficClassCountRecord(this.compressionAttemptCounts),
      outboundFrames: this.computeOutboundFrames(),
      compressionSkipCount: createCompressionSkipCountRecord(this.compressionSkipCounts),
      compressionPrepareMs: this.compressionPrepareSamples.length
        ? [
            {
              algorithm: RELAY_TRANSPORT_COMPRESSION_ALGORITHM,
              ...summarizeDurations(this.compressionPrepareSamples.values()),
            },
          ]
        : [],
      compressionQueueMs: RELAY_TRAFFIC_CLASSES.flatMap((trafficClass) => {
        const samples = this.compressionQueueSamples.get(trafficClass);
        return samples?.length ? [{ trafficClass, ...summarizeDurations(samples.values()) }] : [];
      }),
      compressionCodecMs: this.compressionCodecSamples.length
        ? [
            {
              algorithm: RELAY_TRANSPORT_COMPRESSION_ALGORITHM,
              ...summarizeDurations(this.compressionCodecSamples.values()),
            },
          ]
        : [],
      inboundDecodeMs: this.computeInboundDecodeMs(),
      inboundFrames: this.computeInboundFrames(),
      framedProtocolErrorCount: createFramedProtocolErrorCountRecord(
        this.framedProtocolErrorCounts,
      ),
      pendingPreparedBytes: summarizeByteSamples(this.pendingPreparedByteSamples.values()),
      pendingReceiveWireBytes: summarizeByteSamples(this.pendingReceiveWireByteSamples.values()),
    };
    this.resetWindowEvents();
    return snapshot;
  }

  /** Aggregates active connections under current configured policy. */
  private computeActiveConnections(): RelayTransportRuntimeMetricsSnapshot["activeConnectionCount"] {
    const counts = new Map<string, number>();
    const values = new Map<
      string,
      Omit<RelayTransportRuntimeMetricsSnapshot["activeConnectionCount"][number], "count">
    >();
    for (const negotiated of this.activeConnections) {
      const effective = resolveRelayTransportPolicy({
        configured: this.configuredPolicy,
        negotiated,
      });
      const value = {
        mode: negotiated.mode,
        ciphertextEncoding: negotiated.ciphertextEncoding,
        codec: effective.compression.algorithm ?? "identity",
        effectiveReason: effective.compression.reason,
      } as const;
      const key = JSON.stringify(value);
      incrementCount(counts, key);
      values.set(key, value);
    }
    return [...counts.entries()]
      .map(([key, count]) => {
        /** Label tuple stored alongside the count under the same deterministic key. */
        const value = values.get(key);
        if (!value) throw new Error("Active relay metric labels are missing");
        return {
          mode: value.mode,
          ciphertextEncoding: value.ciphertextEncoding,
          codec: value.codec,
          effectiveReason: value.effectiveReason,
          count,
        };
      })
      .sort((left, right) => compareMetricRows({ left, right }));
  }

  /** Aggregates current effective compression reasons across active connections. */
  private computeEffectiveCompressionCounts(): RelayTransportRuntimeMetricsSnapshot["effectiveCompressionCount"] {
    const counts = new Map<string, number>();
    for (const negotiated of this.activeConnections) {
      const effective = resolveRelayTransportPolicy({
        configured: this.configuredPolicy,
        negotiated,
      });
      incrementCount(counts, effectiveCompressionKey(effective.compression));
    }
    return [...counts.entries()]
      .map(([key, count]) => {
        /** Effective policy reconstructed from the bounded aggregate key. */
        const policy = parseEffectiveCompressionKey(key);
        return {
          enabled: policy.enabled,
          algorithm: policy.algorithm,
          reason: policy.reason,
          count,
        };
      })
      .sort((left, right) => compareMetricRows({ left, right }));
  }

  /** Converts outbound aggregate keys back into stable diagnostic rows. */
  private computeOutboundFrames(): RelayTransportRuntimeMetricsSnapshot["outboundFrames"] {
    return [...this.outboundFrames.entries()]
      .map(([key, aggregate]) => {
        /** Bounded labels reconstructed from the aggregate key. */
        const labels = parseOutboundFrameKey(key);
        return {
          ciphertextEncoding: labels.ciphertextEncoding,
          trafficClass: labels.trafficClass,
          codec: labels.codec,
          frameCount: aggregate.frameCount,
          originalBytes: aggregate.originalBytes,
          encodedBytes: aggregate.encodedBytes,
          wireBytes: aggregate.wireBytes,
        };
      })
      .sort((left, right) => compareMetricRows({ left, right }));
  }

  /** Converts inbound timing keys into stable percentile rows. */
  private computeInboundDecodeMs(): RelayTransportRuntimeMetricsSnapshot["inboundDecodeMs"] {
    return [...this.inboundDecodeSamples.entries()]
      .map(([key, samples]) => {
        /** Bounded labels reconstructed from the timing key. */
        const labels = parseInboundFrameKey(key);
        /** Percentiles calculated over the fixed-capacity recent sample window. */
        const summary = summarizeDurations(samples.values());
        return {
          ciphertextEncoding: labels.ciphertextEncoding,
          codec: labels.codec,
          p50: summary.p50,
          p95: summary.p95,
          max: summary.max,
        };
      })
      .sort((left, right) => compareMetricRows({ left, right }));
  }

  /** Converts inbound aggregate keys back into stable diagnostic rows. */
  private computeInboundFrames(): RelayTransportRuntimeMetricsSnapshot["inboundFrames"] {
    return [...this.inboundFrames.entries()]
      .map(([key, aggregate]) => {
        /** Bounded labels reconstructed from the aggregate key. */
        const labels = parseInboundFrameKey(key);
        return {
          ciphertextEncoding: labels.ciphertextEncoding,
          codec: labels.codec,
          frameCount: aggregate.frameCount,
          originalBytes: aggregate.originalBytes,
          encodedBytes: aggregate.encodedBytes,
          wireBytes: aggregate.wireBytes,
        };
      })
      .sort((left, right) => compareMetricRows({ left, right }));
  }

  /** Clears current-window events while retaining gauges and active connections. */
  private resetWindowEvents(): void {
    this.negotiatedModeCounts.clear();
    this.compressionAttemptCounts.clear();
    this.outboundFrames.clear();
    this.compressionSkipCounts.clear();
    this.compressionPrepareSamples.clear();
    this.compressionQueueSamples.clear();
    this.compressionCodecSamples.clear();
    this.inboundDecodeSamples.clear();
    this.inboundFrames.clear();
    this.framedProtocolErrorCounts.clear();
    this.pendingPreparedByteSamples.clear();
    this.pendingReceiveWireByteSamples.clear();
  }
}

export interface WebSocketRuntimeCounters {
  connectedAwaitingHello: number;
  helloResumed: number;
  helloNew: number;
  pendingDisconnected: number;
  sessionDisconnectedWaitingReconnect: number;
  sessionSocketDisconnectedAttached: number;
  sessionCleanup: number;
  validationFailed: number;
  binaryBeforeHelloRejected: number;
  pendingMessageRejectedBeforeHello: number;
  missingConnectionForMessage: number;
  unexpectedHelloOnActiveConnection: number;
  relayExternalSocketAttached: number;
  originRejected: number;
  hostRejected: number;
}

export interface WebSocketRuntimeMetricsSnapshot {
  windowMs: number;
  relayTransport: RelayTransportRuntimeMetricsSnapshot;
  counters: WebSocketRuntimeCounters;
  inboundMessageTypesTop: Array<[string, number]>;
  inboundSessionRequestTypesTop: Array<[string, number]>;
  outboundMessageTypesTop: Array<[string, number]>;
  outboundSessionMessageTypesTop: Array<[string, number]>;
  outboundAgentStreamTypesTop: Array<[string, number]>;
  outboundAgentStreamAgentsTop: Array<[string, number]>;
  outboundBinaryFrameTypesTop: Array<[string, number]>;
  bufferedAmount: {
    p95: number;
    max: number;
  };
  latency: Array<{
    type: string;
    count: number;
    minMs: number;
    maxMs: number;
    p50Ms: number;
    totalMs: number;
  }>;
}

export interface WebSocketRuntimeDiagnosticSnapshot<
  TRuntime = unknown,
  TAgents = unknown,
  TGit = unknown,
> extends WebSocketRuntimeMetricsSnapshot {
  collectedAt: string;
  final: boolean;
  sessions: {
    activeConnections: number;
    externalSessionKeys: number;
    reconnectGraceSessions: number;
  };
  sockets: {
    activeSockets: number;
    pendingConnections: number;
  };
  eventLoopDelay: {
    p50Ms: number;
    p99Ms: number;
    maxMs: number;
  } | null;
  uptimeSeconds: number;
  memory: ProcessMemoryDiagnostics;
  runtime: TRuntime;
  agents: TAgents;
  git: TGit;
}

type Clock = () => number;

export class WebSocketRuntimeMetricsWindow {
  /** Relay-specific content-free aggregates shared with the transport runtime. */
  readonly relayTransport = new RelayTransportRuntimeMetricsWindow();
  private windowStartedAt: number;
  private readonly counters: WebSocketRuntimeCounters = createRuntimeCounters();
  private readonly inboundMessageCounts = new Map<string, number>();
  private readonly inboundSessionRequestCounts = new Map<string, number>();
  private readonly outboundMessageCounts = new Map<string, number>();
  private readonly outboundSessionMessageCounts = new Map<string, number>();
  private readonly outboundAgentStreamCounts = new Map<string, number>();
  private readonly outboundAgentStreamByAgentCounts = new Map<string, number>();
  private readonly outboundBinaryFrameCounts = new Map<string, number>();
  private readonly bufferedAmountSamples: number[] = [];
  private readonly requestLatencies = new Map<string, number[]>();

  constructor(private readonly clock: Clock = Date.now) {
    this.windowStartedAt = this.clock();
  }

  incrementCounter(counter: keyof WebSocketRuntimeCounters): void {
    this.counters[counter] += 1;
  }

  recordInboundMessage(type: string): void {
    incrementCount(this.inboundMessageCounts, type);
  }

  recordInboundSessionRequest(type: string): void {
    incrementCount(this.inboundSessionRequestCounts, type);
  }

  recordOutboundMessage(message: WSOutboundMessage, bufferedAmount?: number): void {
    if (message.type !== "session") {
      incrementCount(this.outboundMessageCounts, message.type);
      this.recordBufferedAmount(bufferedAmount);
      return;
    }

    incrementCount(this.outboundMessageCounts, "session_message");
    incrementCount(this.outboundSessionMessageCounts, message.message.type);

    if (message.message.type === "agent_stream") {
      this.recordOutboundAgentStreamMessage(message.message.payload);
    }

    this.recordBufferedAmount(bufferedAmount);
  }

  recordOutboundBinaryFrame(bufferedAmount?: number): void {
    incrementCount(this.outboundBinaryFrameCounts, "binary");
    this.recordBufferedAmount(bufferedAmount);
  }

  recordRequestLatency(type: string, durationMs: number): void {
    let latencies = this.requestLatencies.get(type);
    if (!latencies) {
      latencies = [];
      this.requestLatencies.set(type, latencies);
    }
    latencies.push(durationMs);
  }

  snapshotAndReset(): WebSocketRuntimeMetricsSnapshot {
    const now = this.clock();
    const snapshot: WebSocketRuntimeMetricsSnapshot = {
      windowMs: Math.max(0, now - this.windowStartedAt),
      relayTransport: this.relayTransport.snapshotAndReset(),
      counters: { ...this.counters },
      inboundMessageTypesTop: getTopCounts(this.inboundMessageCounts, 12),
      inboundSessionRequestTypesTop: getTopCounts(this.inboundSessionRequestCounts, 20),
      outboundMessageTypesTop: getTopCounts(this.outboundMessageCounts, 12),
      outboundSessionMessageTypesTop: getTopCounts(this.outboundSessionMessageCounts, 20),
      outboundAgentStreamTypesTop: getTopCounts(this.outboundAgentStreamCounts, 20),
      outboundAgentStreamAgentsTop: getTopCounts(this.outboundAgentStreamByAgentCounts, 20),
      outboundBinaryFrameTypesTop: getTopCounts(this.outboundBinaryFrameCounts, 12),
      bufferedAmount: this.computeBufferedAmountStats(),
      latency: this.computeLatencyStats(),
    };

    this.reset(now);
    return snapshot;
  }

  private recordOutboundAgentStreamMessage(
    payload: Extract<SessionOutboundMessage, { type: "agent_stream" }>["payload"],
  ): void {
    const { agentId, event } = payload;
    const eventType = event.type === "timeline" ? `timeline:${event.item.type}` : event.type;
    incrementCount(this.outboundAgentStreamCounts, eventType);
    incrementCount(this.outboundAgentStreamByAgentCounts, agentId);
  }

  private recordBufferedAmount(bufferedAmount: number | undefined): void {
    if (typeof bufferedAmount !== "number") {
      return;
    }
    this.bufferedAmountSamples.push(bufferedAmount);
  }

  private computeLatencyStats(): WebSocketRuntimeMetricsSnapshot["latency"] {
    const stats: WebSocketRuntimeMetricsSnapshot["latency"] = [];
    for (const [type, latencies] of this.requestLatencies) {
      if (latencies.length === 0) continue;
      const sortedLatencies = [...latencies].sort((a, b) => a - b);
      const count = sortedLatencies.length;
      const minMs = Math.round(sortedLatencies[0]);
      const maxMs = Math.round(sortedLatencies[count - 1]);
      const p50Ms = Math.round(sortedLatencies[Math.floor(count / 2)]);
      const totalMs = Math.round(sortedLatencies.reduce((sum, value) => sum + value, 0));
      stats.push({ type, count, minMs, maxMs, p50Ms, totalMs });
    }
    stats.sort((a, b) => b.totalMs - a.totalMs);
    return stats.slice(0, 15);
  }

  private computeBufferedAmountStats(): WebSocketRuntimeMetricsSnapshot["bufferedAmount"] {
    if (this.bufferedAmountSamples.length === 0) {
      return { p95: 0, max: 0 };
    }

    const samples = [...this.bufferedAmountSamples].sort((a, b) => a - b);
    const p95Index = Math.ceil(samples.length * 0.95) - 1;
    return {
      p95: samples[p95Index] ?? 0,
      max: samples[samples.length - 1] ?? 0,
    };
  }

  private reset(windowStartedAt: number): void {
    for (const counter of Object.keys(this.counters) as Array<keyof WebSocketRuntimeCounters>) {
      this.counters[counter] = 0;
    }
    this.inboundMessageCounts.clear();
    this.inboundSessionRequestCounts.clear();
    this.outboundMessageCounts.clear();
    this.outboundSessionMessageCounts.clear();
    this.outboundAgentStreamCounts.clear();
    this.outboundAgentStreamByAgentCounts.clear();
    this.outboundBinaryFrameCounts.clear();
    this.bufferedAmountSamples.length = 0;
    this.requestLatencies.clear();
    this.windowStartedAt = windowStartedAt;
  }
}

function createRuntimeCounters(): WebSocketRuntimeCounters {
  return {
    connectedAwaitingHello: 0,
    helloResumed: 0,
    helloNew: 0,
    pendingDisconnected: 0,
    sessionDisconnectedWaitingReconnect: 0,
    sessionSocketDisconnectedAttached: 0,
    sessionCleanup: 0,
    validationFailed: 0,
    binaryBeforeHelloRejected: 0,
    pendingMessageRejectedBeforeHello: 0,
    missingConnectionForMessage: 0,
    unexpectedHelloOnActiveConnection: 0,
    relayExternalSocketAttached: 0,
    originRejected: 0,
    hostRejected: 0,
  };
}

function incrementCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function getTopCounts(map: Map<string, number>, limit: number): Array<[string, number]> {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

/** Clones one negotiated policy so active gauges never retain caller-owned arrays. */
function cloneNegotiatedRelayPolicy(
  negotiated: NegotiatedRelayTransportPolicy,
): NegotiatedRelayTransportPolicy {
  return {
    ...negotiated,
    compressionAlgorithms: [...negotiated.compressionAlgorithms],
  };
}

/** Maps one negotiated policy to its bounded diagnostics label. */
function relayNegotiatedModeLabel(
  negotiated: NegotiatedRelayTransportPolicy,
): RelayNegotiatedModeLabel {
  if (negotiated.mode === "legacy") {
    return negotiated.ciphertextEncoding === "hybrid" ? "legacy-hybrid" : "legacy-base64";
  }
  return negotiated.ciphertextEncoding === "binary" ? "framed-v1-binary" : "framed-v1-base64";
}

/** Serializes one bounded effective-policy tuple for aggregate map storage. */
function effectiveCompressionKey(policy: EffectiveRelayTransportCompressionPolicy): string {
  return [
    policy.enabled ? "1" : "0",
    policy.algorithm ?? "identity",
    policy.reason ?? "enabled",
  ].join("|");
}

/** Restores one bounded effective-policy tuple from aggregate map storage. */
function parseEffectiveCompressionKey(key: string): EffectiveRelayTransportCompressionPolicy {
  const [enabled, algorithm, reason] = key.split("|");
  /** Bounded effective reason restored from aggregate storage. */
  let boundedReason: EffectiveRelayTransportCompressionPolicy["reason"] = null;
  switch (reason) {
    case "configured-disabled":
    case "legacy-mode":
    case "peer-unsupported":
      boundedReason = reason;
      break;
  }
  return {
    enabled: enabled === "1",
    algorithm:
      algorithm === RELAY_TRANSPORT_COMPRESSION_ALGORITHM
        ? RELAY_TRANSPORT_COMPRESSION_ALGORITHM
        : null,
    reason: boundedReason,
  };
}

/** Serializes one bounded outbound label tuple for aggregate map storage. */
function relayOutboundFrameKey(
  metric: Pick<RelayPreparedFrameMetric, "ciphertextEncoding" | "trafficClass" | "codec">,
): string {
  return `${metric.ciphertextEncoding}|${metric.trafficClass}|${metric.codec}`;
}

/** Restores one bounded outbound label tuple from aggregate map storage. */
function parseOutboundFrameKey(key: string): RelayOutboundFrameLabels {
  const [encoding, trafficClass, codec] = key.split("|");
  /** Bounded traffic class restored from aggregate storage. */
  let boundedTrafficClass: RelayTrafficClass = "realtime";
  switch (trafficClass) {
    case "state-sync":
    case "bulk":
    case "bulk-live":
      boundedTrafficClass = trafficClass;
      break;
  }
  return {
    ciphertextEncoding: encoding === "base64" ? "base64" : "binary",
    trafficClass: boundedTrafficClass,
    codec: codec === "deflate-raw" ? "deflate-raw" : "identity",
  };
}

/** Serializes one bounded inbound label tuple for aggregate map storage. */
function relayInboundFrameKey(
  metric: Pick<RelayInboundFrameMetric, "ciphertextEncoding" | "codec">,
): string {
  return `${metric.ciphertextEncoding}|${metric.codec}`;
}

/** Restores one bounded inbound label tuple from aggregate map storage. */
function parseInboundFrameKey(key: string): RelayInboundFrameLabels {
  const [encoding, codec] = key.split("|");
  return {
    ciphertextEncoding: encoding === "base64" ? "base64" : "binary",
    codec: codec === "deflate-raw" ? "deflate-raw" : "identity",
  };
}

/** Adds one content-free byte sample to an aggregate map. */
function addFrameAggregate(options: AddFrameAggregateOptions): void {
  const { map, key, metric } = options;
  const aggregate = map.get(key) ?? {
    frameCount: 0,
    originalBytes: 0,
    encodedBytes: 0,
    wireBytes: 0,
  };
  aggregate.frameCount += 1;
  aggregate.originalBytes += normalizeByteCount(metric.originalByteLength);
  aggregate.encodedBytes += normalizeByteCount(metric.encodedByteLength);
  aggregate.wireBytes += normalizeByteCount(metric.wireByteLength);
  map.set(key, aggregate);
}

/** Adds one normalized duration sample to a bounded label map. */
function pushMapSample<TKey>(options: PushMapSampleOptions<TKey>): void {
  const { map, key, durationMs } = options;
  const samples = map.get(key) ?? new RecentRelayMetricSamples();
  samples.push(normalizeDuration(durationMs));
  map.set(key, samples);
}

/** Completes every negotiated-mode counter without a dynamic record assertion. */
function createNegotiatedModeCountRecord(
  counts: ReadonlyMap<RelayNegotiatedModeLabel, number>,
): Record<RelayNegotiatedModeLabel, number> {
  return {
    "legacy-base64": counts.get("legacy-base64") ?? 0,
    "legacy-hybrid": counts.get("legacy-hybrid") ?? 0,
    "framed-v1-base64": counts.get("framed-v1-base64") ?? 0,
    "framed-v1-binary": counts.get("framed-v1-binary") ?? 0,
  };
}

/** Completes every traffic-class counter without a dynamic record assertion. */
function createTrafficClassCountRecord(
  counts: ReadonlyMap<RelayTrafficClass, number>,
): Record<RelayTrafficClass, number> {
  return {
    realtime: counts.get("realtime") ?? 0,
    "state-sync": counts.get("state-sync") ?? 0,
    bulk: counts.get("bulk") ?? 0,
    "bulk-live": counts.get("bulk-live") ?? 0,
  };
}

/** Completes every compression-skip counter without a dynamic record assertion. */
function createCompressionSkipCountRecord(
  counts: ReadonlyMap<RelayCompressionSkipReason, number>,
): Record<RelayCompressionSkipReason, number> {
  return {
    "configured-disabled": counts.get("configured-disabled") ?? 0,
    "legacy-mode": counts.get("legacy-mode") ?? 0,
    "peer-unsupported": counts.get("peer-unsupported") ?? 0,
    "traffic-ineligible": counts.get("traffic-ineligible") ?? 0,
    "too-small": counts.get("too-small") ?? 0,
    "too-large": counts.get("too-large") ?? 0,
    "no-gain": counts.get("no-gain") ?? 0,
    ratio: counts.get("ratio") ?? 0,
    busy: counts.get("busy") ?? 0,
    error: counts.get("error") ?? 0,
  };
}

/** Completes every framed-protocol counter without a dynamic record assertion. */
function createFramedProtocolErrorCountRecord(
  counts: ReadonlyMap<RelayFramedProtocolErrorReason, number>,
): Record<RelayFramedProtocolErrorReason, number> {
  return {
    "invalid-wire": counts.get("invalid-wire") ?? 0,
    "decrypt-failed": counts.get("decrypt-failed") ?? 0,
    "invalid-envelope": counts.get("invalid-envelope") ?? 0,
    "decode-failed": counts.get("decode-failed") ?? 0,
    "receive-high-water": counts.get("receive-high-water") ?? 0,
  };
}

/** Returns deterministic p50, p95, and max values for duration samples. */
function summarizeDurations(samples: readonly number[]): RelayDurationSummary {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    p50: percentile({ sorted, quantile: 0.5 }),
    p95: percentile({ sorted, quantile: 0.95 }),
    max: sorted.at(-1) ?? 0,
  };
}

/** Returns p95 and max for a non-negative byte gauge. */
function summarizeByteSamples(samples: readonly number[]): RelayByteSummary {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    p95: percentile({ sorted, quantile: 0.95 }),
    max: sorted.at(-1) ?? 0,
  };
}

/** Selects a nearest-rank percentile from an already sorted sample set. */
function percentile(options: PercentileOptions): number {
  const { sorted, quantile } = options;
  if (sorted.length === 0) return 0;
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index] ?? 0;
}

/** Normalizes runtime durations before retaining them in a metrics window. */
function normalizeDuration(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100) / 100;
}

/** Normalizes byte counters before retaining them in a metrics window. */
function normalizeByteCount(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

/** Orders bounded metric rows without depending on map insertion timing. */
function compareMetricRows(options: CompareMetricRowsOptions): number {
  const { left, right } = options;
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}
