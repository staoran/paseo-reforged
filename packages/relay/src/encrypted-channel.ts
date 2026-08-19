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

/** WebSocket ciphertext representation used by framed-v1 connections. */
export type CiphertextEncoding = "base64" | "binary";

/** Daemon-side preference used to select a connection-level ciphertext representation. */
export type ConfiguredCiphertextEncoding = "auto" | CiphertextEncoding;

/** Optional daemon-side wire policy supplied when a data connection is created. */
export interface DaemonChannelOptions {
  /** Selects framed binary, framed Base64, or legacy fallback behavior. */
  ciphertextEncoding?: ConfiguredCiphertextEncoding;
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

/** Reads a valid framed-v1 selection limited to capabilities offered by this client. */
function parseFramedCiphertextV1Selection(
  message: E2EEReadyMessage,
): FramedCiphertextV1Selection | null {
  // Untrusted framed selection carried by the plaintext ready message.
  const value = message.capabilities?.framedCiphertextV1;
  if (!isRecord(value) || !isCiphertextEncoding(value.ciphertextEncoding)) return null;
  if (!SUPPORTED_FRAMED_CIPHERTEXT_ENCODINGS.includes(value.ciphertextEncoding)) return null;
  if (!Array.isArray(value.compressionAlgorithms)) return null;
  if (!value.compressionAlgorithms.every((algorithm) => typeof algorithm === "string")) {
    return null;
  }
  if (
    !value.compressionAlgorithms.every((algorithm) =>
      SUPPORTED_FRAMED_COMPRESSION_ALGORITHMS.includes(algorithm),
    )
  ) {
    return null;
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
  if (!Array.isArray(value.ciphertextEncodings)) return null;
  if (!value.ciphertextEncodings.every((encoding) => typeof encoding === "string")) return null;
  if (!Array.isArray(value.compressionAlgorithms)) return null;
  if (!value.compressionAlgorithms.every((algorithm) => typeof algorithm === "string")) {
    return null;
  }

  return {
    ciphertextEncodings: value.ciphertextEncodings.filter(isCiphertextEncoding),
    compressionAlgorithms: [...value.compressionAlgorithms],
  };
}

/** Resolves the immutable framed-v1 selection for one daemon connection. */
function resolveDaemonFramedSelection(
  offer: FramedCiphertextV1Offer | null,
  configuredEncoding: ConfiguredCiphertextEncoding,
): FramedCiphertextV1Selection | null {
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
    compressionAlgorithms: SUPPORTED_FRAMED_COMPRESSION_ALGORITHMS.filter((algorithm) =>
      offer.compressionAlgorithms.includes(algorithm),
    ),
  };
}

/** Serializes the exact ready frame saved for initial send and same-key replay. */
function buildDaemonReadyText(
  binaryCiphertext: boolean,
  selection: FramedCiphertextV1Selection | null,
): string {
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
/** Byte marker identifying an authenticated Paseo envelope. */
const FRAMED_CIPHERTEXT_MAGIC = 0x50;
/** Current authenticated envelope version. */
const FRAMED_CIPHERTEXT_VERSION = 0x01;
/** Number of bytes before the encoded payload in a v1 envelope. */
const FRAMED_CIPHERTEXT_HEADER_BYTES = 8;
/** Envelope codec value for an uncompressed payload. */
const FRAMED_CIPHERTEXT_IDENTITY_CODEC = 0x00;
/** Bit indicating that the original application payload was binary. */
const FRAMED_CIPHERTEXT_BINARY_FLAG = 0x01;
/** Framed ciphertext representations implemented by this relay package. */
const SUPPORTED_FRAMED_CIPHERTEXT_ENCODINGS: readonly CiphertextEncoding[] = ["base64", "binary"];
/** Compression decoders implemented by this relay package in the identity-only slice. */
const SUPPORTED_FRAMED_COMPRESSION_ALGORITHMS: readonly string[] = [];

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
export async function createClientChannel(
  transport: Transport,
  daemonPublicKeyB64: string,
  events: EncryptedChannelEvents = {},
): Promise<EncryptedChannel> {
  const keyPair = generateKeyPair();
  const daemonPublicKey = importPublicKey(daemonPublicKeyB64);
  const sharedKey = deriveSharedKey(keyPair.secretKey, daemonPublicKey);

  const channel = new EncryptedChannel(transport, sharedKey, events);

  // Send e2ee_hello with our public key
  const ourPublicKeyB64 = exportPublicKey(keyPair.publicKey);
  const hello: E2EEHelloMessage = {
    type: "e2ee_hello",
    key: ourPublicKeyB64,
    capabilities: {
      binaryCiphertext: true,
      framedCiphertextV1: {
        ciphertextEncodings: [...SUPPORTED_FRAMED_CIPHERTEXT_ENCODINGS],
        compressionAlgorithms: [...SUPPORTED_FRAMED_COMPRESSION_ALGORITHMS],
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
export async function createDaemonChannel(
  transport: Transport,
  daemonKeyPair: KeyPair,
  events: EncryptedChannelEvents = {},
  options: DaemonChannelOptions = {},
): Promise<EncryptedChannel> {
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

    // Messages retained while ready or a same-key replay is crossing the transport boundary.
    const bufferedMessages: TransportMessage[] = [];
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

    /** Rejects the unattached factory once without requesting a physical close. */
    const rejectFactory = (error: Error): void => {
      phase = "closed";
      if (factorySettled) return;
      factorySettled = true;
      reject(error);
    };

    /** Closes and rejects a daemon handshake after an accepted hello cannot safely attach. */
    const failHandshake = (error: unknown, closeCode = 1011): void => {
      if (phase === "closed") return;
      // Normalized protocol error shared by the promise and physical close reason.
      const err = error instanceof Error ? error : new Error(String(error));
      phase = "closed";
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
      });
      attachedChannel.setState("open");
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

    /** Drains handshake backlog serially and hands post-attach frames to the channel in order. */
    const drainBufferedMessages = async (): Promise<void> => {
      if (drainingBufferedMessages || phase === "sending-ready" || phase === "closed") return;
      drainingBufferedMessages = true;
      try {
        while (bufferedMessages.length > 0) {
          // FIFO head retained across every awaited transport or crypto boundary.
          const buffered = bufferedMessages.shift();
          if (!buffered) continue;
          if (phase === "pending-confirm") {
            await handlePendingConfirm(buffered);
            continue;
          }
          if (phase === "open") {
            if (shouldIgnoreBufferedReady(buffered)) continue;
            await transport.onmessage?.(buffered);
            continue;
          }
          break;
        }
      } catch (error) {
        const closeCode =
          error instanceof Error && error.message === REHANDSHAKE_KEY_MISMATCH_CLOSE_REASON
            ? REHANDSHAKE_KEY_MISMATCH_CLOSE_CODE
            : 1011;
        failHandshake(error, closeCode);
      } finally {
        drainingBufferedMessages = false;
        if (bufferedMessages.length > 0 && (phase === "pending-confirm" || phase === "open")) {
          void drainBufferedMessages();
        }
      }
    };

    /** Buffers every post-hello message until ready and optional confirm complete in FIFO. */
    const bufferPostHelloMessage = (message: TransportMessage): void => {
      bufferedMessages.push(message);
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

        framedSelection = resolveDaemonFramedSelection(
          parseFramedCiphertextV1Offer(msg),
          configuredEncoding,
        );
        binaryCiphertext = framedSelection
          ? framedSelection.ciphertextEncoding === "binary"
          : configuredEncoding !== "base64" && supportsBinaryCiphertext(msg);
        savedReadyText = buildDaemonReadyText(binaryCiphertext, framedSelection);
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
          failHandshake(err);
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
          failHandshake(error);
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

    Object.assign(transport, {
      onmessage: (message: TransportMessage) => this.handleMessage(message),
      onclose: (code: number, reason: string) => {
        this.state = "closed";
        this.events.onclose?.(code, reason);
        for (const cb of this.onCloseCallbacks) cb();
      },
      onerror: (error: Error) => {
        this.events.onerror?.(error);
      },
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

    try {
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
        const plaintext = this.options.framedCiphertextV1
          ? decodeIdentityEnvelope(plaintextBytes)
          : decodePlaintext(plaintextBytes, ciphertext.isBinary);
        if (typeof plaintext === "string" && isReservedModeConfirmText(plaintext)) {
          throw new Error("Received reserved e2ee_mode_confirm outside a pending selection");
        }
        this.events.onmessage?.(plaintext);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

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
    try {
      if (message.isBinary) return;
      const text = decodeTransportText(message.data);
      const parsed: unknown = JSON.parse(text);
      if (!isE2EEReadyMessage(parsed)) return;
      await this.transitionFromReady(parsed);
    } catch {
      // ignore non-ready handshake traffic
    }
  }

  /** Confirms the selected mode, drains queued sends, and exposes the open channel. */
  private async transitionFromReady(message: E2EEReadyMessage): Promise<void> {
    // COMPAT(framedCiphertextV1): introduced in v0.4.0-beta.4; remove after
    // 2027-08-18 once the supported peer floor requires framed-v1.
    const framedSelection = parseFramedCiphertextV1Selection(message);
    if (framedSelection) {
      this.state = "confirming";
      if (!(await this.tryConfirmFramedMode(framedSelection))) return;
      if (this.state !== "confirming") return;
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
    this.events.onopen?.();
    for (const cb of this.onOpenCallbacks) cb();
  }

  async send(data: string | ArrayBuffer): Promise<void> {
    if (this.state === "handshaking" || this.state === "confirming" || this.state === "opening") {
      if (this.pendingSends.length >= MAX_PENDING_SENDS) {
        this.pendingSends.shift();
      }
      this.pendingSends.push(data);
      return;
    }

    if (this.state !== "open") {
      throw new Error("Channel not open");
    }

    await this.sendApplicationFrame(data);
  }

  /** Encrypts and writes one application frame after the channel mode is fixed. */
  private async sendApplicationFrame(data: string | ArrayBuffer): Promise<void> {
    // Authenticated plaintext selected by the negotiated connection mode.
    const authenticatedPlaintext = this.options.framedCiphertextV1
      ? encodeIdentityEnvelope(data)
      : data;
    // NaCl bundle containing the nonce, authenticated ciphertext, and MAC.
    const ciphertext = encrypt(this.sharedKey, authenticatedPlaintext);
    if (this.options.framedCiphertextV1) {
      if (this.options.framedCiphertextV1.ciphertextEncoding === "binary") {
        await this.transport.send(ciphertext);
        return;
      }
      await this.transport.send(arrayBufferToBase64(ciphertext));
      return;
    }
    if (this.options.binaryCiphertext && data instanceof ArrayBuffer) {
      await this.transport.send(ciphertext);
      return;
    }
    // COMPAT(binaryCiphertext): added in v0.2.3, remove base64 binary sends
    // after 2027-01-27 once the supported peer floor includes negotiation.
    await this.transport.send(arrayBufferToBase64(ciphertext));
  }

  outboundWireByteLength(data: string | ArrayBuffer): number {
    const plaintextBytes = utf8ByteLength(data);
    if (this.options.framedCiphertextV1) {
      // Encrypted bytes include the authenticated envelope header.
      const encryptedBytes =
        plaintextBytes + FRAMED_CIPHERTEXT_HEADER_BYTES + ENCRYPTED_PAYLOAD_OVERHEAD_BYTES;
      return this.options.framedCiphertextV1.ciphertextEncoding === "binary"
        ? encryptedBytes
        : 4 * Math.ceil(encryptedBytes / 3);
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
        buildDaemonReadyText(this.options.binaryCiphertext === true, null);
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
    this.transport.close(code, reason);
  }

  isOpen(): boolean {
    return this.state === "open";
  }

  onTransitionToOpen(cb: () => void): void {
    this.onOpenCallbacks.push(cb);
  }

  onClose(cb: () => void): void {
    this.onCloseCallbacks.push(cb);
  }
}

function decodeTransportText(data: string | ArrayBuffer): string {
  return typeof data === "string" ? data : new TextDecoder().decode(data);
}

function requireArrayBuffer(data: string | ArrayBuffer): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  throw new Error("Binary WebSocket frame did not contain bytes");
}

/** Encodes an application payload in the exact authenticated v1 identity envelope. */
function encodeIdentityEnvelope(data: string | ArrayBuffer): ArrayBuffer {
  // Original application bytes preserved after the fixed header.
  const payload = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  if (payload.byteLength > 0xffffffff) {
    throw new Error("Framed ciphertext payload exceeds uint32 length");
  }

  // Contiguous authenticated plaintext passed to the existing NaCl primitive.
  const envelope = new Uint8Array(FRAMED_CIPHERTEXT_HEADER_BYTES + payload.byteLength);
  envelope[0] = FRAMED_CIPHERTEXT_MAGIC;
  envelope[1] = FRAMED_CIPHERTEXT_VERSION;
  envelope[2] = data instanceof ArrayBuffer ? FRAMED_CIPHERTEXT_BINARY_FLAG : 0;
  envelope[3] = FRAMED_CIPHERTEXT_IDENTITY_CODEC;
  new DataView(envelope.buffer).setUint32(4, payload.byteLength, false);
  envelope.set(payload, FRAMED_CIPHERTEXT_HEADER_BYTES);
  return envelope.buffer;
}

/** Decodes an authenticated v1 identity envelope into its original payload type. */
function decodeIdentityEnvelope(data: ArrayBuffer): string | ArrayBuffer {
  if (data.byteLength < FRAMED_CIPHERTEXT_HEADER_BYTES) {
    throw new Error("Framed ciphertext envelope is truncated");
  }

  const header = new Uint8Array(data, 0, FRAMED_CIPHERTEXT_HEADER_BYTES);
  if (header[0] !== FRAMED_CIPHERTEXT_MAGIC || header[1] !== FRAMED_CIPHERTEXT_VERSION) {
    throw new Error("Unsupported framed ciphertext envelope");
  }
  if (header[2] !== 0 && header[2] !== FRAMED_CIPHERTEXT_BINARY_FLAG) {
    throw new Error("Unsupported framed ciphertext flags");
  }
  if (header[3] !== FRAMED_CIPHERTEXT_IDENTITY_CODEC) {
    throw new Error("Unsupported framed ciphertext codec");
  }

  const payloadLength = new DataView(data).getUint32(4, false);
  if (payloadLength !== data.byteLength - FRAMED_CIPHERTEXT_HEADER_BYTES) {
    throw new Error("Framed ciphertext payload length mismatch");
  }

  const payload = data.slice(FRAMED_CIPHERTEXT_HEADER_BYTES);
  if (header[2] === FRAMED_CIPHERTEXT_BINARY_FLAG) return payload;
  return new TextDecoder("utf-8", { fatal: true }).decode(payload);
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

function utf8ByteLength(data: string | ArrayBuffer): number {
  return typeof data === "string" ? new TextEncoder().encode(data).byteLength : data.byteLength;
}

function keysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let difference = 0;
  for (let i = 0; i < a.byteLength; i += 1) {
    difference |= a[i] ^ b[i];
  }
  return difference === 0;
}
