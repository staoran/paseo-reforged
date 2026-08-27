import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";
import { createClientChannel, type Transport } from "@getpaseo/relay/e2ee";
import { exportPublicKey, generateKeyPair } from "@getpaseo/relay";
import { startRelayTransport, type RelaySocketLike } from "./relay-transport";
import { resolveConfiguredRelayTransportPolicy } from "./relay-transport-policy.js";
import { createNodeRawDeflateCodec } from "./relay-frame-compression.js";
import type { EncryptedRelaySocket } from "./websocket/encrypted-relay-socket.js";
import { RelayTransportRuntimeMetricsWindow } from "./websocket/runtime-metrics.js";

interface TestLogEntry {
  /** Pino level retained in the bounded test observer. */
  level: "debug" | "info" | "warn" | "error";
  /** Structured message literal emitted by the relay transport. */
  message: string | undefined;
}

interface TestLogger {
  /** Real pino logger passed through the production relay seam. */
  logger: pino.Logger;
  /** Parsed content-free records observed by the test. */
  messages: TestLogEntry[];
}

interface ParsedLogRecord {
  /** Numeric pino level emitted by the real logger. */
  level?: number;
  /** Structured pino message literal. */
  msg?: string;
}

/** Parses one pino record at the test-only logging boundary. */
function parseLogRecord(line: string): ParsedLogRecord {
  const value: unknown = JSON.parse(line);
  if (value === null) throw new Error("Expected a pino object record");
  if (typeof value !== "object") throw new Error("Expected a pino object record");
  if (Array.isArray(value)) throw new Error("Expected a pino object record");
  let level: number | undefined;
  if ("level" in value) {
    level = typeof value.level === "number" ? value.level : undefined;
  }
  let msg: string | undefined;
  if ("msg" in value) {
    msg = typeof value.msg === "string" ? value.msg : undefined;
  }
  return { level, msg };
}

/** Creates a real pino logger with a deterministic in-memory observation sink. */
function createMockLogger(): TestLogger {
  const messages: TestLogEntry[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      const record = parseLogRecord(chunk.toString("utf8"));
      const levelByNumber: Record<number, TestLogEntry["level"] | undefined> = {
        20: "debug",
        30: "info",
        40: "warn",
        50: "error",
      };
      const level = record.level === undefined ? undefined : levelByNumber[record.level];
      if (level !== undefined) messages.push({ level, message: record.msg });
      callback();
    },
  });
  return { logger: pino({ level: "debug" }, destination), messages };
}

/** Narrows the daemon attachment boundary to the relay-aware encrypted socket contract. */
function isEncryptedRelaySocket(socket: RelaySocketLike): socket is EncryptedRelaySocket {
  if (typeof socket.bufferedAmount !== "number") return false;
  if (typeof socket.terminate !== "function") return false;
  if (!("sendClassified" in socket)) return false;
  return typeof socket.sendClassified === "function";
}

function hasLogMessage(logger: TestLogger, level: "info" | "warn", message: string): boolean {
  return logger.messages.some((entry) => {
    const hasMatchingLevel = entry.level === level;
    const hasMatchingMessage = entry.message === message;
    return hasMatchingLevel && hasMatchingMessage;
  });
}

/** Narrows one captured binary WebSocket wire before byte-level assertions. */
function requireArrayBufferWire(wire: string | Uint8Array | ArrayBuffer | undefined): ArrayBuffer {
  if (!(wire instanceof ArrayBuffer)) throw new Error("Expected a binary relay wire");
  return wire;
}

class FakeRelayWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState = FakeRelayWebSocket.CONNECTING;
  sent: Array<string | Uint8Array | ArrayBuffer> = [];
  terminateCalls = 0;
  pingCalls = 0;
  deferSendCompletion = false;
  onSend: ((data: string | Uint8Array | ArrayBuffer) => void) | null = null;
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  private readonly pendingSendCallbacks: Array<(error?: Error) => void> = [];

  constructor(readonly url: string) {}

  on(event: string, listener: (...args: unknown[]) => void) {
    const handlers = this.listeners.get(event) ?? [];
    handlers.push(listener);
    this.listeners.set(event, handlers);
  }

  once(event: string, listener: (...args: unknown[]) => void) {
    const wrapped = (...args: unknown[]) => {
      this.off(event, wrapped);
      listener(...args);
    };
    this.on(event, wrapped);
  }

  close(code?: number, reason?: string) {
    this.readyState = FakeRelayWebSocket.CLOSED;
    this.emit("close", code ?? 1000, reason ?? "");
  }

  terminate() {
    this.terminateCalls += 1;
    this.readyState = FakeRelayWebSocket.CLOSED;
    this.emit("close", 1006, "");
  }

  send(data: string | Uint8Array | ArrayBuffer, callback?: (error?: Error) => void) {
    if (this.readyState !== FakeRelayWebSocket.OPEN) {
      throw new Error(`WebSocket not open (readyState=${this.readyState})`);
    }
    this.sent.push(data);
    this.onSend?.(data);
    if (!callback) return;
    if (this.deferSendCompletion) {
      this.pendingSendCallbacks.push(callback);
      return;
    }
    callback();
  }

  completeNextSend() {
    this.pendingSendCallbacks.shift()?.();
  }

  ping() {
    if (this.readyState !== FakeRelayWebSocket.OPEN) {
      throw new Error(`WebSocket not open (readyState=${this.readyState})`);
    }
    this.pingCalls += 1;
  }

  open() {
    this.readyState = FakeRelayWebSocket.OPEN;
    this.emit("open");
  }

  message(data: unknown, isBinary = data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    this.emit("message", data, isBinary);
  }

  pong() {
    this.emit("pong");
  }

  private off(event: string, listener: (...args: unknown[]) => void) {
    const handlers = this.listeners.get(event) ?? [];
    this.listeners.set(
      event,
      handlers.filter((handler) => handler !== listener),
    );
  }

  private emit(event: string, ...args: unknown[]) {
    const handlers = this.listeners.get(event) ?? [];
    for (const handler of handlers.slice()) {
      handler(...args);
    }
  }
}

function createFakeWebSockets() {
  const sockets: FakeRelayWebSocket[] = [];
  return {
    sockets,
    createWebSocket(url: string) {
      const socket = new FakeRelayWebSocket(url);
      sockets.push(socket);
      return socket;
    },
  };
}

describe("relay-transport control lifecycle", () => {
  const controllers: Array<{ stop: () => Promise<void> }> = [];
  let relay: ReturnType<typeof createFakeWebSockets>;

  beforeEach(() => {
    relay = createFakeWebSockets();
  });

  afterEach(async () => {
    await Promise.all(controllers.map((controller) => controller.stop()));
    controllers.length = 0;
    vi.useRealTimers();
  });

  test("logs relay_control_connected only after first valid control message", () => {
    const logger = createMockLogger();
    const controller = startRelayTransport({
      logger: logger.logger,
      attachSocket: async () => {},
      relayEndpoint: "relay.paseo.sh:443",
      relayUseTls: true,
      serverId: "srv_test",
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);

    const control = relay.sockets[0];
    expect(control).toBeDefined();

    control.open();
    expect(hasLogMessage(logger, "info", "relay_control_connected")).toBe(false);
    expect(control.pingCalls).toBeGreaterThan(0);

    control.message(JSON.stringify({ type: "sync", connectionIds: [] }));
    expect(hasLogMessage(logger, "info", "relay_control_connected")).toBe(true);
  });

  test("terminates and reconnects when control socket opens but never becomes ready", () => {
    vi.useFakeTimers();
    const logger = createMockLogger();
    const controller = startRelayTransport({
      logger: logger.logger,
      attachSocket: async () => {},
      relayEndpoint: "relay.paseo.sh:443",
      relayUseTls: true,
      serverId: "srv_test",
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);

    const firstControl = relay.sockets[0];
    firstControl.open();

    vi.advanceTimersByTime(8_000);
    expect(hasLogMessage(logger, "warn", "relay_control_ready_timeout_terminating")).toBe(true);
    expect(firstControl.terminateCalls).toBe(1);

    vi.advanceTimersByTime(1_000);
    expect(relay.sockets.length).toBeGreaterThanOrEqual(2);
  });

  test("terminates stale control sockets in under one minute", () => {
    vi.useFakeTimers();
    const logger = createMockLogger();
    const controller = startRelayTransport({
      logger: logger.logger,
      attachSocket: async () => {},
      relayEndpoint: "relay.paseo.sh:443",
      relayUseTls: true,
      serverId: "srv_test",
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);

    const control = relay.sockets[0];
    control.open();
    control.message(JSON.stringify({ type: "sync", connectionIds: [] }));
    logger.messages.length = 0;

    vi.advanceTimersByTime(40_000);
    expect(hasLogMessage(logger, "warn", "relay_control_stale_terminating")).toBe(true);
    expect(control.terminateCalls).toBe(1);
  });

  test("passes stable relay external session metadata when attaching data socket", async () => {
    const logger = createMockLogger();
    const attachedSockets: unknown[] = [];
    const attachedMetadata: unknown[] = [];
    const attachSocket = async (socket: unknown, metadata: unknown) => {
      attachedSockets.push(socket);
      attachedMetadata.push(metadata);
    };
    const controller = startRelayTransport({
      logger: logger.logger,
      attachSocket,
      relayEndpoint: "relay.paseo.sh:443",
      relayUseTls: true,
      serverId: "srv_test",
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);

    const control = relay.sockets[0];
    control.open();
    control.message(JSON.stringify({ type: "sync", connectionIds: [] }));
    control.message(JSON.stringify({ type: "connected", connectionId: "clt_test" }));

    const dataSocket = relay.sockets[1];
    expect(dataSocket).toBeDefined();
    dataSocket.open();

    await Promise.resolve();

    expect(attachedSockets).toEqual([dataSocket]);
    expect(attachedMetadata).toEqual([
      {
        transport: "relay",
        externalSessionKey: "session:clt_test",
        relayConnectionId: "clt_test",
      },
    ]);
  });

  test("locks each encrypted data socket to the policy read when its handshake starts", async () => {
    // Mutable configured policy models a hot config update without restarting control transport.
    let configuredPolicy = resolveConfiguredRelayTransportPolicy(undefined);
    // Stable daemon key reused across both independently negotiated data sockets.
    const daemonKeyPair = generateKeyPair();
    // Long-lived transport controller that must not restart during the policy update.
    const controller = startRelayTransport({
      logger: createMockLogger().logger,
      attachSocket: async () => undefined,
      relayEndpoint: "relay.paseo.sh:443",
      relayUseTls: true,
      serverId: "srv_policy_snapshot",
      daemonKeyPair,
      createWebSocket: relay.createWebSocket,
      getConfiguredTransportPolicy: () => configuredPolicy,
    });
    controllers.push(controller);

    // One control socket creates the first data connection under default auto encoding.
    const control = relay.sockets[0];
    control.open();
    control.message(JSON.stringify({ type: "sync", connectionIds: [] }), false);
    control.message(JSON.stringify({ type: "connected", connectionId: "clt_binary" }), false);
    // First physical data socket whose handshake locks the default binary selection.
    const binaryDataSocket = relay.sockets[1];
    binaryDataSocket.open();
    binaryDataSocket.message(createFramedHello(), false);
    await vi.waitFor(() => expect(binaryDataSocket.sent).toHaveLength(1));

    // Hot update affects only the subsequently created data connection's handshake snapshot.
    configuredPolicy = resolveConfiguredRelayTransportPolicy({
      ciphertextEncoding: "base64",
      compression: { enabled: false },
    });
    control.message(JSON.stringify({ type: "connected", connectionId: "clt_base64" }), false);
    // Second physical data socket whose handshake observes the updated Base64 preference.
    const base64DataSocket = relay.sockets[2];
    base64DataSocket.open();
    base64DataSocket.message(createFramedHello(), false);
    await vi.waitFor(() => expect(base64DataSocket.sent).toHaveLength(1));

    expect([binaryDataSocket.sent[0], base64DataSocket.sent[0]].map(parseReadySelection)).toEqual([
      {
        ciphertextEncoding: "binary",
        compressionAlgorithms: ["deflate-raw"],
      },
      {
        ciphertextEncoding: "base64",
        compressionAlgorithms: ["deflate-raw"],
      },
    ]);
  });

  test("encrypted sends wait for the physical data socket callback", async () => {
    const logger = createMockLogger();
    const daemonKeyPair = generateKeyPair();
    let resolveAttached: ((socket: EncryptedRelaySocket) => void) | undefined;
    const attached = new Promise<EncryptedRelaySocket>((resolve) => {
      resolveAttached = resolve;
    });
    const controller = startRelayTransport({
      logger: logger.logger,
      attachSocket: async (socket) => {
        if (!isEncryptedRelaySocket(socket)) throw new Error("Expected encrypted relay socket");
        resolveAttached?.(socket);
      },
      relayEndpoint: "relay.paseo.sh:443",
      relayUseTls: true,
      serverId: "srv_test",
      daemonKeyPair,
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);

    const control = relay.sockets[0];
    control.open();
    control.message(JSON.stringify({ type: "sync", connectionIds: [] }), false);
    control.message(JSON.stringify({ type: "connected", connectionId: "clt_test" }), false);

    const dataSocket = relay.sockets[1];
    dataSocket.deferSendCompletion = true;
    dataSocket.open();
    let clientTransport: Transport;
    clientTransport = {
      send: (data) => dataSocket.message(data, data instanceof ArrayBuffer),
      close: () => undefined,
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    dataSocket.onSend = (data) => {
      clientTransport.onmessage?.({
        data: data instanceof Uint8Array ? data.slice().buffer : data,
        isBinary: data instanceof ArrayBuffer || data instanceof Uint8Array,
      });
    };
    let resolveClientOpen: (() => void) | undefined;
    const clientOpen = new Promise<void>((resolve) => {
      resolveClientOpen = resolve;
    });
    await createClientChannel({
      transport: clientTransport,
      daemonPublicKeyB64: exportPublicKey(daemonKeyPair.publicKey),
      events: { onopen: () => resolveClientOpen?.() },
    });

    let attachedCompleted = false;
    void attached.then(() => {
      attachedCompleted = true;
      return undefined;
    });
    await clientOpen;
    await Promise.resolve();
    expect(attachedCompleted).toBe(false);
    dataSocket.completeNextSend();
    const encryptedSocket = await attached;
    let completed = false;
    // Physical writes observed before invoking the encrypted socket send.
    const sentBeforeApplication = dataSocket.sent.length;

    const sending = Promise.resolve(encryptedSocket.send(new Uint8Array([1, 2, 3]))).then(() => {
      completed = true;
      return undefined;
    });
    await vi.waitFor(() => {
      expect(dataSocket.sent).toHaveLength(sentBeforeApplication + 1);
    });
    expect(completed).toBe(false);

    dataSocket.completeNextSend();
    await sending;
    expect(completed).toBe(true);
  });

  test("keeps actual realtime sends out of the compressor while compressing state sync", async () => {
    /** Stable daemon key used by the real authenticated framed handshake. */
    const daemonKeyPair = generateKeyPair();
    /** Resolver that exposes the attached encrypted socket after exact mode confirmation. */
    let resolveAttached: ((socket: EncryptedRelaySocket) => void) | undefined;
    /** Attached socket is the public daemon send seam under test. */
    const attached = new Promise<EncryptedRelaySocket>((resolve) => {
      resolveAttached = resolve;
    });
    /** Content-free metrics recorder observed through its public snapshot. */
    const runtimeMetrics = new RelayTransportRuntimeMetricsWindow();
    /** Long-lived relay controller owning the control and data sockets. */
    const controller = startRelayTransport({
      logger: createMockLogger().logger,
      attachSocket: async (socket) => {
        if (!isEncryptedRelaySocket(socket)) throw new Error("Expected encrypted relay socket");
        resolveAttached?.(socket);
      },
      relayEndpoint: "relay.paseo.sh:443",
      relayUseTls: true,
      serverId: "srv_classified_compression",
      daemonKeyPair,
      createWebSocket: relay.createWebSocket,
      runtimeMetrics,
    });
    controllers.push(controller);

    /** Control connection that announces one client data connection. */
    const control = relay.sockets[0];
    control.open();
    control.message(JSON.stringify({ type: "sync", connectionIds: [] }), false);
    control.message(JSON.stringify({ type: "connected", connectionId: "clt_compression" }), false);

    /** Physical data socket bridged bidirectionally to a real client channel. */
    const dataSocket = relay.sockets[1];
    dataSocket.open();
    /** Client transport feeds its encrypted output back into the daemon data socket. */
    let clientTransport: Transport;
    clientTransport = {
      send: (data) => dataSocket.message(data, data instanceof ArrayBuffer),
      close: () => undefined,
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    dataSocket.onSend = (data) => {
      clientTransport.onmessage?.({
        data: data instanceof Uint8Array ? data.slice().buffer : data,
        isBinary: data instanceof ArrayBuffer || data instanceof Uint8Array,
      });
    };
    const clientChannel = await createClientChannel({
      transport: clientTransport,
      daemonPublicKeyB64: exportPublicKey(daemonKeyPair.publicKey),
      compressionAdapter: createNodeRawDeflateCodec(),
    });
    /** Relay-aware socket shape that retains sender-side traffic semantics. */
    const encryptedSocket = await attached;
    /** Client-to-daemon framed identity payload observed at the attached socket seam. */
    const inboundPayload = "client-framed-identity";
    /** Delivery signal for the daemon-side framed decoder. */
    const inboundDelivered = new Promise<string | ArrayBuffer>((resolve) => {
      encryptedSocket.on("message", (data) => {
        if (typeof data === "string" || data instanceof ArrayBuffer) resolve(data);
      });
    });
    await clientChannel.send(inboundPayload);
    await expect(inboundDelivered).resolves.toBe(inboundPayload);
    /** Large realtime payload that remains ineligible regardless of potential compression gain. */
    const realtimePayload = "realtime-payload:".repeat(512);
    /** Repeated catch-up payload whose level-1 raw DEFLATE result is unambiguously smaller. */
    const stateSyncPayload = "state-sync-payload:".repeat(512);
    /** Number of handshake wires already emitted before application traffic. */
    const sentBeforeApplication = dataSocket.sent.length;

    await encryptedSocket.sendClassified({
      data: realtimePayload,
      hint: { trafficClass: "realtime" },
    });
    await encryptedSocket.sendClassified({
      data: stateSyncPayload,
      hint: { trafficClass: "state-sync" },
    });

    expect(dataSocket.sent).toHaveLength(sentBeforeApplication + 2);
    /** Opaque realtime wire produced through framed identity. */
    const realtimeWire = dataSocket.sent.at(-2);
    /** Opaque state-sync wire produced after compression and encryption. */
    const stateSyncWire = dataSocket.sent.at(-1);
    expect(realtimeWire).toBeInstanceOf(ArrayBuffer);
    expect(stateSyncWire).toBeInstanceOf(ArrayBuffer);
    const realtimeWireBuffer = requireArrayBufferWire(realtimeWire);
    const stateSyncWireBuffer = requireArrayBufferWire(stateSyncWire);
    expect(realtimeWireBuffer.byteLength).toBe(
      new TextEncoder().encode(realtimePayload).byteLength + 48,
    );
    expect(stateSyncWireBuffer.byteLength).toBeLessThan(
      new TextEncoder().encode(stateSyncPayload).byteLength / 2,
    );
    /** Relay transport aggregates produced by the actual handshake and send path. */
    const snapshot = runtimeMetrics.snapshotAndReset();
    expect(snapshot.negotiatedModeCount["framed-v1-binary"]).toBe(1);
    expect(snapshot.effectiveCompressionCount).toEqual([
      {
        enabled: true,
        algorithm: "deflate-raw",
        reason: null,
        count: 1,
      },
    ]);
    expect(snapshot.compressionAttemptCount).toEqual({
      realtime: 0,
      "state-sync": 1,
      bulk: 0,
      "bulk-live": 0,
    });
    expect(snapshot.outboundFrames).toEqual([
      {
        ciphertextEncoding: "binary",
        trafficClass: "realtime",
        codec: "identity",
        frameCount: 1,
        originalBytes: new TextEncoder().encode(realtimePayload).byteLength,
        encodedBytes: new TextEncoder().encode(realtimePayload).byteLength,
        wireBytes: realtimeWireBuffer.byteLength,
      },
      {
        ciphertextEncoding: "binary",
        trafficClass: "state-sync",
        codec: "deflate-raw",
        frameCount: 1,
        originalBytes: new TextEncoder().encode(stateSyncPayload).byteLength,
        encodedBytes: expect.any(Number),
        wireBytes: stateSyncWireBuffer.byteLength,
      },
    ]);
    expect(snapshot.outboundFrames[1]?.encodedBytes).toBeLessThan(
      snapshot.outboundFrames[1]?.originalBytes ?? 0,
    );
    expect(snapshot.compressionSkipCount["traffic-ineligible"]).toBe(1);
    expect(snapshot.compressionPrepareMs).toEqual([
      {
        algorithm: "deflate-raw",
        p50: expect.any(Number),
        p95: expect.any(Number),
        max: expect.any(Number),
      },
    ]);
    expect(snapshot.compressionCodecMs).toHaveLength(1);
    expect(snapshot.compressionQueueMs).toEqual([
      {
        trafficClass: "realtime",
        p50: expect.any(Number),
        p95: expect.any(Number),
        max: expect.any(Number),
      },
      {
        trafficClass: "state-sync",
        p50: expect.any(Number),
        p95: expect.any(Number),
        max: expect.any(Number),
      },
    ]);
    expect(snapshot.pendingPreparedBytes).toEqual({
      p95: realtimeWireBuffer.byteLength,
      max: realtimeWireBuffer.byteLength,
    });
    expect(snapshot.inboundFrames).toEqual([
      {
        ciphertextEncoding: "binary",
        codec: "identity",
        frameCount: 1,
        originalBytes: new TextEncoder().encode(inboundPayload).byteLength,
        encodedBytes: new TextEncoder().encode(inboundPayload).byteLength,
        wireBytes: new TextEncoder().encode(inboundPayload).byteLength + 48,
      },
    ]);
    expect(snapshot.inboundDecodeMs).toEqual([
      {
        ciphertextEncoding: "binary",
        codec: "identity",
        p50: expect.any(Number),
        p95: expect.any(Number),
        max: expect.any(Number),
      },
    ]);
    expect(snapshot.pendingReceiveWireBytes).toEqual({
      p95: new TextEncoder().encode(inboundPayload).byteLength + 48,
      max: new TextEncoder().encode(inboundPayload).byteLength + 48,
    });
  });

  test("uses relayUseTls for control and data socket URLs", () => {
    const logger = createMockLogger();
    const controller = startRelayTransport({
      logger: logger.logger,
      attachSocket: async () => {},
      relayEndpoint: "[::1]:443",
      relayUseTls: true,
      serverId: "srv_test",
      createWebSocket: relay.createWebSocket,
    });
    controllers.push(controller);

    const control = relay.sockets[0];
    control.open();
    control.message(JSON.stringify({ type: "sync", connectionIds: [] }));
    control.message(JSON.stringify({ type: "connected", connectionId: "clt_test" }));

    expect(relay.sockets[0]?.url).toMatch(/^wss:\/\/\[::1\]\/ws\?/);
    expect(relay.sockets[1]?.url).toMatch(/^wss:\/\/\[::1\]\/ws\?/);
  });
});

/** Creates one valid client hello offering both framed representations and raw DEFLATE. */
function createFramedHello(): string {
  // Fresh client key used only to produce a structurally valid hello.
  const clientKeyPair = generateKeyPair();
  return JSON.stringify({
    type: "e2ee_hello",
    key: exportPublicKey(clientKeyPair.publicKey),
    capabilities: {
      binaryCiphertext: true,
      framedCiphertextV1: {
        ciphertextEncodings: ["base64", "binary"],
        compressionAlgorithms: ["deflate-raw"],
      },
    },
  });
}

/** Extracts the framed selection from one plaintext daemon ready wire. */
function parseReadySelection(wire: string | Uint8Array | ArrayBuffer): unknown {
  if (typeof wire !== "string") throw new Error("Expected a plaintext ready frame");
  const parsed: unknown = JSON.parse(wire);
  if (parsed === null) throw new Error("Expected a JSON ready frame");
  if (typeof parsed !== "object") throw new Error("Expected a JSON ready frame");
  if (Array.isArray(parsed)) throw new Error("Expected a JSON ready frame");
  const capabilities = "capabilities" in parsed ? parsed.capabilities : undefined;
  if (capabilities === null) return undefined;
  if (typeof capabilities !== "object") return undefined;
  if (Array.isArray(capabilities)) return undefined;
  return "framedCiphertextV1" in capabilities ? capabilities.framedCiphertextV1 : undefined;
}
