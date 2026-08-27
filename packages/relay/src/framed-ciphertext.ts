import { base64ToArrayBuffer } from "./base64.js";

/** Byte marker identifying an authenticated Paseo framed payload. */
export const FRAMED_CIPHERTEXT_MAGIC = 0x50;

/** Current authenticated framed payload version. */
export const FRAMED_CIPHERTEXT_VERSION = 0x01;

/** Number of bytes before the encoded payload. */
export const FRAMED_CIPHERTEXT_HEADER_BYTES = 8;

/** NaCl nonce and authentication overhead added around framed plaintext. */
export const FRAMED_CIPHERTEXT_ENCRYPTION_OVERHEAD_BYTES = 40;

/** Largest original application payload eligible for framed compression. */
export const MAX_COMPRESSION_INPUT_BYTES = 4 * 1024 * 1024;

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

/** Largest identity payload that can still fit below the binary framed wire limit. */
export const MAX_FRAMED_IDENTITY_PAYLOAD_BYTES =
  MAX_FRAMED_WIRE_BYTES -
  FRAMED_CIPHERTEXT_HEADER_BYTES -
  FRAMED_CIPHERTEXT_ENCRYPTION_OVERHEAD_BYTES -
  1;

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

/** Complete bounded input for one raw DEFLATE decode. */
export interface InflateRawFrameOptions {
  /** Independent raw DEFLATE bytes. */
  input: ArrayBuffer;
  /** Authenticated original application byte length. */
  expectedLength: number;
  /** Exclusive decoder output ceiling used to detect expansion. */
  maxOutputLength: number;
}

/** Platform decoder used by the framed parser without importing a runtime-specific codec. */
export interface FrameCompressionAdapter {
  /** Inflates one independent raw DEFLATE frame within the supplied output bound. */
  inflateRaw(options: InflateRawFrameOptions): Promise<ArrayBuffer>;
}

/** Complete input for one raw DEFLATE encode. */
export interface DeflateRawFrameOptions {
  /** Original application bytes to encode. */
  input: ArrayBuffer;
  /** Private implementation level; never serialized into the wire envelope. */
  level: number;
}

/** Platform encoder used by the daemon without exposing its level on wire or config. */
export interface FrameCompressionEncoder {
  /** Compresses one independent raw DEFLATE frame at the caller's private level. */
  deflateRaw(options: DeflateRawFrameOptions): Promise<ArrayBuffer>;
}

/** Locked wire representation and opcode supplied to one framed ciphertext decoder. */
export interface DecodeFramedCiphertextWireOptions {
  /** Untrusted WebSocket frame payload. */
  data: string | ArrayBuffer;
  /** Whether the transport delivered a binary opcode. */
  isBinary: boolean;
  /** Representation fixed by the authenticated handshake. */
  encoding: FramedCiphertextEncoding;
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
  options: DecodeFramedCiphertextWireOptions,
): ArrayBuffer {
  const { data, isBinary, encoding } = options;
  if (encoding === "binary") {
    /** Whether the locked binary representation matches both WebSocket opcode and payload. */
    const hasBinaryOpcodeAndPayload = isBinary && data instanceof ArrayBuffer;
    if (!hasBinaryOpcodeAndPayload) {
      throw new Error("Framed binary ciphertext requires a binary WebSocket frame");
    }
    if (data.byteLength >= MAX_FRAMED_WIRE_BYTES) {
      throw new Error("Framed ciphertext exceeds the wire byte limit");
    }
    return data;
  }
  /** Whether the locked Base64 representation matches both WebSocket opcode and payload. */
  const hasBase64TextOpcodeAndPayload = !isBinary && typeof data === "string";
  if (!hasBase64TextOpcodeAndPayload) {
    throw new Error("Framed Base64 ciphertext requires a text WebSocket frame");
  }
  if (data.length >= MAX_FRAMED_WIRE_BYTES) {
    throw new Error("Framed ciphertext exceeds the wire byte limit");
  }
  /** Whether the text is a complete canonical padded Base64 representation. */
  const hasCanonicalPaddedBase64 = data.length % 4 === 0 && CANONICAL_PADDED_BASE64.test(data);
  if (!hasCanonicalPaddedBase64) {
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

/** Normalizes application data into the bytes authenticated by a framed envelope. */
function applicationPayloadBytes(data: string | ArrayBuffer): Uint8Array {
  // Original bytes copied into the contiguous authenticated plaintext.
  const payload = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  if (payload.byteLength > MAX_FRAMED_IDENTITY_PAYLOAD_BYTES) {
    throw new Error("Framed ciphertext payload exceeds the logical byte limit");
  }
  return payload;
}

/** Inputs for building one authenticated framed envelope. */
interface PrepareFramedPayloadOptions {
  /** Original application payload whose type and length are authenticated. */
  data: string | ArrayBuffer;
  /** Identity or independently compressed bytes stored after the header. */
  encodedPayload: ArrayBuffer;
  /** Authenticated codec identifier for the encoded bytes. */
  codec: FramedCiphertextCodec;
}

/** Builds one authenticated framed envelope from validated original and encoded bytes. */
function prepareFramedPayload(options: PrepareFramedPayloadOptions): PreparedFramedPayload {
  const { data, encodedPayload, codec } = options;
  // Original bytes determine the authenticated type and logical length.
  const originalPayload = applicationPayloadBytes(data);
  // Encoded bytes copied into the contiguous authenticated plaintext.
  const encodedBytes = new Uint8Array(encodedPayload);

  // Fixed header followed by the unmodified application bytes.
  const plaintext = new Uint8Array(FRAMED_CIPHERTEXT_HEADER_BYTES + encodedBytes.byteLength);
  plaintext[0] = FRAMED_CIPHERTEXT_MAGIC;
  plaintext[1] = FRAMED_CIPHERTEXT_VERSION;
  plaintext[2] = data instanceof ArrayBuffer ? 0x01 : 0x00;
  plaintext[3] = codec === "identity" ? 0x00 : 0x01;
  new DataView(plaintext.buffer).setUint32(4, originalPayload.byteLength, false);
  plaintext.set(encodedBytes, FRAMED_CIPHERTEXT_HEADER_BYTES);

  return {
    plaintext: plaintext.buffer,
    binary: data instanceof ArrayBuffer,
    codec,
    originalByteLength: originalPayload.byteLength,
    encodedByteLength: encodedBytes.byteLength,
  };
}

/** Encodes one application payload in the authenticated identity envelope. */
export function prepareIdentityFramedPayload(data: string | ArrayBuffer): PreparedFramedPayload {
  // Identity bytes are identical to the normalized original application bytes.
  const payload = applicationPayloadBytes(data);
  // Standalone buffer prevents a view offset from entering the authenticated envelope.
  const encodedPayload = payload.slice().buffer;
  return prepareFramedPayload({ data, encodedPayload, codec: "identity" });
}

/** Encodes one safely compressed application payload in a deflate-raw envelope. */
export function prepareDeflateFramedPayload(
  data: string | ArrayBuffer,
  encodedPayload: ArrayBuffer,
): PreparedFramedPayload {
  // Logical length used by the sender-side savings and ratio gates.
  const originalByteLength = applicationPayloadBytes(data).byteLength;
  if (originalByteLength > MAX_COMPRESSION_INPUT_BYTES) {
    throw new Error("Framed ciphertext payload exceeds the compression input limit");
  }
  // Encoded size supplied by the runtime-specific raw DEFLATE adapter.
  const encodedByteLength = encodedPayload.byteLength;
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
  return prepareFramedPayload({ data, encodedPayload, codec: "deflate-raw" });
}

/** Authenticated plaintext and optional decoder supplied to the framed payload parser. */
export interface DecodeFramedPayloadOptions {
  /** Decrypted authenticated envelope bytes. */
  plaintext: ArrayBuffer;
  /** Runtime decoder required only for deflate-raw frames. */
  compressionAdapter?: FrameCompressionAdapter;
}

/** Decodes and validates one authenticated framed envelope. */
export async function decodeFramedPayload(
  options: DecodeFramedPayloadOptions,
): Promise<DecodedFramedPayload> {
  const { plaintext, compressionAdapter } = options;
  if (plaintext.byteLength < FRAMED_CIPHERTEXT_HEADER_BYTES) {
    throw new Error("Framed ciphertext envelope is truncated");
  }

  // Header fields are authenticated because parsing occurs only after decryption.
  const header = new Uint8Array(plaintext, 0, FRAMED_CIPHERTEXT_HEADER_BYTES);
  /** Whether authenticated magic and version select the supported envelope version. */
  const hasSupportedEnvelopeVersion =
    header[0] === FRAMED_CIPHERTEXT_MAGIC && header[1] === FRAMED_CIPHERTEXT_VERSION;
  if (!hasSupportedEnvelopeVersion) {
    throw new Error("Unsupported framed ciphertext envelope");
  }
  /** Whether the authenticated original-payload type flag is one of the v1 values. */
  const hasSupportedPayloadFlag = header[2] === 0x00 || header[2] === 0x01;
  if (!hasSupportedPayloadFlag) {
    throw new Error("Unsupported framed ciphertext flags");
  }
  /** Whether the authenticated codec flag is one of the v1 values. */
  const hasSupportedCodecFlag = header[3] === 0x00 || header[3] === 0x01;
  if (!hasSupportedCodecFlag) {
    throw new Error("Unsupported framed ciphertext codec");
  }

  // Length is checked before copying or decoding application bytes.
  const originalByteLength = new DataView(plaintext).getUint32(4, false);
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
  if (originalByteLength > MAX_COMPRESSION_INPUT_BYTES) {
    throw new Error("Framed ciphertext payload exceeds the compression input limit");
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
  const payload = await compressionAdapter.inflateRaw({
    input: encodedPayload,
    expectedLength: originalByteLength,
    maxOutputLength: originalByteLength + 1,
  });
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
