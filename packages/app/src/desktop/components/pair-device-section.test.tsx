/**
 * @vitest-environment jsdom
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MutableDaemonConfig, RelayTransportConfig } from "@getpaseo/protocol/messages";

const { clientState } = vi.hoisted(() => ({
  /** Mutable daemon boundary used to exercise capability and config responses. */
  clientState: {
    /** Latest server capability map returned by the client. */
    features: {
      daemonStatusRpc: true,
      relayConfig: true,
      relayTransportPolicy: true,
    } as Record<string, boolean>,
    /** Mutable daemon config returned by the config RPC. */
    config: null as MutableDaemonConfig | null,
    /** Mutable pairing offer returned by the pairing RPC. */
    offer: { relayEnabled: true, url: "paseo://pair/test" },
    /** Config RPC mutation spy and response boundary. */
    patchDaemonConfig: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  /** Stable translation key renderer for component behavior assertions. */
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("qrcode", () => ({
  /** Deterministic QR boundary that avoids exercising the third-party encoder. */
  toString: vi.fn(async () => "<svg />"),
}));

vi.mock("lucide-react-native", async (importOriginal) => {
  /** Existing project stub exports retained for nested UI components. */
  const original = await importOriginal<typeof import("lucide-react-native")>();
  return { ...original, Network: () => null };
});

vi.mock("@/runtime/host-runtime", () => ({
  /** Connected daemon client boundary consumed by pairing and config hooks. */
  useHostRuntimeClient: () => ({
    getLastServerInfoMessage: () => ({ features: clientState.features }),
    getDaemonPairingOffer: async () => clientState.offer,
    getDaemonConfig: async () => ({ config: clientState.config }),
    patchDaemonConfig: clientState.patchDaemonConfig,
  }),
  /** Online runtime state used by the pairing query. */
  useHostRuntimeSnapshot: () => ({ connectionStatus: "online" }),
  /** Online config-query state used by useDaemonConfig. */
  useHostRuntimeIsConnected: () => true,
}));

import { PairDeviceSection } from "./pair-device-section";

/** Explicit persisted transport fixture used by most relay policy tests. */
const persistedTransport = {
  ciphertextEncoding: "binary",
  compression: { enabled: false },
} as const;

/** Complete mutable config fixture with an explicit relay transport policy. */
function createDaemonConfig(
  transport: RelayTransportConfig | null = persistedTransport,
): MutableDaemonConfig {
  return {
    relay: {
      enabled: true,
      ...(transport ? { transport } : {}),
    },
    mcp: { injectIntoAgents: false },
    browserTools: { enabled: false },
    providers: {},
    metadataGeneration: { providers: [] },
    autoArchiveAfterMerge: false,
    enableTerminalAgentHooks: false,
    appendSystemPrompt: "",
  };
}

/** Renders the public pairing surface with an isolated server-query cache. */
function renderPairDeviceSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PairDeviceSection serverId="server-1" onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("PairDeviceSection relay transport policy", () => {
  beforeEach(() => {
    clientState.features = {
      daemonStatusRpc: true,
      relayConfig: true,
      relayTransportPolicy: true,
    };
    clientState.config = createDaemonConfig();
    clientState.offer = { relayEnabled: true, url: "paseo://pair/test" };
    clientState.patchDaemonConfig.mockReset();
    clientState.patchDaemonConfig.mockResolvedValue({ config: createDaemonConfig() });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the daemon's persisted encoding and compression values when transport policy is supported", async () => {
    const view = renderPairDeviceSection();

    await waitFor(() => {
      expect(
        view.getByTestId("relay-ciphertext-encoding-binary").getAttribute("aria-selected"),
      ).toBe("true");
    });
    expect(view.getByTestId("relay-compression-switch").getAttribute("aria-checked")).toBe("false");
  });

  it("shows auto encoding and enabled compression when the daemon omits transport policy values", async () => {
    clientState.config = createDaemonConfig(null);

    const view = renderPairDeviceSection();

    await waitFor(() => {
      expect(view.getByTestId("relay-ciphertext-encoding-auto").getAttribute("aria-selected")).toBe(
        "true",
      );
    });
    expect(view.getByTestId("relay-compression-switch").getAttribute("aria-checked")).toBe("true");
  });

  it("patches only ciphertext encoding when a supported daemon receives an encoding change", async () => {
    const view = renderPairDeviceSection();
    await waitFor(() => {
      expect(view.queryByTestId("relay-ciphertext-encoding-base64")).not.toBeNull();
    });

    fireEvent.click(view.getByTestId("relay-ciphertext-encoding-base64"));

    await waitFor(() => {
      expect(clientState.patchDaemonConfig).toHaveBeenCalledWith({
        relay: { transport: { ciphertextEncoding: "base64" } },
      });
    });
  });

  it("updates the displayed encoding from the daemon's successful patch response", async () => {
    clientState.patchDaemonConfig.mockResolvedValue({
      config: createDaemonConfig({
        ciphertextEncoding: "base64",
        compression: { enabled: false },
      }),
    });
    const view = renderPairDeviceSection();
    await waitFor(() => {
      expect(view.queryByTestId("relay-ciphertext-encoding-base64")).not.toBeNull();
    });

    fireEvent.click(view.getByTestId("relay-ciphertext-encoding-base64"));

    await waitFor(() => {
      expect(
        view.getByTestId("relay-ciphertext-encoding-base64").getAttribute("aria-selected"),
      ).toBe("true");
    });
  });

  it("patches only compression enabled when a supported daemon receives a compression change", async () => {
    const view = renderPairDeviceSection();
    await waitFor(() => {
      expect(view.queryByTestId("relay-compression-switch")).not.toBeNull();
    });

    fireEvent.click(view.getByTestId("relay-compression-switch"));

    await waitFor(() => {
      expect(clientState.patchDaemonConfig).toHaveBeenCalledWith({
        relay: { transport: { compression: { enabled: true } } },
      });
    });
  });

  it("hides transport controls and sends no transport patch when the daemon lacks the capability", async () => {
    delete clientState.features.relayTransportPolicy;

    const view = renderPairDeviceSection();
    await waitFor(() => {
      expect(view.queryByDisplayValue("paseo://pair/test")).not.toBeNull();
    });

    expect(view.queryByTestId("relay-transport-settings")).toBeNull();
    expect(clientState.patchDaemonConfig).not.toHaveBeenCalled();
  });

  it("shows a patch failure while retaining the daemon's persisted transport values", async () => {
    clientState.patchDaemonConfig.mockRejectedValue(new Error("relay write rejected"));
    const view = renderPairDeviceSection();
    await waitFor(() => {
      expect(view.queryByTestId("relay-ciphertext-encoding-base64")).not.toBeNull();
    });

    fireEvent.click(view.getByTestId("relay-ciphertext-encoding-base64"));

    await waitFor(() => {
      expect(view.queryByText("relay write rejected")).not.toBeNull();
    });
    expect(view.getByTestId("relay-ciphertext-encoding-binary").getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(view.getByTestId("relay-ciphertext-encoding-base64").getAttribute("aria-selected")).toBe(
      "false",
    );
  });

  it("keeps relay enablement on its existing independent config patch", async () => {
    clientState.offer = { relayEnabled: false, url: "" };
    const view = renderPairDeviceSection();
    await waitFor(() => {
      expect(view.queryByText("pairing.device.enableRelay")).not.toBeNull();
    });

    fireEvent.click(view.getByText("pairing.device.enableRelay"));

    await waitFor(() => {
      expect(clientState.patchDaemonConfig).toHaveBeenCalledWith({ relay: { enabled: true } });
    });
    expect(view.queryByTestId("relay-transport-settings")).toBeNull();
  });
});
