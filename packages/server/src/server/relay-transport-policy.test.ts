import { describe, expect, test } from "vitest";

import {
  resolveConfiguredRelayTransportPolicy,
  resolveRelayTransportPolicy,
  type NegotiatedRelayTransportPolicy,
} from "./relay-transport-policy.js";

/** Framed binary connection that negotiated the fixed v1 compression codec. */
const framedBinaryWithDeflate = {
  mode: "framed-v1",
  ciphertextEncoding: "binary",
  compressionAlgorithms: ["deflate-raw"],
} as const satisfies NegotiatedRelayTransportPolicy;

describe("relay transport policy resolver", () => {
  test("fills runtime defaults without materializing configurable codec or level fields", () => {
    // In-memory defaults resolved from a legacy config without a transport block.
    const configured = resolveConfiguredRelayTransportPolicy(undefined);

    expect(configured).toEqual({
      ciphertextEncoding: "auto",
      compressionEnabled: true,
    });
  });

  test("preserves independently configured encoding and compression values", () => {
    // Fully resolved policy containing both explicit user preferences.
    const configured = resolveConfiguredRelayTransportPolicy({
      ciphertextEncoding: "base64",
      compression: { enabled: false },
    });

    expect(configured).toEqual({
      ciphertextEncoding: "base64",
      compressionEnabled: false,
    });
  });

  test("keeps a legacy connection on identity regardless of configured compression", () => {
    // User policy requesting binary representation and eligible compression.
    const configured = resolveConfiguredRelayTransportPolicy({
      ciphertextEncoding: "binary",
      compression: { enabled: true },
    });
    // Immutable legacy connection result without framed codec negotiation.
    const negotiated = {
      mode: "legacy",
      ciphertextEncoding: "hybrid",
      compressionAlgorithms: [],
    } as const satisfies NegotiatedRelayTransportPolicy;

    expect(resolveRelayTransportPolicy(configured, negotiated)).toEqual({
      mode: "legacy",
      ciphertextEncoding: "hybrid",
      compression: {
        enabled: false,
        algorithm: null,
        reason: "legacy-mode",
      },
    });
  });

  test("reports configured-disabled before considering framed peer codec support", () => {
    // Explicit user switch that disables compression attempts.
    const configured = resolveConfiguredRelayTransportPolicy({
      compression: { enabled: false },
    });
    // Framed connection without the fixed codec in its authenticated intersection.
    const negotiated = {
      mode: "framed-v1",
      ciphertextEncoding: "base64",
      compressionAlgorithms: [],
    } as const satisfies NegotiatedRelayTransportPolicy;

    expect(resolveRelayTransportPolicy(configured, negotiated).compression).toEqual({
      enabled: false,
      algorithm: null,
      reason: "configured-disabled",
    });
  });

  test("reports peer-unsupported when a framed peer did not negotiate deflate-raw", () => {
    // Default policy permits compression when the peer can decode it.
    const configured = resolveConfiguredRelayTransportPolicy(undefined);
    // Framed binary connection that negotiated no compression codecs.
    const negotiated = {
      mode: "framed-v1",
      ciphertextEncoding: "binary",
      compressionAlgorithms: [],
    } as const satisfies NegotiatedRelayTransportPolicy;

    expect(resolveRelayTransportPolicy(configured, negotiated).compression).toEqual({
      enabled: false,
      algorithm: null,
      reason: "peer-unsupported",
    });
  });

  test("enables only deflate-raw when configuration and framed negotiation allow it", () => {
    // Default configured policy used with the reusable supported connection snapshot.
    const configured = resolveConfiguredRelayTransportPolicy(undefined);

    expect(resolveRelayTransportPolicy(configured, framedBinaryWithDeflate)).toEqual({
      mode: "framed-v1",
      ciphertextEncoding: "binary",
      compression: {
        enabled: true,
        algorithm: "deflate-raw",
        reason: null,
      },
    });
  });

  test("keeps the negotiated encoding immutable when configured preference changes", () => {
    // Updated preference intentionally differs from the existing connection selection.
    const configured = resolveConfiguredRelayTransportPolicy({
      ciphertextEncoding: "base64",
    });

    expect(
      resolveRelayTransportPolicy(configured, framedBinaryWithDeflate).ciphertextEncoding,
    ).toBe("binary");
  });
});
