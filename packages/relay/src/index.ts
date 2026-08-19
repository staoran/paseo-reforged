export type { ConnectionRole, RelaySessionAttachment } from "./types.js";

export {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  deriveSharedKey,
  encrypt,
  decrypt,
} from "./crypto.js";

export { createFflateFrameCompressionAdapter } from "./fflate-frame-compression.js";
export type { FflateFrameCompressionAdapter } from "./fflate-frame-compression.js";

export {
  base64EncryptedWireByteLength,
  createClientChannel,
  createDaemonChannel,
  EncryptedChannel,
  maxBase64EncryptedPlaintextByteLength,
} from "./encrypted-channel.js";
export type {
  CiphertextEncoding,
  ClientChannelOptions,
  ConfiguredCiphertextEncoding,
  DaemonChannelOptions,
  EncryptedChannelEvents,
  Transport,
} from "./encrypted-channel.js";
