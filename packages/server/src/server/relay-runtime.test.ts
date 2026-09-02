import { describe, expect, test, vi } from "vitest";
import pino from "pino";
import { generateKeyPair } from "@getpaseo/relay";
import { createRelayRuntime } from "./relay-runtime.js";
import { startRelayTransport, type RelayTransportController } from "./relay-transport.js";
import { resolveConfiguredRelayTransportPolicy } from "./relay-transport-policy.js";
import { RelayTransportRuntimeMetricsWindow } from "./websocket/runtime-metrics.js";

describe("RelayRuntime", () => {
  test("starts and stops transport as enabled state changes", async () => {
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    const starts: string[] = [];
    const startTransport: typeof startRelayTransport = (options) => {
      starts.push(options.relayEndpoint);
      const stop = vi.fn(async () => undefined);
      stops.push(stop);
      return { stop } satisfies RelayTransportController;
    };
    const runtime = createRelayRuntime({
      config: {
        enabled: false,
        endpoint: "relay.example.test:443",
        publicEndpoint: "relay.example.test:443",
        useTls: true,
        publicUseTls: true,
      },
      transportPolicy: resolveConfiguredRelayTransportPolicy(undefined),
      logger: pino({ level: "silent" }),
      attachSocket: async () => undefined,
      serverId: "relay-runtime-test",
      daemonKeyPair: generateKeyPair(),
      startTransport,
    });

    expect(starts).toEqual([]);
    runtime.setEnabled(true);
    runtime.setEnabled(true);
    expect(starts).toEqual(["relay.example.test:443"]);
    expect(runtime.getConfig().enabled).toBe(true);

    runtime.setEnabled(false);
    await vi.waitFor(() => expect(stops[0]).toHaveBeenCalledOnce());
    expect(runtime.getConfig().enabled).toBe(false);
  });

  test("keeps relay disabled when transport startup fails", () => {
    const runtime = createRelayRuntime({
      config: {
        enabled: false,
        endpoint: "invalid-endpoint",
        publicEndpoint: "invalid-endpoint",
        useTls: false,
        publicUseTls: false,
      },
      transportPolicy: resolveConfiguredRelayTransportPolicy(undefined),
      logger: pino({ level: "silent" }),
      attachSocket: async () => undefined,
      serverId: "relay-runtime-test",
      daemonKeyPair: generateKeyPair(),
      startTransport: () => {
        throw new Error("Invalid relay endpoint");
      },
    });

    expect(() => runtime.setEnabled(true)).toThrow("Invalid relay endpoint");
    expect(runtime.getConfig().enabled).toBe(false);
  });

  test("updates transport policy in place for subsequent data-connection reads", () => {
    // Transport starts captured through the runtime's production adapter seam.
    const starts: Parameters<typeof startRelayTransport>[0][] = [];
    /** Recorder shared with WebSocket diagnostics across transport updates. */
    const runtimeMetrics = new RelayTransportRuntimeMetricsWindow();
    // Runtime under test owns one transport while policy is updated in place.
    const runtime = createRelayRuntime({
      config: {
        enabled: true,
        endpoint: "relay.example.test:443",
        publicEndpoint: "relay.example.test:443",
        useTls: true,
        publicUseTls: true,
      },
      transportPolicy: resolveConfiguredRelayTransportPolicy(undefined),
      logger: pino({ level: "silent" }),
      attachSocket: async () => undefined,
      serverId: "relay-runtime-policy-test",
      daemonKeyPair: generateKeyPair(),
      validation: { enableFramedCiphertextV1: true },
      runtimeMetrics,
      startTransport: (options) => {
        starts.push(options);
        return { stop: async () => undefined };
      },
    });

    expect(starts[0]?.getConfiguredTransportPolicy?.()).toEqual({
      ciphertextEncoding: "auto",
      compressionEnabled: true,
    });
    expect(starts[0]?.runtimeMetrics).toBe(runtimeMetrics);
    expect(starts[0]?.validation).toEqual({ enableFramedCiphertextV1: true });

    runtime.setTransportPolicy(
      resolveConfiguredRelayTransportPolicy({
        ciphertextEncoding: "base64",
        compression: { enabled: false },
      }),
    );

    expect(starts).toHaveLength(1);
    expect(starts[0]?.getConfiguredTransportPolicy?.()).toEqual({
      ciphertextEncoding: "base64",
      compressionEnabled: false,
    });
    expect(runtimeMetrics.snapshotAndReset().configuredPolicy).toEqual({
      ciphertextEncoding: "base64",
      compressionEnabled: false,
    });
    expect(runtime.getConfig()).toEqual({
      enabled: true,
      endpoint: "relay.example.test:443",
      publicEndpoint: "relay.example.test:443",
      useTls: true,
      publicUseTls: true,
    });
  });
});
