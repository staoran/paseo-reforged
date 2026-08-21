/// <reference lib="dom" />
/**
 * Encrypted channel that wraps a WebSocket-like transport.
 *
 * Handles ECDH handshake and encrypts/decrypts all messages.
 * Works identically for daemon and client sides.
 */

import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  deriveSharedKey,
  encrypt,
  decrypt,
  type KeyPair,
  type SharedKey,
} from "./crypto.js";
import { arrayBufferToBase64, base64ToArrayBuffer } from "./base64.js";
import {
  decodeFramedCiphertextWire,
  decodeFramedPayload,
  framedCiphertextWireByteLength,
  MAX_FRAMED_WIRE_BYTES,
  prepareIdentityFramedPayload,
  type DecodedFramedPayload,
  type FrameCompressionAdapter,
  type FramedCiphertextCodec,
  type InflateRawFrameOptions,
  type PreparedFramedPayload,
} from "./framed-ciphertext.js";

export interface Transport {
  send(data: string | ArrayBuffer): void | Promise<void>;
  close(code?: number, reason?: string): void;
  onmessage: ((message: TransportMessage) => void) | null;
  onclose: ((code: number, reason: string) => void) | null;
  onerror: ((error: Error) => void) | null;
}

export interface TransportMessage {
  data: string | ArrayBuffer;
  isBinary: boolean;
}

export interface EncryptedChannelEvents {
  onopen?: () => void;
  onmessage?: (data: string | ArrayBuffer) => void;
  onclose?: (code: number, reason: string) => void;
  onerror?: (error: Error) => void;
}

type ChannelState = "connecting" | "handshaking" | "confirming" | "opening" | "open" | "closed";

/** Inputs for deciding whether one prepared application frame may reach the transport. */
interface ApplicationFrameWritePermissionOptions {
  /** Current encrypted channel lifecycle state. */
  state: ChannelState;
  /** Whether the handshake FIFO may write while the channel is opening. */
  allowOpening: boolean;
}

/** Returns whether one prepared application frame may write in the current lifecycle state. */
function canWriteApplicationFrame({
  state,
  allowOpening,
}: ApplicationFrameWritePermissionOptions): boolean {
  if (state === "open") return true;
  if (!allowOpening) return false;
  return state === "opening";
}

/** WebSocket ciphertext representation used by framed-v1 connections. */
export type CiphertextEncoding = "base64" | "binary";

/** Daemon-side preference used to select a connection-level ciphertext representation. */
export type ConfiguredCiphertextEncoding = "auto" | CiphertextEncoding;

/** Optional daemon-side wire policy supplied when a data connection is created. */
export interface DaemonChannelOptions {
  /** Selects framed binary, framed Base64, or legacy fallback behavior. */
  ciphertextEncoding?: ConfiguredCiphertextEncoding;
  /** Compression codecs implemented by the daemon runtime for this data connection. */
  compressionAlgorithms?: readonly string[];
  /** Optional content-free observer for negotiated and inbound framed metrics. */
  runtimeObserver?: EncryptedChannelRuntimeObserver;
}

/** Immutable encrypted transport result exposed after one connection handshakes. */
export type NegotiatedEncryptedTransport =
  | {
      /** Legacy encrypted transport without authenticated framing. */
      readonly mode: "legacy";
      /** Legacy Base64-only or binary-payload hybrid representation. */
      readonly ciphertextEncoding: "base64" | "hybrid";
      /** Legacy transport never negotiates framed compression codecs. */
      readonly compressionAlgorithms: readonly string[];
    }
  | {
      /** Authenticated framed ciphertext transport. */
      readonly mode: "framed-v1";
      /** WebSocket representation locked by exact confirmation. */
      readonly ciphertextEncoding: CiphertextEncoding;
      /** Ordered framed compression codecs shared by both peers. */
      readonly compressionAlgorithms: readonly string[];
    };

/** Optional client runtime capabilities supplied when a data connection is created. */
export interface ClientChannelOptions {
  /** Enables safe decoding and advertisement of framed raw DEFLATE payloads. */
  compressionAdapter?: FrameCompressionAdapter;
  /** Optional content-free observer for negotiated and inbound framed metrics. */
  runtimeObserver?: EncryptedChannelRuntimeObserver;
}

/** Complete input for creating one client-side encrypted channel. */
export interface CreateClientChannelOptions extends ClientChannelOptions {
  /** Physical transport carrying handshake and encrypted application frames. */
  transport: Transport;
  /** Daemon public key received through the pairing boundary. */
  daemonPublicKeyB64: string;
  /** Optional application callbacks for the channel lifecycle. */
  events?: EncryptedChannelEvents;
}

/** Complete input for creating one daemon-side encrypted channel. */
export interface CreateDaemonChannelOptions extends DaemonChannelOptions {
  /** Physical relay transport carrying handshake and encrypted application frames. */
  transport: Transport;
  /** Daemon identity used to derive the shared key. */
  daemonKeyPair: KeyPair;
  /** Optional application callbacks for the channel lifecycle. */
  events?: EncryptedChannelEvents;
}

/** Content-free metadata emitted after one framed application payload is decoded. */
export interface EncryptedChannelInboundFrameMetric {
  /** Connection-locked ciphertext representation. */
  ciphertextEncoding: CiphertextEncoding;
  /** Authenticated payload codec. */
  codec: FramedCiphertextCodec;
  /** Authenticated original application byte count. */
  originalByteLength: number;
  /** Encoded payload byte count inside the authenticated envelope. */
  encodedByteLength: number;
  /** Raw WebSocket application bytes received before any decoding. */
  wireByteLength: number;
  /** Full framed receive wall time through representation decode, decrypt, and payload decode. */
  decodeMs: number;
}

/** Optional runtime observer whose failures never affect encrypted traffic. */
export interface EncryptedChannelRuntimeObserver {
  /** Reports the immutable result after authenticated mode confirmation. */
  onNegotiatedTransport?(negotiated: NegotiatedEncryptedTransport): void;
  /** Reports one successfully decoded framed payload without its content. */
  onInboundFrame?(metric: EncryptedChannelInboundFrameMetric): void;
  /** Reports one bounded framed protocol failure without remote error text. */
  onFramedProtocolError?(reason: EncryptedChannelProtocolErrorReason): void;
  /** Samples aggregate raw WebSocket bytes retained by the receive FIFO. */
  onPendingReceiveWireBytes?(bytes: number): void;
}

/** Bounded framed receive failure stages exposed to runtime metrics. */
export type EncryptedChannelProtocolErrorReason =
  | "invalid-wire"
  | "decrypt-failed"
  | "invalid-envelope"
  | "decode-failed"
  | "receive-high-water";

/** Fully encrypted and representation-encoded application frame ready for one transport write. */
export interface PreparedEncryptedFrame {
  /** Exact text or binary value passed unchanged to the transport. */
  readonly wireData: string | ArrayBuffer;
  /** Exact number of bytes occupied by the WebSocket application payload. */
  readonly wireByteLength: number;
  /** Whether the frame uses the authenticated framed-v1 contract. */
  readonly framedCiphertextV1: boolean;
}

/** Inputs for writing one prepared frame through the encrypted channel FIFO. */
export interface SendPreparedEncryptedFrameOptions {
  /** Fully encrypted and representation-encoded frame to write. */
  frame: PreparedEncryptedFrame;
  /** Transfers external byte ownership immediately before the physical write starts. */
  onTransportWriteStart?: () => void;
}

interface WritePreparedEncryptedFrameOptions extends SendPreparedEncryptedFrameOptions {
  /** Allows the authenticated opening flush to use the same channel FIFO. */
  allowOpening: boolean;
}

/** Inputs for resolving the immutable daemon framed selection. */
interface ResolveDaemonFramedSelectionOptions {
  /** Structurally valid client offer, or null for legacy negotiation. */
  offer: FramedCiphertextV1Offer | null;
  /** Daemon representation preference fixed for this connection. */
  configuredEncoding: ConfiguredCiphertextEncoding;
  /** Compression codecs implemented by the daemon runtime. */
  supportedCompressionAlgorithms: readonly string[];
}

/** Inputs for serializing one exact daemon ready frame. */
interface BuildDaemonReadyTextOptions {
  /** Whether the legacy binary capability remains advertised. */
  binaryCiphertext: boolean;
  /** Framed selection echoed for exact authenticated confirmation. */
  selection: FramedCiphertextV1Selection | null;
}

/** Inputs for invoking one content-free observer callback in isolation. */
interface NotifyRuntimeObserverOptions {
  /** Optional observer configured for this encrypted channel. */
  observer?: EncryptedChannelRuntimeObserver;
  /** Type-safe observer invocation whose errors cannot affect protocol behavior. */
  notify: (observer: EncryptedChannelRuntimeObserver) => void;
}

/** Input for closing a daemon handshake after a protocol or transport failure. */
interface FailHandshakeOptions {
  /** Failure that should be exposed to the factory promise and close reason. */
  error: unknown;
  /** WebSocket close code used for the physical handshake transport. */
  closeCode?: number;
}

/** Input for closing an attached encrypted channel after a receive failure. */
interface FailReceiveOptions {
  /** Failure that should close the channel. */
  error: unknown;
  /** WebSocket close code used for the physical transport. */
  closeCode?: number;
}

/** Returns the actual WebSocket application bytes carried by one prepared encrypted frame. */
export function preparedEncryptedFrameWireByteLength(frame: PreparedEncryptedFrame): number {
  return utf8ByteLength(frame.wireData);
}

interface EncryptedChannelOptions {
  /**
   * If set, the channel can validate repeated plaintext `{type:"e2ee_hello"}`
   * messages even after it is open.
   *
   * This is useful for robustness when the client retries the handshake
   * (e.g., it didn't observe the daemon's `{type:"e2ee_ready"}` yet). In that case,
   * the daemon should re-send `{type:"e2ee_ready"}` without changing keys.
   */
  daemonKeyPair?: KeyPair;
  /** Enables the legacy binary-ciphertext representation for binary payloads. */
  binaryCiphertext?: boolean;
  /** Locks the authenticated framed-v1 selection for this connection. */
  framedCiphertextV1?: FramedCiphertextV1Selection;
  /** Exact plaintext ready frame to replay for this daemon connection. */
  daemonReadyText?: string;
  /** Compression algorithms included in this client's immutable hello offer. */
  offeredCompressionAlgorithms?: readonly string[];
  /** Runtime decoder for framed payloads selected on this connection. */
  compressionAdapter?: FrameCompressionAdapter;
  /** Shared raw-wire budget retained while daemon factory ownership is handed off. */
  receiveWireBudget?: ReceiveWireBudget;
  /** Reserves ready-adjacent client traffic until the offered framed mode is accepted or declined. */
  framedCiphertextV1Offered?: boolean;
  /** Optional content-free runtime observer supplied by the host adapter. */
  runtimeObserver?: EncryptedChannelRuntimeObserver;
}

interface FramedCiphertextV1Offer {
  /** WebSocket ciphertext representations supported in framed-v1 mode. */
  ciphertextEncodings: readonly CiphertextEncoding[];
  /** Compression codecs this runtime can decode. */
  compressionAlgorithms: readonly string[];
}

interface FramedCiphertextV1Selection {
  /** WebSocket ciphertext representation selected for this connection. */
  ciphertextEncoding: CiphertextEncoding;
  /** Ordered compression codecs shared by both peers. */
  compressionAlgorithms: readonly string[];
}

interface E2EEHelloMessage {
  type: "e2ee_hello";
  key: string;
  capabilities?: E2EECapabilities;
}

interface E2EEReadyMessage {
  type: "e2ee_ready";
  capabilities?: E2EECapabilities;
}

interface E2EECapabilities {
  /** Legacy capability for sending binary payload ciphertext as binary frames. */
  binaryCiphertext?: boolean;
  /** Optional framed-v1 offer or selection, validated at its use site. */
  framedCiphertextV1?: unknown;
}

interface E2EEModeConfirmMessage {
  /** Transport-reserved confirmation message type. */
  type: "e2ee_mode_confirm";
  /** Authenticated wire mode selected by the daemon. */
  mode: "framed-ciphertext-v1";
  /** Authenticated ciphertext representation selected by the daemon. */
  ciphertextEncoding: CiphertextEncoding;
  /** Authenticated ordered compression codec intersection. */
  compressionAlgorithms: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isE2EECapabilities(value: unknown): value is E2EECapabilities {
  return (
    value === undefined ||
    (isRecord(value) &&
      (value.binaryCiphertext === undefined || typeof value.binaryCiphertext === "boolean"))
  );
}

function isE2EEHelloMessage(value: unknown): value is E2EEHelloMessage {
  return (
    isRecord(value) &&
    value.type === "e2ee_hello" &&
    typeof value.key === "string" &&
    value.key.trim().length > 0 &&
    isE2EECapabilities(value.capabilities)
  );
}

function isE2EEReadyMessage(value: unknown): value is E2EEReadyMessage {
  return isRecord(value) && value.type === "e2ee_ready" && isE2EECapabilities(value.capabilities);
}

/** Returns whether decrypted application text is reserved mode-confirm traffic. */
function isReservedModeConfirmText(value: string): boolean {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) && parsed.type === "e2ee_mode_confirm";
  } catch {
    return false;
  }
}

function supportsBinaryCiphertext(message: E2EEHelloMessage | E2EEReadyMessage): boolean {
  return message.capabilities?.binaryCiphertext === true;
}

/** Returns whether a capability token names a supported framed wire representation. */
function isCiphertextEncoding(value: unknown): value is CiphertextEncoding {
  return value === "base64" || value === "binary";
}

/** Returns whether an untrusted framed capability array stays within token bounds. */
function isBoundedFramedCapabilityTokenArray(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length > MAX_FRAMED_CAPABILITY_TOKENS) return false;
  return value.every(
    (token) => typeof token === "string" && token.length <= MAX_FRAMED_CAPABILITY_TOKEN_LENGTH,
  );
}

/** Reads a valid framed-v1 selection limited to capabilities offered by this client. */
function parseFramedCiphertextV1Selection(
  message: E2EEReadyMessage,
  offeredCompressionAlgorithms: readonly string[],
): FramedCiphertextV1Selection | null {
  // Untrusted framed selection carried by the plaintext ready message.
  const value = message.capabilities?.framedCiphertextV1;
  if (value === undefined) return null;
  if (!isRecord(value) || !isCiphertextEncoding(value.ciphertextEncoding)) {
    throw new Error("Invalid framed-v1 selection");
  }
  if (!SUPPORTED_FRAMED_CIPHERTEXT_ENCODINGS.includes(value.ciphertextEncoding)) {
    throw new Error("Framed-v1 selection uses an unoffered ciphertext encoding");
  }
  if (!isBoundedFramedCapabilityTokenArray(value.compressionAlgorithms)) {
    throw new Error("Invalid framed-v1 compression selection");
  }
  if (
    !value.compressionAlgorithms.every((algorithm) =>
      offeredCompressionAlgorithms.includes(algorithm),
    )
  ) {
    throw new Error("Framed-v1 selection uses an unoffered compression algorithm");
  }

  return {
    ciphertextEncoding: value.ciphertextEncoding,
    compressionAlgorithms: [...value.compressionAlgorithms],
  };
}

/** Reads a structurally valid framed-v1 client offer and ignores additive string tokens. */
function parseFramedCiphertextV1Offer(message: E2EEHelloMessage): FramedCiphertextV1Offer | null {
  // Untrusted capability value supplied by a remote client.
  const value = message.capabilities?.framedCiphertextV1;
  if (!isRecord(value)) return null;
  if (!isBoundedFramedCapabilityTokenArray(value.ciphertextEncodings)) return null;
  if (!isBoundedFramedCapabilityTokenArray(value.compressionAlgorithms)) return null;

  return {
    ciphertextEncodings: value.ciphertextEncodings.filter(isCiphertextEncoding),
    compressionAlgorithms: [...value.compressionAlgorithms],
  };
}

/** Resolves the immutable framed-v1 selection for one daemon connection. */
function resolveDaemonFramedSelection(
  options: ResolveDaemonFramedSelectionOptions,
): FramedCiphertextV1Selection | null {
  const { offer, configuredEncoding, supportedCompressionAlgorithms } = options;
  // COMPAT(framedCiphertextV1): introduced in v0.4.0-beta.4; remove legacy fallback after 2027-08-18.
  if (!offer) return null;

  // Local preference is independent of the order supplied by an untrusted peer.
  const preferredEncodings: readonly CiphertextEncoding[] =
    configuredEncoding === "auto" ? ["binary", "base64"] : [configuredEncoding];
  const ciphertextEncoding = preferredEncodings.find((encoding) =>
    offer.ciphertextEncodings.includes(encoding),
  );
  if (!ciphertextEncoding) return null;

  return {
    ciphertextEncoding,
    compressionAlgorithms: supportedCompressionAlgorithms.filter((algorithm) =>
      offer.compressionAlgorithms.includes(algorithm),
    ),
  };
}

/** Serializes the exact ready frame saved for initial send and same-key replay. */
function buildDaemonReadyText(options: BuildDaemonReadyTextOptions): string {
  const { binaryCiphertext, selection } = options;
  // Capability object is omitted entirely for the legacy Base64 fallback.
  const capabilities: E2EECapabilities | undefined =
    binaryCiphertext || selection
      ? {
          ...(binaryCiphertext ? { binaryCiphertext: true } : {}),
          ...(selection
            ? {
                framedCiphertextV1: {
                  ciphertextEncoding: selection.ciphertextEncoding,
                  compressionAlgorithms: [...selection.compressionAlgorithms],
                },
              }
            : {}),
        }
      : undefined;
  return JSON.stringify({
    type: "e2ee_ready",
    ...(capabilities ? { capabilities } : {}),
  } satisfies E2EEReadyMessage);
}

/** Returns whether an authenticated confirm exactly echoes the saved selection fields. */
function isExactModeConfirm(
  value: unknown,
  selection: FramedCiphertextV1Selection,
): value is E2EEModeConfirmMessage {
  if (!isRecord(value)) return false;
  if (value.type !== "e2ee_mode_confirm" || value.mode !== "framed-ciphertext-v1") return false;
  if (value.ciphertextEncoding !== selection.ciphertextEncoding) return false;
  if (!Array.isArray(value.compressionAlgorithms)) return false;
  if (!value.compressionAlgorithms.every((algorithm) => typeof algorithm === "string")) {
    return false;
  }
  return (
    value.compressionAlgorithms.length === selection.compressionAlgorithms.length &&
    value.compressionAlgorithms.every(
      (algorithm, index) => algorithm === selection.compressionAlgorithms[index],
    )
  );
}

function buildInvalidHelloError(rawText: string, parsed?: unknown): Error {
  const parsedRecord = isRecord(parsed) ? parsed : null;
  const rawType = parsedRecord?.type;
  function describeType(value: unknown): string {
    if (typeof value === "string") return value;
    if (value === undefined) return "undefined";
    return typeof value;
  }
  const receivedType = describeType(rawType);
  const hasKey = typeof parsedRecord?.key === "string" && parsedRecord.key.trim().length > 0;
  const compact = rawText.replace(/\s+/g, " ").trim();
  const preview = compact.length > 160 ? `${compact.slice(0, 157)}...` : compact;
  return new Error(
    `Invalid hello message (receivedType=${receivedType}, hasKey=${hasKey}, preview=${JSON.stringify(preview)})`,
  );
}

const HANDSHAKE_RETRY_MS = 1000;
const MAX_PENDING_SENDS = 200;
const REHANDSHAKE_KEY_MISMATCH_CLOSE_CODE = 1008;
const ENCRYPTED_PAYLOAD_OVERHEAD_BYTES = 40;
/** Aggregate raw inbound WebSocket bytes retained by one encrypted channel. */
export const MAX_PENDING_RECEIVE_WIRE_BYTES = 64 * 1024 * 1024;
/** Framed ciphertext representations implemented by this relay package. */
const SUPPORTED_FRAMED_CIPHERTEXT_ENCODINGS: readonly CiphertextEncoding[] = ["base64", "binary"];
/** Compression decoders implemented by this relay package in the identity-only slice. */
const SUPPORTED_FRAMED_COMPRESSION_ALGORITHMS: readonly string[] = [];
/** Framed compression codec enabled when a client runtime provides its decoder. */
const CLIENT_FRAMED_COMPRESSION_ALGORITHMS: readonly string[] = ["deflate-raw"];
/** Maximum additive tokens accepted in each untrusted framed capability array. */
const MAX_FRAMED_CAPABILITY_TOKENS = 16;
/** Maximum UTF-16 code units accepted in one untrusted framed capability token. */
const MAX_FRAMED_CAPABILITY_TOKEN_LENGTH = 64;

export function base64EncryptedWireByteLength(plaintextBytes: number): number {
  return 4 * Math.ceil((plaintextBytes + ENCRYPTED_PAYLOAD_OVERHEAD_BYTES) / 3);
}

export function maxBase64EncryptedPlaintextByteLength(wireBytes: number): number {
  return Math.floor(wireBytes / 4) * 3 - ENCRYPTED_PAYLOAD_OVERHEAD_BYTES;
}
const REHANDSHAKE_KEY_MISMATCH_CLOSE_REASON = "E2EE re-handshake key mismatch";

interface TimeoutWithUnref {
  unref(): void;
}

/** Idempotent reservation held until one inbound transport item finishes processing. */
interface ReceiveWireReservation {
  /** Raw WebSocket byte count charged to this item. */
  bytes: number;
  /** Prevents close cleanup and FIFO completion from releasing twice. */
  released: boolean;
}

/** Mutable byte counter shared only across one connection's receive ownership handoff. */
interface ReceiveWireBudget {
  /** Active and queued raw WebSocket bytes retained by factory and channel. */
  pendingBytes: number;
}

function hasUnref(timeout: unknown): timeout is TimeoutWithUnref {
  return (
    typeof timeout === "object" &&
    timeout !== null &&
    "unref" in timeout &&
    typeof (timeout as Record<string, unknown>).unref === "function"
  );
}

/**
 * Creates an encrypted channel as the initiator (client).
 *
 * The client:
 * 1. Receives daemon's public key via QR code
 * 2. Generates own keypair
 * 3. Sends e2ee_hello with own public key
 * 4. Derives shared key and starts encrypted communication
 */
export function createClientChannel(options: CreateClientChannelOptions): Promise<EncryptedChannel>;
// COMPAT(relayChannelObjectOptions): positional API predates v0.4.0-beta.5; remove after 2027-08-21.
export function createClientChannel(
  transport: Transport,
  daemonPublicKeyB64: string,
  events?: EncryptedChannelEvents,
  options?: ClientChannelOptions,
): Promise<EncryptedChannel>;
export async function createClientChannel(
  ...args:
    | [options: CreateClientChannelOptions]
    | [
        transport: Transport,
        daemonPublicKeyB64: string,
        events?: EncryptedChannelEvents,
        options?: ClientChannelOptions,
      ]
): Promise<EncryptedChannel> {
  /** Canonical object input normalized from the temporary positional compatibility overload. */
  let input: CreateClientChannelOptions;
  if (args.length === 1) {
    input = args[0];
  } else {
    const [transport, daemonPublicKeyB64, events = {}, options = {}] = args;
    input = { transport, daemonPublicKeyB64, events, ...options };
  }
  const { transport, daemonPublicKeyB64, events = {}, ...options } = input;
  const keyPair = generateKeyPair();
  const daemonPublicKey = importPublicKey(daemonPublicKeyB64);
  const sharedKey = deriveSharedKey(keyPair.secretKey, daemonPublicKey);
  // Decoder-backed codecs offered for this immutable client connection.
  const compressionAlgorithms = options.compressionAdapter
    ? CLIENT_FRAMED_COMPRESSION_ALGORITHMS
    : [];

  const channel = new EncryptedChannel(transport, sharedKey, events, {
    offeredCompressionAlgorithms: compressionAlgorithms,
    compressionAdapter: options.compressionAdapter,
    framedCiphertextV1Offered: true,
    runtimeObserver: options.runtimeObserver,
  });

  // Send e2ee_hello with our public key
  const ourPublicKeyB64 = exportPublicKey(keyPair.publicKey);
  const hello: E2EEHelloMessage = {
    type: "e2ee_hello",
    key: ourPublicKeyB64,
    capabilities: {
      binaryCiphertext: true,
      framedCiphertextV1: {
        ciphertextEncodings: [...SUPPORTED_FRAMED_CIPHERTEXT_ENCODINGS],
        compressionAlgorithms: [...compressionAlgorithms],
      } satisfies FramedCiphertextV1Offer,
    },
  };
  const helloText = JSON.stringify(hello);

  let retry: ReturnType<typeof setInterval> | null = null;
  const emitSendError = (error: unknown) => {
    const err = error instanceof Error ? error : new Error(String(error));
    events.onerror?.(err);
  };
  const sendHello = () => {
    try {
      const result = transport.send(helloText);
      if (result) {
        void result.catch(emitSendError);
      }
      return true;
    } catch (error) {
      // This can happen during daemon restarts while the socket transitions
      // through CLOSING/CLOSED states. Report it but do not throw from timers.
      emitSendError(error);
      return false;
    }
  };
  const clearRetry = () => {
    if (retry) {
      clearInterval(retry);
      retry = null;
    }
  };

  channel.onTransitionToOpen(() => clearRetry());
  channel.onClose(() => clearRetry());

  sendHello();
  retry = setInterval(() => {
    if (channel.isOpen()) {
      clearRetry();
      return;
    }
    sendHello();
  }, HANDSHAKE_RETRY_MS);
  // Avoid keeping Node processes alive (e.g. tests) if the handshake is stuck.
  if (hasUnref(retry)) {
    retry.unref();
  }

  return channel;
}

/**
 * Creates an encrypted channel as the responder (daemon).
 *
 * The daemon:
 * 1. Has pre-generated keypair (public key was in QR)
 * 2. Waits for client's e2ee_hello with their public key
 * 3. Derives shared key and starts encrypted communication
 */
export function createDaemonChannel(options: CreateDaemonChannelOptions): Promise<EncryptedChannel>;
// COMPAT(relayChannelObjectOptions): positional API predates v0.4.0-beta.5; remove after 2027-08-21.
export function createDaemonChannel(
  transport: Transport,
  daemonKeyPair: KeyPair,
  events?: EncryptedChannelEvents,
  options?: DaemonChannelOptions,
): Promise<EncryptedChannel>;
export async function createDaemonChannel(
  ...args:
    | [options: CreateDaemonChannelOptions]
    | [
        transport: Transport,
        daemonKeyPair: KeyPair,
        events?: EncryptedChannelEvents,
        options?: DaemonChannelOptions,
      ]
): Promise<EncryptedChannel> {
  /** Canonical object input normalized from the temporary positional compatibility overload. */
  let input: CreateDaemonChannelOptions;
  if (args.length === 1) {
    input = args[0];
  } else {
    const [transport, daemonKeyPair, events = {}, options = {}] = args;
    input = { transport, daemonKeyPair, events, ...options };
  }
  const { transport, daemonKeyPair, events = {}, ...options } = input;
  // Immutable daemon preference captured when this data connection is created.
  const configuredEncoding = options.ciphertextEncoding ?? "auto";

  return new Promise((resolve, reject) => {
    /** Factory phases before ownership moves to the attached channel. */
    type DaemonHandshakePhase =
      | "awaiting-hello"
      | "sending-ready"
      | "pending-confirm"
      | "open"
      | "closed";

    /** One pre-attach transport item and its shared raw-wire reservation. */
    interface BufferedHandshakeMessage {
      /** Original transport item retained without decoding or decrypting. */
      message: TransportMessage;
      /** Raw-wire reservation owned by the factory until channel handoff. */
      reservation: ReceiveWireReservation;
    }
    // Messages retained while ready or a same-key replay is crossing the transport boundary.
    const bufferedMessages: BufferedHandshakeMessage[] = [];
    // Shared raw-byte counter retained across the factory-to-channel ownership handoff.
    const receiveWireBudget: ReceiveWireBudget = { pendingBytes: 0 };
    // Individual factory reservations used for idempotent failure cleanup.
    const handshakeReservations = new Set<ReceiveWireReservation>();
    // Current factory phase used to keep handshake messages in one receive FIFO.
    let phase: DaemonHandshakePhase = "awaiting-hello";
    // Prevents two async drains from consuming the same buffered FIFO.
    let drainingBufferedMessages = false;
    // Shared key derived from the accepted initial hello.
    let sharedKey: SharedKey | null = null;
    // Framed selection saved until an exact authenticated confirmation arrives.
    let framedSelection: FramedCiphertextV1Selection | null = null;
    // Legacy binary behavior or framed-binary compatibility advertisement for this connection.
    let binaryCiphertext = false;
    // Exact ready bytes reused for every same-key hello on this connection.
    let savedReadyText: string | null = null;
    // Attached channel reference used only to mark protocol failures closed.
    let channel: EncryptedChannel | null = null;
    // Settlement guard because close echoes can race the explicit failure path.
    let factorySettled = false;
    // Physical close guard ensuring one protocol failure produces one close request.
    let closeRequested = false;

    /** Returns whether buffered plaintext is a stray ready that the daemon can ignore. */
    const shouldIgnoreBufferedReady = (message: TransportMessage): boolean => {
      try {
        if (message.isBinary) return false;
        const text = decodeTransportText(message.data);
        const parsed: unknown = JSON.parse(text);
        return isE2EEReadyMessage(parsed);
      } catch {
        return false;
      }
    };

    /** Re-reads the mutable phase after an asynchronous transport boundary. */
    const isHandshakeClosed = (): boolean => phase === "closed";

    /** Releases one pre-attach raw-wire reservation exactly once. */
    const releaseHandshakeReservation = (reservation: ReceiveWireReservation): void => {
      if (reservation.released) return;
      reservation.released = true;
      handshakeReservations.delete(reservation);
      receiveWireBudget.pendingBytes -= reservation.bytes;
      if (receiveWireBudget.pendingBytes < 0) receiveWireBudget.pendingBytes = 0;
    };

    /** Releases every queued and active factory reservation during teardown. */
    const releaseAllHandshakeReservations = (): void => {
      for (const reservation of handshakeReservations) {
        releaseHandshakeReservation(reservation);
      }
      bufferedMessages.length = 0;
    };

    /** Rejects the unattached factory once without requesting a physical close. */
    const rejectFactory = (error: Error): void => {
      phase = "closed";
      releaseAllHandshakeReservations();
      if (factorySettled) return;
      factorySettled = true;
      reject(error);
    };

    /** Closes and rejects a daemon handshake after an accepted hello cannot safely attach. */
    const failHandshake = (failure: FailHandshakeOptions): void => {
      const { error, closeCode = 1011 } = failure;
      if (phase === "closed") return;
      // Normalized protocol error shared by the promise and physical close reason.
      const err = error instanceof Error ? error : new Error(String(error));
      phase = "closed";
      releaseAllHandshakeReservations();
      channel?.setState("closed");
      if (!factorySettled) {
        factorySettled = true;
        reject(err);
      }
      if (closeRequested) return;
      closeRequested = true;
      try {
        transport.close(closeCode, err.message);
      } catch {
        // The original handshake error remains the observable factory result.
      }
    };

    /** Reserves one framed handshake-backlog item before any wire decoding or decryption. */
    const reserveHandshakeMessage = (message: TransportMessage): ReceiveWireReservation | null => {
      if (!framedSelection) return { bytes: 0, released: false };
      // Raw WebSocket bytes counted before Base64 allocation or authenticated parsing.
      const bytes = transportMessageWireByteLength(message);
      if (framedSelection && bytes >= MAX_FRAMED_WIRE_BYTES) {
        failHandshake({
          error: new Error("Framed ciphertext exceeds the wire byte limit"),
          closeCode: 1009,
        });
        return null;
      }
      if (receiveWireBudget.pendingBytes + bytes > MAX_PENDING_RECEIVE_WIRE_BYTES) {
        failHandshake({
          error: new Error("Encrypted channel exceeded its inbound high-water mark"),
          closeCode: 1009,
        });
        return null;
      }
      const reservation: ReceiveWireReservation = { bytes, released: false };
      receiveWireBudget.pendingBytes += bytes;
      handshakeReservations.add(reservation);
      return reservation;
    };

    /** Attaches one channel after legacy ready or an exact framed confirmation. */
    const attachChannel = (): EncryptedChannel => {
      if (!sharedKey || !savedReadyText) {
        throw new Error("Daemon handshake state is incomplete");
      }

      // Channel mode is immutable after this constructor takes transport ownership.
      const attachedChannel = new EncryptedChannel(transport, sharedKey, events, {
        daemonKeyPair,
        binaryCiphertext,
        ...(framedSelection ? { framedCiphertextV1: framedSelection } : {}),
        daemonReadyText: savedReadyText,
        receiveWireBudget,
        runtimeObserver: options.runtimeObserver,
      });
      attachedChannel.setState("open");
      notifyRuntimeObserver({
        observer: options.runtimeObserver,
        notify: (observer) =>
          observer.onNegotiatedTransport?.(attachedChannel.getNegotiatedTransport()),
      });
      channel = attachedChannel;
      phase = "open";
      events.onopen?.();
      if (!factorySettled) {
        factorySettled = true;
        resolve(attachedChannel);
      }
      return attachedChannel;
    };

    /** Replays the saved selection only when a pending hello derives the same shared key. */
    const handlePendingRehello = async (message: E2EEHelloMessage): Promise<void> => {
      if (!sharedKey || !savedReadyText) {
        throw new Error("Daemon handshake state is incomplete");
      }
      // Candidate key proves whether this is a retry of the already accepted client hello.
      const clientPublicKey = importPublicKey(message.key);
      const nextSharedKey = deriveSharedKey(daemonKeyPair.secretKey, clientPublicKey);
      if (!keysEqual(nextSharedKey, sharedKey)) {
        throw new Error(REHANDSHAKE_KEY_MISMATCH_CLOSE_REASON);
      }
      await transport.send(savedReadyText);
    };

    /** Validates the first encrypted pending frame as the exact legacy Base64 confirm. */
    const handlePendingConfirm = async (message: TransportMessage): Promise<void> => {
      if (!sharedKey || !framedSelection) {
        throw new Error("Daemon framed selection is not pending");
      }

      // Plaintext hello retries are allowed without changing the saved selection.
      if (!message.isBinary) {
        // Parsed handshake candidate, kept separate so retry errors are not mistaken for parse misses.
        let parsedPlaintext: unknown = null;
        try {
          const plaintext = decodeTransportText(message.data);
          parsedPlaintext = JSON.parse(plaintext);
        } catch {
          // Non-handshake text continues through the required encrypted-confirm path.
        }
        if (isE2EEHelloMessage(parsedPlaintext)) {
          await handlePendingRehello(parsedPlaintext);
          return;
        }
        if (isE2EEReadyMessage(parsedPlaintext)) return;
      }

      if (message.isBinary || typeof message.data !== "string") {
        throw new Error("Framed mode confirm must use a legacy Base64 text frame");
      }

      // Authentication occurs before any confirm field influences connection state.
      const plaintextBytes = decrypt(sharedKey, base64ToArrayBuffer(message.data));
      const confirmText = new TextDecoder("utf-8", { fatal: true }).decode(plaintextBytes);
      const parsedConfirm: unknown = JSON.parse(confirmText);
      if (!isExactModeConfirm(parsedConfirm, framedSelection)) {
        throw new Error("Framed mode confirm does not match the saved selection");
      }

      attachChannel();
    };

    /** Processes one handshake backlog item under the current factory phase. */
    const deliverBufferedMessage = async (buffered: BufferedHandshakeMessage): Promise<boolean> => {
      if (phase === "pending-confirm") {
        await handlePendingConfirm(buffered.message);
        return true;
      }
      if (phase !== "open") return false;
      if (shouldIgnoreBufferedReady(buffered.message)) return true;
      // Ownership moves synchronously to EncryptedChannel's receive reservation.
      releaseHandshakeReservation(buffered.reservation);
      transport.onmessage?.(buffered.message);
      return true;
    };

    /** Drains handshake backlog serially and hands post-attach frames to the channel in order. */
    const drainBufferedMessages = async (): Promise<void> => {
      if (drainingBufferedMessages) return;
      if (phase === "sending-ready") return;
      if (phase === "closed") return;
      drainingBufferedMessages = true;
      try {
        while (bufferedMessages.length > 0) {
          // FIFO head retained across every awaited transport or crypto boundary.
          const buffered = bufferedMessages.shift();
          if (!buffered) continue;
          try {
            if (!(await deliverBufferedMessage(buffered))) break;
          } finally {
            releaseHandshakeReservation(buffered.reservation);
          }
        }
      } catch (error) {
        const closeCode =
          error instanceof Error && error.message === REHANDSHAKE_KEY_MISMATCH_CLOSE_REASON
            ? REHANDSHAKE_KEY_MISMATCH_CLOSE_CODE
            : 1011;
        failHandshake({ error, closeCode });
      } finally {
        drainingBufferedMessages = false;
        if (bufferedMessages.length > 0 && (phase === "pending-confirm" || phase === "open")) {
          void drainBufferedMessages();
        }
      }
    };

    /** Buffers every post-hello message until ready and optional confirm complete in FIFO. */
    const bufferPostHelloMessage = (message: TransportMessage): void => {
      const reservation = reserveHandshakeMessage(message);
      if (!reservation) return;
      bufferedMessages.push({ message, reservation });
      if (phase === "pending-confirm" || phase === "open") {
        void drainBufferedMessages();
      }
    };

    /** Accepts the initial hello, writes one saved ready, and enters the selected attach path. */
    const handleHello = async (message: TransportMessage): Promise<void> => {
      // Distinguishes invalid initial traffic from failures after a valid key was accepted.
      let acceptedHello = false;
      try {
        if (message.isBinary) {
          throw buildInvalidHelloError("<binary frame>");
        }
        const helloText = decodeTransportText(message.data);

        let parsed: unknown;
        try {
          parsed = JSON.parse(helloText);
        } catch {
          throw buildInvalidHelloError(helloText);
        }

        if (!isE2EEHelloMessage(parsed)) {
          throw buildInvalidHelloError(helloText, parsed);
        }

        const msg = parsed;
        acceptedHello = true;

        // Buffer any subsequent messages that arrive while we're doing async
        // handshake work or waiting for the ready transport write.
        phase = "sending-ready";
        Object.assign(transport, { onmessage: bufferPostHelloMessage });

        const clientPublicKey = importPublicKey(msg.key);
        sharedKey = deriveSharedKey(daemonKeyPair.secretKey, clientPublicKey);

        framedSelection = resolveDaemonFramedSelection({
          offer: parseFramedCiphertextV1Offer(msg),
          configuredEncoding,
          supportedCompressionAlgorithms:
            options.compressionAlgorithms ?? SUPPORTED_FRAMED_COMPRESSION_ALGORITHMS,
        });
        binaryCiphertext = framedSelection
          ? framedSelection.ciphertextEncoding === "binary"
          : configuredEncoding !== "base64" && supportsBinaryCiphertext(msg);
        savedReadyText = buildDaemonReadyText({ binaryCiphertext, selection: framedSelection });
        await transport.send(savedReadyText);
        if (isHandshakeClosed()) return;

        if (framedSelection) {
          phase = "pending-confirm";
        } else {
          attachChannel();
        }
        await drainBufferedMessages();
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        if (acceptedHello) {
          failHandshake({ error: err });
        } else {
          rejectFactory(err);
        }
      }
    };

    Object.assign(transport, {
      onmessage: handleHello,
      onerror: (error: Error) => {
        if (phase === "awaiting-hello") {
          rejectFactory(error);
        } else {
          failHandshake({ error });
        }
      },
      onclose: (code: number, reason: string) => {
        rejectFactory(new Error(`Connection closed during handshake: ${code} ${reason}`));
      },
    });
  });
}

/**
 * Encrypted channel that wraps a transport with E2EE.
 */
export class EncryptedChannel {
  private transport: Transport;
  private sharedKey: SharedKey;
  private state: ChannelState = "handshaking";
  private events: EncryptedChannelEvents;
  private options: EncryptedChannelOptions;
  private pendingSends: Array<string | ArrayBuffer> = [];
  private onOpenCallbacks: Array<() => void> = [];
  private onCloseCallbacks: Array<() => void> = [];
  /** Serial receive tail covering handshake transitions and application decode. */
  private receiveTail: Promise<void> = Promise.resolve();
  /** Serial transport-write tail preserving application send invocation order. */
  private sendTail: Promise<void> = Promise.resolve();
  /** Aggregate raw-byte counter shared with a daemon factory during ownership handoff. */
  private readonly receiveWireBudget: ReceiveWireBudget;
  /** Individual inbound reservations used for idempotent close cleanup. */
  private readonly receiveReservations = new Set<ReceiveWireReservation>();
  /** Whether inbound application traffic is locked to the framed-v1 contract. */
  private framedReceiveExpected: boolean;

  constructor(
    transport: Transport,
    sharedKey: SharedKey,
    events: EncryptedChannelEvents = {},
    options: EncryptedChannelOptions = {},
  ) {
    this.transport = transport;
    this.sharedKey = sharedKey;
    this.events = events;
    this.options = options;
    this.receiveWireBudget = options.receiveWireBudget ?? { pendingBytes: 0 };
    this.framedReceiveExpected =
      options.framedCiphertextV1 !== undefined || options.framedCiphertextV1Offered === true;

    Object.assign(transport, {
      onmessage: (message: TransportMessage) => this.enqueueMessage(message),
      onclose: (code: number, reason: string) => {
        this.state = "closed";
        this.releaseAllReceiveReservations();
        this.events.onclose?.(code, reason);
        for (const cb of this.onCloseCallbacks) cb();
      },
      onerror: (error: Error) => {
        if (this.options.framedCiphertextV1) {
          this.failReceive({ error });
        } else {
          this.releaseAllReceiveReservations();
        }
        this.events.onerror?.(error);
      },
    });
  }

  /** Appends one transport message to the connection-wide receive FIFO. */
  private enqueueMessage(message: TransportMessage): void {
    if (!this.framedReceiveExpected) {
      this.receiveTail = this.receiveTail
        .then(() => this.handleMessage(message))
        .catch((error: unknown) => this.failReceive({ error }));
      return;
    }
    const reservation = this.reserveReceiveWire(message);
    if (!reservation) return;
    this.receiveTail = this.receiveTail
      .then(() => this.handleMessage(message))
      .catch((error: unknown) => {
        this.failReceive({ error });
      })
      .finally(() => this.releaseReceiveWire(reservation));
  }

  /** Reserves raw ingress bytes before Base64 decoding, decryption, or decompression. */
  private reserveReceiveWire(message: TransportMessage): ReceiveWireReservation | null {
    if (this.state === "closed") return null;
    const bytes = transportMessageWireByteLength(message);
    if (this.options.framedCiphertextV1 && bytes >= MAX_FRAMED_WIRE_BYTES) {
      this.notifyProtocolError("invalid-wire");
      this.failReceive({
        error: new Error("Framed ciphertext exceeds the wire byte limit"),
        closeCode: 1009,
      });
      return null;
    }
    if (this.receiveWireBudget.pendingBytes + bytes > MAX_PENDING_RECEIVE_WIRE_BYTES) {
      this.notifyProtocolError("receive-high-water");
      this.failReceive({
        error: new Error("Encrypted channel exceeded its inbound high-water mark"),
        closeCode: 1009,
      });
      return null;
    }
    const reservation: ReceiveWireReservation = { bytes, released: false };
    this.receiveWireBudget.pendingBytes += bytes;
    this.receiveReservations.add(reservation);
    this.samplePendingReceiveWireBytes();
    return reservation;
  }

  /** Releases one inbound reservation exactly once after FIFO processing completes. */
  private releaseReceiveWire(reservation: ReceiveWireReservation): void {
    if (reservation.released) return;
    reservation.released = true;
    this.receiveReservations.delete(reservation);
    this.receiveWireBudget.pendingBytes -= reservation.bytes;
    if (this.receiveWireBudget.pendingBytes < 0) this.receiveWireBudget.pendingBytes = 0;
    this.samplePendingReceiveWireBytes();
  }

  /** Releases all active and queued ingress reservations during connection teardown. */
  private releaseAllReceiveReservations(): void {
    for (const reservation of this.receiveReservations) this.releaseReceiveWire(reservation);
  }

  /** Fails the current connection without allowing a partially decoded frame to escape. */
  private failReceive(options: FailReceiveOptions): void {
    const { error, closeCode = 1011 } = options;
    if (this.state === "closed") return;
    const err = error instanceof Error ? error : new Error(String(error));
    this.state = "closed";
    this.releaseAllReceiveReservations();
    try {
      this.transport.close(closeCode, err.message);
    } catch {
      // The protocol failure remains observable through channel state and pending promises.
    }
  }

  /** Emits one bounded protocol reason without retaining the source exception. */
  private notifyProtocolError(reason: EncryptedChannelProtocolErrorReason): void {
    notifyRuntimeObserver({
      observer: this.options.runtimeObserver,
      notify: (observer) => observer.onFramedProtocolError?.(reason),
    });
  }

  /** Samples the current receive reservation gauge without affecting traffic. */
  private samplePendingReceiveWireBytes(): void {
    notifyRuntimeObserver({
      observer: this.options.runtimeObserver,
      notify: (observer) =>
        observer.onPendingReceiveWireBytes?.(Math.max(0, this.receiveWireBudget.pendingBytes)),
    });
  }

  setState(state: ChannelState): void {
    this.state = state;
  }

  private async handleMessage(message: TransportMessage): Promise<void> {
    if (this.state === "handshaking") {
      await this.handleHandshakeMessage(message);
      return;
    }

    if (this.state !== "open") return;

    /** Bounded stage retained if framed processing fails before application delivery. */
    let framedFailureReason: EncryptedChannelProtocolErrorReason = "invalid-wire";
    try {
      /** Monotonic start of the complete framed receive path. */
      const framedDecodeStartedAt = this.options.framedCiphertextV1
        ? defaultMonotonicClock()
        : null;
      const ciphertext = await (async () => {
        // Handle (or ignore) any stray plaintext handshake traffic.
        try {
          if (message.isBinary) throw new Error("not plaintext handshake traffic");
          const text = decodeTransportText(message.data);
          if (text.trim().startsWith("{")) {
            const parsed: unknown = JSON.parse(text);

            if (isE2EEHelloMessage(parsed)) {
              if (this.options.daemonKeyPair) {
                await this.handleDaemonRehello(parsed);
              }
              return null;
            }

            if (isE2EEReadyMessage(parsed)) {
              return null;
            }

            // Any other JSON-looking payload is plaintext app traffic, which
            // means the peer is not encrypting (or we are out of sync).
            throw new Error("Received plaintext frame on encrypted channel");
          }
        } catch (error) {
          // If we detected plaintext protocol mismatch, fail hard.
          if (error instanceof Error && error.message.includes("plaintext frame")) {
            throw error;
          }
          // Otherwise ignore JSON parse/TextDecoder failures and fall back to
          // decoding ciphertext below.
        }

        if (this.options.framedCiphertextV1) {
          // Ciphertext bytes validated against the immutable connection representation.
          const framedWire = decodeFramedCiphertextWire({
            data: message.data,
            isBinary: message.isBinary,
            encoding: this.options.framedCiphertextV1.ciphertextEncoding,
          });
          framedFailureReason = "decrypt-failed";
          return { data: framedWire, isBinary: null };
        }

        if (this.options.binaryCiphertext) {
          return message.isBinary
            ? { data: requireArrayBuffer(message.data), isBinary: true as const }
            : {
                data: base64ToArrayBuffer(decodeTransportText(message.data)),
                isBinary: false as const,
              };
        }

        // COMPAT(binaryCiphertext): added in v0.2.3, remove legacy base64-only
        // receive mode after 2027-01-27.
        if (!message.isBinary) {
          return { data: base64ToArrayBuffer(decodeTransportText(message.data)), isBinary: null };
        }

        // Older transport adapters could lose the opcode. Retain the former
        // base64-first behavior only in the legacy path.
        try {
          return { data: base64ToArrayBuffer(decodeTransportText(message.data)), isBinary: null };
        } catch {
          return { data: requireArrayBuffer(message.data), isBinary: null };
        }
      })();

      if (ciphertext) {
        const plaintextBytes = decrypt(this.sharedKey, ciphertext.data);
        if (this.options.framedCiphertextV1) framedFailureReason = "invalid-envelope";
        /** Authenticated framed result retained only long enough to emit content-free metrics. */
        let decodedFramed: DecodedFramedPayload | null = null;
        /** Adapter wrapper marks failures that occurred after bounded inflate began. */
        const observedCompressionAdapter = this.options.compressionAdapter
          ? {
              inflateRaw: (options: InflateRawFrameOptions) => {
                framedFailureReason = "decode-failed";
                return this.options.compressionAdapter!.inflateRaw(options);
              },
            }
          : undefined;
        const plaintext = this.options.framedCiphertextV1
          ? ((decodedFramed = await decodeFramedPayload({
              plaintext: plaintextBytes,
              compressionAdapter: observedCompressionAdapter,
            })),
            decodedFramed.data)
          : decodePlaintext(plaintextBytes, ciphertext.isBinary);
        if (decodedFramed) {
          const selection = this.options.framedCiphertextV1;
          if (!selection) throw new Error("Decoded framed payload without a framed selection");
          if (framedDecodeStartedAt === null) {
            throw new Error("Decoded framed payload without a decode start time");
          }
          notifyRuntimeObserver({
            observer: this.options.runtimeObserver,
            notify: (observer) =>
              observer.onInboundFrame?.({
                ciphertextEncoding: selection.ciphertextEncoding,
                codec: decodedFramed.codec,
                originalByteLength: decodedFramed.originalByteLength,
                encodedByteLength: decodedFramed.encodedByteLength,
                wireByteLength: transportMessageWireByteLength(message),
                decodeMs: elapsedMs(framedDecodeStartedAt, defaultMonotonicClock()),
              }),
          });
        }
        if (this.state !== "open") return;
        if (typeof plaintext === "string" && isReservedModeConfirmText(plaintext)) {
          throw new Error("Received reserved e2ee_mode_confirm outside a pending selection");
        }
        this.events.onmessage?.(plaintext);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      if (this.isClosed()) return;

      if (this.options.framedCiphertextV1) {
        this.notifyProtocolError(framedFailureReason);
      }

      // Treat decryption/protocol errors as fatal so the peer can reconnect and
      // re-handshake. Emitting an error event here can cause higher-level code
      // to tear down the session without triggering a clean reconnect.
      this.state = "closed";
      try {
        this.transport.close(1011, err.message);
      } catch {
        // ignore
      }
    }
  }

  /** Parses plaintext client-side handshake traffic and accepts valid ready messages. */
  private async handleHandshakeMessage(message: TransportMessage): Promise<void> {
    if (message.isBinary) return;
    let parsed: unknown;
    try {
      const text = decodeTransportText(message.data);
      parsed = JSON.parse(text);
    } catch {
      // Ignore non-JSON traffic until a ready message arrives.
      return;
    }
    if (!isE2EEReadyMessage(parsed)) return;
    try {
      await this.transitionFromReady(parsed);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.state = "closed";
      this.transport.close(1011, err.message);
    }
  }

  /** Confirms the selected mode, drains queued sends, and exposes the open channel. */
  private async transitionFromReady(message: E2EEReadyMessage): Promise<void> {
    // COMPAT(framedCiphertextV1): introduced in v0.4.0-beta.4; remove after
    // 2027-08-18 once the supported peer floor requires framed-v1.
    const framedSelection = parseFramedCiphertextV1Selection(
      message,
      this.options.offeredCompressionAlgorithms ?? SUPPORTED_FRAMED_COMPRESSION_ALGORITHMS,
    );
    if (framedSelection) {
      this.framedReceiveExpected = true;
      this.state = "confirming";
      if (!(await this.tryConfirmFramedMode(framedSelection))) return;
      if (this.state !== "confirming") return;
    } else {
      this.framedReceiveExpected = false;
    }

    this.options.binaryCiphertext = supportsBinaryCiphertext(message);
    this.state = "opening";
    try {
      do {
        await this.flushPendingSends();
        // Re-check after the await boundary for sends queued during an empty flush.
      } while (this.state === "opening" && this.pendingSends.length > 0);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.events.onerror?.(err);
      this.state = "closed";
      this.transport.close(1011, err.message);
      return;
    }
    if (this.state !== "opening") return;
    this.state = "open";
    notifyRuntimeObserver({
      observer: this.options.runtimeObserver,
      notify: (observer) => observer.onNegotiatedTransport?.(this.getNegotiatedTransport()),
    });
    this.events.onopen?.();
    for (const cb of this.onOpenCallbacks) cb();
  }

  async send(data: string | ArrayBuffer): Promise<void> {
    switch (this.state) {
      case "handshaking":
      case "confirming":
      case "opening":
        if (this.pendingSends.length >= MAX_PENDING_SENDS) {
          this.pendingSends.shift();
        }
        this.pendingSends.push(data);
        return;
      case "open":
        await this.sendApplicationFrame(data);
        return;
      default:
        throw new Error("Channel not open");
    }
  }

  /** Encrypts and writes one application frame after the channel mode is fixed. */
  private async sendApplicationFrame(data: string | ArrayBuffer): Promise<void> {
    const prepared = this.prepareOutboundFrame(data);
    await this.writePreparedFrame({
      frame: prepared,
      allowOpening: this.state === "opening",
    });
  }

  /** Encrypts and representation-encodes one logical or already-framed payload exactly once. */
  prepareOutboundFrame(data: string | ArrayBuffer | PreparedFramedPayload): PreparedEncryptedFrame {
    // Caller-supplied envelopes are local trusted values produced by the framed preparation API.
    const suppliedEnvelope = typeof data !== "string" && !(data instanceof ArrayBuffer);
    const selection = this.options.framedCiphertextV1;
    if (suppliedEnvelope && !selection) {
      throw new Error("Prepared framed payload requires a framed-v1 connection");
    }

    if (selection) {
      // Authenticated envelope is reused when compression already prepared it upstream.
      const framedPayload = suppliedEnvelope ? data : prepareIdentityFramedPayload(data);
      if (
        framedPayload.codec !== "identity" &&
        !selection.compressionAlgorithms.includes(framedPayload.codec)
      ) {
        throw new Error("Prepared framed payload uses an unnegotiated compression codec");
      }
      const wireByteLength = framedCiphertextWireByteLength(
        framedPayload.encodedByteLength,
        selection.ciphertextEncoding,
      );
      if (wireByteLength >= MAX_FRAMED_WIRE_BYTES) {
        throw new Error("Framed ciphertext exceeds the wire byte limit");
      }
      // NaCl output and its selected WebSocket representation are materialized once.
      const ciphertext = encrypt(this.sharedKey, framedPayload.plaintext);
      const wireData =
        selection.ciphertextEncoding === "binary" ? ciphertext : arrayBufferToBase64(ciphertext);
      return { wireData, wireByteLength, framedCiphertextV1: true };
    }

    if (typeof data !== "string" && !(data instanceof ArrayBuffer)) {
      throw new Error("Prepared framed payload requires a framed-v1 connection");
    }

    // Legacy plaintext kind still controls its pre-framed hybrid representation.
    const ciphertext = encrypt(this.sharedKey, data);
    const wireData =
      this.options.binaryCiphertext && data instanceof ArrayBuffer
        ? ciphertext
        : arrayBufferToBase64(ciphertext);
    return {
      wireData,
      wireByteLength: typeof wireData === "string" ? wireData.length : wireData.byteLength,
      framedCiphertextV1: false,
    };
  }

  /** Writes one fully prepared frame through the connection-wide send FIFO. */
  // COMPAT(relayPreparedFrameObjectOptions): frame-only API predates v0.4.0-beta.5; remove after 2027-08-21.
  async sendPreparedFrame(frame: PreparedEncryptedFrame): Promise<void>;
  async sendPreparedFrame(options: SendPreparedEncryptedFrameOptions): Promise<void>;
  async sendPreparedFrame(
    frameOrOptions: PreparedEncryptedFrame | SendPreparedEncryptedFrameOptions,
  ): Promise<void> {
    const options = "frame" in frameOrOptions ? frameOrOptions : { frame: frameOrOptions };
    await this.writePreparedFrame({ ...options, allowOpening: false });
  }

  /** Returns whether this open channel is locked to framed-v1 application traffic. */
  usesFramedCiphertextV1(): boolean {
    return this.options.framedCiphertextV1 !== undefined;
  }

  /** Returns the immutable encrypted transport selection for this open channel. */
  getNegotiatedTransport(): NegotiatedEncryptedTransport {
    const selection = this.options.framedCiphertextV1;
    if (selection) {
      return {
        mode: "framed-v1",
        ciphertextEncoding: selection.ciphertextEncoding,
        compressionAlgorithms: [...selection.compressionAlgorithms],
      };
    }
    return {
      mode: "legacy",
      ciphertextEncoding: this.options.binaryCiphertext ? "hybrid" : "base64",
      compressionAlgorithms: [],
    };
  }

  /** Writes a prepared frame while the handshake opening flush still owns the channel. */
  private async writePreparedFrame(options: WritePreparedEncryptedFrameOptions): Promise<void> {
    const { frame, allowOpening, onTransportWriteStart } = options;
    if (preparedEncryptedFrameWireByteLength(frame) !== frame.wireByteLength) {
      throw new Error("Prepared encrypted frame wire length mismatch");
    }
    const selection = this.options.framedCiphertextV1;
    if (frame.framedCiphertextV1 !== (selection !== undefined)) {
      throw new Error("Prepared encrypted frame mode does not match the channel");
    }
    if (selection?.ciphertextEncoding === "binary" && !(frame.wireData instanceof ArrayBuffer)) {
      throw new Error("Prepared framed binary ciphertext requires binary wire data");
    }
    if (selection?.ciphertextEncoding === "base64" && typeof frame.wireData !== "string") {
      throw new Error("Prepared framed Base64 ciphertext requires text wire data");
    }
    if (!canWriteApplicationFrame({ state: this.state, allowOpening })) {
      throw new Error("Channel not open");
    }
    if (!frame.framedCiphertextV1) {
      onTransportWriteStart?.();
      await this.transport.send(frame.wireData);
      return;
    }
    const sendOperation = this.sendTail.then(async () => {
      if (!canWriteApplicationFrame({ state: this.state, allowOpening })) {
        throw new Error("Channel not open");
      }
      onTransportWriteStart?.();
      return this.transport.send(frame.wireData);
    });
    // A rejected write must not strand later queued operations on a rejected tail.
    this.sendTail = sendOperation.catch(() => undefined);
    try {
      await sendOperation;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (frame.framedCiphertextV1 && !this.isClosed()) {
        this.state = "closed";
        try {
          this.transport.close(1011, err.message);
        } catch {
          // The original write failure remains the observable send result.
        }
      }
      throw err;
    }
  }

  outboundWireByteLength(data: string | ArrayBuffer): number {
    const plaintextBytes = utf8ByteLength(data);
    if (this.options.framedCiphertextV1) {
      return framedCiphertextWireByteLength(
        plaintextBytes,
        this.options.framedCiphertextV1.ciphertextEncoding,
      );
    }
    const encryptedBytes = plaintextBytes + ENCRYPTED_PAYLOAD_OVERHEAD_BYTES;
    if (this.options.binaryCiphertext && data instanceof ArrayBuffer) {
      return encryptedBytes;
    }
    return base64EncryptedWireByteLength(plaintextBytes);
  }

  private async flushPendingSends(): Promise<void> {
    while (this.state === "opening" && this.pendingSends.length > 0) {
      const item = this.pendingSends.shift();
      if (item !== undefined) {
        await this.sendApplicationFrame(item);
      }
    }
  }

  /** Confirms and locks framed mode, closing the channel when transport send fails. */
  private async tryConfirmFramedMode(selection: FramedCiphertextV1Selection): Promise<boolean> {
    try {
      await this.sendFramedModeConfirm(selection);
      this.options.framedCiphertextV1 = selection;
      return true;
    } catch (error) {
      // Normalized transport failure surfaced through the channel contract.
      const err = error instanceof Error ? error : new Error(String(error));
      this.events.onerror?.(err);
      this.state = "closed";
      this.transport.close(1011, err.message);
      return false;
    }
  }

  /** Sends the authenticated mode confirmation using the legacy Base64 wire. */
  private async sendFramedModeConfirm(selection: FramedCiphertextV1Selection): Promise<void> {
    // Exact selection echo authenticated under the established shared key.
    const confirm: E2EEModeConfirmMessage = {
      type: "e2ee_mode_confirm",
      mode: "framed-ciphertext-v1",
      ciphertextEncoding: selection.ciphertextEncoding,
      compressionAlgorithms: [...selection.compressionAlgorithms],
    };
    // Confirmation deliberately bypasses the framed envelope and representation.
    const ciphertext = encrypt(this.sharedKey, JSON.stringify(confirm));
    await this.transport.send(arrayBufferToBase64(ciphertext));
  }

  private async handleDaemonRehello(message: E2EEHelloMessage): Promise<void> {
    if (!this.options.daemonKeyPair) return;
    const clientPublicKey = importPublicKey(message.key);
    const nextSharedKey = deriveSharedKey(this.options.daemonKeyPair.secretKey, clientPublicKey);

    // If it's the same client key (handshake retry), re-send
    // "ready" but do not re-key. Re-keying here would desync
    // the channel and cause decrypt failures.
    if (keysEqual(nextSharedKey, this.sharedKey)) {
      const readyText =
        this.options.daemonReadyText ??
        buildDaemonReadyText({
          binaryCiphertext: this.options.binaryCiphertext === true,
          selection: null,
        });
      await this.transport.send(readyText);
      return;
    }

    // A different key on an already-open encrypted channel is not an
    // authenticated reconnect. Close and require a fresh transport instead of
    // allowing the relay to switch this channel to an attacker-chosen key.
    this.state = "closed";
    this.transport.close(
      REHANDSHAKE_KEY_MISMATCH_CLOSE_CODE,
      REHANDSHAKE_KEY_MISMATCH_CLOSE_REASON,
    );
  }

  close(code = 1000, reason = "Normal closure"): void {
    this.state = "closed";
    this.releaseAllReceiveReservations();
    this.transport.close(code, reason);
  }

  isOpen(): boolean {
    return this.state === "open";
  }

  /** Returns current closed state without retaining control-flow narrowing across awaits. */
  private isClosed(): boolean {
    return this.state === "closed";
  }

  onTransitionToOpen(cb: () => void): void {
    this.onOpenCallbacks.push(cb);
  }

  onClose(cb: () => void): void {
    this.onCloseCallbacks.push(cb);
  }
}

/** Calls one runtime observer method without allowing observability to affect traffic. */
function notifyRuntimeObserver(options: NotifyRuntimeObserverOptions): void {
  const { observer, notify } = options;
  if (!observer) return;
  try {
    notify(observer);
  } catch {
    // Runtime observers are intentionally isolated from protocol behavior.
  }
}

/** Returns the cross-runtime monotonic clock used by receive metrics. */
function defaultMonotonicClock(): number {
  return globalThis.performance.now();
}

/** Normalizes one monotonic duration to a finite non-negative metric. */
function elapsedMs(startedAt: number, endedAt: number): number {
  const duration = endedAt - startedAt;
  if (!Number.isFinite(duration) || duration < 0) return 0;
  return duration;
}

function decodeTransportText(data: string | ArrayBuffer): string {
  return typeof data === "string" ? data : new TextDecoder().decode(data);
}

/** Returns exact raw WebSocket application bytes before any representation decoding. */
function transportMessageWireByteLength(message: TransportMessage): number {
  return utf8ByteLength(message.data);
}

function requireArrayBuffer(data: string | ArrayBuffer): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  throw new Error("Binary WebSocket frame did not contain bytes");
}

function decodeLegacyPlaintext(data: ArrayBuffer): string | ArrayBuffer {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return data;
  }
}

function decodePlaintext(data: ArrayBuffer, isBinary: boolean | null): string | ArrayBuffer {
  if (isBinary === true) return data;
  if (isBinary === false) return new TextDecoder("utf-8", { fatal: true }).decode(data);
  return decodeLegacyPlaintext(data);
}

/** Counts UTF-8 wire bytes without allocating an encoded copy before budget checks. */
function utf8ByteLength(data: string | ArrayBuffer): number {
  if (data instanceof ArrayBuffer) return data.byteLength;
  let bytes = 0;
  for (let index = 0; index < data.length; index += 1) {
    const codeUnit = data.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (
      codeUnit >= 0xd800 &&
      codeUnit <= 0xdbff &&
      index + 1 < data.length &&
      data.charCodeAt(index + 1) >= 0xdc00 &&
      data.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else {
      // Unpaired surrogates match TextEncoder's three-byte U+FFFD replacement.
      bytes += 3;
    }
  }
  return bytes;
}

function keysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let difference = 0;
  for (let i = 0; i < a.byteLength; i += 1) {
    difference |= a[i] ^ b[i];
  }
  return difference === 0;
}
