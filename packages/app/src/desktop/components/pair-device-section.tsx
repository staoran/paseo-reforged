import { useCallback, useMemo, useState } from "react";
import { Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as QRCode from "qrcode";
import { SvgXml } from "react-native-svg";
import { useMutation } from "@tanstack/react-query";
import { Check, Copy, Network, RotateCw, ShieldCheck } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/external-link";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { useFetchQuery } from "@/data/query";
import { daemonPairingOfferQueryKey } from "@/data/daemon-pairing";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeClient, useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import type { RelayTransportConfig } from "@getpaseo/protocol/messages";
import type { Theme } from "@/styles/theme";

const RELAY_DOCS_URL = "https://paseo.sh/docs/security";
const FLEX_ONE_STYLE = { flex: 1 } as const;
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedShieldCheck = withUnistyles(ShieldCheck);
const ThemedNetwork = withUnistyles(Network);
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const accentBrightColorMapping = (theme: Theme) => ({ color: theme.colors.accentBright });

/** Supported user-facing ciphertext policy values. */
type RelayCiphertextEncoding = NonNullable<RelayTransportConfig["ciphertextEncoding"]>;

export interface PairDeviceSectionProps {
  serverId: string;
  onClose: () => void;
}

export function PairDeviceSection({ serverId, onClose }: PairDeviceSectionProps) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const isConnected = runtimeSnapshot?.connectionStatus === "online";
  const isDisconnected =
    runtimeSnapshot?.connectionStatus === "offline" ||
    runtimeSnapshot?.connectionStatus === "error";
  const { config, patchConfig } = useDaemonConfig(serverId);
  const [copied, setCopied] = useState(false);
  const serverFeatures = client?.getLastServerInfoMessage()?.features;
  const supportsPairingRpc = serverFeatures?.daemonStatusRpc === true;
  const canConfigureRelay = supportsPairingRpc && serverFeatures?.relayConfig === true;
  /** New transport controls use their own capability and never infer support from relayConfig. */
  const canConfigureRelayTransport = serverFeatures?.relayTransportPolicy === true;

  const pairingQuery = useFetchQuery({
    queryKey: daemonPairingOfferQueryKey(serverId),
    queryFn: async () => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      return client.getDaemonPairingOffer();
    },
    enabled: supportsPairingRpc && Boolean(client && isConnected),
    dataShape: "value",
    staleTimeMs: 5 * 60 * 1000,
    retry: 1,
  });

  const enableRelay = useMutation({
    mutationFn: async () => {
      if (client?.getLastServerInfoMessage()?.features?.relayConfig !== true) {
        throw new Error(t("pairing.device.updateRequired"));
      }
      const nextConfig = await patchConfig({ relay: { enabled: true } });
      if (!nextConfig) throw new Error(t("workspace.terminal.hostDisconnected"));
      return pairingQuery.refetch();
    },
  });

  /** Capability-guarded relay transport config mutation shared by both controls. */
  const updateRelayTransport = useMutation({
    mutationFn: async (transport: RelayTransportConfig) => {
      if (client?.getLastServerInfoMessage()?.features?.relayTransportPolicy !== true) {
        throw new Error(t("pairing.device.updateRequired"));
      }
      const nextConfig = await patchConfig({ relay: { transport } });
      if (!nextConfig) throw new Error(t("workspace.terminal.hostDisconnected"));
      return nextConfig;
    },
  });

  const qrQuery = useFetchQuery({
    queryKey: ["daemon-pairing-offer-qr", pairingQuery.data?.url],
    queryFn: () =>
      QRCode.toString(pairingQuery.data?.url ?? "", {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 1,
        width: 480,
      }),
    enabled: Boolean(pairingQuery.data?.url),
    dataShape: "value",
    staleTimeMs: 5 * 60 * 1000,
  });

  const handleCopyLink = useCallback(async () => {
    if (!pairingQuery.data?.url) return;
    await Clipboard.setStringAsync(pairingQuery.data.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [pairingQuery.data?.url]);
  const handleCopyPress = useCallback(() => {
    void handleCopyLink();
  }, [handleCopyLink]);
  const handleRetry = useCallback(() => {
    void pairingQuery.refetch();
  }, [pairingQuery]);
  const handleEnableRelay = useCallback(() => {
    enableRelay.mutate();
  }, [enableRelay]);
  /** Writes only the selected ciphertext policy; the daemon applies it to new connections. */
  const handleCiphertextEncodingChange = useCallback(
    (ciphertextEncoding: RelayCiphertextEncoding) => {
      updateRelayTransport.mutate({ ciphertextEncoding });
    },
    [updateRelayTransport],
  );
  /** Writes only the hot-reloadable compression switch. */
  const handleCompressionEnabledChange = useCallback(
    ({ enabled }: CompressionEnabledChangeOptions) => {
      updateRelayTransport.mutate({ compression: { enabled } });
    },
    [updateRelayTransport],
  );

  const qrSvg = useMemo(() => qrQuery.data ?? null, [qrQuery.data]);

  return (
    <View testID="pair-device-content">
      <PairDeviceBody
        isPending={supportsPairingRpc && pairingQuery.isPending}
        isDisconnected={isDisconnected}
        error={pairingQuery.error}
        offer={pairingQuery.data}
        canConfigureRelay={canConfigureRelay}
        canConfigureRelayTransport={canConfigureRelayTransport}
        relayTransport={config?.relay?.transport}
        transportUpdatePending={updateRelayTransport.isPending}
        transportUpdateError={updateRelayTransport.error}
        onCiphertextEncodingChange={handleCiphertextEncodingChange}
        onCompressionEnabledChange={handleCompressionEnabledChange}
        enablePending={enableRelay.isPending}
        enableError={enableRelay.error}
        qrSvg={qrSvg}
        qrError={qrQuery.isError}
        copied={copied}
        onRetry={handleRetry}
        onEnableRelay={handleEnableRelay}
        onClose={onClose}
        onCopy={handleCopyPress}
      />
    </View>
  );
}

interface PairDeviceBodyProps {
  isPending: boolean;
  isDisconnected: boolean;
  error: Error | null;
  offer: { relayEnabled: boolean; url: string } | undefined;
  canConfigureRelay: boolean;
  /** Whether the daemon accepts relay transport policy patches. */
  canConfigureRelayTransport: boolean;
  /** Persisted transport policy returned by the daemon config RPC. */
  relayTransport: RelayTransportConfig | undefined;
  /** Whether a transport policy write is in flight. */
  transportUpdatePending: boolean;
  /** Last transport policy write failure. */
  transportUpdateError: Error | null;
  /** Requests a connection-level ciphertext policy change. */
  onCiphertextEncodingChange: (ciphertextEncoding: RelayCiphertextEncoding) => void;
  /** Requests an immediate eligible-frame compression policy change. */
  onCompressionEnabledChange: (options: CompressionEnabledChangeOptions) => void;
  enablePending: boolean;
  enableError: Error | null;
  qrSvg: string | null;
  qrError: boolean;
  copied: boolean;
  onRetry: () => void;
  onEnableRelay: () => void;
  onClose: () => void;
  onCopy: () => void;
}

/** Input for changing the hot-reloadable relay compression switch. */
interface CompressionEnabledChangeOptions {
  /** Whether eligible framed payloads should attempt compression immediately. */
  enabled: boolean;
}

/** Persisted relay transport settings displayed in the pairing surface. */
interface RelayTransportSettingsProps {
  /** Persisted daemon policy displayed by the controls. */
  policy: RelayTransportConfig | undefined;
  /** Disables both controls while the single mutation is in flight. */
  updatePending: boolean;
  /** Last mutation failure surfaced without changing persisted display state. */
  updateError: Error | null;
  /** Mutation callback for a new connection-level encoding preference. */
  onCiphertextEncodingChange: (ciphertextEncoding: RelayCiphertextEncoding) => void;
  /** Mutation callback for the hot-reloadable compression switch. */
  onCompressionEnabledChange: (options: CompressionEnabledChangeOptions) => void;
}

function PairDeviceBody(props: PairDeviceBodyProps) {
  const { t } = useTranslation();
  if (props.isDisconnected) {
    return (
      <OfferLoadError message={t("workspace.terminal.hostDisconnected")} onRetry={props.onRetry} />
    );
  }
  if (props.isPending) {
    return <Text style={styles.stateLine}>{t("pairing.device.loadingOffer")}</Text>;
  }
  if (props.error) {
    return <OfferLoadError message={props.error.message} onRetry={props.onRetry} />;
  }
  if (!props.offer?.relayEnabled) {
    return <RelayConsent {...props} />;
  }
  if (!props.offer.url) {
    return <Text style={styles.stateLine}>{t("pairing.device.unavailable")}</Text>;
  }
  return <PairingOffer {...props} offer={props.offer} />;
}

function OfferLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <Alert variant="error" description={message}>
      <Button variant="outline" size="sm" leftIcon={RotateCw} onPress={onRetry}>
        {t("pairing.device.retry")}
      </Button>
    </Alert>
  );
}

function RelayConsent(props: PairDeviceBodyProps) {
  const { t } = useTranslation();
  let enableButtonLabel = t("pairing.device.enableRelay");
  if (props.enablePending) {
    enableButtonLabel = t("pairing.device.enablingRelay");
  } else if (props.enableError) {
    enableButtonLabel = t("pairing.device.retry");
  }
  return (
    <View style={styles.consent}>
      <View style={styles.hero}>
        <RelayHeroBadge />
        <Text style={styles.consentTitle}>{t("pairing.device.enableTitle")}</Text>
        <Text style={styles.consentDescription}>{t("pairing.device.enableDescription")}</Text>
        <ExternalLink
          href={RELAY_DOCS_URL}
          label={t("pairing.device.relayDocs")}
          accessibilityLabel={t("pairing.device.relayDocsAccessibility")}
        />
      </View>
      {props.enableError ? <Alert variant="error" description={props.enableError.message} /> : null}
      {!props.canConfigureRelay ? (
        <Alert variant="warning" description={t("pairing.device.updateRequired")} />
      ) : null}
      <View style={styles.actions}>
        <Button variant="secondary" style={FLEX_ONE_STYLE} onPress={props.onClose}>
          {t("pairing.device.notNow")}
        </Button>
        {props.canConfigureRelay ? (
          <Button
            variant="default"
            style={FLEX_ONE_STYLE}
            loading={props.enablePending}
            onPress={props.onEnableRelay}
          >
            {enableButtonLabel}
          </Button>
        ) : null}
      </View>
      <View style={styles.directRow}>
        <ThemedNetwork size={14} style={styles.directIcon} />
        <Text style={styles.directHint}>{t("pairing.device.directConnectionHint")}</Text>
      </View>
    </View>
  );
}

function RelayHeroBadge() {
  return (
    <View style={styles.heroBadge}>
      <ThemedShieldCheck size={20} uniProps={accentBrightColorMapping} />
    </View>
  );
}

function PairingOffer(props: PairDeviceBodyProps & { offer: { url: string } }) {
  const { t } = useTranslation();
  return (
    <View style={styles.offer}>
      <Text style={styles.offerHint}>{t("pairing.device.hint")}</Text>
      <View style={styles.qrTile}>
        <PairingQr svg={props.qrSvg} isError={props.qrError} />
      </View>
      <View style={styles.linkRow}>
        <View style={styles.inputWrapper}>
          <TextInput
            style={styles.linkInput}
            value={props.offer.url}
            readOnly
            selectTextOnFocus
            accessibilityLabel={t("pairing.link.label")}
          />
        </View>
        <Button
          variant="outline"
          size="sm"
          leftIcon={props.copied ? Check : Copy}
          onPress={props.onCopy}
        >
          {props.copied ? t("pairing.device.copied") : t("pairing.device.copy")}
        </Button>
      </View>
      {props.canConfigureRelayTransport ? (
        <RelayTransportSettings
          policy={props.relayTransport}
          updatePending={props.transportUpdatePending}
          updateError={props.transportUpdateError}
          onCiphertextEncodingChange={props.onCiphertextEncodingChange}
          onCompressionEnabledChange={props.onCompressionEnabledChange}
        />
      ) : null}
    </View>
  );
}

/** Displays the persisted relay transport policy at the pairing surface. */
function RelayTransportSettings({
  policy,
  updatePending,
  updateError,
  onCiphertextEncodingChange,
  onCompressionEnabledChange,
}: RelayTransportSettingsProps) {
  const { t } = useTranslation();
  /** Missing encoding follows the daemon's configured-policy default. */
  const ciphertextEncoding = policy?.ciphertextEncoding ?? "auto";
  /** Missing compression follows the daemon's configured-policy default. */
  const compressionEnabled = policy?.compression?.enabled ?? true;
  /** Adapts the native boolean switch callback to the named relay policy input. */
  const handleCompressionEnabledChange = useCallback(
    (enabled: boolean) => onCompressionEnabledChange({ enabled }),
    [onCompressionEnabledChange],
  );

  return (
    <View style={styles.transportSettings} testID="relay-transport-settings">
      <View style={styles.transportHeading}>
        <Text style={styles.transportTitle}>{t("pairing.device.transport.title")}</Text>
        <Text style={styles.transportHint}>{t("pairing.device.transport.description")}</Text>
      </View>
      {updateError ? <Alert variant="error" description={updateError.message} /> : null}
      <View style={styles.transportRow}>
        <View style={styles.transportRowContent}>
          <Text style={styles.transportLabel}>{t("pairing.device.transport.encoding.label")}</Text>
          <Text style={styles.transportHint}>
            {t("pairing.device.transport.encoding.newConnections")}
          </Text>
        </View>
        <SegmentedControl
          size="sm"
          value={ciphertextEncoding}
          onValueChange={onCiphertextEncodingChange}
          options={[
            {
              value: "auto",
              label: t("pairing.device.transport.encoding.auto"),
              disabled: updatePending,
              testID: "relay-ciphertext-encoding-auto",
            },
            {
              value: "base64",
              label: t("pairing.device.transport.encoding.base64"),
              disabled: updatePending,
              testID: "relay-ciphertext-encoding-base64",
            },
            {
              value: "binary",
              label: t("pairing.device.transport.encoding.binary"),
              disabled: updatePending,
              testID: "relay-ciphertext-encoding-binary",
            },
          ]}
          testID="relay-ciphertext-encoding"
        />
      </View>
      <View style={styles.transportRow}>
        <View style={styles.transportRowContent}>
          <Text style={styles.transportLabel}>
            {t("pairing.device.transport.compression.label")}
          </Text>
          <Text style={styles.transportHint}>
            {t("pairing.device.transport.compression.description")}
          </Text>
        </View>
        <Switch
          value={compressionEnabled}
          onValueChange={handleCompressionEnabledChange}
          disabled={updatePending}
          accessibilityLabel={t("pairing.device.transport.compression.accessibilityLabel")}
          testID="relay-compression-switch"
        />
      </View>
    </View>
  );
}

function PairingQr({ svg, isError }: { svg: string | null; isError: boolean }) {
  const { t } = useTranslation();
  if (svg) {
    return (
      <SvgXml
        xml={svg}
        style={styles.qrImage}
        accessibilityRole="image"
        accessibilityLabel={t("pairing.device.qrAccessibility")}
      />
    );
  }
  if (isError) {
    return <Text style={styles.hint}>{t("pairing.device.qrUnavailable")}</Text>;
  }
  return <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />;
}

const styles = StyleSheet.create((theme) => ({
  stateLine: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
    paddingVertical: theme.spacing[6],
  },
  consent: {
    gap: theme.spacing[4],
  },
  hero: {
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  heroBadge: {
    width: 48,
    height: 48,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing[1],
  },
  consentTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  consentDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.5,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  directRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing[4],
  },
  directIcon: {
    color: theme.colors.foregroundMuted,
    marginTop: 1, // optical: seats the glyph on the hint's first text line
  },
  directHint: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: theme.fontSize.xs * 1.5,
  },
  offer: {
    gap: theme.spacing[4],
  },
  offerHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  qrTile: {
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    width: 304,
    maxWidth: "100%",
    aspectRatio: 1,
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.palette.white,
  },
  qrImage: {
    width: "100%",
    height: "100%",
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  inputWrapper: {
    flex: 1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    overflow: "hidden",
  },
  linkInput: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.xs,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    outlineStyle: "none",
  } as object,
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  transportSettings: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing[4],
    gap: theme.spacing[3],
  },
  transportHeading: {
    gap: theme.spacing[1],
  },
  transportTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  transportRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    minWidth: 0,
  },
  transportRowContent: {
    flex: 1,
    flexBasis: 180,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  transportLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  transportHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: theme.fontSize.xs * 1.5,
  },
}));
