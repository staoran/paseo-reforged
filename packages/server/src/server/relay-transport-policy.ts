import type { RelayTransportConfig } from "@getpaseo/protocol/messages";
import type {
  ConfiguredCiphertextEncoding,
  NegotiatedEncryptedTransport,
} from "@getpaseo/relay/e2ee";

/** Compression codec fixed by the first relay framed transport version. */
export const RELAY_TRANSPORT_COMPRESSION_ALGORITHM = "deflate-raw" as const;

/** Fully defaulted user policy used by relay runtime code. */
export interface ConfiguredRelayTransportPolicy {
  /** Preferred representation for data connections created after this value is read. */
  readonly ciphertextEncoding: ConfiguredCiphertextEncoding;
  /** Whether eligible frames may use the fixed compression codec. */
  readonly compressionEnabled: boolean;
}

/** Immutable E2EE result captured after one daemon data connection handshakes. */
export type NegotiatedRelayTransportPolicy = NegotiatedEncryptedTransport;

/** Stable connection-level reason that disables relay compression. */
export type RelayTransportCompressionReason =
  | "configured-disabled"
  | "legacy-mode"
  | "peer-unsupported";

/** Compression policy resolved for one not-yet-started outbound frame. */
export interface EffectiveRelayTransportCompressionPolicy {
  /** Whether this frame may enter the fixed codec's traffic and size gates. */
  readonly enabled: boolean;
  /** Fixed codec when enabled, otherwise no codec. */
  readonly algorithm: typeof RELAY_TRANSPORT_COMPRESSION_ALGORITHM | null;
  /** Null when enabled, otherwise the stable connection-level disable reason. */
  readonly reason: RelayTransportCompressionReason | null;
}

/** Effective policy combining live configuration with one immutable connection result. */
export interface EffectiveRelayTransportPolicy {
  /** Negotiated wire mode, immutable for the connection. */
  readonly mode: NegotiatedRelayTransportPolicy["mode"];
  /** Negotiated ciphertext representation, immutable for the connection. */
  readonly ciphertextEncoding: NegotiatedRelayTransportPolicy["ciphertextEncoding"];
  /** Per-frame compression eligibility resolved from current configuration. */
  readonly compression: EffectiveRelayTransportCompressionPolicy;
}

/** Fills runtime defaults without materializing them in persisted or RPC config. */
export function resolveConfiguredRelayTransportPolicy(
  config: RelayTransportConfig | undefined,
): ConfiguredRelayTransportPolicy {
  return {
    ciphertextEncoding: config?.ciphertextEncoding ?? "auto",
    compressionEnabled: config?.compression?.enabled ?? true,
  };
}

/** Combines current configuration with one immutable negotiated connection snapshot. */
export function resolveRelayTransportPolicy(
  configured: ConfiguredRelayTransportPolicy,
  negotiated: NegotiatedRelayTransportPolicy,
): EffectiveRelayTransportPolicy {
  if (negotiated.mode === "legacy") {
    return {
      mode: negotiated.mode,
      ciphertextEncoding: negotiated.ciphertextEncoding,
      compression: { enabled: false, algorithm: null, reason: "legacy-mode" },
    };
  }
  if (!configured.compressionEnabled) {
    return {
      mode: negotiated.mode,
      ciphertextEncoding: negotiated.ciphertextEncoding,
      compression: { enabled: false, algorithm: null, reason: "configured-disabled" },
    };
  }
  if (!negotiated.compressionAlgorithms.includes(RELAY_TRANSPORT_COMPRESSION_ALGORITHM)) {
    return {
      mode: negotiated.mode,
      ciphertextEncoding: negotiated.ciphertextEncoding,
      compression: { enabled: false, algorithm: null, reason: "peer-unsupported" },
    };
  }
  return {
    mode: negotiated.mode,
    ciphertextEncoding: negotiated.ciphertextEncoding,
    compression: {
      enabled: true,
      algorithm: RELAY_TRANSPORT_COMPRESSION_ALGORITHM,
      reason: null,
    },
  };
}
