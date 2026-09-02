/// <reference lib="dom" />
import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import type pino from "pino";
import {
  createDaemonChannel,
  type Transport as RelayTransport,
  type KeyPair,
  type PreparedEncryptedFrame,
} from "@getpaseo/relay/e2ee";
import { buildRelayWebSocketUrl } from "@getpaseo/protocol/daemon-endpoints";
// Node and emitted ESM run without a TypeScript path-alias resolver.
import type { ExternalSocketMetadata } from "./websocket-server.js";
import {
  createDaemonFrameCompression,
  createNodeRawDeflateCodec,
  type DaemonFrameCompression,
} from "./relay-frame-compression.js";
import {
  RELAY_TRANSPORT_COMPRESSION_ALGORITHM,
  resolveConfiguredRelayTransportPolicy,
  resolveRelayTransportPolicy,
  type ConfiguredRelayTransportPolicy,
} from "./relay-transport-policy.js";
import {
  createEncryptedRelaySocket,
  type EncryptedRelayPrepareOutboundFrameOptions,
} from "./websocket/encrypted-relay-socket.js";
import type { RelayTransportRuntimeMetricsWindow } from "./websocket/runtime-metrics.js";

export interface RelayTransportOptions {
  logger: pino.Logger;
  attachSocket: (ws: RelaySocketLike, metadata?: ExternalSocketMetadata) => Promise<void>;
  relayEndpoint: string; // "host:port"
  relayUseTls: boolean;
  serverId: string;
  daemonKeyPair?: KeyPair;
  createWebSocket?: RelayWebSocketFactory;
  /** Reads the latest configured policy when a data connection needs it. */
  getConfiguredTransportPolicy?: () => ConfiguredRelayTransportPolicy;
  /** Optional content-free runtime metrics recorder owned by WebSocket diagnostics. */
  runtimeMetrics?: RelayTransportRuntimeMetricsWindow;
  /** Isolated protocol-validation overrides unavailable through production config. */
  validation?: RelayTransportValidationOptions;
}

/** Explicit daemon relay overrides reserved for isolated protocol validation. */
export interface RelayTransportValidationOptions {
  /** Enables framed-v1 despite the closed production release gate. */
  enableFramedCiphertextV1?: boolean;
}

export interface RelayTransportController {
  stop: () => Promise<void>;
}

/** Dependencies fixed while attaching one encrypted relay data socket. */
interface AttachEncryptedSocketOptions {
  /** Physical relay WebSocket carrying opaque encrypted frames. */
  socket: RelayWebSocketLike;
  /** Daemon identity used to derive the data-channel shared key. */
  daemonKeyPair: KeyPair;
  /** Connection-scoped logger with the relay connection id. */
  logger: pino.Logger;
  /** Attaches the decrypted WebSocket-compatible adapter to the daemon. */
  attachSocket: (ws: RelaySocketLike, metadata?: ExternalSocketMetadata) => Promise<void>;
  /** Reads the current configured relay transport policy. */
  getConfiguredTransportPolicy: () => ConfiguredRelayTransportPolicy;
  /** Shared process compression coordinator, absent when framing is unavailable. */
  frameCompression: DaemonFrameCompression | null;
  /** Optional content-free metrics recorder. */
  runtimeMetrics?: RelayTransportRuntimeMetricsWindow;
  /** Isolated protocol-validation overrides unavailable through production config. */
  validation?: RelayTransportValidationOptions;
  /** Optional external-session metadata forwarded to the daemon attachment. */
  metadata?: ExternalSocketMetadata;
}

export interface RelaySocketLike {
  readyState: number;
  bufferedAmount?: number;
  send: (data: string | Uint8Array | ArrayBuffer, callback?: (error?: Error) => void) => void;
  close: (code?: number, reason?: string) => void;
  terminate?: () => void;
  on: (event: "message" | "close" | "error", listener: (...args: unknown[]) => void) => void;
  once: (event: "close" | "error", listener: (...args: unknown[]) => void) => void;
}

interface RelayWebSocketLike extends RelaySocketLike {
  terminate: () => void;
  ping: () => void;
  on: (
    event: "open" | "message" | "close" | "error" | "pong",
    listener: (...args: unknown[]) => void,
  ) => void;
}

type RelayWebSocketFactory = (url: string) => RelayWebSocketLike;

type ControlMessage =
  | { type: "sync"; connectionIds: string[] }
  | { type: "connected"; connectionId: string }
  | { type: "disconnected"; connectionId: string }
  | { type: "ping" }
  | { type: "pong" };

const CONTROL_PING_INTERVAL_MS = 10_000;
const CONTROL_STALE_TIMEOUT_MS = 30_000;
const CONTROL_READY_TIMEOUT_MS = 8_000;
const RELAY_WEBSOCKET_OPTIONS = { handshakeTimeout: 10_000, perMessageDeflate: false } as const;
/** Release gate held closed until hosted relay near-limit framing passes. */
const ENABLE_PRODUCTION_FRAMED_CIPHERTEXT_V1 = false;

function createDefaultRelayWebSocket(url: string): RelayWebSocketLike {
  return new WebSocket(url, RELAY_WEBSOCKET_OPTIONS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function tryParseControlMessage(raw: unknown): ControlMessage | null {
  try {
    let text: string;
    if (typeof raw === "string") {
      text = raw;
    } else if (Buffer.isBuffer(raw)) {
      text = raw.toString("utf8");
    } else {
      text = String(raw);
    }
    const parsed = JSON.parse(text);
    if (!isRecord(parsed)) return null;
    if (parsed.type === "ping") return { type: "ping" };
    if (parsed.type === "pong") return { type: "pong" };
    if (parsed.type === "sync" && Array.isArray(parsed.connectionIds)) {
      const connectionIds = parsed.connectionIds.filter(
        (id: unknown) => typeof id === "string" && id.trim().length > 0,
      );
      return { type: "sync", connectionIds };
    }
    if (
      parsed.type === "connected" &&
      typeof parsed.connectionId === "string" &&
      parsed.connectionId.trim()
    ) {
      return { type: "connected", connectionId: parsed.connectionId.trim() };
    }
    if (
      parsed.type === "disconnected" &&
      typeof parsed.connectionId === "string" &&
      parsed.connectionId.trim()
    ) {
      return { type: "disconnected", connectionId: parsed.connectionId.trim() };
    }
    return null;
  } catch {
    return null;
  }
}

export function startRelayTransport({
  logger,
  attachSocket,
  relayEndpoint,
  relayUseTls,
  serverId,
  daemonKeyPair,
  createWebSocket = createDefaultRelayWebSocket,
  getConfiguredTransportPolicy = () => resolveConfiguredRelayTransportPolicy(undefined),
  runtimeMetrics,
  validation,
}: RelayTransportOptions): RelayTransportController {
  const relayLogger = logger.child({ module: "relay-transport" });
  /** Shared daemon codec coordinator used by every framed data connection. */
  const frameCompression = daemonKeyPair
    ? createDaemonFrameCompression({ codec: createNodeRawDeflateCodec() })
    : null;
  /** Initial configured gauge published without retaining relay identifiers. */
  runtimeMetrics?.setConfiguredPolicy(getConfiguredTransportPolicy());

  let stopped = false;
  let controlWs: RelayWebSocketLike | null = null;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  const dataSockets = new Map<string, RelayWebSocketLike>(); // connectionId -> ws
  let controlKeepaliveInterval: ReturnType<typeof setInterval> | null = null;
  let controlReadyTimeout: ReturnType<typeof setTimeout> | null = null;
  let controlLastSeenAt = 0;
  let controlConnectionSeq = 0;

  const stop = async (): Promise<void> => {
    stopped = true;
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (controlKeepaliveInterval) {
      clearInterval(controlKeepaliveInterval);
      controlKeepaliveInterval = null;
    }
    if (controlReadyTimeout) {
      clearTimeout(controlReadyTimeout);
      controlReadyTimeout = null;
    }
    if (controlWs) {
      try {
        controlWs.close();
      } catch {
        // ignore
      }
      controlWs = null;
    }
    for (const ws of dataSockets.values()) {
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
    dataSockets.clear();
  };

  const connectControl = (): void => {
    if (stopped) return;

    const connectionId = ++controlConnectionSeq;
    const url = buildRelayWebSocketUrl({
      endpoint: relayEndpoint,
      useTls: relayUseTls,
      serverId,
      role: "server",
    });
    const socket = createWebSocket(url);
    controlWs = socket;
    let controlConnected = false;

    const markControlReady = () => {
      if (controlWs !== socket) return;
      if (controlConnected) return;
      controlConnected = true;
      reconnectAttempt = 0;
      if (controlReadyTimeout) {
        clearTimeout(controlReadyTimeout);
        controlReadyTimeout = null;
      }
      relayLogger.info({ connectionId }, "relay_control_connected");
    };

    socket.on("open", () => {
      if (controlWs !== socket) return;

      controlLastSeenAt = Date.now();
      if (controlKeepaliveInterval) {
        clearInterval(controlKeepaliveInterval);
        controlKeepaliveInterval = null;
      }
      if (controlReadyTimeout) {
        clearTimeout(controlReadyTimeout);
        controlReadyTimeout = null;
      }
      controlReadyTimeout = setTimeout(() => {
        if (stopped) return;
        if (controlWs !== socket) return;
        if (controlConnected) return;
        relayLogger.warn(
          { url, connectionId, waitedMs: CONTROL_READY_TIMEOUT_MS },
          "relay_control_ready_timeout_terminating",
        );
        try {
          socket.terminate();
        } catch {
          // ignore
        }
      }, CONTROL_READY_TIMEOUT_MS);
      controlKeepaliveInterval = setInterval(() => {
        if (stopped) return;
        if (controlWs !== socket) return;
        if (socket.readyState !== WebSocket.OPEN) return;

        const now = Date.now();
        const staleForMs = now - controlLastSeenAt;
        // If the control socket is half-open or silently dropped, ws may never emit "close".
        // Use a WebSocket protocol ping to detect staleness and force a reconnect.
        // Cloudflare's runtime auto-responds to protocol pings at the edge without waking the
        // hibernated relay Durable Object, so this keepalive does not incur DO CPU billing.
        if (staleForMs > CONTROL_STALE_TIMEOUT_MS) {
          relayLogger.warn(
            { url, staleForMs, connectionId, staleTimeoutMs: CONTROL_STALE_TIMEOUT_MS },
            "relay_control_stale_terminating",
          );
          try {
            socket.terminate();
          } catch {
            // ignore
          }
          return;
        }

        try {
          socket.ping();
        } catch (error) {
          relayLogger.warn({ err: error, connectionId }, "relay_control_ping_send_failed");
          try {
            socket.terminate();
          } catch {
            // ignore
          }
        }
      }, CONTROL_PING_INTERVAL_MS);
      try {
        socket.ping();
      } catch (error) {
        relayLogger.warn({ err: error, connectionId }, "relay_control_ping_send_failed");
        try {
          socket.terminate();
        } catch {
          // ignore
        }
      }
      relayLogger.debug({ connectionId }, "relay_control_open_waiting_for_ready");
    });

    socket.on("close", (code, reason) => {
      if (controlWs !== socket) return;
      relayLogger.warn(
        { code, reason: reason?.toString?.(), url, connectionId },
        "relay_control_disconnected",
      );
      controlWs = null;
      if (controlKeepaliveInterval) {
        clearInterval(controlKeepaliveInterval);
        controlKeepaliveInterval = null;
      }
      if (controlReadyTimeout) {
        clearTimeout(controlReadyTimeout);
        controlReadyTimeout = null;
      }
      scheduleReconnect();
    });

    socket.on("error", (err) => {
      if (controlWs !== socket) return;
      relayLogger.warn({ err, connectionId }, "relay_error");
      // close event will schedule reconnect
    });

    socket.on("pong", () => {
      if (controlWs !== socket) return;
      controlLastSeenAt = Date.now();
      relayLogger.debug({ connectionId }, "relay_control_pong_received");
    });

    socket.on("message", (data) => {
      if (controlWs !== socket) return;
      controlLastSeenAt = Date.now();
      const msg = tryParseControlMessage(data);
      if (msg) {
        markControlReady();
      }
      if (!msg) return;
      if (msg.type === "ping") {
        try {
          socket.send(JSON.stringify({ type: "pong", ts: Date.now() }));
        } catch {
          // ignore
        }
        return;
      }
      if (msg.type === "pong") return;
      if (msg.type === "sync") {
        for (const clientConnectionId of msg.connectionIds) {
          ensureClientDataSocket(clientConnectionId);
        }
        return;
      }
      if (msg.type === "connected") {
        ensureClientDataSocket(msg.connectionId);
        return;
      }
      if (msg.type === "disconnected") {
        const existing = dataSockets.get(msg.connectionId);
        if (existing) {
          try {
            existing.close(1001, "Client disconnected");
          } catch {
            // ignore
          }
          dataSockets.delete(msg.connectionId);
        }
      }
    });
  };

  const scheduleReconnect = (): void => {
    if (stopped) return;
    if (reconnectTimeout) return;

    reconnectAttempt += 1;
    const delayMs = Math.min(30000, 1000 * reconnectAttempt);
    reconnectTimeout = setTimeout(() => {
      reconnectTimeout = null;
      connectControl();
    }, delayMs);
  };

  const ensureClientDataSocket = (connectionId: string): void => {
    if (stopped) return;
    if (!connectionId) return;
    if (dataSockets.has(connectionId)) return;

    const url = buildRelayWebSocketUrl({
      endpoint: relayEndpoint,
      useTls: relayUseTls,
      serverId,
      role: "server",
      connectionId,
    });
    const socket = createWebSocket(url);
    dataSockets.set(connectionId, socket);

    let attached = false;
    const openTimeout = setTimeout(() => {
      if (stopped) return;
      if (socket.readyState === WebSocket.OPEN) return;
      relayLogger.warn({ connectionId }, "relay_data_open_timeout_terminating");
      try {
        socket.terminate();
      } catch {
        // ignore
      }
    }, 15_000);

    socket.on("open", () => {
      clearTimeout(openTimeout);
      relayLogger.info({ connectionId }, "relay_data_connected");
      if (attached) return;
      attached = true;
      const externalMetadata: ExternalSocketMetadata = {
        transport: "relay",
        externalSessionKey: `session:${connectionId}`,
        relayConnectionId: connectionId,
      };
      if (daemonKeyPair) {
        void attachEncryptedSocket({
          socket,
          daemonKeyPair,
          logger: relayLogger.child({ connectionId }),
          attachSocket,
          getConfiguredTransportPolicy,
          frameCompression,
          runtimeMetrics,
          validation,
          metadata: externalMetadata,
        });
      } else {
        void attachSocket(socket, externalMetadata);
      }
    });

    socket.on("close", (code, reason) => {
      clearTimeout(openTimeout);
      relayLogger.warn(
        { code, reason: reason?.toString?.(), url, connectionId },
        "relay_data_disconnected",
      );
      if (dataSockets.get(connectionId) === socket) {
        dataSockets.delete(connectionId);
      }
    });

    socket.on("error", (err) => {
      relayLogger.warn({ err, connectionId }, "relay_data_error");
    });
  };

  connectControl();

  return { stop };
}

/** Negotiates E2EE and attaches one relay data socket to the daemon session layer. */
async function attachEncryptedSocket(options: AttachEncryptedSocketOptions): Promise<void> {
  const {
    socket,
    daemonKeyPair,
    logger,
    attachSocket,
    getConfiguredTransportPolicy,
    frameCompression,
    runtimeMetrics,
    validation,
    metadata,
  } = options;
  try {
    /** WebSocket adapter used by the encrypted channel. */
    const relayTransport = createRelayTransportAdapter(socket, logger);
    /** Event bridge exposed to the daemon session attachment. */
    const emitter = new EventEmitter();
    /** Decrypted messages retained until the daemon session is attached. */
    const pendingMessages: Array<string | ArrayBuffer> = [];
    /** Whether decrypted messages can now be emitted directly. */
    let attached = false;
    /** Delivers or retains one decrypted application message in arrival order. */
    const emitMessage = (data: string | ArrayBuffer) => {
      if (attached) {
        emitter.emit("message", data);
        return;
      }
      pendingMessages.push(data);
    };
    // Encoding preference is captured once before the handshake and never changes in place.
    const configuredAtConnectionStart = getConfiguredTransportPolicy();
    /** Encrypted channel whose negotiated representation is immutable after confirmation. */
    const channel = await createDaemonChannel({
      transport: relayTransport,
      daemonKeyPair,
      enableFramedCiphertextV1:
        ENABLE_PRODUCTION_FRAMED_CIPHERTEXT_V1 || validation?.enableFramedCiphertextV1 === true,
      events: {
        onmessage: emitMessage,
        onclose: (code, reason) => emitter.emit("close", code, reason),
        onerror: (error) => {
          logger.warn({ err: error }, "relay_e2ee_error");
          emitter.emit("error", error);
        },
      },
      ciphertextEncoding: configuredAtConnectionStart.ciphertextEncoding,
      compressionAlgorithms: [RELAY_TRANSPORT_COMPRESSION_ALGORITHM],
      ...(runtimeMetrics
        ? {
            runtimeObserver: {
              onInboundFrame: (metric) => runtimeMetrics.recordInboundFrame(metric),
              onFramedProtocolError: (reason) => runtimeMetrics.recordFramedProtocolError(reason),
              onPendingReceiveWireBytes: (bytes) =>
                runtimeMetrics.recordPendingReceiveWireBytes(bytes),
            },
          }
        : {}),
    });
    /** Idempotent active-connection cleanup retained until physical close. */
    const closeMetricsConnection = runtimeMetrics?.recordConnectionOpened(
      channel.getNegotiatedTransport(),
    );
    if (closeMetricsConnection) socket.once("close", closeMetricsConnection);
    /** Optional socket metrics port precomputed before the socket options are assembled. */
    const encryptedSocketMetricsOptions = runtimeMetrics ? { runtimeMetrics } : {};
    /** Socket preparation hook populated only for a framed connection with a codec coordinator. */
    const encryptedSocketPreparationOptions: {
      prepareOutboundFrame?: (
        options: EncryptedRelayPrepareOutboundFrameOptions,
      ) => Promise<PreparedEncryptedFrame>;
    } = {};
    /** Compression coordinator available only while this connection uses authenticated framing. */
    const compressionForConnection = channel.usesFramedCiphertextV1() ? frameCompression : null;
    if (compressionForConnection) {
      encryptedSocketPreparationOptions.prepareOutboundFrame = async ({ data, hint }) => {
        // Compression setting is re-read only when a new frame begins preparation.
        const negotiated = channel.getNegotiatedTransport();
        /** Configured snapshot fixed when this frame begins preparation. */
        const configuredForFrame = getConfiguredTransportPolicy();
        /** Per-frame policy combining current compression config with locked negotiation. */
        const effective = resolveRelayTransportPolicy({
          configured: configuredForFrame,
          negotiated,
        });
        runtimeMetrics?.setConfiguredPolicy(configuredForFrame);
        if (effective.mode !== "framed-v1" || negotiated.mode !== "framed-v1") {
          throw new Error("Framed preparation requires a framed relay connection");
        }
        /** Authenticated payload prepared once before channel encryption and representation. */
        const prepared = await compressionForConnection.prepare({
          data,
          hint,
          policy: {
            compressionEnabled: configuredForFrame.compressionEnabled,
            negotiatedCompressionAlgorithms: negotiated.compressionAlgorithms,
            ciphertextEncoding: negotiated.ciphertextEncoding,
          },
        });
        if (prepared.compressionAttempted) {
          runtimeMetrics?.recordCompressionAttempt(hint.trafficClass);
        }
        runtimeMetrics?.recordPreparedFrame({
          ciphertextEncoding: prepared.ciphertextEncoding,
          trafficClass: prepared.trafficClass,
          codec: prepared.codec,
          originalByteLength: prepared.originalByteLength,
          encodedByteLength: prepared.encodedByteLength,
          wireByteLength: prepared.wireByteLength,
          skipReason: prepared.skipReason,
          prepareMs: prepared.prepareMs,
          codecMs: prepared.codecMs,
        });
        return channel.prepareOutboundFrame(prepared);
      };
    }
    /** WebSocket-compatible encrypted adapter attached to the daemon session. */
    const encryptedSocket = createEncryptedRelaySocket({
      channel,
      emitter,
      getTransportBufferedAmount: () => socket.bufferedAmount,
      terminateTransport: () => socket.terminate(),
      ...encryptedSocketMetricsOptions,
      ...encryptedSocketPreparationOptions,
    });
    await attachSocket(encryptedSocket, metadata);
    attached = true;
    for (const message of pendingMessages) {
      emitter.emit("message", message);
    }
    pendingMessages.length = 0;
  } catch (error) {
    logger.warn({ err: error }, "relay_e2ee_handshake_failed");
    try {
      socket.close(1011, "E2EE handshake failed");
    } catch {
      // ignore
    }
  }
}

function createRelayTransportAdapter(
  socket: RelayWebSocketLike,
  logger: pino.Logger,
): RelayTransport {
  const relayTransport: RelayTransport = {
    send: (data) =>
      new Promise<void>((resolve, reject) => {
        try {
          socket.send(data, (error) => {
            if (!error) {
              resolve();
              return;
            }
            logger.warn({ err: error }, "relay_socket_send_failed");
            reject(error);
          });
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          logger.warn({ err }, "relay_socket_send_failed");
          reject(err);
        }
      }),
    close: (code?: number, reason?: string) => socket.close(code, reason),
    onmessage: null,
    onclose: null,
    onerror: null,
  };

  socket.on("message", (data, isBinary) => {
    const binary = isBinary === true;
    relayTransport.onmessage?.({ data: normalizeMessageData(data, binary), isBinary: binary });
  });
  socket.on("close", (code, reason) => {
    const closeCode = typeof code === "number" ? code : 1006;
    relayTransport.onclose?.(closeCode, String(reason ?? ""));
  });
  socket.on("error", (err) => {
    relayTransport.onerror?.(err instanceof Error ? err : new Error(String(err)));
  });

  return relayTransport;
}

function normalizeMessageData(data: unknown, isBinary: boolean): string | ArrayBuffer {
  if (!isBinary) {
    if (typeof data === "string") return data;
    const buffer = bufferFromWsData(data);
    if (buffer) return buffer.toString("utf8");
    return String(data);
  }

  if (data instanceof ArrayBuffer) return data;

  const buffer = bufferFromWsData(data);
  if (buffer) {
    const view = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const out = new Uint8Array(view.byteLength);
    out.set(view);
    return out.buffer;
  }

  return String(data);
}

function bufferFromWsData(data: unknown): Buffer | null {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) {
    const buffers: Buffer[] = [];
    for (const part of data) {
      if (Buffer.isBuffer(part)) {
        buffers.push(part);
      } else if (part instanceof ArrayBuffer) {
        buffers.push(Buffer.from(part));
      } else if (ArrayBuffer.isView(part)) {
        buffers.push(Buffer.from(part.buffer, part.byteOffset, part.byteLength));
      } else if (typeof part === "string") {
        buffers.push(Buffer.from(part, "utf8"));
      } else {
        return null;
      }
    }
    return Buffer.concat(buffers);
  }
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}
