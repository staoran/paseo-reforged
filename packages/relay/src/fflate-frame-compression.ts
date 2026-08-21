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

/** Returns a standalone ArrayBuffer containing exactly the supplied view. */
function toStandaloneArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

/** Validates a caller-supplied byte length before allocating an output buffer. */
function assertCompressionByteLength(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_COMPRESSION_INPUT_BYTES) {
    throw new Error(`${name} exceeds the framed compression byte limit`);
  }
}

/** Validates the exact one-byte overflow sentinel used by the framed parser. */
function assertOutputBound(expectedLength: number, maxOutputLength: number): void {
  if (
    !Number.isSafeInteger(maxOutputLength) ||
    maxOutputLength !== expectedLength + 1 ||
    maxOutputLength > MAX_COMPRESSION_INPUT_BYTES + 1
  ) {
    throw new Error("Invalid bounded raw DEFLATE output lengths");
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
      if (!Number.isInteger(level) || level < 0 || level > MAX_FFLATE_LEVEL) {
        throw new Error("Invalid fflate compression level");
      }
      const output = deflateSync(new Uint8Array(input), {
        level: level as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
      });
      return toStandaloneArrayBuffer(output);
    },
  };
}
