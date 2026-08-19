import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { DaemonConfigStore } from "./daemon-config-store.js";
import {
  loadPersistedConfig,
  PersistedConfigSchema,
  savePersistedConfig,
} from "./persisted-config.js";

// Invalid transport values excluded from the v1 persisted contract.
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

describe("PersistedConfigSchema relay transport contract", () => {
  test("accepts the v1 relay transport policy", () => {
    // Parsed strict config containing only the user-configurable v1 fields.
    const parsed = PersistedConfigSchema.parse({
      version: 1,
      daemon: {
        relay: {
          transport: {
            ciphertextEncoding: "auto",
            compression: { enabled: true },
          },
        },
      },
    });

    expect(parsed.daemon?.relay).toEqual({
      transport: {
        ciphertextEncoding: "auto",
        compression: { enabled: true },
      },
    });
  });

  test("keeps transport absent in legacy relay config", () => {
    // Legacy persisted relay state without a transport block.
    const legacy = PersistedConfigSchema.parse({
      version: 1,
      daemon: { relay: { enabled: false } },
    });

    expect(legacy.daemon?.relay).toEqual({ enabled: false });
  });

  test.each(["auto", "base64", "binary"] as const)(
    "preserves ciphertextEncoding=%s without materializing compression",
    (ciphertextEncoding) => {
      // Persisted policy containing only an explicit encoding preference.
      const parsed = PersistedConfigSchema.parse({
        version: 1,
        daemon: { relay: { transport: { ciphertextEncoding } } },
      });

      expect(parsed.daemon?.relay).toEqual({
        transport: { ciphertextEncoding },
      });
    },
  );

  test.each([true, false])(
    "preserves compression.enabled=%s without materializing encoding",
    (enabled) => {
      // Persisted policy containing only an explicit compression preference.
      const parsed = PersistedConfigSchema.parse({
        version: 1,
        daemon: { relay: { transport: { compression: { enabled } } } },
      });

      expect(parsed.daemon?.relay).toEqual({
        transport: { compression: { enabled } },
      });
    },
  );

  test.each(invalidTransportCases)("rejects %s", (_label, transport) => {
    // Invalid strict config must fail at the declared transport boundary.
    const parsed = PersistedConfigSchema.safeParse({
      version: 1,
      daemon: {
        relay: {
          transport,
        },
      },
    });

    expect(parsed.success).toBe(false);
  });
});

describe("DaemonConfigStore relay transport persistence", () => {
  // Temporary Paseo homes created by persistence behavior tests.
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /** Creates a public config store backed by an explicit legacy persisted relay shape. */
  function createLegacyRelayConfigStore(
    options: {
      /** Relay state visible for this daemon launch. */
      initialRelayEnabled?: boolean;
      /** Whether this launch may persist relay availability changes. */
      relayEnabledMutable?: boolean;
    } = {},
  ) {
    // Isolated home used to observe the public config store persistence result.
    const paseoHome = mkdtempSync(path.join(tmpdir(), "paseo-relay-transport-config-"));
    tempDirs.push(paseoHome);
    savePersistedConfig(paseoHome, {
      version: 1,
      daemon: { relay: { enabled: false } },
    });
    // Config store initialized with the launch-visible mutable relay state.
    const store = new DaemonConfigStore(
      paseoHome,
      {
        relay: { enabled: options.initialRelayEnabled ?? false },
        mcp: { injectIntoAgents: false },
        browserTools: { enabled: false },
        providers: {},
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
      },
      undefined,
      { relayEnabledMutable: options.relayEnabledMutable },
    );

    return { paseoHome, store };
  }

  test("does not persist a default transport block after an unrelated relay patch", () => {
    // Store fixture starting from a persisted config without transport policy.
    const { paseoHome, store } = createLegacyRelayConfigStore();

    store.patch({ relay: { enabled: true } });

    // Reloaded persisted relay state must remain compatible with old daemons.
    const persistedRelay = loadPersistedConfig(paseoHome).daemon?.relay;
    expect(persistedRelay).toEqual({ enabled: true });
  });

  test("persists encoding and compression set by separate relay transport patches", () => {
    // Store fixture used to verify separate optional transport fields survive persistence.
    const { paseoHome, store } = createLegacyRelayConfigStore();

    store.patch({ relay: { transport: { ciphertextEncoding: "binary" } } });
    store.patch({ relay: { transport: { compression: { enabled: false } } } });

    // Reloaded config must retain both independently patched fields and legacy relay state.
    const persistedRelay = loadPersistedConfig(paseoHome).daemon?.relay;
    expect(persistedRelay).toEqual({
      enabled: false,
      transport: {
        ciphertextEncoding: "binary",
        compression: { enabled: false },
      },
    });
  });

  test("persists transport while preserving persisted enabled under a relay launch override", () => {
    // Launch-level relay state differs from the persisted user preference.
    const { paseoHome, store } = createLegacyRelayConfigStore({
      initialRelayEnabled: true,
      relayEnabledMutable: false,
    });

    store.patch({
      relay: {
        transport: {
          ciphertextEncoding: "binary",
          compression: { enabled: true },
        },
      },
    });

    // Transport remains user-mutable while the persisted availability preference stays untouched.
    const persistedRelay = loadPersistedConfig(paseoHome).daemon?.relay;
    expect(persistedRelay).toEqual({
      enabled: false,
      transport: {
        ciphertextEncoding: "binary",
        compression: { enabled: true },
      },
    });
  });

  test("preserves transport when persisting an enabled-only legacy relay patch", () => {
    // Store fixture with transport configured by a transport-aware client.
    const { paseoHome, store } = createLegacyRelayConfigStore();
    store.patch({
      relay: {
        transport: {
          ciphertextEncoding: "base64",
          compression: { enabled: false },
        },
      },
    });

    store.patch({ relay: { enabled: true } });

    // An older enabled-only patch must not erase fields it cannot represent.
    const persistedRelay = loadPersistedConfig(paseoHome).daemon?.relay;
    expect(persistedRelay).toEqual({
      enabled: true,
      transport: {
        ciphertextEncoding: "base64",
        compression: { enabled: false },
      },
    });
  });
});
