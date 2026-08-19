export {
  createClientChannel,
  createDaemonChannel,
  EncryptedChannel,
  MAX_PENDING_RECEIVE_WIRE_BYTES,
  preparedEncryptedFrameWireByteLength,
} from "./encrypted-channel.js";
export type {
  CiphertextEncoding,
  ClientChannelOptions,
  ConfiguredCiphertextEncoding,
  DaemonChannelOptions,
  EncryptedChannelEvents,
  NegotiatedEncryptedTransport,
  PreparedEncryptedFrame,
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
  MAX_FRAMED_WIRE_BYTES,
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
