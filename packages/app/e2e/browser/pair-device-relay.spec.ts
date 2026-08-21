import type { WebSocketRoute } from "@playwright/test";
import type { RelayTransportConfig, SessionOutboundMessage } from "@getpaseo/protocol/messages";
import { expect, test, type Page } from "../support/fixtures";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { wsRoutePatternForPort } from "../support/helpers/daemon-port";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import {
  expectPairingOffer,
  expectRelayConsent,
  openPairDeviceModal,
  preparePairingHost,
  reloadAndOpenPairDevice,
} from "../support/helpers/pair-device";

/** Canonical config RPC payload consumed by the relay pairing tests. */
type RelayTransportDaemonConfigResponse = Extract<
  SessionOutboundMessage,
  { type: "get_daemon_config_response" }
>["payload"];

type WebSocketMessage = Parameters<Parameters<WebSocketRoute["onMessage"]>[0]>[0];

interface RelayTransportDaemonClient {
  /** Establishes the direct test connection. */
  connect(): Promise<void>;
  /** Closes the direct test connection. */
  close(): Promise<void>;
  /** Reads the daemon's current mutable relay transport policy. */
  getDaemonConfig(): Promise<RelayTransportDaemonConfigResponse>;
  /** Seeds a persisted relay transport policy before the browser connects. */
  patchDaemonConfig(config: { relay: { transport: RelayTransportConfig } }): Promise<unknown>;
}

interface RelayTransportProtocolGateOptions {
  /** Browser page whose isolated-daemon socket is routed. */
  page: Page;
  /** Isolated daemon port targeted by the route. */
  daemonPort: number;
  /** Removes the new capability from otherwise real server_info traffic. */
  stripCapability?: boolean;
  /** Rejects browser transport-policy mutations with this correlated RPC error. */
  rejectPatchMessage?: string;
}

/** Narrows an untrusted JSON value to an indexable object. */
function isJsonRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object") return false;
  if (value === null) return false;
  return !Array.isArray(value);
}

/** Parses one text WebSocket frame as a JSON object. */
function parseWebSocketJson(message: WebSocketMessage): Record<string, unknown> | null {
  const raw = typeof message === "string" ? message : message.toString("utf8");
  try {
    const parsed: unknown = JSON.parse(raw);
    return isJsonRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Returns the inner session message carried by one WebSocket envelope. */
function readSessionMessage(message: WebSocketMessage): Record<string, unknown> | null {
  const envelope = parseWebSocketJson(message);
  if (envelope?.type !== "session" || !isJsonRecord(envelope.message)) {
    return null;
  }
  return envelope.message;
}

/** Removes relayTransportPolicy from one real server_info frame when present. */
function withoutRelayTransportCapability(message: WebSocketMessage): WebSocketMessage {
  const envelope = parseWebSocketJson(message);
  if (envelope?.type !== "session" || !isJsonRecord(envelope.message)) {
    return message;
  }
  const sessionMessage = envelope.message;
  if (sessionMessage.type !== "status" || !isJsonRecord(sessionMessage.payload)) return message;
  const payload = sessionMessage.payload;
  if (payload.status !== "server_info" || !isJsonRecord(payload.features)) return message;
  const features = payload.features;
  delete features.relayTransportPolicy;
  return JSON.stringify(envelope);
}

/** Routes one browser connection through a narrow mixed-version or RPC-failure gate. */
async function installRelayTransportProtocolGate(
  options: RelayTransportProtocolGateOptions,
): Promise<void> {
  const { page, daemonPort, stripCapability = false, rejectPatchMessage } = options;
  await page.routeWebSocket(wsRoutePatternForPort(String(daemonPort)), (browserSocket) => {
    const daemonSocket = browserSocket.connectToServer();
    browserSocket.onMessage((message) => {
      const sessionMessage = readSessionMessage(message);
      if (
        rejectPatchMessage &&
        sessionMessage?.type === "set_daemon_config_request" &&
        typeof sessionMessage.requestId === "string"
      ) {
        browserSocket.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "rpc_error",
              payload: {
                requestId: sessionMessage.requestId,
                requestType: "set_daemon_config_request",
                error: rejectPatchMessage,
                code: "transport",
              },
            },
          }),
        );
        return;
      }
      daemonSocket.send(message);
    });
    daemonSocket.onMessage((message) => {
      browserSocket.send(stripCapability ? withoutRelayTransportCapability(message) : message);
    });
  });
}

test("opens relay consent in browser web", async ({ page }) => {
  const daemon = await startIsolatedHostDaemon("pair-device-browser-relay-off", {
    mutableRelay: { enabled: false },
  });
  try {
    await preparePairingHost(page, daemon);
    await openPairDeviceModal(page);
    await expectRelayConsent(page);
  } finally {
    await daemon.close();
  }
});

test("persists relay transport defaults changed through the pairing controls", async ({ page }) => {
  const daemon = await startIsolatedHostDaemon("pair-device-browser-relay-transport", {
    mutableRelay: { enabled: true },
  });
  const client = await connectDaemonClient<RelayTransportDaemonClient>({
    clientIdPrefix: "pair-device-browser-relay-transport",
    port: daemon.port,
  });
  try {
    await preparePairingHost(page, daemon);
    await openPairDeviceModal(page);
    await expectPairingOffer(page);
    const encodingAuto = page.getByTestId("relay-ciphertext-encoding-auto");
    const encodingBinary = page.getByTestId("relay-ciphertext-encoding-binary");
    const compression = page.getByTestId("relay-compression-switch");
    await expect(encodingAuto).toHaveAttribute("aria-selected", "true");
    await expect(compression).toHaveAttribute("aria-checked", "true");

    await encodingBinary.click();
    await expect
      .poll(async () => (await client.getDaemonConfig()).config.relay?.transport)
      .toEqual({ ciphertextEncoding: "binary" });
    await compression.click();
    await expect
      .poll(async () => (await client.getDaemonConfig()).config.relay?.transport)
      .toEqual({
        ciphertextEncoding: "binary",
        compression: { enabled: false },
      });

    await reloadAndOpenPairDevice(page);
    await expect(page.getByTestId("relay-ciphertext-encoding-binary")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByTestId("relay-compression-switch")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  } finally {
    await client.close().catch(() => undefined);
    await daemon.close();
  }
});

test("hides relay transport controls when the daemon omits the capability", async ({ page }) => {
  const daemon = await startIsolatedHostDaemon("pair-device-browser-relay-legacy-capability", {
    mutableRelay: { enabled: true },
  });
  try {
    await installRelayTransportProtocolGate({
      page,
      daemonPort: daemon.port,
      stripCapability: true,
    });
    await preparePairingHost(page, daemon);
    await openPairDeviceModal(page);
    await expectPairingOffer(page);

    await expect(page.getByTestId("relay-transport-settings")).toHaveCount(0);
  } finally {
    await daemon.close();
  }
});

test("keeps persisted relay transport values visible when the daemon rejects a patch", async ({
  page,
}) => {
  const daemon = await startIsolatedHostDaemon("pair-device-browser-relay-patch-failure", {
    mutableRelay: { enabled: true },
  });
  const client = await connectDaemonClient<RelayTransportDaemonClient>({
    clientIdPrefix: "pair-device-browser-relay-patch-failure",
    port: daemon.port,
  });
  try {
    await client.patchDaemonConfig({
      relay: {
        transport: {
          ciphertextEncoding: "binary",
          compression: { enabled: false },
        },
      },
    });
    await installRelayTransportProtocolGate({
      page,
      daemonPort: daemon.port,
      rejectPatchMessage: "relay write rejected",
    });
    await preparePairingHost(page, daemon);
    await openPairDeviceModal(page);
    await expectPairingOffer(page);
    const modal = page.getByTestId("host-page-pair-device-card");
    const encodingBinary = modal.getByTestId("relay-ciphertext-encoding-binary");
    const encodingBase64 = modal.getByTestId("relay-ciphertext-encoding-base64");
    await expect(encodingBinary).toHaveAttribute("aria-selected", "true");

    await encodingBase64.click();

    await expect(modal.getByRole("alert")).toContainText("relay write rejected");
    await expect(encodingBinary).toHaveAttribute("aria-selected", "true");
    await expect(encodingBase64).toHaveAttribute("aria-selected", "false");
    await expect
      .poll(async () => (await client.getDaemonConfig()).config.relay?.transport)
      .toEqual({
        ciphertextEncoding: "binary",
        compression: { enabled: false },
      });
  } finally {
    await client.close().catch(() => undefined);
    await daemon.close();
  }
});
