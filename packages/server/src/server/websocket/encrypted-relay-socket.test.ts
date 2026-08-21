import { EventEmitter } from "node:events";
import {
  framedCiphertextWireByteLength,
  type PreparedEncryptedFrame,
  type SendPreparedEncryptedFrameOptions,
} from "@getpaseo/relay/e2ee";
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
  sendPreparedFrame(options: SendPreparedEncryptedFrameOptions): Promise<void> {
    const { frame, onTransportWriteStart } = options;
    onTransportWriteStart?.();
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

class FramedBase64Channel extends BlockingChannel {
  /** Creates a framed channel whose identity ciphertext uses Base64 representation. */
  constructor() {
    super(true);
  }

  /** Returns the deterministic Base64 wire upper bound for one identity frame. */
  override outboundWireByteLength(data: string | ArrayBuffer): number {
    const plaintextBytes =
      typeof data === "string" ? new TextEncoder().encode(data).byteLength : data.byteLength;
    return Math.ceil((plaintextBytes + 40) / 3) * 4;
  }
}

class NestedFifoChannel extends BlockingChannel {
  /** Resolves when the outer socket has queued its first prepared frame into this channel. */
  readonly firstPreparedSendQueued: Promise<void>;
  /** Shared exact-size wire used by every deterministic prepared frame. */
  private readonly wireData: ArrayBuffer;
  /** Inner FIFO barrier that keeps the physical transport write from starting. */
  private readonly transportBarrier: Promise<void>;
  /** Releases the inner FIFO barrier during deterministic cleanup. */
  private releaseTransportBarrier: () => void = () => undefined;
  /** Marks the first prepared send as queued behind the inner FIFO. */
  private markFirstPreparedSendQueued: () => void = () => undefined;

  /** Creates a framed channel with a controllable second transport FIFO. */
  constructor(wireByteLength: number) {
    super(true);
    this.wireData = new ArrayBuffer(wireByteLength);
    this.firstPreparedSendQueued = new Promise((resolve) => {
      this.markFirstPreparedSendQueued = resolve;
    });
    this.transportBarrier = new Promise((resolve) => {
      this.releaseTransportBarrier = resolve;
    });
  }

  /** Reuses one exact-size frame so the test exercises byte accounting without extra copies. */
  override prepareOutboundFrame(): PreparedEncryptedFrame {
    return {
      wireData: this.wireData,
      wireByteLength: this.wireData.byteLength,
      framedCiphertextV1: true,
    };
  }

  /** Returns the production framed-binary identity wire length used for admission. */
  override outboundWireByteLength(data: string | ArrayBuffer): number {
    const encodedByteLength =
      typeof data === "string" ? new TextEncoder().encode(data).byteLength : data.byteLength;
    return framedCiphertextWireByteLength(encodedByteLength, "binary");
  }

  /** Queues a prepared frame behind the same nested FIFO used by the real encrypted channel. */
  override async sendPreparedFrame(options: SendPreparedEncryptedFrameOptions): Promise<void> {
    const { frame, onTransportWriteStart } = options;
    this.markFirstPreparedSendQueued();
    await this.transportBarrier;
    onTransportWriteStart?.();
    await super.sendPreparedFrame({ frame });
  }

  /** Releases the nested FIFO and makes all deterministic physical sends complete. */
  releaseTransport(): void {
    this.drain();
    this.releaseTransportBarrier();
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

test("framed Base64 send rejects when encoded wire bytes exceed the outbound high-water mark", async () => {
  /** Framed Base64 channel exposes a wire estimate larger than its plaintext input. */
  const channel = new FramedBase64Channel();
  /** Preparation count proves admission happens before compression and encryption work. */
  let preparationCount = 0;
  /** Physical termination count exposes fail-closed high-water handling. */
  let terminations = 0;
  /** Five plaintext bytes become a 60-byte Base64 wire with the test channel overhead. */
  const payload = new Uint8Array([1, 2, 3, 4, 5]);
  const socket = createEncryptedRelaySocket({
    channel,
    emitter: new EventEmitter(),
    getTransportBufferedAmount: () => MAX_PHYSICAL_SOCKET_BUFFERED_BYTES - 59,
    terminateTransport: () => {
      terminations += 1;
    },
    prepareOutboundFrame: () => {
      preparationCount += 1;
      return new Promise<PreparedEncryptedFrame>(() => undefined);
    },
  });

  const rejected = Promise.resolve(socket.send(payload));

  expect({ preparationCount, terminations }).toEqual({ preparationCount: 0, terminations: 1 });
  await expect(rejected).rejects.toThrow("outbound high-water mark");
});

test("framed bufferedAmount includes wire bytes reserved during asynchronous preparation", async () => {
  /** Framed Base64 channel reserves 60 wire bytes for the five-byte payload. */
  const channel = new FramedBase64Channel();
  /** Unresolved preparation keeps the reservation observable at the socket boundary. */
  const pendingPreparation = new Promise<PreparedEncryptedFrame>(() => undefined);
  const socket = createEncryptedRelaySocket({
    channel,
    emitter: new EventEmitter(),
    getTransportBufferedAmount: () => 7,
    terminateTransport: () => undefined,
    prepareOutboundFrame: () => pendingPreparation,
  });

  const sending = Promise.resolve(socket.send(new Uint8Array([1, 2, 3, 4, 5])));

  expect(socket.bufferedAmount).toBe(67);
  socket.terminate();
  await expect(sending).rejects.toThrow("not open");
});

test("rejects a third large frame while the first prepared frame waits in the channel FIFO", async () => {
  /** Each exact framed wire is below 32 MiB, while three together exceed 64 MiB. */
  const frameWireBytes = 22 * 1024 * 1024;
  /** Identity payload whose encrypted framed binary wire matches the channel's exact test wire. */
  const payload = new Uint8Array(frameWireBytes - framedCiphertextWireByteLength(0, "binary"));
  /** Nested FIFO exposes the handoff gap before its physical transport write begins. */
  const channel = new NestedFifoChannel(frameWireBytes);
  /** Physical termination count exposes fail-closed aggregate admission. */
  let terminations = 0;
  /** Socket under test owns the outer preparation/send FIFO and all wire reservations. */
  const socket = createEncryptedRelaySocket({
    channel,
    emitter: new EventEmitter(),
    getTransportBufferedAmount: () => 0,
    terminateTransport: () => {
      terminations += 1;
    },
  });

  /** First two sends fit exactly within the aggregate admission budget. */
  const firstSend = Promise.resolve(socket.send(payload));
  const secondSend = Promise.resolve(socket.send(payload));
  await channel.firstPreparedSendQueued;
  /** Third send must include both the prepared handoff and the queued second reservation. */
  const thirdSend = Promise.resolve(socket.send(payload));
  /** Settled third-send result observed without releasing the inner transport barrier. */
  let thirdErrorMessage: string | null = null;
  void thirdSend.catch((error: unknown) => {
    thirdErrorMessage = error instanceof Error ? error.message : String(error);
  });
  await Promise.resolve();
  await Promise.resolve();
  const observed = {
    thirdErrorMessage,
    terminations,
    readyState: socket.readyState,
  };

  channel.releaseTransport();
  await Promise.allSettled([firstSend, secondSend, thirdSend]);

  expect(observed).toEqual({
    thirdErrorMessage: "Encrypted relay socket exceeded its outbound high-water mark",
    terminations: 1,
    readyState: 3,
  });
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
