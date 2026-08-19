import { describe, expect, test } from "vitest";

import {
  MutableDaemonConfigPatchSchema,
  MutableDaemonConfigSchema,
  ServerInfoStatusPayloadSchema,
} from "./messages.js";

// Valid optional transport shapes accepted by config responses and patches.
const validTransportCases = [
  ["auto encoding-only transport", { ciphertextEncoding: "auto" }],
  ["base64 encoding-only transport", { ciphertextEncoding: "base64" }],
  ["binary encoding-only transport", { ciphertextEncoding: "binary" }],
  ["enabled compression-only transport", { compression: { enabled: true } }],
  ["disabled compression-only transport", { compression: { enabled: false } }],
] as const;

// Invalid transport values excluded from the v1 RPC contract.
const invalidTransportCases = [
  ["an unsupported ciphertext encoding", { ciphertextEncoding: "text" }],
  ["a non-boolean compression switch", { compression: { enabled: "yes" } }],
  ["a compression algorithm", { compression: { enabled: true, algorithm: "gzip" } }],
  ["a compression strategy", { compression: { enabled: true, strategy: "always" } }],
  ["a compression level", { compression: { enabled: true, level: 3 } }],
  ["an unknown transport field", { ciphertextEncoding: "auto", unknownTransportField: true }],
  [
    "an unknown compression field",
    { compression: { enabled: true, unknownCompressionField: true } },
  ],
] as const;

describe("relay transport policy protocol contract", () => {
  test.each(validTransportCases)("preserves %s in config responses", (_label, transport) => {
    // Parsed full config returned to relay transport settings clients.
    const config = MutableDaemonConfigSchema.parse({
      relay: {
        enabled: true,
        transport,
      },
      mcp: { injectIntoAgents: false },
    });

    expect(config.relay).toEqual({ enabled: true, transport });
  });

  test.each(validTransportCases)("preserves %s in config patches", (_label, transport) => {
    // Parsed partial config sent by relay transport settings clients.
    const patch = MutableDaemonConfigPatchSchema.parse({
      relay: {
        transport,
      },
    });

    expect(patch.relay).toEqual({ transport });
  });

  test.each(invalidTransportCases)("rejects %s in config patches", (_label, transport) => {
    // Invalid patch must fail instead of passing unknown policy through.
    const parsed = MutableDaemonConfigPatchSchema.safeParse({
      relay: {
        transport,
      },
    });

    expect(parsed.success).toBe(false);
  });

  test("preserves relayTransportPolicy as a boolean server feature", () => {
    // Valid capability payload advertised by a supporting daemon.
    const supported = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "daemon-transport-v1",
      features: { relayTransportPolicy: true },
    });

    expect(supported.features).toEqual({ relayTransportPolicy: true });
  });

  test("rejects a non-boolean relayTransportPolicy feature", () => {
    // Invalid capability payload must not be accepted as truthy feature support.
    const invalid = ServerInfoStatusPayloadSchema.safeParse({
      status: "server_info",
      serverId: "daemon-transport-v1",
      features: { relayTransportPolicy: "yes" },
    });

    expect(invalid.success).toBe(false);
  });
});
