export { createClientChannel, createDaemonChannel, EncryptedChannel } from "./encrypted-channel.js";
export type {
  CiphertextEncoding,
  ClientChannelOptions,
  ConfiguredCiphertextEncoding,
  DaemonChannelOptions,
  EncryptedChannelEvents,
  Transport,
  TransportMessage,
} from "./encrypted-channel.js";

export { createFflateFrameCompressionAdapter } from "./fflate-frame-compression.js";
export type { FflateFrameCompressionAdapter } from "./fflate-frame-compression.js";

export {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  exportSecretKey,
  importSecretKey,
} from "./crypto.js";
export type { KeyPair, SharedKey } from "./crypto.js";

export {
  framedCiphertextWireByteLength,
  MAX_COMPRESSION_RATIO,
  MAX_COMPRESSION_INPUT_BYTES,
  MIN_COMPRESSION_BYTES,
  MIN_COMPRESSION_SAVINGS_BYTES,
  MIN_COMPRESSION_SAVINGS_RATIO,
  prepareDeflateFramedPayload,
  prepareIdentityFramedPayload,
} from "./framed-ciphertext.js";
export type {
  FrameCompressionAdapter,
  FrameCompressionEncoder,
  FramedCiphertextEncoding,
  PreparedFramedPayload,
} from "./framed-ciphertext.js";
