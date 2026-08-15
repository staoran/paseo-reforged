import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Clipboard from "expo-clipboard";
import {
  Modal,
  Pressable,
  StyleSheet as RNStyleSheet,
  ScrollView,
  View,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import {
  Check,
  Code,
  Copy,
  FileText,
  Hand,
  Maximize2,
  MousePointer2,
  RotateCcw,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react-native";
import { WebView, type WebViewMessageEvent, type WebViewProps } from "react-native-webview";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { HighlightedCodeBlock } from "@/components/highlighted-code-block";
import type { Theme } from "@/styles/theme";
import type { MarkdownFenceRendererProps } from "../types";
import { getDiagramBoxStyle } from "./presentation";
import type { MermaidRenderRequest } from "./render-model";
import { mermaidRuntimeHtml } from "./runtime/html.gen";
import {
  parseMermaidRuntimeMessage,
  serializeMermaidRuntimeInboundMessage,
  type MermaidRuntimeInboundMessage,
  type MermaidRuntimeRenderMessage,
  type MermaidRuntimeViewportCommand,
} from "./runtime/messages";
import { MermaidRuntimeRequestDriver } from "./runtime/request-driver";
import { useMermaidRenderModel } from "./use-render-model";
import type { MermaidViewportCommand, MermaidViewportMode } from "./viewport-controller";

interface MermaidFenceHostImplProps extends MarkdownFenceRendererProps {
  colorScheme?: "light" | "dark";
}

interface RuntimeRenderedMessage {
  revision: number;
  source: string;
  colorScheme: "light" | "dark";
  height: number;
  width: number;
}

interface NativeViewportState {
  mode: MermaidViewportMode;
  command: MermaidRuntimeViewportCommand | null;
}

const WEBVIEW_SOURCE = { html: mermaidRuntimeHtml };
const WEBVIEW_ORIGIN_WHITELIST = ["about:blank", "data:*"];
const MAX_PREVIEW_HEIGHT = 480;
const RENDER_TIMEOUT_MS = 5_000;
const COPIED_RESET_MS = 1_500;

interface MermaidWebViewProps {
  request: MermaidRenderRequest | null;
  interactive: boolean;
  onRendered: (message: RuntimeRenderedMessage) => void;
  onRenderFailed: (revision: number) => void;
  style?: ViewStyle;
  viewport?: NativeViewportState;
}

function MermaidWebView({
  request,
  interactive,
  onRendered,
  onRenderFailed,
  style,
  viewport,
}: MermaidWebViewProps) {
  const webViewRef = useRef<WebView | null>(null);
  const driverRef = useRef(new MermaidRuntimeRequestDriver());
  const requestRef = useRef<MermaidRenderRequest | null>(null);
  const settledRevisionRef = useRef<number | null>(null);
  const renderedRevisionRef = useRef<number | null>(null);
  const failedRevisionRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const restartingRef = useRef(false);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<() => void>(() => undefined);
  const viewportRef = useRef(viewport);
  const [webViewEpoch, setWebViewEpoch] = useState(0);
  viewportRef.current = viewport;

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const armWatchdog = useCallback(
    (revision: number) => {
      clearWatchdog();
      watchdogRef.current = setTimeout(() => {
        if (requestRef.current?.revision === revision && settledRevisionRef.current !== revision) {
          retryRef.current();
        }
      }, RENDER_TIMEOUT_MS);
    },
    [clearWatchdog],
  );

  const injectMessage = useCallback((message: MermaidRuntimeInboundMessage) => {
    const payload = serializeMermaidRuntimeInboundMessage(message);
    webViewRef.current?.injectJavaScript(
      `window.__PASEO_MERMAID_RUNTIME_RECEIVE__ && window.__PASEO_MERMAID_RUNTIME_RECEIVE__(${payload}); true;`,
    );
  }, []);

  const sendRequest = useCallback(
    (current: MermaidRenderRequest | null) => {
      if (!current || !webViewRef.current) {
        return;
      }
      const message: MermaidRuntimeRenderMessage = {
        type: "render",
        revision: current.revision,
        source: current.source,
        colorScheme: current.colorScheme,
        interactive,
      };
      injectMessage(message);
      armWatchdog(current.revision);
    },
    [armWatchdog, injectMessage, interactive],
  );

  const sendViewport = useCallback(
    (current: NativeViewportState | undefined, revision = renderedRevisionRef.current) => {
      if (!current || revision === null || !webViewRef.current) {
        return;
      }
      injectMessage({
        type: "viewport",
        revision,
        mode: current.mode,
        command: current.command,
      });
    },
    [injectMessage],
  );

  const retryOrFail = useCallback(() => {
    const current = requestRef.current;
    if (!current || settledRevisionRef.current === current.revision || restartingRef.current) {
      return;
    }
    clearWatchdog();
    if (retryCountRef.current < 1) {
      retryCountRef.current += 1;
      restartingRef.current = true;
      renderedRevisionRef.current = null;
      driverRef.current = new MermaidRuntimeRequestDriver();
      driverRef.current.update(current);
      setWebViewEpoch((value) => value + 1);
      return;
    }
    settledRevisionRef.current = current.revision;
    failedRevisionRef.current = current.revision;
    onRenderFailed(current.revision);
  }, [clearWatchdog, onRenderFailed]);
  retryRef.current = retryOrFail;

  useEffect(() => {
    if (!request) {
      return;
    }
    const previousRevision = requestRef.current?.revision;
    const recoveringFromFailure = failedRevisionRef.current !== null;
    requestRef.current = request;
    if (previousRevision !== request.revision) {
      settledRevisionRef.current = null;
      renderedRevisionRef.current = null;
      failedRevisionRef.current = null;
      retryCountRef.current = 0;
    }
    if (recoveringFromFailure) {
      restartingRef.current = true;
      driverRef.current = new MermaidRuntimeRequestDriver();
      driverRef.current.update(request);
      setWebViewEpoch((value) => value + 1);
      return;
    }
    sendRequest(driverRef.current.update(request));
  }, [request, sendRequest]);

  useEffect(() => {
    sendViewport(viewport);
  }, [sendViewport, viewport]);

  useEffect(
    () => () => {
      clearWatchdog();
    },
    [clearWatchdog],
  );

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let value: unknown;
      try {
        value = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      const message = parseMermaidRuntimeMessage(value);
      if (!message) {
        return;
      }
      if (message.type === "bridgeReady") {
        sendRequest(driverRef.current.ready());
        return;
      }
      if (message.type === "renderError") {
        if (requestRef.current?.revision === message.revision) {
          clearWatchdog();
          settledRevisionRef.current = message.revision;
        }
        onRenderFailed(message.revision);
        sendRequest(driverRef.current.settled(message.revision, false));
        return;
      }
      if (requestRef.current?.revision === message.revision) {
        clearWatchdog();
        settledRevisionRef.current = message.revision;
        renderedRevisionRef.current = message.revision;
      }
      onRendered(message);
      sendViewport(viewportRef.current, message.revision);
      sendRequest(driverRef.current.settled(message.revision, true));
    },
    [clearWatchdog, onRenderFailed, onRendered, sendRequest, sendViewport],
  );

  const handleLoadStart = useCallback(() => {
    restartingRef.current = false;
    const current = requestRef.current;
    if (current && settledRevisionRef.current !== current.revision) {
      armWatchdog(current.revision);
    }
  }, [armWatchdog]);

  const handleShouldStartLoad = useCallback<
    NonNullable<WebViewProps["onShouldStartLoadWithRequest"]>
  >((load) => load.url === "about:blank" || load.url.startsWith("data:text/html"), []);

  return (
    <WebView
      key={webViewEpoch}
      ref={webViewRef}
      source={WEBVIEW_SOURCE}
      originWhitelist={WEBVIEW_ORIGIN_WHITELIST}
      style={[webViewStyles.webView, style]}
      onMessage={handleMessage}
      onLoadStart={handleLoadStart}
      onError={retryOrFail}
      onContentProcessDidTerminate={retryOrFail}
      onRenderProcessGone={retryOrFail}
      onShouldStartLoadWithRequest={handleShouldStartLoad}
      javaScriptEnabled
      domStorageEnabled={false}
      cacheEnabled={false}
      incognito
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      mixedContentMode="never"
      thirdPartyCookiesEnabled={false}
      sharedCookiesEnabled={false}
      javaScriptCanOpenWindowsAutomatically={false}
      setSupportMultipleWindows={false}
      allowsLinkPreview={false}
      textInteractionEnabled
      scrollEnabled={false}
      nestedScrollEnabled={false}
      bounces={false}
      overScrollMode="never"
      automaticallyAdjustContentInsets={false}
      contentInsetAdjustmentBehavior="never"
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      setBuiltInZoomControls={false}
      setDisplayZoomControls={false}
      scalesPageToFit={false}
      textZoom={100}
    />
  );
}

const webViewStyles = RNStyleSheet.create({
  webView: { flex: 1, backgroundColor: "transparent" },
});

function DiagramActionIcon({ icon: Icon, color }: { icon: LucideIcon; color: string }) {
  return <Icon size={18} color={color} />;
}

const ThemedDiagramActionIcon = withUnistyles(DiagramActionIcon, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

function DiagramAction({
  icon: Icon,
  label,
  onPress,
  selected,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void | Promise<void>;
  selected?: boolean;
}) {
  const accessibilityState = useMemo(
    () => (selected === undefined ? undefined : { selected }),
    [selected],
  );
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      hitSlop={6}
      onPress={onPress}
      style={[viewerStyles.actionButton, selected && viewerStyles.actionSelected]}
    >
      <ThemedDiagramActionIcon icon={Icon} />
    </Pressable>
  );
}

function useCopyMermaidSource(source: string) {
  const [copied, setCopied] = useState(false);
  const copiedResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copy = useCallback(async () => {
    await Clipboard.setStringAsync(source);
    setCopied(true);
    if (copiedResetRef.current) {
      clearTimeout(copiedResetRef.current);
    }
    copiedResetRef.current = setTimeout(() => {
      setCopied(false);
      copiedResetRef.current = null;
    }, COPIED_RESET_MS);
  }, [source]);
  useEffect(
    () => () => {
      if (copiedResetRef.current) {
        clearTimeout(copiedResetRef.current);
      }
    },
    [],
  );
  return { copied, copy };
}

function sourcePresentation(textStyle: TextStyle): {
  container: ViewStyle[];
  text: TextStyle;
} {
  const { marginTop, marginBottom, marginVertical, ...sourceTextStyle } = textStyle;
  return {
    container: [
      {
        marginTop: marginTop ?? marginVertical,
        marginBottom: marginBottom ?? marginVertical,
      },
      sourceContainerStyle,
    ],
    text: sourceTextStyle,
  };
}

interface MermaidDiagramViewerProps {
  code: string;
  colorScheme: "light" | "dark";
  onClose: () => void;
  inheritedStyles: TextStyle;
  textStyle: TextStyle;
}

function MermaidDiagramViewer({
  code,
  colorScheme,
  onClose,
  inheritedStyles,
  textStyle,
}: MermaidDiagramViewerProps) {
  const { t } = useTranslation();
  const [showSource, setShowSource] = useState(false);
  const [mode, setMode] = useState<MermaidViewportMode>("pan");
  const [command, setCommand] = useState<MermaidRuntimeViewportCommand | null>(null);
  const commandIdRef = useRef(0);
  const { copied, copy } = useCopyMermaidSource(code);
  const viewport = useMemo<NativeViewportState>(() => ({ mode, command }), [command, mode]);
  const { state, request, rendered, renderFailed } = useMermaidRenderModel({
    source: code,
    phase: "complete",
    colorScheme,
  });
  const handleRendered = useCallback(
    (message: RuntimeRenderedMessage) => {
      rendered({
        revision: message.revision,
        source: message.source,
        colorScheme: message.colorScheme,
        dimensions: { height: message.height, width: message.width },
      });
    },
    [rendered],
  );
  const issueCommand = useCallback((type: MermaidViewportCommand) => {
    commandIdRef.current += 1;
    setCommand({ id: commandIdRef.current, type });
  }, []);
  const zoomOut = useCallback(() => issueCommand("zoom-out"), [issueCommand]);
  const zoomIn = useCallback(() => issueCommand("zoom-in"), [issueCommand]);
  const fit = useCallback(() => issueCommand("fit"), [issueCommand]);
  const reset = useCallback(() => issueCommand("reset"), [issueCommand]);
  const toggleSource = useCallback(() => setShowSource((current) => !current), []);
  const usePanMode = useCallback(() => setMode("pan"), []);
  const useSelectMode = useCallback(() => setMode("select"), []);

  useEffect(() => {
    if (state.status === "failed" || state.status === "rejected") {
      setShowSource(true);
    }
  }, [state.status]);

  return (
    <Modal transparent animationType="fade" statusBarTranslucent visible onRequestClose={onClose}>
      <View style={viewerStyles.backdrop}>
        <View style={viewerStyles.actions}>
          <DiagramAction
            icon={ZoomOut}
            label={t("message.actions.zoomOutMermaidDiagram")}
            onPress={zoomOut}
          />
          <DiagramAction
            icon={ZoomIn}
            label={t("message.actions.zoomInMermaidDiagram")}
            onPress={zoomIn}
          />
          <DiagramAction
            icon={Maximize2}
            label={t("message.actions.fitMermaidDiagram")}
            onPress={fit}
          />
          <DiagramAction
            icon={RotateCcw}
            label={t("message.actions.resetMermaidDiagram")}
            onPress={reset}
          />
          <DiagramAction
            icon={Hand}
            label={t("message.actions.panMermaidDiagram")}
            onPress={usePanMode}
            selected={mode === "pan"}
          />
          <DiagramAction
            icon={MousePointer2}
            label={t("message.actions.selectMermaidText")}
            onPress={useSelectMode}
            selected={mode === "select"}
          />
          <DiagramAction
            icon={showSource ? Workflow : Code}
            label={showSource ? t("message.diagram.viewDiagram") : t("message.diagram.viewSource")}
            onPress={toggleSource}
            selected={showSource}
          />
          <DiagramAction
            icon={copied ? Check : Copy}
            label={copied ? t("message.actions.copied") : t("message.actions.copyMermaidSource")}
            onPress={copy}
          />
          <DiagramAction icon={X} label={t("common.actions.close")} onPress={onClose} />
        </View>
        <View style={viewerStyles.webView}>
          <MermaidWebView
            request={request}
            interactive
            viewport={viewport}
            onRendered={handleRendered}
            onRenderFailed={renderFailed}
            style={viewerStyles.runtime}
          />
          {showSource ? (
            <ScrollView
              style={viewerStyles.sourceOverlay}
              contentContainerStyle={viewerStyles.source}
            >
              <HighlightedCodeBlock
                code={code}
                language="mermaid"
                inheritedStyles={inheritedStyles}
                textStyle={textStyle}
              />
            </ScrollView>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const viewerStyles = StyleSheet.create((theme, runtime) => ({
  backdrop: { flex: 1, backgroundColor: theme.colors.surface0 },
  actions: {
    paddingTop: runtime.insets.top + theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[2],
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  actionButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.base,
    backgroundColor: theme.colors.surface2,
  },
  actionSelected: { backgroundColor: theme.colors.surface3 },
  webView: {
    flex: 1,
    marginBottom: runtime.insets.bottom,
  },
  runtime: { flex: 1 },
  sourceOverlay: {
    position: "absolute",
    inset: 0,
    backgroundColor: theme.colors.surface0,
  },
  source: {
    padding: theme.spacing[4],
  },
}));

function MermaidFenceHostImpl({
  code,
  phase,
  inheritedStyles,
  textStyle,
  colorScheme = "dark",
}: MermaidFenceHostImplProps) {
  const { t } = useTranslation();
  const { state, request, rendered, renderFailed } = useMermaidRenderModel({
    source: code,
    phase,
    colorScheme,
  });
  const [hasRuntimeContent, setHasRuntimeContent] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const { copied, copy } = useCopyMermaidSource(code);
  const handleRendered = useCallback(
    (message: RuntimeRenderedMessage) => {
      setHasRuntimeContent(true);
      rendered({
        revision: message.revision,
        source: message.source,
        colorScheme: message.colorScheme,
        dimensions: { height: message.height, width: message.width },
      });
    },
    [rendered],
  );
  const toggleSource = useCallback(() => setShowSource((current) => !current), []);
  const openViewer = useCallback(() => setViewerOpen(true), []);
  const closeViewer = useCallback(() => setViewerOpen(false), []);
  const visible = state.visible;
  const canShowDiagram = visible !== null && hasRuntimeContent;
  const diagramVisible = canShowDiagram && !showSource;
  const previewInnerStyle = useMemo(
    () =>
      canShowDiagram && visible
        ? { height: Math.min(visible.height, MAX_PREVIEW_HEIGHT) }
        : previewStyles.measuringInner,
    [canShowDiagram, visible],
  );
  const sourceView = useMemo(() => sourcePresentation(textStyle), [textStyle]);
  const rootStyle = canShowDiagram
    ? [getDiagramBoxStyle(textStyle), previewStyles.frame]
    : sourceView.container;

  return (
    <View style={rootStyle}>
      {canShowDiagram ? (
        <View style={previewStyles.toolbar}>
          <DiagramAction
            icon={showSource ? Workflow : FileText}
            label={
              showSource
                ? t("message.actions.hideMermaidSource")
                : t("message.actions.showMermaidSource")
            }
            onPress={toggleSource}
            selected={showSource}
          />
          <DiagramAction
            icon={copied ? Check : Copy}
            label={copied ? t("message.actions.copied") : t("message.actions.copyMermaidSource")}
            onPress={copy}
          />
          <DiagramAction
            icon={Maximize2}
            label={t("message.actions.expandMermaidDiagram")}
            onPress={openViewer}
          />
        </View>
      ) : null}
      {!canShowDiagram || showSource ? (
        <HighlightedCodeBlock
          code={code}
          language="mermaid"
          inheritedStyles={inheritedStyles}
          textStyle={canShowDiagram ? sourceView.text : textStyle}
        />
      ) : null}
      <Pressable
        onPress={openViewer}
        disabled={!diagramVisible}
        accessibilityRole={diagramVisible ? "imagebutton" : undefined}
        accessibilityLabel={t("message.diagram.diagram")}
        style={diagramVisible ? previewStyles.preview : previewStyles.measuring}
      >
        <View style={previewInnerStyle} pointerEvents="none">
          <MermaidWebView
            request={request}
            interactive={false}
            onRendered={handleRendered}
            onRenderFailed={renderFailed}
          />
        </View>
      </Pressable>
      {viewerOpen && canShowDiagram && visible ? (
        <MermaidDiagramViewer
          code={visible.source}
          colorScheme={visible.colorScheme}
          onClose={closeViewer}
          inheritedStyles={inheritedStyles}
          textStyle={textStyle}
        />
      ) : null}
    </View>
  );
}

const previewStyles = StyleSheet.create((theme) => ({
  frame: {
    overflow: "hidden",
    position: "relative",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
  toolbar: {
    minHeight: 44,
    paddingHorizontal: theme.spacing[2],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  measuring: {
    position: "absolute",
    left: 0,
    right: 0,
    opacity: 0,
    pointerEvents: "none",
  },
  measuringInner: { height: 240 },
  preview: { overflow: "hidden" },
}));

const sourceContainerStyle: ViewStyle = { position: "relative" };
const mapColorScheme = (theme: Theme) => ({ colorScheme: theme.colorScheme });
const ThemedMermaidFenceHost = withUnistyles(MermaidFenceHostImpl);

export function MermaidFenceHost(props: MarkdownFenceRendererProps) {
  return <ThemedMermaidFenceHost {...props} uniProps={mapColorScheme} />;
}
