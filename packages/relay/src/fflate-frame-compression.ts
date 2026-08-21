import { deflateSync, inflateSync } from "fflate";
import {
  MAX_COMPRESSION_INPUT_BYTES,
  type FrameCompressionAdapter,
  type FrameCompressionEncoder,
} from "./framed-ciphertext.js";

/** Portable raw DEFLATE codec; runtime capability gates decide whether a client advertises it. */
export type FflateFrameCompressionAdapter = FrameCompressionAdapter & FrameCompressionEncoder;

/** Largest compression level accepted by fflate. */
const MAX_FFLATE_LEVEL = 9;

/** Compression level literals accepted by fflate's typed options. */
type FflateCompressionLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** Returns a standalone ArrayBuffer containing exactly the supplied view. */
function toStandaloneArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

/** Validates a caller-supplied byte length before allocating an output buffer. */
function assertCompressionByteLength(value: number, name: string): void {
  const isSafeInteger = Number.isSafeInteger(value);
  const isNonNegative = value >= 0;
  const isWithinLimit = value <= MAX_COMPRESSION_INPUT_BYTES;
  if (!isSafeInteger) throw new Error(`${name} exceeds the framed compression byte limit`);
  if (!isNonNegative) throw new Error(`${name} exceeds the framed compression byte limit`);
  if (!isWithinLimit) throw new Error(`${name} exceeds the framed compression byte limit`);
}

/** Validates the exact one-byte overflow sentinel used by the framed parser. */
function assertOutputBound(expectedLength: number, maxOutputLength: number): void {
  const isSafeInteger = Number.isSafeInteger(maxOutputLength);
  const hasOverflowSentinel = maxOutputLength === expectedLength + 1;
  const isWithinLimit = maxOutputLength <= MAX_COMPRESSION_INPUT_BYTES + 1;
  if (!isSafeInteger) throw new Error("Invalid bounded raw DEFLATE output lengths");
  if (!hasOverflowSentinel) throw new Error("Invalid bounded raw DEFLATE output lengths");
  if (!isWithinLimit) throw new Error("Invalid bounded raw DEFLATE output lengths");
}

/** Converts a validated numeric level to fflate's literal-level union. */
function parseFflateCompressionLevel(level: number): FflateCompressionLevel {
  switch (level) {
    case 0:
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
    case 6:
    case 7:
    case 8:
    case 9:
      return level;
    default:
      throw new Error("Invalid fflate compression level");
  }
}

/** Creates the portable raw DEFLATE adapter used by validated non-Node runtimes. */
export function createFflateFrameCompressionAdapter(): FflateFrameCompressionAdapter {
  return {
    /** Inflates one frame and rejects truncated or oversized output. */
    async inflateRaw(options): Promise<ArrayBuffer> {
      const { input, expectedLength, maxOutputLength } = options;
      assertCompressionByteLength(input.byteLength, "Compressed input");
      assertCompressionByteLength(expectedLength, "Expected output");
      assertOutputBound(expectedLength, maxOutputLength);

      // fflate truncates into a short `out`; the extra byte makes overflow observable.
      const output = inflateSync(new Uint8Array(input), {
        out: new Uint8Array(maxOutputLength),
      });
      if (output.byteLength > expectedLength) {
        throw new Error("Framed ciphertext decompressed length exceeds authenticated length");
      }
      if (output.byteLength < expectedLength) {
        throw new Error(
          "Framed ciphertext decompressed length is shorter than authenticated length",
        );
      }
      return toStandaloneArrayBuffer(output);
    },

    /** Compresses one independent raw DEFLATE frame for compatibility vectors. */
    async deflateRaw({ input, level }): Promise<ArrayBuffer> {
      assertCompressionByteLength(input.byteLength, "Compression input");
      const isInteger = Number.isInteger(level);
      const isNonNegative = level >= 0;
      const isWithinLimit = level <= MAX_FFLATE_LEVEL;
      if (!isInteger) throw new Error("Invalid fflate compression level");
      if (!isNonNegative) throw new Error("Invalid fflate compression level");
      if (!isWithinLimit) throw new Error("Invalid fflate compression level");
      const fflateLevel = parseFflateCompressionLevel(level);
      const output = deflateSync(new Uint8Array(input), {
        level: fflateLevel,
      });
      return toStandaloneArrayBuffer(output);
    },
  };
}
