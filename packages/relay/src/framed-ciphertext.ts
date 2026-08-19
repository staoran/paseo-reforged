import { base64ToArrayBuffer } from "./base64.js";

/** Byte marker identifying an authenticated Paseo framed payload. */
export const FRAMED_CIPHERTEXT_MAGIC = 0x50;

/** Current authenticated framed payload version. */
export const FRAMED_CIPHERTEXT_VERSION = 0x01;

/** Number of bytes before the encoded payload. */
export const FRAMED_CIPHERTEXT_HEADER_BYTES = 8;

/** NaCl nonce and authentication overhead added around framed plaintext. */
export const FRAMED_CIPHERTEXT_ENCRYPTION_OVERHEAD_BYTES = 40;

/** Largest logical application payload accepted by framed-v1. */
export const MAX_FRAMED_PAYLOAD_BYTES = 4 * 1024 * 1024;

/** Smallest logical payload eligible for framed compression. */
export const MIN_COMPRESSION_BYTES = 4 * 1024;

/** Smallest absolute reduction required for a compressed frame. */
export const MIN_COMPRESSION_SAVINGS_BYTES = 64;

/** Smallest proportional reduction required for a compressed frame. */
export const MIN_COMPRESSION_SAVINGS_RATIO = 0.05;

/** Largest authenticated original-to-encoded ratio accepted by the decoder. */
export const MAX_COMPRESSION_RATIO = 128;

/** Exclusive production relay limit for one framed ciphertext wire. */
export const MAX_FRAMED_WIRE_BYTES = 32 * 1024 * 1024;

/** WebSocket ciphertext representation fixed for one framed connection. */
export type FramedCiphertextEncoding = "base64" | "binary";

/** Complete standard Base64 grammar with canonical trailing padding. */
const CANONICAL_PADDED_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Framed payload codec fixed by the authenticated header. */
export type FramedCiphertextCodec = "identity" | "deflate-raw";

/** Prepared authenticated plaintext ready for encryption. */
export interface PreparedFramedPayload {
  /** Header and encoded payload passed to the authenticated cipher. */
  plaintext: ArrayBuffer;
  /** Whether the original application payload was binary. */
  binary: boolean;
  /** Codec applied before encryption. */
  codec: FramedCiphertextCodec;
  /** Original application payload length. */
  originalByteLength: number;
  /** Encoded payload length after the header. */
  encodedByteLength: number;
}

/** Decoded framed payload and authenticated metadata. */
export interface DecodedFramedPayload {
  /** Original application payload. */
  data: string | ArrayBuffer;
  /** Whether the original application payload was binary. */
  binary: boolean;
  /** Authenticated codec selected by the sender. */
  codec: FramedCiphertextCodec;
  /** Original application payload length. */
  originalByteLength: number;
  /** Encoded payload length after the header. */
  encodedByteLength: number;
}

/** Platform decoder used by the framed parser without importing a runtime-specific codec. */
export interface FrameCompressionAdapter {
  /** Inflates one independent raw DEFLATE frame within the supplied output bound. */
  inflateRaw(
    input: ArrayBuffer,
    expectedLength: number,
    maxOutputLength: number,
  ): Promise<ArrayBuffer>;
}

/** Returns the exact locked WebSocket wire length for an encoded framed payload. */
export function framedCiphertextWireByteLength(
  encodedByteLength: number,
  encoding: FramedCiphertextEncoding,
): number {
  // Encrypted bytes include both the authenticated header and NaCl overhead.
  const encryptedByteLength =
    encodedByteLength +
    FRAMED_CIPHERTEXT_HEADER_BYTES +
    FRAMED_CIPHERTEXT_ENCRYPTION_OVERHEAD_BYTES;
  return encoding === "binary" ? encryptedByteLength : 4 * Math.ceil(encryptedByteLength / 3);
}

/** Validates and decodes one ciphertext wire using the connection-locked representation. */
export function decodeFramedCiphertextWire(
  data: string | ArrayBuffer,
  isBinary: boolean,
  encoding: FramedCiphertextEncoding,
): ArrayBuffer {
  if (encoding === "binary") {
    if (!isBinary || !(data instanceof ArrayBuffer)) {
      throw new Error("Framed binary ciphertext requires a binary WebSocket frame");
    }
    if (data.byteLength >= MAX_FRAMED_WIRE_BYTES) {
      throw new Error("Framed ciphertext exceeds the wire byte limit");
    }
    return data;
  }
  if (isBinary || typeof data !== "string") {
    throw new Error("Framed Base64 ciphertext requires a text WebSocket frame");
  }
  if (data.length >= MAX_FRAMED_WIRE_BYTES) {
    throw new Error("Framed ciphertext exceeds the wire byte limit");
  }
  if (data.length % 4 !== 0 || !CANONICAL_PADDED_BASE64.test(data)) {
    throw new Error("Framed ciphertext requires canonical padded Base64");
  }

  // Number of terminal padding characters represented by the canonical grammar.
  let paddingBytes = 0;
  if (data.endsWith("==")) {
    paddingBytes = 2;
  } else if (data.endsWith("=")) {
    paddingBytes = 1;
  }
  // Exact output size established before the decoder allocates its result.
  const decodedByteLength = (data.length / 4) * 3 - paddingBytes;
  if (decodedByteLength >= MAX_FRAMED_WIRE_BYTES) {
    throw new Error("Framed ciphertext exceeds the decoded wire byte limit");
  }
  // Ciphertext bytes copied by the existing portable Base64 adapter.
  const decoded = base64ToArrayBuffer(data);
  if (decoded.byteLength !== decodedByteLength) {
    throw new Error("Framed ciphertext Base64 decoded length mismatch");
  }
  return decoded;
}

/** Encodes one application payload in the authenticated identity envelope. */
export function prepareIdentityFramedPayload(data: string | ArrayBuffer): PreparedFramedPayload {
  // Original bytes copied into the contiguous authenticated plaintext.
  const payload = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  if (payload.byteLength > MAX_FRAMED_PAYLOAD_BYTES) {
    throw new Error("Framed ciphertext payload exceeds the logical byte limit");
  }

  // Fixed header followed by the unmodified application bytes.
  const plaintext = new Uint8Array(FRAMED_CIPHERTEXT_HEADER_BYTES + payload.byteLength);
  plaintext[0] = FRAMED_CIPHERTEXT_MAGIC;
  plaintext[1] = FRAMED_CIPHERTEXT_VERSION;
  plaintext[2] = data instanceof ArrayBuffer ? 0x01 : 0x00;
  plaintext[3] = 0x00;
  new DataView(plaintext.buffer).setUint32(4, payload.byteLength, false);
  plaintext.set(payload, FRAMED_CIPHERTEXT_HEADER_BYTES);

  return {
    plaintext: plaintext.buffer,
    binary: data instanceof ArrayBuffer,
    codec: "identity",
    originalByteLength: payload.byteLength,
    encodedByteLength: payload.byteLength,
  };
}

/** Decodes and validates one authenticated framed envelope. */
export async function decodeFramedPayload(
  plaintext: ArrayBuffer,
  compressionAdapter?: FrameCompressionAdapter,
): Promise<DecodedFramedPayload> {
  if (plaintext.byteLength < FRAMED_CIPHERTEXT_HEADER_BYTES) {
    throw new Error("Framed ciphertext envelope is truncated");
  }

  // Header fields are authenticated because parsing occurs only after decryption.
  const header = new Uint8Array(plaintext, 0, FRAMED_CIPHERTEXT_HEADER_BYTES);
  if (header[0] !== FRAMED_CIPHERTEXT_MAGIC || header[1] !== FRAMED_CIPHERTEXT_VERSION) {
    throw new Error("Unsupported framed ciphertext envelope");
  }
  if (header[2] !== 0x00 && header[2] !== 0x01) {
    throw new Error("Unsupported framed ciphertext flags");
  }
  if (header[3] !== 0x00 && header[3] !== 0x01) {
    throw new Error("Unsupported framed ciphertext codec");
  }

  // Length is checked before copying or decoding application bytes.
  const originalByteLength = new DataView(plaintext).getUint32(4, false);
  if (originalByteLength > MAX_FRAMED_PAYLOAD_BYTES) {
    throw new Error("Framed ciphertext payload exceeds the logical byte limit");
  }
  const encodedByteLength = plaintext.byteLength - FRAMED_CIPHERTEXT_HEADER_BYTES;
  // Original application type authenticated by the envelope flags.
  const binary = header[2] === 0x01;
  // Encoded bytes copied out of the authenticated plaintext before decoding.
  const encodedPayload = plaintext.slice(FRAMED_CIPHERTEXT_HEADER_BYTES);
  if (header[3] === 0x00) {
    if (originalByteLength !== encodedByteLength) {
      throw new Error("Framed ciphertext payload length mismatch");
    }
    return {
      data: binary
        ? encodedPayload
        : new TextDecoder("utf-8", { fatal: true }).decode(encodedPayload),
      binary,
      codec: "identity",
      originalByteLength,
      encodedByteLength,
    };
  }

  if (!compressionAdapter) {
    throw new Error("Framed ciphertext compression decoder is unavailable");
  }
  if (originalByteLength < MIN_COMPRESSION_BYTES) {
    throw new Error("Framed ciphertext payload is below the compression minimum");
  }
  if (encodedByteLength === 0) {
    throw new Error("Framed ciphertext encoded payload is empty");
  }
  // Required byte reduction combining the fixed and proportional gates.
  const requiredSavings = Math.max(
    MIN_COMPRESSION_SAVINGS_BYTES,
    Math.ceil(originalByteLength * MIN_COMPRESSION_SAVINGS_RATIO),
  );
  if (encodedByteLength > originalByteLength - requiredSavings) {
    throw new Error("Framed ciphertext payload does not meet compression savings");
  }
  if (originalByteLength > encodedByteLength * MAX_COMPRESSION_RATIO) {
    throw new Error("Framed ciphertext payload exceeds the compression ratio limit");
  }
  // Bounded raw DEFLATE output supplied by the platform adapter.
  const payload = await compressionAdapter.inflateRaw(
    encodedPayload,
    originalByteLength,
    originalByteLength + 1,
  );
  if (payload.byteLength !== originalByteLength) {
    throw new Error("Framed ciphertext decompressed output length mismatch");
  }
  return {
    data: binary ? payload : new TextDecoder("utf-8", { fatal: true }).decode(payload),
    binary,
    codec: "deflate-raw",
    originalByteLength,
    encodedByteLength,
  };
}
