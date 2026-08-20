import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";
import type {
  FramedCiphertextCodec,
  FramedCiphertextEncoding,
  NegotiatedEncryptedTransport,
} from "@getpaseo/relay/e2ee";

/** Stable negotiated mode labels used by client relay metrics. */
type RelayNegotiatedModeLabel =
  | "legacy-base64"
  | "legacy-hybrid"
  | "framed-v1-base64"
  | "framed-v1-binary";

/** Bounded framed protocol reasons that never retain remote error text. */
export type RelayFramedProtocolErrorReason =
  | "invalid-wire"
  | "decrypt-failed"
  | "invalid-envelope"
  | "decode-failed"
  | "receive-high-water";

/** Content-free metadata emitted after one relay frame is decoded. */
export interface RelayInboundFrameMetric {
  ciphertextEncoding: FramedCiphertextEncoding;
  codec: FramedCiphertextCodec;
  originalByteLength: number;
  encodedByteLength: number;
  wireByteLength: number;
  decodeMs: number;
}

/** Aggregated byte totals for one inbound relay label tuple. */
interface RelayFrameAggregate {
  frameCount: number;
  originalBytes: number;
  encodedBytes: number;
  wireBytes: number;
}

interface RuntimeMetricsLogger {
  info(obj: object, msg?: string): void;
}

interface RuntimeMetricsHandlerTiming {
  count: number;
  totalMs: number;
  maxMs: number;
}

interface RuntimeMetricsBucket {
  inboundMessageCounts: Map<string, number>;
  inboundMessageBytes: Map<string, number>;
  inboundMessageHandlerMs: Map<string, RuntimeMetricsHandlerTiming>;
  inboundAgentStreamCounts: Map<string, number>;
  inboundAgentStreamByAgentCounts: Map<string, number>;
  inboundBinaryFrameCounts: Map<string, number>;
  relayNegotiatedModeCounts: Map<RelayNegotiatedModeLabel, number>;
  relayInboundFrames: Map<string, RelayFrameAggregate>;
  relayInboundDecodeMs: Map<string, number[]>;
  relayFramedProtocolErrorCounts: Map<RelayFramedProtocolErrorReason, number>;
  relayPendingReceiveWireBytes: number[];
  endedAt: number;
}

interface RuntimeMetricsContext {
  connectionPath: "direct" | "relay";
  serverId: string | null;
  getConnectionStatus: () => string;
}

interface RuntimeMetricsOptions {
  windowMs?: number;
}

const DEFAULT_ROLLING_WINDOW_MS = 60_000;

/** Maximum recent observations retained for any one relay percentile series. */
const MAX_RELAY_PERCENTILE_SAMPLES = 2_048;

/** Fixed-capacity recent-value buffer that bounds client metrics memory under dense streams. */
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

  /** Copies the retained numeric set for sealing one rolling bucket. */
  values(): number[] {
    return this.samples.slice(0, this.size);
  }

  /** Releases retained observations while preserving the reusable allocation. */
  clear(): void {
    this.size = 0;
    this.nextIndex = 0;
  }
}

/** Bounded negotiated labels in deterministic log order. */
const RELAY_NEGOTIATED_MODE_LABELS: readonly RelayNegotiatedModeLabel[] = [
  "legacy-base64",
  "legacy-hybrid",
  "framed-v1-base64",
  "framed-v1-binary",
];

/** Bounded protocol failure reasons in deterministic log order. */
const RELAY_FRAMED_PROTOCOL_ERROR_REASONS: readonly RelayFramedProtocolErrorReason[] = [
  "invalid-wire",
  "decrypt-failed",
  "invalid-envelope",
  "decode-failed",
  "receive-high-water",
];

export class DaemonClientRuntimeMetrics {
  private readonly startedAt = Date.now();
  private readonly windowMs: number;
  private readonly buckets: RuntimeMetricsBucket[] = [];
  private readonly inboundMessageCounts = new Map<string, number>();
  private readonly inboundMessageBytes = new Map<string, number>();
  private readonly inboundMessageHandlerMs = new Map<string, RuntimeMetricsHandlerTiming>();
  private readonly inboundAgentStreamCounts = new Map<string, number>();
  private readonly inboundAgentStreamByAgentCounts = new Map<string, number>();
  private readonly inboundBinaryFrameCounts = new Map<string, number>();
  /** Negotiated relay connection events awaiting the next rolling bucket. */
  private readonly relayNegotiatedModeCounts = new Map<RelayNegotiatedModeLabel, number>();
  /** Inbound framed byte aggregates awaiting the next rolling bucket. */
  private readonly relayInboundFrames = new Map<string, RelayFrameAggregate>();
  /** Inbound framed decode samples awaiting the next rolling bucket. */
  private readonly relayInboundDecodeMs = new Map<string, RecentRelayMetricSamples>();
  /** Bounded framed failures awaiting the next rolling bucket. */
  private readonly relayFramedProtocolErrorCounts = new Map<
    RelayFramedProtocolErrorReason,
    number
  >();
  /** Pending receive byte gauge samples awaiting the next rolling bucket. */
  private readonly relayPendingReceiveWireBytes = new RecentRelayMetricSamples();

  constructor(
    private readonly logger: RuntimeMetricsLogger,
    private readonly context: RuntimeMetricsContext,
    options?: RuntimeMetricsOptions,
  ) {
    this.windowMs =
      typeof options?.windowMs === "number" && options.windowMs > 0
        ? options.windowMs
        : DEFAULT_ROLLING_WINDOW_MS;
  }

  recordMessage(type: string, bytes: number, handlerMs: number): void {
    incrementCount(this.inboundMessageCounts, type, 1);
    incrementCount(this.inboundMessageBytes, type, bytes);
    incrementHandlerTiming(this.inboundMessageHandlerMs, type, handlerMs);
  }

  recordAgentStream(
    payload: Extract<SessionOutboundMessage, { type: "agent_stream" }>["payload"],
  ): void {
    const { agentId, event } = payload;
    const eventType = event.type === "timeline" ? `timeline:${event.item.type}` : event.type;
    incrementCount(this.inboundAgentStreamCounts, eventType, 1);
    incrementCount(this.inboundAgentStreamByAgentCounts, agentId, 1);
  }

  recordBinaryFrame(kind: string, bytes: number, handlerMs: number): void {
    incrementCount(this.inboundBinaryFrameCounts, kind, 1);
    incrementCount(this.inboundMessageBytes, `binary:${kind}`, bytes);
    incrementHandlerTiming(this.inboundMessageHandlerMs, `binary:${kind}`, handlerMs);
  }

  /** Records one authenticated relay transport selection. */
  recordRelayNegotiated(negotiated: NegotiatedEncryptedTransport): void {
    incrementCount(this.relayNegotiatedModeCounts, relayNegotiatedModeLabel(negotiated), 1);
  }

  /** Aggregates one decoded relay frame without retaining application bytes. */
  recordRelayInboundFrame(metric: RelayInboundFrameMetric): void {
    const key = relayInboundFrameKey(metric.ciphertextEncoding, metric.codec);
    addRelayFrameAggregate(this.relayInboundFrames, key, metric);
    pushDurationSample(this.relayInboundDecodeMs, key, metric.decodeMs);
  }

  /** Increments one bounded framed receive failure. */
  recordRelayFramedProtocolError(reason: RelayFramedProtocolErrorReason): void {
    incrementCount(this.relayFramedProtocolErrorCounts, reason, 1);
  }

  /** Samples aggregate raw wire bytes retained by the relay receive FIFO. */
  recordRelayPendingReceiveWireBytes(bytes: number): void {
    this.relayPendingReceiveWireBytes.push(normalizeByteCount(bytes));
  }

  flush(options?: { final?: boolean }): void {
    const now = Date.now();
    const bucket = this.consumeCurrentBucket(now);
    if (bucket) {
      this.buckets.push(bucket);
    }
    this.pruneBuckets(now);

    const aggregate = this.aggregateBuckets();
    const hasActivity =
      aggregate.inboundMessageCounts.size > 0 ||
      aggregate.inboundBinaryFrameCounts.size > 0 ||
      aggregate.relayNegotiatedModeCounts.size > 0 ||
      aggregate.relayInboundFrames.size > 0 ||
      aggregate.relayFramedProtocolErrorCounts.size > 0 ||
      aggregate.relayPendingReceiveWireBytes.length > 0;
    if (!hasActivity && !options?.final) {
      return;
    }

    this.logger.info(
      {
        windowMs: Math.min(this.windowMs, Math.max(0, now - this.startedAt)),
        rollingWindowMs: this.windowMs,
        bucketCount: this.buckets.length,
        final: Boolean(options?.final),
        connectionPath: this.context.connectionPath,
        serverId: this.context.serverId,
        connectionStatus: this.context.getConnectionStatus(),
        inboundMessageTypesTop: getTopCounts(aggregate.inboundMessageCounts, 20),
        inboundMessageBytesTop: getTopCounts(aggregate.inboundMessageBytes, 20),
        inboundAgentStreamTypesTop: getTopCounts(aggregate.inboundAgentStreamCounts, 20),
        inboundAgentStreamAgentsTop: getTopCounts(aggregate.inboundAgentStreamByAgentCounts, 20),
        inboundBinaryFrameTypesTop: getTopCounts(aggregate.inboundBinaryFrameCounts, 12),
        handlerTimingTop: getTopHandlerTimings(aggregate.inboundMessageHandlerMs, 20),
        relayTransport: createRelayTransportSnapshot(aggregate),
      },
      "ws_runtime_metrics_client",
    );
  }

  private consumeCurrentBucket(now: number): RuntimeMetricsBucket | null {
    const hasActivity =
      this.inboundMessageCounts.size > 0 ||
      this.inboundBinaryFrameCounts.size > 0 ||
      this.relayNegotiatedModeCounts.size > 0 ||
      this.relayInboundFrames.size > 0 ||
      this.relayFramedProtocolErrorCounts.size > 0 ||
      this.relayPendingReceiveWireBytes.length > 0;
    if (!hasActivity) {
      return null;
    }

    const bucket = {
      inboundMessageCounts: new Map(this.inboundMessageCounts),
      inboundMessageBytes: new Map(this.inboundMessageBytes),
      inboundMessageHandlerMs: cloneHandlerTimingMap(this.inboundMessageHandlerMs),
      inboundAgentStreamCounts: new Map(this.inboundAgentStreamCounts),
      inboundAgentStreamByAgentCounts: new Map(this.inboundAgentStreamByAgentCounts),
      inboundBinaryFrameCounts: new Map(this.inboundBinaryFrameCounts),
      relayNegotiatedModeCounts: new Map(this.relayNegotiatedModeCounts),
      relayInboundFrames: cloneRelayFrameAggregateMap(this.relayInboundFrames),
      relayInboundDecodeMs: cloneDurationSampleMap(this.relayInboundDecodeMs),
      relayFramedProtocolErrorCounts: new Map(this.relayFramedProtocolErrorCounts),
      relayPendingReceiveWireBytes: this.relayPendingReceiveWireBytes.values(),
      endedAt: now,
    };

    this.inboundMessageCounts.clear();
    this.inboundMessageBytes.clear();
    this.inboundMessageHandlerMs.clear();
    this.inboundAgentStreamCounts.clear();
    this.inboundAgentStreamByAgentCounts.clear();
    this.inboundBinaryFrameCounts.clear();
    this.relayNegotiatedModeCounts.clear();
    this.relayInboundFrames.clear();
    this.relayInboundDecodeMs.clear();
    this.relayFramedProtocolErrorCounts.clear();
    this.relayPendingReceiveWireBytes.clear();
    return bucket;
  }

  private pruneBuckets(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.buckets.length > 0 && this.buckets[0].endedAt < cutoff) {
      this.buckets.shift();
    }
  }

  private aggregateBuckets(): RuntimeMetricsBucket {
    const aggregate = createEmptyBucket(Date.now());
    for (const bucket of this.buckets) {
      mergeCountMap(aggregate.inboundMessageCounts, bucket.inboundMessageCounts);
      mergeCountMap(aggregate.inboundMessageBytes, bucket.inboundMessageBytes);
      mergeHandlerTimingMap(aggregate.inboundMessageHandlerMs, bucket.inboundMessageHandlerMs);
      mergeCountMap(aggregate.inboundAgentStreamCounts, bucket.inboundAgentStreamCounts);
      mergeCountMap(
        aggregate.inboundAgentStreamByAgentCounts,
        bucket.inboundAgentStreamByAgentCounts,
      );
      mergeCountMap(aggregate.inboundBinaryFrameCounts, bucket.inboundBinaryFrameCounts);
      mergeCountMap(aggregate.relayNegotiatedModeCounts, bucket.relayNegotiatedModeCounts);
      mergeRelayFrameAggregateMap(aggregate.relayInboundFrames, bucket.relayInboundFrames);
      mergeDurationSampleMap(aggregate.relayInboundDecodeMs, bucket.relayInboundDecodeMs);
      mergeCountMap(
        aggregate.relayFramedProtocolErrorCounts,
        bucket.relayFramedProtocolErrorCounts,
      );
      appendBoundedSamples(
        aggregate.relayPendingReceiveWireBytes,
        bucket.relayPendingReceiveWireBytes,
      );
    }
    return aggregate;
  }
}

function createEmptyBucket(endedAt: number): RuntimeMetricsBucket {
  return {
    inboundMessageCounts: new Map(),
    inboundMessageBytes: new Map(),
    inboundMessageHandlerMs: new Map(),
    inboundAgentStreamCounts: new Map(),
    inboundAgentStreamByAgentCounts: new Map(),
    inboundBinaryFrameCounts: new Map(),
    relayNegotiatedModeCounts: new Map(),
    relayInboundFrames: new Map(),
    relayInboundDecodeMs: new Map(),
    relayFramedProtocolErrorCounts: new Map(),
    relayPendingReceiveWireBytes: [],
    endedAt,
  };
}

function incrementCount(map: Map<string, number>, key: string, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function incrementHandlerTiming(
  map: Map<string, RuntimeMetricsHandlerTiming>,
  key: string,
  handlerMs: number,
): void {
  const existing = map.get(key);
  if (existing) {
    existing.count += 1;
    existing.totalMs += handlerMs;
    existing.maxMs = Math.max(existing.maxMs, handlerMs);
    return;
  }
  map.set(key, {
    count: 1,
    totalMs: handlerMs,
    maxMs: handlerMs,
  });
}

function cloneHandlerTimingMap(
  map: Map<string, RuntimeMetricsHandlerTiming>,
): Map<string, RuntimeMetricsHandlerTiming> {
  return new Map(
    [...map.entries()].map(([key, value]) => [
      key,
      { count: value.count, totalMs: value.totalMs, maxMs: value.maxMs },
    ]),
  );
}

function mergeCountMap(target: Map<string, number>, source: Map<string, number>): void {
  for (const [key, value] of source) {
    incrementCount(target, key, value);
  }
}

function mergeHandlerTimingMap(
  target: Map<string, RuntimeMetricsHandlerTiming>,
  source: Map<string, RuntimeMetricsHandlerTiming>,
): void {
  for (const [key, value] of source) {
    const existing = target.get(key);
    if (existing) {
      existing.count += value.count;
      existing.totalMs += value.totalMs;
      existing.maxMs = Math.max(existing.maxMs, value.maxMs);
      continue;
    }
    target.set(key, {
      count: value.count,
      totalMs: value.totalMs,
      maxMs: value.maxMs,
    });
  }
}

function getTopCounts(map: Map<string, number>, limit: number): Array<[string, number]> {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function getTopHandlerTimings(
  map: Map<string, RuntimeMetricsHandlerTiming>,
  limit: number,
): Array<{
  type: string;
  count: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
}> {
  const rows = [...map.entries()].map(([type, value]) => ({
    type,
    count: value.count,
    totalMs: Math.round(value.totalMs),
    avgMs: Math.round((value.totalMs / value.count) * 100) / 100,
    maxMs: Math.round(value.maxMs * 100) / 100,
  }));
  rows.sort((a, b) => b.totalMs - a.totalMs);
  return rows.slice(0, limit);
}

/** Maps one negotiated relay policy to its bounded metrics label. */
function relayNegotiatedModeLabel(
  negotiated: NegotiatedEncryptedTransport,
): RelayNegotiatedModeLabel {
  if (negotiated.mode === "legacy") {
    return negotiated.ciphertextEncoding === "hybrid" ? "legacy-hybrid" : "legacy-base64";
  }
  return negotiated.ciphertextEncoding === "binary" ? "framed-v1-binary" : "framed-v1-base64";
}

/** Serializes one bounded inbound relay label tuple. */
function relayInboundFrameKey(
  encoding: FramedCiphertextEncoding,
  codec: FramedCiphertextCodec,
): string {
  return `${encoding}|${codec}`;
}

/** Restores one bounded inbound relay label tuple. */
function parseRelayInboundFrameKey(key: string): {
  ciphertextEncoding: FramedCiphertextEncoding;
  codec: FramedCiphertextCodec;
} {
  const [encoding, codec] = key.split("|");
  return {
    ciphertextEncoding: encoding === "base64" ? "base64" : "binary",
    codec: codec === "deflate-raw" ? "deflate-raw" : "identity",
  };
}

/** Adds one content-free inbound frame to its aggregate row. */
function addRelayFrameAggregate(
  map: Map<string, RelayFrameAggregate>,
  key: string,
  metric: RelayInboundFrameMetric,
): void {
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

/** Clones relay byte aggregates when sealing a rolling bucket. */
function cloneRelayFrameAggregateMap(
  map: Map<string, RelayFrameAggregate>,
): Map<string, RelayFrameAggregate> {
  return new Map([...map.entries()].map(([key, value]) => [key, { ...value }]));
}

/** Clones relay duration arrays when sealing a rolling bucket. */
function cloneDurationSampleMap(map: Map<string, RecentRelayMetricSamples>): Map<string, number[]> {
  return new Map([...map.entries()].map(([key, value]) => [key, value.values()]));
}

/** Adds one normalized duration sample to a bounded label map. */
function pushDurationSample(
  map: Map<string, RecentRelayMetricSamples>,
  key: string,
  durationMs: number,
): void {
  const samples = map.get(key) ?? new RecentRelayMetricSamples();
  samples.push(normalizeDuration(durationMs));
  map.set(key, samples);
}

/** Merges relay byte aggregates across rolling buckets. */
function mergeRelayFrameAggregateMap(
  target: Map<string, RelayFrameAggregate>,
  source: Map<string, RelayFrameAggregate>,
): void {
  for (const [key, value] of source) {
    const aggregate = target.get(key) ?? {
      frameCount: 0,
      originalBytes: 0,
      encodedBytes: 0,
      wireBytes: 0,
    };
    aggregate.frameCount += value.frameCount;
    aggregate.originalBytes += value.originalBytes;
    aggregate.encodedBytes += value.encodedBytes;
    aggregate.wireBytes += value.wireBytes;
    target.set(key, aggregate);
  }
}

/** Merges relay duration samples across rolling buckets. */
function mergeDurationSampleMap(
  target: Map<string, number[]>,
  source: Map<string, number[]>,
): void {
  for (const [key, values] of source) {
    const samples = target.get(key) ?? [];
    appendBoundedSamples(samples, values);
    target.set(key, samples);
  }
}

/** Appends numeric samples while retaining only the newest fixed-capacity observations. */
function appendBoundedSamples(target: number[], source: readonly number[]): void {
  if (source.length >= MAX_RELAY_PERCENTILE_SAMPLES) {
    target.splice(0, target.length, ...source.slice(source.length - MAX_RELAY_PERCENTILE_SAMPLES));
    return;
  }
  /** Number of old values that cannot coexist with the appended source values. */
  const overflow = target.length + source.length - MAX_RELAY_PERCENTILE_SAMPLES;
  if (overflow > 0) target.splice(0, overflow);
  target.push(...source);
}

/** Builds the relay-only child snapshot embedded in the existing client log. */
function createRelayTransportSnapshot(bucket: RuntimeMetricsBucket): object {
  const inboundFrames = [...bucket.relayInboundFrames.entries()]
    .map(([key, value]) => {
      /** Bounded labels reconstructed from the aggregate key. */
      const labels = parseRelayInboundFrameKey(key);
      return {
        ciphertextEncoding: labels.ciphertextEncoding,
        codec: labels.codec,
        frameCount: value.frameCount,
        originalBytes: value.originalBytes,
        encodedBytes: value.encodedBytes,
        wireBytes: value.wireBytes,
      };
    })
    .sort(compareMetricRows);
  const inboundDecodeMs = [...bucket.relayInboundDecodeMs.entries()]
    .map(([key, samples]) => {
      /** Bounded labels reconstructed from the timing key. */
      const labels = parseRelayInboundFrameKey(key);
      /** Percentiles calculated over the fixed-capacity recent sample window. */
      const summary = summarizeDurations(samples);
      return {
        ciphertextEncoding: labels.ciphertextEncoding,
        codec: labels.codec,
        p50: summary.p50,
        p95: summary.p95,
        max: summary.max,
      };
    })
    .sort(compareMetricRows);
  return {
    negotiatedModeCount: createBoundedCountRecord(
      RELAY_NEGOTIATED_MODE_LABELS,
      bucket.relayNegotiatedModeCounts,
    ),
    inboundFrames,
    inboundDecodeMs,
    framedProtocolErrorCount: createBoundedCountRecord(
      RELAY_FRAMED_PROTOCOL_ERROR_REASONS,
      bucket.relayFramedProtocolErrorCounts,
    ),
    pendingReceiveWireBytes: summarizeByteSamples(bucket.relayPendingReceiveWireBytes),
  };
}

/** Converts a bounded sparse count map into a complete record. */
function createBoundedCountRecord<TKey extends string>(
  keys: readonly TKey[],
  counts: ReadonlyMap<TKey, number>,
): Record<TKey, number> {
  return Object.fromEntries(keys.map((key) => [key, counts.get(key) ?? 0])) as Record<TKey, number>;
}

/** Returns deterministic p50, p95, and max values for duration samples. */
function summarizeDurations(samples: readonly number[]): { p50: number; p95: number; max: number } {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1) ?? 0,
  };
}

/** Returns p95 and max for a non-negative byte gauge. */
function summarizeByteSamples(samples: readonly number[]): { p95: number; max: number } {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1) ?? 0,
  };
}

/** Selects a nearest-rank percentile from an already sorted sample set. */
function percentile(sorted: readonly number[], quantile: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index] ?? 0;
}

/** Normalizes byte counters before retaining them in a metrics bucket. */
function normalizeByteCount(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

/** Normalizes duration samples before retaining them in a metrics bucket. */
function normalizeDuration(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100) / 100;
}

/** Orders bounded metric rows without depending on event timing. */
function compareMetricRows(left: object, right: object): number {
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}
