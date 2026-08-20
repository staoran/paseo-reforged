import { deflateRaw as nodeDeflateRaw, inflateRaw as nodeInflateRaw } from "node:zlib";

import {
  framedCiphertextWireByteLength,
  MAX_COMPRESSION_INPUT_BYTES,
  MAX_COMPRESSION_RATIO,
  MIN_COMPRESSION_BYTES,
  MIN_COMPRESSION_SAVINGS_BYTES,
  MIN_COMPRESSION_SAVINGS_RATIO,
  prepareDeflateFramedPayload,
  prepareIdentityFramedPayload,
  type FrameCompressionAdapter,
  type FrameCompressionEncoder,
  type FramedCiphertextEncoding,
  type PreparedFramedPayload,
} from "@getpaseo/relay/e2ee";

/** Daemon-private DEFLATE level fixed for the first framed protocol version. */
export const FIXED_DEFLATE_LEVEL = 1;

/** Larger lower bound reserved for completed live tool-call results. */
export const MIN_BULK_LIVE_COMPRESSION_BYTES = 16 * 1024;

/** Process coordinator capacity reserved for asynchronous daemon compression. */
export const MAX_CONCURRENT_DAEMON_COMPRESSION_JOBS = 2;

/** Active raw DEFLATE jobs shared by every framed connection in this daemon process. */
let activeDaemonCompressionJobs = 0;

/** Semantic traffic class used only by the local relay transport. */
export type RelayTrafficClass = "realtime" | "state-sync" | "bulk" | "bulk-live";

/** Optional sender-side classification supplied before serialization context is lost. */
export interface RelayTrafficHint {
  /** Semantic latency and catch-up class for this application frame. */
  trafficClass: RelayTrafficClass;
  /** Whether a bulk payload is known to be safe and useful to compress. */
  compressible?: boolean;
}

/** Effective framed policy fixed for one daemon data connection. */
export interface DaemonFrameCompressionPolicy {
  /** Runtime compression switch after config resolution. */
  compressionEnabled: boolean;
  /** Authenticated codec intersection selected during the handshake. */
  negotiatedCompressionAlgorithms: readonly string[];
  /** Locked WebSocket ciphertext representation for this connection. */
  ciphertextEncoding: FramedCiphertextEncoding;
}

/** Stable reason explaining why an eligible frame used identity. */
export type CompressionSkipReason =
  | "configured-disabled"
  | "peer-unsupported"
  | "traffic-ineligible"
  | "too-small"
  | "too-large"
  | "no-gain"
  | "ratio"
  | "busy"
  | "error";

/** Node-capable codec port shared by compression preparation and bounded decoding. */
export interface DaemonFrameCompressionCodec
  extends FrameCompressionEncoder, FrameCompressionAdapter {}

/** Prepared authenticated payload and exact eventual wire metadata. */
export interface PreparedDaemonFramedPayload extends PreparedFramedPayload {
  /** Exact WebSocket ciphertext length after encryption and locked representation. */
  wireByteLength: number;
  /** Locked WebSocket representation used by the eventual encrypted frame. */
  ciphertextEncoding: FramedCiphertextEncoding;
  /** Sender-side semantic class retained only for metrics and queue policy. */
  trafficClass: RelayTrafficClass;
  /** Null when compression was adopted; otherwise the identity fallback reason. */
  skipReason: CompressionSkipReason | null;
  /** Whether this frame entered the raw DEFLATE adapter after all pre-codec gates. */
  compressionAttempted: boolean;
  /** Total preparation wall time including gates, codec, and envelope construction. */
  prepareMs: number;
  /** Raw DEFLATE callback wall time, or null when the adapter was not entered. */
  codecMs: number | null;
}

/** Daemon compression coordinator sharing one process-wide non-waiting job gate. */
export interface DaemonFrameCompression {
  /** Prepares one authenticated payload without encrypting or sending it. */
  prepare(
    data: string | ArrayBuffer,
    hint: RelayTrafficHint,
    policy: DaemonFrameCompressionPolicy,
  ): Promise<PreparedDaemonFramedPayload>;
}

/** Copies a Node buffer view into a standalone cross-runtime ArrayBuffer. */
function copyNodeBuffer(buffer: Buffer): ArrayBuffer {
  // Exact-size output detached from Node's pooled backing buffer.
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy.buffer;
}

/** Creates the production asynchronous Node raw DEFLATE codec. */
export function createNodeRawDeflateCodec(): DaemonFrameCompressionCodec {
  return {
    deflateRaw: (input, level) =>
      new Promise<ArrayBuffer>((resolve, reject) => {
        nodeDeflateRaw(Buffer.from(input), { level }, (error, output) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(copyNodeBuffer(output));
        });
      }),
    inflateRaw: (input, expectedLength, maxOutputLength) =>
      new Promise<ArrayBuffer>((resolve, reject) => {
        if (
          !Number.isSafeInteger(expectedLength) ||
          expectedLength < 0 ||
          !Number.isSafeInteger(maxOutputLength) ||
          maxOutputLength <= expectedLength
        ) {
          reject(new Error("Invalid bounded raw DEFLATE output lengths"));
          return;
        }
        nodeInflateRaw(Buffer.from(input), { maxOutputLength }, (error, output) => {
          if (error) {
            reject(error);
            return;
          }
          if (output.byteLength !== expectedLength) {
            reject(new Error("Raw DEFLATE output length mismatch"));
            return;
          }
          resolve(copyNodeBuffer(output));
        });
      }),
  };
}

/** Resolves a policy or traffic reason that forbids entering the compressor. */
function resolvePreCompressionSkipReason(
  byteLength: number,
  hint: RelayTrafficHint,
  policy: DaemonFrameCompressionPolicy,
): CompressionSkipReason | null {
  if (!policy.compressionEnabled) return "configured-disabled";
  if (!policy.negotiatedCompressionAlgorithms.includes("deflate-raw")) {
    return "peer-unsupported";
  }
  if (hint.trafficClass === "realtime") return "traffic-ineligible";
  if (
    (hint.trafficClass === "bulk" || hint.trafficClass === "bulk-live") &&
    hint.compressible !== true
  ) {
    return "traffic-ineligible";
  }
  // Compression floor selected by the authenticated sender-side traffic class.
  const minimumBytes =
    hint.trafficClass === "bulk-live" ? MIN_BULK_LIVE_COMPRESSION_BYTES : MIN_COMPRESSION_BYTES;
  if (byteLength < minimumBytes) return "too-small";
  if (byteLength > MAX_COMPRESSION_INPUT_BYTES) return "too-large";
  return null;
}

/** Wraps the original bytes in identity while retaining preparation metadata. */
function prepareIdentityFallback(
  data: string | ArrayBuffer,
  hint: RelayTrafficHint,
  policy: DaemonFrameCompressionPolicy,
  skipReason: CompressionSkipReason,
  timing: {
    /** Monotonic start of the full preparation operation. */
    prepareStartedAt: number;
    /** Raw codec callback wall time when the adapter was entered. */
    codecMs: number | null;
  },
  clock: () => number,
): PreparedDaemonFramedPayload {
  // Authenticated identity envelope used for every safe compression fallback.
  const prepared = prepareIdentityFramedPayload(data);
  return {
    ...prepared,
    wireByteLength: framedCiphertextWireByteLength(
      prepared.encodedByteLength,
      policy.ciphertextEncoding,
    ),
    ciphertextEncoding: policy.ciphertextEncoding,
    trafficClass: hint.trafficClass,
    skipReason,
    compressionAttempted: timing.codecMs !== null,
    prepareMs: elapsedMs(timing.prepareStartedAt, clock()),
    codecMs: timing.codecMs,
  };
}

/** Creates one connection-local coordinator backed by the process-wide job gate. */
export function createDaemonFrameCompression(options: {
  /** Runtime-specific raw DEFLATE codec. */
  codec: DaemonFrameCompressionCodec;
  /** Optional monotonic clock used by runtime metrics and deterministic tests. */
  clock?: () => number;
}): DaemonFrameCompression {
  /** Monotonic clock shared by every preparation owned by this coordinator. */
  const clock = options.clock ?? defaultMonotonicClock;
  return {
    prepare: async (data, hint, policy) => {
      /** Monotonic start retained only for content-free wall-time metrics. */
      const prepareStartedAt = clock();
      // Logical application bytes passed unchanged to the codec boundary.
      const originalBytes = typeof data === "string" ? new TextEncoder().encode(data).buffer : data;
      // Eligibility result computed before consuming a daemon compression slot.
      const skipReason = resolvePreCompressionSkipReason(originalBytes.byteLength, hint, policy);
      if (skipReason) {
        return prepareIdentityFallback(
          data,
          hint,
          policy,
          skipReason,
          { prepareStartedAt, codecMs: null },
          clock,
        );
      }
      if (activeDaemonCompressionJobs >= MAX_CONCURRENT_DAEMON_COMPRESSION_JOBS) {
        return prepareIdentityFallback(
          data,
          hint,
          policy,
          "busy",
          { prepareStartedAt, codecMs: null },
          clock,
        );
      }
      activeDaemonCompressionJobs += 1;
      try {
        // Raw DEFLATE output produced at the fixed private encoder level.
        let compressed: ArrayBuffer;
        /** Monotonic start around the asynchronous native codec callback. */
        const codecStartedAt = clock();
        /** Codec callback wall time including any libuv worker-pool wait. */
        let codecMs: number;
        try {
          compressed = await options.codec.deflateRaw(originalBytes, FIXED_DEFLATE_LEVEL);
          codecMs = elapsedMs(codecStartedAt, clock());
        } catch {
          codecMs = elapsedMs(codecStartedAt, clock());
          return prepareIdentityFallback(
            data,
            hint,
            policy,
            "error",
            { prepareStartedAt, codecMs },
            clock,
          );
        }
        if (
          compressed.byteLength === 0 ||
          originalBytes.byteLength > compressed.byteLength * MAX_COMPRESSION_RATIO
        ) {
          return prepareIdentityFallback(
            data,
            hint,
            policy,
            "ratio",
            { prepareStartedAt, codecMs },
            clock,
          );
        }
        // Required reduction combining the fixed and proportional policy gates.
        const requiredSavings = Math.max(
          MIN_COMPRESSION_SAVINGS_BYTES,
          Math.ceil(originalBytes.byteLength * MIN_COMPRESSION_SAVINGS_RATIO),
        );
        if (compressed.byteLength > originalBytes.byteLength - requiredSavings) {
          return prepareIdentityFallback(
            data,
            hint,
            policy,
            "no-gain",
            { prepareStartedAt, codecMs },
            clock,
          );
        }
        // Authenticated envelope prepared exactly once before the later encryption stage.
        let prepared: PreparedFramedPayload;
        try {
          prepared = prepareDeflateFramedPayload(data, compressed);
        } catch {
          return prepareIdentityFallback(
            data,
            hint,
            policy,
            "error",
            { prepareStartedAt, codecMs },
            clock,
          );
        }
        return {
          ...prepared,
          wireByteLength: framedCiphertextWireByteLength(
            prepared.encodedByteLength,
            policy.ciphertextEncoding,
          ),
          ciphertextEncoding: policy.ciphertextEncoding,
          trafficClass: hint.trafficClass,
          skipReason: null,
          compressionAttempted: true,
          prepareMs: elapsedMs(prepareStartedAt, clock()),
          codecMs,
        };
      } finally {
        activeDaemonCompressionJobs -= 1;
      }
    },
  };
}

/** Returns the cross-runtime monotonic clock used by production preparation metrics. */
function defaultMonotonicClock(): number {
  return globalThis.performance.now();
}

/** Normalizes one monotonic duration to a finite non-negative metric. */
function elapsedMs(startedAt: number, endedAt: number): number {
  const duration = endedAt - startedAt;
  if (!Number.isFinite(duration) || duration < 0) return 0;
  return duration;
}
