import { EventEmitter } from "node:events";
import type { PreparedEncryptedFrame } from "@getpaseo/relay/e2ee";
import { expect, test } from "vitest";
import { MAX_PHYSICAL_SOCKET_BUFFERED_BYTES } from "./physical-socket.js";
import {
  createEncryptedRelaySocket,
  type EncryptedRelayChannel,
} from "./encrypted-relay-socket.js";
import type { RelayTrafficHint } from "../relay-frame-compression.js";

class BlockingChannel implements EncryptedRelayChannel {
  /** Final transport writes observed through the public channel seam. */
  readonly sent: Array<string | ArrayBuffer> = [];
  /** Graceful channel closes observed through the public channel seam. */
  readonly closes: Array<{ code?: number; reason?: string }> = [];
  /** Whether this channel exercises the framed prepared-frame pipeline. */
  private readonly framedCiphertextV1: boolean;
  /** Optional physical send failure used by the legacy compatibility case. */
  private readonly sendError: Error | null;
  /** Resolver for the currently blocked physical send. */
  private resolveSend: (() => void) | null = null;
  /** Whether subsequent physical sends should complete immediately. */
  private drained = false;

  /** Creates a controllable channel in either legacy or framed mode. */
  constructor(framedCiphertextV1 = false, sendError: Error | null = null) {
    this.framedCiphertextV1 = framedCiphertextV1;
    this.sendError = sendError;
  }

  /** Accepts the adapter's transition to application-open state. */
  setState(state: "open"): void {
    expect(state).toBe("open");
  }

  /** Records one physical write and blocks until drained unless configured to reject. */
  send(data: string | ArrayBuffer): Promise<void> {
    this.sent.push(data);
    if (this.sendError) return Promise.reject(this.sendError);
    return new Promise((resolve) => {
      this.resolveSend = resolve;
      if (this.drained) resolve();
    });
  }

  /** Builds one deterministic prepared frame for adapter-level tests. */
  prepareOutboundFrame(data: string | ArrayBuffer): PreparedEncryptedFrame {
    const wireByteLength =
      typeof data === "string"
        ? new TextEncoder().encode(data).byteLength + 40
        : data.byteLength + 40;
    return {
      wireData: new ArrayBuffer(wireByteLength),
      wireByteLength,
      framedCiphertextV1: this.framedCiphertextV1,
    };
  }

  /** Writes one prepared frame through the same controllable transport. */
  sendPreparedFrame(frame: PreparedEncryptedFrame): Promise<void> {
    return this.send(frame.wireData);
  }

  /** Records one graceful channel close. */
  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
  }

  /** Returns the legacy encrypted wire estimate. */
  outboundWireByteLength(data: string | ArrayBuffer): number {
    const plaintextBytes =
      typeof data === "string" ? new TextEncoder().encode(data).byteLength : data.byteLength;
    return plaintextBytes + 40;
  }

  /** Returns the immutable negotiated ciphertext mode. */
  usesFramedCiphertextV1(): boolean {
    return this.framedCiphertextV1;
  }

  /** Releases the currently blocked physical send and all subsequent sends. */
  drain(): void {
    this.drained = true;
    this.resolveSend?.();
  }
}

test("negotiated binary ciphertext accepts the exact hard bound and rejects one byte over", async () => {
  const channel = new BlockingChannel();
  let terminations = 0;
  let transportBufferedAmount = 0;
  const socket = createEncryptedRelaySocket({
    channel,
    emitter: new EventEmitter(),
    getTransportBufferedAmount: () => transportBufferedAmount,
    terminateTransport: () => {
      terminations += 1;
    },
  });

  socket.send(new Uint8Array(MAX_PHYSICAL_SOCKET_BUFFERED_BYTES - 40));
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(channel.sent).toHaveLength(1);
  transportBufferedAmount = MAX_PHYSICAL_SOCKET_BUFFERED_BYTES;
  expect(socket.bufferedAmount).toBe(MAX_PHYSICAL_SOCKET_BUFFERED_BYTES);

  const rejected = socket.send(new Uint8Array(1));
  await expect(rejected).rejects.toThrow("outbound high-water mark");

  expect(channel.sent).toHaveLength(1);
  expect(terminations).toBe(1);
  expect(channel.closes).toEqual([]);
  expect(socket.readyState).toBe(3);

  channel.drain();
  await Promise.resolve();
});

test("underlying relay backpressure rejects binary before encryption and terminates physically", async () => {
  const channel = new BlockingChannel();
  let terminations = 0;
  const socket = createEncryptedRelaySocket({
    channel,
    emitter: new EventEmitter(),
    getTransportBufferedAmount: () => MAX_PHYSICAL_SOCKET_BUFFERED_BYTES - 1,
    terminateTransport: () => {
      terminations += 1;
    },
  });

  const rejected = socket.send(new Uint8Array(1));
  await expect(rejected).rejects.toThrow("outbound high-water mark");

  expect(channel.sent).toEqual([]);
  expect(channel.closes).toEqual([]);
  expect(terminations).toBe(1);
});

test("explicit encrypted-socket termination forcibly terminates the relay transport", () => {
  const channel = new BlockingChannel();
  let terminations = 0;
  const socket = createEncryptedRelaySocket({
    channel,
    emitter: new EventEmitter(),
    getTransportBufferedAmount: () => 0,
    terminateTransport: () => {
      terminations += 1;
    },
  });

  socket.terminate();

  expect(terminations).toBe(1);
  expect(channel.closes).toEqual([]);
  expect(socket.readyState).toBe(3);
});

test("encrypted sends report physical completion through the returned promise", async () => {
  const channel = new BlockingChannel();
  const socket = createEncryptedRelaySocket({
    channel,
    emitter: new EventEmitter(),
    getTransportBufferedAmount: () => 0,
    terminateTransport: () => undefined,
  });
  let completed = false;

  const sending = socket.send(new Uint8Array([1]));
  if (!sending) throw new Error("Expected an awaitable encrypted send");
  void sending.then(() => (completed = true));
  await Promise.resolve();
  expect(completed).toBe(false);

  channel.drain();
  await sending;
  expect(completed).toBe(true);
  expect(socket.bufferedAmount).toBe(0);
});

test("encrypted sockets do not double-count bytes already buffered by the transport", () => {
  const channel = new BlockingChannel();
  let transportBufferedAmount = 0;
  const socket = createEncryptedRelaySocket({
    channel,
    emitter: new EventEmitter(),
    getTransportBufferedAmount: () => transportBufferedAmount,
    terminateTransport: () => undefined,
  });
  const payload = new Uint8Array(3 * 1024 * 1024);

  void socket.send(payload);
  transportBufferedAmount = payload.byteLength + 40;

  expect(socket.bufferedAmount).toBe(payload.byteLength + 40);
});

test("legacy channel send rejection leaves the attached relay socket open", async () => {
  // Stable failure identity proves the adapter rethrows the channel result unchanged.
  const sendError = new Error("legacy transport failed");
  // Legacy mode must retain its pre-framed connection lifecycle behavior.
  const channel = new BlockingChannel(false, sendError);
  // Public event bridge records the existing legacy error notification.
  const emitter = new EventEmitter();
  // Errors observed by the attached relay-session boundary.
  const emittedErrors: unknown[] = [];
  // Physical terminations requested by the encrypted socket adapter.
  let terminations = 0;
  emitter.on("error", (error) => emittedErrors.push(error));
  // Adapter under test remains attached after the legacy transport rejection.
  const socket = createEncryptedRelaySocket({
    channel,
    emitter,
    getTransportBufferedAmount: () => 0,
    terminateTransport: () => {
      terminations += 1;
    },
  });

  await expect(Promise.resolve(socket.send(new Uint8Array([1])))).rejects.toBe(sendError);

  expect({ readyState: socket.readyState, terminations }).toEqual({
    readyState: 1,
    terminations: 0,
  });
  expect(channel.closes).toEqual([]);
  expect(emittedErrors).toEqual([sendError]);
});

test("final send capacity includes frames that are still being prepared", async () => {
  // Blocking channel makes an unexpected physical write externally observable.
  const channel = new BlockingChannel(true);
  // Mutable physical queue grows after both application sends reserve their input.
  let transportBufferedAmount = 0;
  // Number of asynchronous preparation requests observed at the public adapter seam.
  let preparationCount = 0;
  // Unreleased second preparation retains its original application-byte reservation.
  const secondPreparation = new Promise<PreparedEncryptedFrame>(() => undefined);
  // Physical termination count caused by the final aggregate high-water check.
  let terminations = 0;
  const socket = createEncryptedRelaySocket({
    channel,
    emitter: new EventEmitter(),
    getTransportBufferedAmount: () => transportBufferedAmount,
    terminateTransport: () => {
      terminations += 1;
    },
    prepareOutboundFrame: () => {
      preparationCount += 1;
      if (preparationCount === 2) return secondPreparation;
      return {
        wireData: new ArrayBuffer(20 * 1024 * 1024),
        wireByteLength: 20 * 1024 * 1024,
        framedCiphertextV1: true,
      };
    },
  });
  // Two input reservations initially fit below the 64 MiB physical high-water mark.
  const firstInput = new Uint8Array(20 * 1024 * 1024);
  const secondInput = new Uint8Array(20 * 1024 * 1024);

  const firstSend = Promise.resolve(socket.send(firstInput));
  const secondSend = Promise.resolve(socket.send(secondInput));
  // External physical pressure makes aggregate retained bytes exceed 64 MiB.
  transportBufferedAmount = 25 * 1024 * 1024;
  channel.drain();

  await expect(firstSend).rejects.toThrow("outbound high-water mark");
  await expect(secondSend).rejects.toThrow("not open");
  expect({ physicalWrites: channel.sent.length, terminations }).toEqual({
    physicalWrites: 0,
    terminations: 1,
  });
});

test("asynchronous preparation cannot reorder physical encrypted writes", async () => {
  // Channel records final physical write order at the encrypted transport seam.
  const channel = new BlockingChannel(true);
  // Per-call preparation resolvers let the later frame finish first.
  const preparationResolvers: Array<(frame: PreparedEncryptedFrame) => void> = [];
  // Socket uses asynchronous preparation while retaining one connection FIFO.
  const socket = createEncryptedRelaySocket({
    channel,
    emitter: new EventEmitter(),
    getTransportBufferedAmount: () => 0,
    terminateTransport: () => undefined,
    prepareOutboundFrame: () =>
      new Promise<PreparedEncryptedFrame>((resolve) => {
        preparationResolvers.push(resolve);
      }),
  });

  const firstSend = Promise.resolve(socket.send(new Uint8Array([1])));
  const secondSend = Promise.resolve(socket.send(new Uint8Array([2])));
  preparationResolvers[1]?.({
    wireData: new Uint8Array([22]).buffer,
    wireByteLength: 1,
    framedCiphertextV1: true,
  });
  await Promise.resolve();
  expect(channel.sent).toEqual([]);

  preparationResolvers[0]?.({
    wireData: new Uint8Array([11]).buffer,
    wireByteLength: 1,
    framedCiphertextV1: true,
  });
  channel.drain();
  await Promise.all([firstSend, secondSend]);

  expect(channel.sent.map((wire) => Array.from(new Uint8Array(wire as ArrayBuffer)))).toEqual([
    [11],
    [22],
  ]);
});

test("classified relay sends preserve explicit hints while ordinary sends default to realtime", async () => {
  /** Framed channel records the final writes after both classified preparations. */
  const channel = new BlockingChannel(true);
  /** Traffic hints observed at the asynchronous framed preparation boundary. */
  const observedHints: RelayTrafficHint[] = [];
  /** Socket under test exposes the WebSocket-compatible and classified send seams together. */
  const socket = createEncryptedRelaySocket({
    channel,
    emitter: new EventEmitter(),
    getTransportBufferedAmount: () => 0,
    terminateTransport: () => undefined,
    prepareOutboundFrame: (...args) => {
      observedHints.push(args[1] as RelayTrafficHint);
      return channel.prepareOutboundFrame(args[0]);
    },
  });
  /** Public shape expected by relay-aware daemon senders. */
  const classifiedSocket = socket as typeof socket & {
    sendClassified: (
      data: string | Uint8Array | ArrayBuffer,
      hint: RelayTrafficHint,
    ) => void | Promise<void>;
  };

  channel.drain();
  await Promise.all([
    classifiedSocket.sendClassified("catch-up", { trafficClass: "state-sync" }),
    socket.send("live"),
  ]);

  expect(observedHints).toEqual([{ trafficClass: "state-sync" }, { trafficClass: "realtime" }]);
});

test("rejects a prepared framed wire at the exclusive 32 MiB limit", async () => {
  // Channel must never observe a frame rejected by the final wire-size gate.
  const channel = new BlockingChannel(true);
  // Physical termination records fail-closed behavior for an invalid prepared frame.
  let terminations = 0;
  const socket = createEncryptedRelaySocket({
    channel,
    emitter: new EventEmitter(),
    getTransportBufferedAmount: () => 0,
    terminateTransport: () => {
      terminations += 1;
    },
    prepareOutboundFrame: () => ({
      wireData: new ArrayBuffer(32 * 1024 * 1024),
      wireByteLength: 32 * 1024 * 1024,
      framedCiphertextV1: true,
    }),
  });

  await expect(Promise.resolve(socket.send(new Uint8Array([1])))).rejects.toThrow(
    "wire byte limit",
  );
  expect({
    physicalWrites: channel.sent.length,
    terminations,
    readyState: socket.readyState,
  }).toEqual({ physicalWrites: 0, terminations: 1, readyState: 3 });
});

test("rejects prepared encrypted metadata that understates actual wire bytes", async () => {
  // Channel must never receive a prepared frame with inconsistent exact-length metadata.
  const channel = new BlockingChannel(true);
  // Physical termination proves fail-closed behavior before a transport write.
  let terminations = 0;
  const socket = createEncryptedRelaySocket({
    channel,
    emitter: new EventEmitter(),
    getTransportBufferedAmount: () => 0,
    terminateTransport: () => {
      terminations += 1;
    },
    prepareOutboundFrame: () => ({
      wireData: new ArrayBuffer(2),
      wireByteLength: 1,
      framedCiphertextV1: true,
    }),
  });

  await expect(Promise.resolve(socket.send(new Uint8Array([1])))).rejects.toThrow(
    "wire length mismatch",
  );
  expect({ physicalWrites: channel.sent.length, terminations }).toEqual({
    physicalWrites: 0,
    terminations: 1,
  });
});
