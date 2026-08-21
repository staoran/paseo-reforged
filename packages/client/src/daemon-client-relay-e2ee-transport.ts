import {
  createClientChannel,
  createFflateFrameCompressionAdapter,
  type EncryptedChannel,
  type EncryptedChannelInboundFrameMetric,
  type EncryptedChannelProtocolErrorReason,
  type FrameCompressionAdapter,
  type NegotiatedEncryptedTransport,
  type Transport as RelayTransport,
} from "@getpaseo/relay/e2ee";
import type {
  DaemonTransport,
  DaemonTransportFactory,
  TransportLogger,
} from "./daemon-client-transport-types.js";
import { extractRelayMessage, normalizeTransportPayload } from "./daemon-client-transport-utils.js";

type OpenHandler = () => void;
type CloseHandler = (event?: unknown) => void;
type ErrorHandler = (event?: unknown) => void;
type MessageHandler = (data: unknown, isBinary: boolean) => void;

/** Content-free metrics port implemented by the owning daemon client. */
interface RelayE2eeRuntimeMetrics {
  /** Records the authenticated connection-level transport selection. */
  recordRelayNegotiated(negotiated: NegotiatedEncryptedTransport): void;
  /** Records one successfully decoded framed payload without its content. */
  recordRelayInboundFrame(metric: EncryptedChannelInboundFrameMetric): void;
  /** Records one bounded framed protocol failure. */
  recordRelayFramedProtocolError(reason: EncryptedChannelProtocolErrorReason): void;
  /** Samples aggregate raw wire bytes retained by the receive FIFO. */
  recordRelayPendingReceiveWireBytes(bytes: number): void;
}

/** Complete input for wrapping one daemon transport with relay E2EE. */
export interface CreateEncryptedTransportOptions {
  /** Physical daemon transport carrying relay handshake and ciphertext. */
  base: DaemonTransport;
  /** Daemon public key received through pairing. */
  daemonPublicKeyB64: string;
  /** Transport logger used for bounded handshake diagnostics. */
  logger: TransportLogger;
  /** Optional content-free metrics recorder owned by the daemon client. */
  runtimeMetrics?: RelayE2eeRuntimeMetrics;
  /** Nullable decoder capability; null deliberately disables compression advertisement. */
  compressionAdapter?: FrameCompressionAdapter | null;
}

/** Stateless browser/Node decoder shared by client relay connections when validated. */
const relayCompressionAdapter = isHermesRuntime() ? null : createFflateFrameCompressionAdapter();

export function createRelayE2eeTransportFactory(args: {
  baseFactory: DaemonTransportFactory;
  daemonPublicKeyB64: string;
  logger: TransportLogger;
  runtimeMetrics?: RelayE2eeRuntimeMetrics;
}): DaemonTransportFactory {
  return ({ url, headers }) => {
    const base = args.baseFactory({ url, headers });
    return createEncryptedTransport({
      base,
      daemonPublicKeyB64: args.daemonPublicKeyB64,
      logger: args.logger,
      runtimeMetrics: args.runtimeMetrics,
    });
  };
}

/** Wraps one physical daemon transport with the negotiated relay E2EE channel. */
export function createEncryptedTransport(
  options: CreateEncryptedTransportOptions,
): DaemonTransport {
  /** Metrics recorder forwarded into the encrypted channel observer. */
  const { base, daemonPublicKeyB64, logger, runtimeMetrics } = options;
  /** Decoder advertised for this connection, including an explicit unavailable state. */
  const compressionAdapter =
    options.compressionAdapter === undefined ? relayCompressionAdapter : options.compressionAdapter;
  let channel: EncryptedChannel | null = null;
  let opened = false;
  let closed = false;

  const openHandlers = new Set<OpenHandler>();
  const closeHandlers = new Set<CloseHandler>();
  const errorHandlers = new Set<ErrorHandler>();
  const messageHandlers = new Set<MessageHandler>();

  const emitOpen = () => {
    if (opened || closed) {
      return;
    }
    opened = true;
    emitHandlers(openHandlers);
  };

  const emitClose = (event?: unknown) => {
    if (closed) {
      return;
    }
    closed = true;
    emitHandlers(closeHandlers, event);
  };

  const emitError = (event?: unknown) => {
    if (closed) {
      return;
    }
    emitHandlers(errorHandlers, event);
  };

  const emitMessage = (data: unknown) => {
    if (closed) {
      return;
    }
    emitHandlers(messageHandlers, data, data instanceof ArrayBuffer);
  };

  const relayTransport: RelayTransport = {
    send: (data) => {
      if (typeof data === "string") {
        base.send(data);
        return;
      }
      if (ArrayBuffer.isView(data)) {
        base.send(normalizeTransportPayload(data));
        return;
      }
      if (data instanceof ArrayBuffer) {
        base.send(data);
        return;
      }
      base.send(String(data));
    },
    close: (code?: number, reason?: string) => base.close(code, reason),
    onmessage: null,
    onclose: null,
    onerror: null,
  };

  const startHandshake = async () => {
    try {
      channel = await createClientChannel({
        transport: relayTransport,
        daemonPublicKeyB64,
        events: {
          onopen: emitOpen,
          onmessage: (data) => emitMessage(data),
          onclose: (code, reason) => emitClose({ code, reason }),
          onerror: (error) => emitError(error),
        },
        ...(compressionAdapter ? { compressionAdapter } : {}),
        ...(runtimeMetrics
          ? {
              runtimeObserver: {
                onNegotiatedTransport: (negotiated) =>
                  runtimeMetrics.recordRelayNegotiated(negotiated),
                onInboundFrame: (metric) => runtimeMetrics.recordRelayInboundFrame(metric),
                onFramedProtocolError: (reason) =>
                  runtimeMetrics.recordRelayFramedProtocolError(reason),
                onPendingReceiveWireBytes: (bytes) =>
                  runtimeMetrics.recordRelayPendingReceiveWireBytes(bytes),
              },
            }
          : {}),
      });
    } catch (error) {
      logger.warn({ err: normalizeTransportError(error) }, "relay_e2ee_handshake_failed");
      emitError(error);
      // Browser WebSocket.close only accepts 1000 or 3000-4999.
      // Use an app-defined code so this path works in browser and Node runtimes.
      base.close(4001, "E2EE handshake failed");
    }
  };

  base.onOpen(() => {
    void startHandshake();
  });
  base.onMessage((data, isBinary) => {
    relayTransport.onmessage?.(extractRelayMessage(data, isBinary));
  });
  base.onClose((event) => {
    const record = event as { code?: number; reason?: string } | undefined;
    relayTransport.onclose?.(record?.code ?? 0, record?.reason ?? "");
    emitClose(event);
  });
  base.onError((event) => {
    relayTransport.onerror?.(event instanceof Error ? event : new Error(String(event)));
    emitError(event);
  });

  return {
    send: (data) => {
      if (!channel) {
        throw new Error("Encrypted channel not ready");
      }
      void channel.send(normalizeTransportPayload(data)).catch((error) => {
        emitError(error);
      });
    },
    close: (code?: number, reason?: string) => {
      if (channel) {
        channel.close(code, reason);
      } else {
        base.close(code, reason);
      }
      emitClose({ code, reason });
    },
    onMessage: (handler) => {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },
    onOpen: (handler) => {
      openHandlers.add(handler);
      if (opened) {
        invokeHandler(handler);
      }
      return () => openHandlers.delete(handler);
    },
    onClose: (handler) => {
      closeHandlers.add(handler);
      if (closed) {
        invokeHandler(handler);
      }
      return () => closeHandlers.delete(handler);
    },
    onError: (handler) => {
      errorHandlers.add(handler);
      return () => errorHandlers.delete(handler);
    },
  };
}

/** Returns whether this JavaScript runtime is powered by Hermes. */
function isHermesRuntime(): boolean {
  return Reflect.get(globalThis, "HermesInternal") !== undefined;
}

function emitHandlers<TArgs extends unknown[]>(
  handlers: Set<(...args: TArgs) => void>,
  ...args: TArgs
) {
  for (const handler of handlers) {
    invokeHandler(handler, ...args);
  }
}

function invokeHandler<TArgs extends unknown[]>(handler: (...args: TArgs) => void, ...args: TArgs) {
  try {
    handler(...args);
  } catch {
    // no-op
  }
}

function normalizeTransportError(error: unknown): Record<string, string> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(typeof error.stack === "string" ? { stack: error.stack } : {}),
    };
  }
  return { message: String(error) };
}
