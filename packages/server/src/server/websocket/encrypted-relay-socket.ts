import { EventEmitter } from "node:events";
import {
  MAX_FRAMED_WIRE_BYTES,
  preparedEncryptedFrameWireByteLength,
  type NegotiatedEncryptedTransport,
  type PreparedEncryptedFrame,
  type SendPreparedEncryptedFrameOptions,
} from "@getpaseo/relay/e2ee";
// Node and emitted ESM run without a TypeScript path-alias resolver.
import { MAX_PHYSICAL_SOCKET_BUFFERED_BYTES } from "./physical-socket.js";
import type { RelayPreparedFrameMetric } from "./runtime-metrics.js";
import type { RelaySendFifoWaitSample, RelayTrafficHint } from "../relay-frame-compression.js";

/** Default classification retained for every existing WebSocket-compatible caller. */
const DEFAULT_RELAY_TRAFFIC_HINT = Object.freeze({
  trafficClass: "realtime",
} satisfies RelayTrafficHint);

export interface EncryptedRelayChannel {
  /** Marks the attached relay channel open for application traffic. */
  setState: (state: "open") => void;
  /** Sends one legacy application payload through the existing channel contract. */
  send: (data: string | ArrayBuffer) => Promise<void>;
  /** Returns the identity-frame wire upper bound for admission control. */
  outboundWireByteLength: (data: string | ArrayBuffer) => number;
  /** Returns whether this connection uses the framed prepared-frame pipeline. */
  usesFramedCiphertextV1: () => boolean;
  /** Returns the immutable legacy or framed transport negotiated by this channel. */
  getNegotiatedTransport: () => NegotiatedEncryptedTransport;
  /** Encrypts and representation-encodes one framed payload exactly once. */
  prepareOutboundFrame: (data: string | ArrayBuffer) => PreparedEncryptedFrame;
  /** Writes one final framed wire through the encrypted channel FIFO. */
  sendPreparedFrame: (options: SendPreparedEncryptedFrameOptions) => Promise<void>;
  /** Closes the encrypted channel gracefully. */
  close: (code?: number, reason?: string) => void;
}

/** Inputs for one relay-aware application send. */
export interface EncryptedRelaySendClassifiedOptions {
  /** Application payload normalized before encryption. */
  data: string | Uint8Array | ArrayBuffer;
  /** Sender-side semantic classification retained through preparation. */
  hint: RelayTrafficHint;
}

/** Inputs for one asynchronous framed payload preparation. */
export interface EncryptedRelayPrepareOutboundFrameOptions {
  /** Application payload awaiting compression and encryption. */
  data: string | ArrayBuffer;
  /** Sender-side semantic classification retained through compression policy. */
  hint: RelayTrafficHint;
}

export interface EncryptedRelaySocket {
  /** WebSocket-compatible ready state exposed to the daemon session layer. */
  readonly readyState: number;
  /** Aggregate outbound wire bytes retained by this socket and its physical transport. */
  readonly bufferedAmount: number;
  /** Sends one application payload through the negotiated encrypted transport. */
  send: (data: string | Uint8Array | ArrayBuffer) => void | Promise<void>;
  /** Sends one application payload with sender-side semantics retained for framed preparation. */
  sendClassified: (options: EncryptedRelaySendClassifiedOptions) => void | Promise<void>;
  /** Closes the encrypted channel gracefully. */
  close: (code?: number, reason?: string) => void;
  /** Terminates the underlying relay WebSocket immediately. */
  terminate: () => void;
  /** Registers one persistent WebSocket-compatible event listener. */
  on: (event: "message" | "close" | "error", listener: (...args: unknown[]) => void) => void;
  /** Registers one one-shot WebSocket-compatible event listener. */
  once: (event: "close" | "error", listener: (...args: unknown[]) => void) => void;
}

/** Content-free metrics port observed at the encrypted socket queue boundary. */
export interface EncryptedRelaySocketMetrics {
  /** Aggregates one prepared or legacy identity frame without retaining application bytes. */
  recordPreparedFrame(metric: RelayPreparedFrameMetric): void;
  /** Records time from send invocation until its ordered FIFO operation starts. */
  recordQueueMs(sample: RelaySendFifoWaitSample): void;
  /** Samples aggregate final wire bytes retained behind the send FIFO. */
  recordPendingPreparedBytes(bytes: number): void;
}

/** Wraps one encrypted channel as the WebSocket-like socket consumed by daemon sessions. */
export function createEncryptedRelaySocket(params: {
  /** Negotiated encrypted application channel. */
  channel: EncryptedRelayChannel;
  /** Event bridge shared with the relay transport attachment path. */
  emitter: EventEmitter;
  /** Reads bytes already owned by the physical WebSocket implementation. */
  getTransportBufferedAmount: () => number | undefined;
  /** Forcibly terminates the physical relay transport. */
  terminateTransport: () => void;
  /** Optional asynchronous framed preparation supplied by the daemon compression policy. */
  prepareOutboundFrame?: (
    options: EncryptedRelayPrepareOutboundFrameOptions,
  ) => PreparedEncryptedFrame | Promise<PreparedEncryptedFrame>;
  /** Optional content-free recorder for FIFO wait and reservation gauges. */
  runtimeMetrics?: EncryptedRelaySocketMetrics;
  /** Optional monotonic clock used by queue metrics and deterministic tests. */
  clock?: () => number;
}): EncryptedRelaySocket {
  const {
    channel,
    emitter,
    getTransportBufferedAmount,
    terminateTransport,
    prepareOutboundFrame,
    runtimeMetrics,
    clock = defaultMonotonicClock,
  } = params;
  let readyState = 1;
  /** Identity-frame wire bytes reserved while asynchronous preparation is incomplete. */
  let pendingPreparationBytes = 0;
  /** Final wire bytes prepared but waiting behind the send FIFO. */
  let pendingPreparedWireBytes = 0;
  /** Serial send tail preserving invocation order across asynchronous preparation. */
  let sendTail: Promise<void> = Promise.resolve();
  /** Immutable connection mode deciding whether new framed queue semantics apply. */
  const framedCiphertextV1 = channel.usesFramedCiphertextV1();

  interface SendReservation {
    /** Identity-frame wire upper bound charged before preparation completes. */
    preparingWireBytes: number;
    /** Final wire byte count charged after preparation completes. */
    wireBytes: number;
    /** Whether this reservation has already been released. */
    released: boolean;
  }
  /** Active reservations released together when the physical socket closes. */
  const reservations = new Set<SendReservation>();

  /** Samples the current prepared-wire gauge without affecting send behavior. */
  const samplePendingPreparedBytes = (): void => {
    try {
      runtimeMetrics?.recordPendingPreparedBytes(pendingPreparedWireBytes);
    } catch {
      // Metrics are observational and cannot fail application traffic.
    }
  };

  /** Releases one framed send reservation exactly once. */
  const releaseReservation = (reservation: SendReservation): void => {
    if (reservation.released) return;
    reservation.released = true;
    pendingPreparationBytes -= reservation.preparingWireBytes;
    pendingPreparedWireBytes -= reservation.wireBytes;
    if (pendingPreparationBytes < 0) pendingPreparationBytes = 0;
    if (pendingPreparedWireBytes < 0) pendingPreparedWireBytes = 0;
    if (reservation.wireBytes > 0) samplePendingPreparedBytes();
    reservations.delete(reservation);
  };

  /** Releases all framed send reservations during physical teardown. */
  const releaseAllReservations = (): void => {
    for (const reservation of reservations) releaseReservation(reservation);
  };

  channel.setState("open");

  /** Terminates the physical transport and releases every local reservation. */
  const terminate = (): void => {
    if (readyState === 3) return;
    readyState = 3;
    releaseAllReservations();
    terminateTransport();
  };

  /** Closes the encrypted channel and releases every local reservation. */
  const close = (code?: number, reason?: string): void => {
    if (readyState === 3) return;
    readyState = 3;
    releaseAllReservations();
    channel.close(code, reason);
  };

  /** Normalizes one framed send failure and closes its physical connection. */
  const failSend = (error: unknown): Error => {
    const err = error instanceof Error ? error : new Error(String(error));
    releaseAllReservations();
    if (emitter.listenerCount("error") > 0) emitter.emit("error", err);
    terminate();
    return err;
  };

  emitter.on("close", () => {
    readyState = 3;
    releaseAllReservations();
  });

  /** Public socket delegates legacy callers and classified callers into one ordered send path. */
  const socket: EncryptedRelaySocket = {
    get readyState() {
      return readyState;
    },
    get bufferedAmount() {
      return (
        (getTransportBufferedAmount() ?? 0) + pendingPreparationBytes + pendingPreparedWireBytes
      );
    },
    send: (data) => socket.sendClassified({ data, hint: DEFAULT_RELAY_TRAFFIC_HINT }),
    sendClassified: ({ data, hint }) => {
      if (readyState !== 1) {
        return Promise.reject(new Error("Encrypted relay socket is not open"));
      }
      const outbound = normalizeRelaySendPayload(data);
      if (!framedCiphertextV1) {
        const outboundBytes = channel.outboundWireByteLength(outbound);
        const queuedBytes = getTransportBufferedAmount() ?? 0;
        if (queuedBytes + outboundBytes > MAX_PHYSICAL_SOCKET_BUFFERED_BYTES) {
          terminate();
          return Promise.reject(
            new Error("Encrypted relay socket exceeded its outbound high-water mark"),
          );
        }
        try {
          /** Immutable legacy selection distinguishes Base64-only from hybrid connections. */
          const negotiated = channel.getNegotiatedTransport();
          /** Legacy hybrid sends only ArrayBuffer payloads as raw binary ciphertext. */
          const sendsBinaryCiphertext =
            negotiated.mode === "legacy" &&
            negotiated.ciphertextEncoding === "hybrid" &&
            outbound instanceof ArrayBuffer;
          /** Actual per-frame WebSocket representation used by the legacy channel. */
          const ciphertextEncoding = sendsBinaryCiphertext ? "binary" : "base64";
          /** Identity payload bytes before the fixed NaCl and representation overhead. */
          const originalByteLength = relayPayloadByteLength(outbound);
          runtimeMetrics?.recordPreparedFrame({
            ciphertextEncoding,
            trafficClass: hint.trafficClass,
            codec: "identity",
            originalByteLength,
            encodedByteLength: originalByteLength,
            wireByteLength: outboundBytes,
            skipReason: "legacy-mode",
            prepareMs: 0,
            codecMs: null,
          });
        } catch {
          // Metrics are observational and cannot fail application traffic.
        }
        return channel.send(outbound).catch((error) => {
          if (emitter.listenerCount("error") > 0) emitter.emit("error", error);
          throw error;
        });
      }
      const preparingWireBytes = channel.outboundWireByteLength(outbound);
      /** Monotonic enqueue time used only for the ordered FIFO wait metric. */
      const queuedAt = clock();
      const physicalBytes = getTransportBufferedAmount() ?? 0;
      if (
        physicalBytes + pendingPreparationBytes + pendingPreparedWireBytes + preparingWireBytes >
        MAX_PHYSICAL_SOCKET_BUFFERED_BYTES
      ) {
        terminate();
        return Promise.reject(
          new Error("Encrypted relay socket exceeded its outbound high-water mark"),
        );
      }

      const reservation: SendReservation = {
        preparingWireBytes,
        wireBytes: 0,
        released: false,
      };
      reservations.add(reservation);
      pendingPreparationBytes += preparingWireBytes;

      let prepared: PreparedEncryptedFrame | Promise<PreparedEncryptedFrame>;
      try {
        prepared = prepareOutboundFrame
          ? prepareOutboundFrame({ data: outbound, hint })
          : channel.prepareOutboundFrame(outbound);
      } catch (error) {
        return Promise.reject(failSend(error));
      }
      const preparedPromise = Promise.resolve(prepared).then((frame) => {
        if (reservation.released || readyState !== 1) {
          throw new Error("Encrypted relay socket is not open");
        }
        if (preparedEncryptedFrameWireByteLength(frame) !== frame.wireByteLength) {
          throw new Error("Prepared encrypted frame wire length mismatch");
        }
        pendingPreparationBytes -= reservation.preparingWireBytes;
        if (pendingPreparationBytes < 0) pendingPreparationBytes = 0;
        reservation.preparingWireBytes = 0;
        reservation.wireBytes = frame.wireByteLength;
        pendingPreparedWireBytes += frame.wireByteLength;
        samplePendingPreparedBytes();
        return frame;
      });
      // A later queue failure may stop awaiting this preparation; retain a rejection handler.
      void preparedPromise.catch(() => undefined);

      const sendOperation = sendTail.then(async () => {
        try {
          runtimeMetrics?.recordQueueMs({
            trafficClass: hint.trafficClass,
            durationMs: elapsedMs({ startedAt: queuedAt, endedAt: clock() }),
          });
        } catch {
          // Metrics are observational and cannot fail application traffic.
        }
        if (readyState !== 1) throw new Error("Encrypted relay socket is not open");
        const frame = await preparedPromise;
        const queuedBytes = getTransportBufferedAmount() ?? 0;
        const otherPendingBytes = pendingPreparedWireBytes - frame.wireByteLength;
        if (frame.framedCiphertextV1 && frame.wireByteLength >= MAX_FRAMED_WIRE_BYTES) {
          throw new Error("Framed ciphertext exceeds the wire byte limit");
        }
        if (
          queuedBytes + pendingPreparationBytes + otherPendingBytes + frame.wireByteLength >
          MAX_PHYSICAL_SOCKET_BUFFERED_BYTES
        ) {
          throw new Error("Encrypted relay socket exceeded its outbound high-water mark");
        }
        return channel.sendPreparedFrame({
          frame,
          onTransportWriteStart: () => {
            pendingPreparedWireBytes -= reservation.wireBytes;
            if (pendingPreparedWireBytes < 0) pendingPreparedWireBytes = 0;
            reservation.wireBytes = 0;
            // Keep the ownership handoff reentrancy-free until transport.send starts.
          },
        });
      });
      sendTail = sendOperation.catch(() => undefined);
      return sendOperation
        .catch((error) => {
          throw failSend(error);
        })
        .finally(() => releaseReservation(reservation));
    },
    close,
    terminate,
    on: (event, listener) => {
      emitter.on(event, listener);
    },
    once: (event, listener) => {
      emitter.once(event, listener);
    },
  };
  return socket;
}

function normalizeRelaySendPayload(data: string | Uint8Array | ArrayBuffer): string | ArrayBuffer {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return data;
  const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const out = new Uint8Array(view.byteLength);
  out.set(view);
  return out.buffer;
}

/** Returns the exact plaintext byte length used by legacy identity encryption. */
function relayPayloadByteLength(data: string | ArrayBuffer): number {
  return typeof data === "string" ? new TextEncoder().encode(data).byteLength : data.byteLength;
}

/** Returns the cross-runtime monotonic clock used by production queue metrics. */
function defaultMonotonicClock(): number {
  return globalThis.performance.now();
}

/** Normalizes one monotonic duration to a finite non-negative metric. */
interface ElapsedMsOptions {
  /** Monotonic operation start. */
  startedAt: number;
  /** Monotonic operation end. */
  endedAt: number;
}

function elapsedMs(options: ElapsedMsOptions): number {
  const duration = options.endedAt - options.startedAt;
  if (!Number.isFinite(duration) || duration < 0) return 0;
  return duration;
}
