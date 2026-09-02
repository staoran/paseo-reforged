import type pino from "pino";
import type { KeyPair } from "@getpaseo/relay/e2ee";
import type { ExternalSocketMetadata } from "./websocket-server.js";
import {
  startRelayTransport,
  type RelaySocketLike,
  type RelayTransportController,
  type RelayTransportValidationOptions,
} from "./relay-transport.js";
import type { ConfiguredRelayTransportPolicy } from "./relay-transport-policy.js";
import type { RelayTransportRuntimeMetricsWindow } from "./websocket/runtime-metrics.js";

export interface RelayRuntimeConfig {
  /** Whether the daemon currently maintains its relay control transport. */
  enabled: boolean;
  /** Internal relay endpoint used by the daemon. */
  endpoint: string;
  /** Public relay endpoint advertised to pairing clients. */
  publicEndpoint: string;
  /** Whether the daemon connects to its relay endpoint over TLS. */
  useTls: boolean;
  /** Whether pairing clients connect to the public endpoint over TLS. */
  publicUseTls: boolean;
}

interface RelayRuntimeOptions {
  /** Public relay runtime settings exposed through daemon status. */
  config: RelayRuntimeConfig;
  /** Internal fully defaulted policy read by relay data connections. */
  transportPolicy: ConfiguredRelayTransportPolicy;
  /** Logger used for asynchronous transport lifecycle failures. */
  logger: pino.Logger;
  /** Attaches one accepted relay data socket to the daemon session layer. */
  attachSocket(ws: RelaySocketLike, metadata?: ExternalSocketMetadata): Promise<void>;
  /** Stable daemon identifier used by relay control and data URLs. */
  serverId: string;
  /** Long-lived daemon key used to authenticate encrypted data connections. */
  daemonKeyPair: KeyPair;
  /** Optional transport factory used by focused lifecycle tests. */
  startTransport?: typeof startRelayTransport;
  /** Content-free recorder shared with the daemon WebSocket diagnostics window. */
  runtimeMetrics?: RelayTransportRuntimeMetricsWindow;
  /** Isolated protocol-validation overrides unavailable through production config. */
  validation?: RelayTransportValidationOptions;
}

export interface RelayRuntime {
  /** Returns the current in-memory relay runtime configuration. */
  getConfig(): RelayRuntimeConfig;
  /** Starts or stops the long-lived relay transport. */
  setEnabled(enabled: boolean): void;
  /** Replaces the policy read by current and subsequent data connections. */
  setTransportPolicy(policy: ConfiguredRelayTransportPolicy): void;
  /** Stops the long-lived relay transport and all data connections. */
  stop(): Promise<void>;
}

/** Creates the relay lifecycle module with separately scoped public config and private policy. */
export function createRelayRuntime(options: RelayRuntimeOptions): RelayRuntime {
  /** Transport factory selected once for this runtime. */
  const startTransport = options.startTransport ?? startRelayTransport;
  /** Public relay status fields updated only by the enabled lifecycle. */
  let config = options.config;
  /** Private configured policy read through the long-lived transport provider. */
  let transportPolicy = options.transportPolicy;
  /** Current long-lived relay transport controller, if enabled. */
  let transport: RelayTransportController | null = null;

  /** Starts the relay transport once using providers backed by runtime state. */
  function start(): void {
    if (transport) return;
    transport = startTransport({
      logger: options.logger,
      attachSocket: options.attachSocket,
      relayEndpoint: config.endpoint,
      relayUseTls: config.useTls,
      serverId: options.serverId,
      daemonKeyPair: options.daemonKeyPair,
      getConfiguredTransportPolicy: () => transportPolicy,
      ...(options.runtimeMetrics ? { runtimeMetrics: options.runtimeMetrics } : {}),
      ...(options.validation ? { validation: options.validation } : {}),
    });
    options.runtimeMetrics?.setConfiguredPolicy(transportPolicy);
  }

  /** Applies an enabled-state transition without changing transport policy. */
  function setEnabled(enabled: boolean): void {
    if (config.enabled === enabled) return;
    if (enabled) {
      start();
      config = { ...config, enabled: true };
      return;
    }
    config = { ...config, enabled: false };
    const current = transport;
    transport = null;
    void current?.stop().catch((error) => {
      options.logger.warn({ err: error }, "Failed to stop relay transport");
    });
  }

  /** Replaces transport policy without restarting or re-handshaking existing connections. */
  function setTransportPolicy(policy: ConfiguredRelayTransportPolicy): void {
    transportPolicy = policy;
    options.runtimeMetrics?.setConfiguredPolicy(policy);
  }

  /** Stops the current relay transport and waits for its teardown. */
  async function stop(): Promise<void> {
    const current = transport;
    transport = null;
    await current?.stop();
  }

  if (config.enabled) start();

  return {
    getConfig: () => config,
    setEnabled,
    setTransportPolicy,
    stop,
  };
}
