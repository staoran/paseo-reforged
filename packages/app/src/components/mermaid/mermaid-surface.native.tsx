import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Asset } from "expo-asset";
import {
  WebView,
  type WebViewMessageEvent,
  type WebViewNavigation,
  type WebViewProps,
} from "react-native-webview";
import {
  createMermaidBridgeState,
  parseMermaidWebViewMessage,
  reduceMermaidBridgeState,
  type MermaidBridgeState,
} from "@/components/mermaid/mermaid-webview-bridge";
import type { MermaidSurfaceProps } from "@/components/mermaid/mermaid-surface-types";
import { useStableMermaidRenderTheme } from "@/components/mermaid/use-stable-mermaid-render-theme";

interface RenderMessage {
  type: "render";
  requestId: number;
  source: string;
  theme: MermaidSurfaceProps["theme"];
}

const MERMAID_WEBVIEW_ASSET_MODULE = require("../../mermaid/webview/mermaid-webview.html");
const WEBVIEW_ORIGIN_WHITELIST = ["*"];
const RENDER_TIMEOUT_MS = 5_000;
let nextRequestId = 1;

function serializeForInjectedJavaScript(message: RenderMessage): string {
  return JSON.stringify(message).replace(/<\/script/gi, "<\\/script");
}

function isAllowedNavigation(request: WebViewNavigation, documentUri: string): boolean {
  return request.url === documentUri || request.url.startsWith(`${documentUri}#`);
}

export function MermaidSurface({ source, theme, onStatusChange, style }: MermaidSurfaceProps) {
  const stableTheme = useStableMermaidRenderTheme(theme);
  const webViewRef = useRef<WebView>(null);
  const bridgeReadyRef = useRef(false);
  const pendingRenderRef = useRef<RenderMessage>({
    type: "render",
    requestId: nextRequestId++,
    source,
    theme: stableTheme,
  });
  const [bridgeState, setBridgeState] = useState<MermaidBridgeState>(() =>
    createMermaidBridgeState(pendingRenderRef.current.requestId),
  );
  const [webViewDocumentUri, setWebViewDocumentUri] = useState<string | null>(null);
  const bridgeStateRef = useRef(bridgeState);
  const [webViewEpoch, setWebViewEpoch] = useState(0);
  const retryCountRef = useRef(0);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<() => void>(() => undefined);

  const commitBridgeState = useCallback(
    (next: MermaidBridgeState) => {
      bridgeStateRef.current = next;
      setBridgeState(next);
      onStatusChange(next.status);
    },
    [onStatusChange],
  );

  const clearWatchdog = useCallback(() => {
    if (!watchdogRef.current) return;
    clearTimeout(watchdogRef.current);
    watchdogRef.current = null;
  }, []);

  const armWatchdog = useCallback(() => {
    clearWatchdog();
    const requestId = pendingRenderRef.current.requestId;
    watchdogRef.current = setTimeout(() => {
      if (
        pendingRenderRef.current.requestId === requestId &&
        bridgeStateRef.current.status !== "ready"
      ) {
        retryRef.current();
      }
    }, RENDER_TIMEOUT_MS);
  }, [clearWatchdog]);

  const injectPendingRender = useCallback(() => {
    if (!bridgeReadyRef.current) return;
    const serialized = serializeForInjectedJavaScript(pendingRenderRef.current);
    webViewRef.current?.injectJavaScript(
      `window.__PASEO_MERMAID_WEBVIEW_RECEIVE__?.(${serialized}); true;`,
    );
  }, []);

  const retryOrFail = useCallback(() => {
    clearWatchdog();
    if (retryCountRef.current < 1) {
      retryCountRef.current += 1;
      bridgeReadyRef.current = false;
      const next = {
        ...createMermaidBridgeState(pendingRenderRef.current.requestId),
        bridgeReady: false,
      };
      commitBridgeState(next);
      setWebViewEpoch((value) => value + 1);
      armWatchdog();
      return;
    }

    commitBridgeState({ ...bridgeStateRef.current, status: "error" });
  }, [armWatchdog, clearWatchdog, commitBridgeState]);
  retryRef.current = retryOrFail;

  useEffect(() => {
    let active = true;
    const asset = Asset.fromModule(MERMAID_WEBVIEW_ASSET_MODULE);
    void asset.downloadAsync().then(
      () => {
        if (!active) return undefined;
        const uri = asset.localUri;
        if (!uri) {
          commitBridgeState({ ...bridgeStateRef.current, status: "error" });
          return undefined;
        }
        setWebViewDocumentUri(uri);
        return undefined;
      },
      () => {
        if (active) {
          commitBridgeState({ ...bridgeStateRef.current, status: "error" });
        }
        return undefined;
      },
    );
    return () => {
      active = false;
    };
  }, [commitBridgeState]);

  useEffect(() => {
    const requestId = nextRequestId++;
    pendingRenderRef.current = { type: "render", requestId, source, theme: stableTheme };
    retryCountRef.current = 0;
    const next = {
      ...createMermaidBridgeState(requestId),
      bridgeReady: bridgeReadyRef.current,
    };
    commitBridgeState(next);
    if (webViewDocumentUri) {
      armWatchdog();
      injectPendingRender();
    }
  }, [
    armWatchdog,
    commitBridgeState,
    injectPendingRender,
    source,
    stableTheme,
    webViewDocumentUri,
  ]);

  useEffect(
    () => () => {
      clearWatchdog();
    },
    [clearWatchdog],
  );

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const message = parseMermaidWebViewMessage(event.nativeEvent.data);
      if (!message) return;

      if (message.type === "ready") {
        bridgeReadyRef.current = true;
        commitBridgeState(reduceMermaidBridgeState(bridgeStateRef.current, message));
        injectPendingRender();
        return;
      }

      const current = bridgeStateRef.current;
      const next = reduceMermaidBridgeState(current, message);
      if (next === current) return;
      commitBridgeState(next);

      if (message.type === "rendered" || message.type === "error") {
        clearWatchdog();
      }
    },
    [clearWatchdog, commitBridgeState, injectPendingRender],
  );

  const handleLoadStart = useCallback(() => {
    bridgeReadyRef.current = false;
    commitBridgeState({ ...bridgeStateRef.current, bridgeReady: false, status: "loading" });
    armWatchdog();
  }, [armWatchdog, commitBridgeState]);

  const handleWebViewFailure = useCallback(() => {
    retryOrFail();
  }, [retryOrFail]);

  const handleShouldStartLoad = useCallback<
    NonNullable<WebViewProps["onShouldStartLoadWithRequest"]>
  >(
    (request) => webViewDocumentUri !== null && isAllowedNavigation(request, webViewDocumentUri),
    [webViewDocumentUri],
  );

  const rootStyle = useMemo<StyleProp<ViewStyle>>(
    () => [styles.root, style, { height: bridgeState.height }],
    [bridgeState.height, style],
  );
  const webViewStyle = useMemo<StyleProp<ViewStyle>>(
    () => [styles.webView, { height: bridgeState.height }],
    [bridgeState.height],
  );
  const webViewSource = useMemo(
    () => (webViewDocumentUri ? { uri: webViewDocumentUri } : null),
    [webViewDocumentUri],
  );

  return (
    <View style={rootStyle}>
      {webViewSource ? (
        <WebView
          key={webViewEpoch}
          ref={webViewRef}
          source={webViewSource}
          style={webViewStyle}
          containerStyle={webViewStyle}
          originWhitelist={WEBVIEW_ORIGIN_WHITELIST}
          onShouldStartLoadWithRequest={handleShouldStartLoad}
          onMessage={handleMessage}
          onLoadStart={handleLoadStart}
          onError={handleWebViewFailure}
          onContentProcessDidTerminate={handleWebViewFailure}
          onRenderProcessGone={handleWebViewFailure}
          javaScriptEnabled
          domStorageEnabled={false}
          cacheEnabled={false}
          allowFileAccess
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          mixedContentMode="never"
          thirdPartyCookiesEnabled={false}
          sharedCookiesEnabled={false}
          javaScriptCanOpenWindowsAutomatically={false}
          setSupportMultipleWindows={false}
          allowsLinkPreview={false}
          textInteractionEnabled
          scrollEnabled
          nestedScrollEnabled
          bounces={false}
          overScrollMode="never"
          automaticallyAdjustContentInsets={false}
          contentInsetAdjustmentBehavior="never"
          showsHorizontalScrollIndicator
          showsVerticalScrollIndicator={false}
          setBuiltInZoomControls={false}
          setDisplayZoomControls={false}
          textZoom={100}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: "100%",
    minWidth: 0,
    overflow: "hidden",
    backgroundColor: "transparent",
  },
  webView: {
    width: "100%",
    backgroundColor: "transparent",
  },
});
