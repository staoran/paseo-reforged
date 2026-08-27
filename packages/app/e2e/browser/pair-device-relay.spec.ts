import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { RelayTransportConfig, SessionOutboundMessage } from "@getpaseo/protocol/messages";
import { expect, test } from "../support/fixtures";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import {
  enableRelayAndExpectOffer,
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

test("enables relay without materializing transport policy defaults", async ({ page }) => {
  const daemon = await startIsolatedHostDaemon("pair-device-browser-relay-off", {
    mutableRelay: { enabled: false },
  });
  const client = await connectDaemonClient<RelayTransportDaemonClient>({
    clientIdPrefix: "pair-device-browser-relay-off",
    port: daemon.port,
  });
  try {
    await preparePairingHost(page, daemon);
    await openPairDeviceModal(page);
    await expectRelayConsent(page);
    await enableRelayAndExpectOffer(page);
    await expect
      .poll(async () => (await client.getDaemonConfig()).config.relay)
      .toEqual({
        enabled: true,
      });
  } finally {
    await client.close().catch(() => undefined);
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

test("hides relay transport controls with a published daemon that predates the capability", async ({
  page,
}) => {
  test.setTimeout(360_000);
  const daemon = await startIsolatedHostDaemon("pair-device-browser-relay-legacy-capability", {
    mutableRelay: { enabled: true },
    publishedVersion: "0.2.5",
  });
  try {
    await preparePairingHost(page, daemon);
    await openPairDeviceModal(page);
    await expectPairingOffer(page);

    await expect(page.getByTestId("relay-transport-settings")).toHaveCount(0);
  } finally {
    await daemon.close();
  }
});

test("keeps persisted relay transport values visible when config persistence fails", async ({
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
    await preparePairingHost(page, daemon);
    await openPairDeviceModal(page);
    await expectPairingOffer(page);
    const modal = page.getByTestId("host-page-pair-device-card");
    const encodingBinary = modal.getByTestId("relay-ciphertext-encoding-binary");
    const encodingBase64 = modal.getByTestId("relay-ciphertext-encoding-base64");
    await expect(encodingBinary).toHaveAttribute("aria-selected", "true");

    const configPath = join(daemon.paseoHome, "config.json");
    await rm(configPath, { force: true });
    await mkdir(configPath);
    await encodingBase64.click();

    await expect(modal.getByRole("alert")).toBeVisible();
    await expect(encodingBase64).toBeEnabled();
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
