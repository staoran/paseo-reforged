import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  type PressableStateCallbackType,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import * as Clipboard from "expo-clipboard";
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
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { HighlightedCodeBlock } from "@/components/highlighted-code-block";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Theme } from "@/styles/theme";
import type { MarkdownFenceRendererProps } from "../types";
import { getDiagramBoxStyle } from "./presentation";
import type { MermaidRenderRequest } from "./render-model";
import { mermaidRuntimeHtml } from "./runtime/html.gen";
import { parseMermaidRuntimeMessage, type MermaidRuntimeRenderMessage } from "./runtime/messages";
import { MermaidRuntimeRequestDriver } from "./runtime/request-driver";
import { useMermaidRenderModel } from "./use-render-model";
import {
  createMermaidViewportController,
  type MermaidViewportCommand,
  type MermaidViewportController,
  type MermaidViewportMode,
} from "./viewport-controller";

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

interface MermaidIframeRuntimeProps {
  request: MermaidRenderRequest | null;
  height: number;
  width?: number | string;
  interactive: boolean;
  pointerEvents: React.CSSProperties["pointerEvents"];
  onRendered: (message: RuntimeRenderedMessage) => void;
  onRenderFailed: (revision: number) => void;
  iframeRef?: React.RefObject<HTMLIFrameElement | null>;
}

function MermaidIframeRuntime({
  request,
  height,
  width = "100%",
  interactive,
  pointerEvents,
  onRendered,
  onRenderFailed,
  iframeRef: forwardedRef,
}: MermaidIframeRuntimeProps) {
  const localRef = useRef<HTMLIFrameElement | null>(null);
  const iframeRef = forwardedRef ?? localRef;
  const driverRef = useRef<MermaidRuntimeRequestDriver | null>(null);
  driverRef.current ??= new MermaidRuntimeRequestDriver();
  const iframeStyle = useMemo<React.CSSProperties>(
    () => ({
      display: "block",
      width,
      height,
      border: 0,
      pointerEvents,
      background: "transparent",
    }),
    [height, pointerEvents, width],
  );

  const sendRequest = useCallback(
    (current: MermaidRenderRequest | null) => {
      const target = iframeRef.current?.contentWindow;
      if (!current || !target) {
        return;
      }
      const message: MermaidRuntimeRenderMessage = {
        type: "render",
        revision: current.revision,
        source: current.source,
        colorScheme: current.colorScheme,
        interactive,
      };
      target.postMessage(message, "*");
    },
    [iframeRef, interactive],
  );

  useEffect(() => {
    sendRequest(driverRef.current?.update(request) ?? null);
  }, [request, sendRequest]);

  useEffect(() => {
    function receiveMessage(event: MessageEvent): void {
      if (event.source !== iframeRef.current?.contentWindow) {
        return;
      }
      const message = parseMermaidRuntimeMessage(event.data);
      if (!message) {
        return;
      }
      if (message.type === "bridgeReady") {
        sendRequest(driverRef.current?.ready() ?? null);
        return;
      }
      if (message.type === "renderError") {
        onRenderFailed(message.revision);
        sendRequest(driverRef.current?.settled(message.revision, false) ?? null);
        return;
      }
      onRendered(message);
      sendRequest(driverRef.current?.settled(message.revision, true) ?? null);
    }
    window.addEventListener("message", receiveMessage);
    return () => window.removeEventListener("message", receiveMessage);
  }, [iframeRef, onRenderFailed, onRendered, sendRequest]);

  return (
    <iframe
      ref={iframeRef}
      title=""
      aria-hidden
      sandbox="allow-scripts"
      srcDoc={mermaidRuntimeHtml}
      tabIndex={-1}
      style={iframeStyle}
    />
  );
}

interface DiagramActionProps {
  icon: LucideIcon;
  label: string;
  onPress: () => void | Promise<void>;
  selected?: boolean;
}

type WebPressableState = PressableStateCallbackType & { hovered?: boolean };

function actionStyle({ hovered, pressed }: WebPressableState) {
  return [styles.action, (hovered || pressed) && styles.actionHovered];
}

function selectedActionStyle({ hovered, pressed }: WebPressableState) {
  return [styles.action, styles.actionSelected, (hovered || pressed) && styles.actionHovered];
}

function DiagramAction({ icon: Icon, label, onPress, selected }: DiagramActionProps) {
  const accessibilityState = useMemo(
    () => (selected === undefined ? undefined : { selected }),
    [selected],
  );
  return (
    <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityLabel={label}
          accessibilityRole="button"
          accessibilityState={accessibilityState}
          aria-selected={selected}
          hitSlop={6}
          onPress={onPress}
          style={selected ? selectedActionStyle : actionStyle}
        >
          <ThemedActionIcon icon={Icon} />
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={6}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function ActionIcon({ icon: Icon, color }: { icon: LucideIcon; color: string }) {
  return <Icon size={14} color={color} />;
}

const ThemedActionIcon = withUnistyles(ActionIcon, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

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

function resolveRootStyle(
  canShowDiagram: boolean,
  textStyle: TextStyle,
  sourceView: ReturnType<typeof sourcePresentation>,
) {
  return canShowDiagram ? [getDiagramBoxStyle(textStyle), styles.frame] : sourceView.container;
}

function ExpandedDiagram({
  source,
  colorScheme,
  inheritedStyles,
  textStyle,
  onClose,
}: {
  source: string;
  colorScheme: "light" | "dark";
  inheritedStyles: TextStyle;
  textStyle: TextStyle;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { state, request, rendered, renderFailed } = useMermaidRenderModel({
    source,
    phase: "complete",
    colorScheme,
  });
  const [mode, setMode] = useState<MermaidViewportMode>("pan");
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const controllerRef = useRef<MermaidViewportController | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const visible = state.visible;
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

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    const iframe = iframeRef.current;
    if (!visible || !viewport || !content || !iframe) {
      return;
    }
    const controller = createMermaidViewportController({
      viewport,
      content,
      interactiveElement: iframe,
      contentSize: { width: visible.width, height: visible.height },
    });
    controller.setMode(modeRef.current);
    controllerRef.current = controller;
    return () => {
      controller.destroy();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [visible]);

  useEffect(() => {
    controllerRef.current?.setMode(mode);
  }, [mode]);

  const copySource = useCallback(async () => {
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

  const issueCommand = useCallback((command: MermaidViewportCommand) => {
    controllerRef.current?.execute(command);
  }, []);
  const zoomOut = useCallback(() => issueCommand("zoom-out"), [issueCommand]);
  const zoomIn = useCallback(() => issueCommand("zoom-in"), [issueCommand]);
  const fit = useCallback(() => issueCommand("fit"), [issueCommand]);
  const reset = useCallback(() => issueCommand("reset"), [issueCommand]);
  const usePanMode = useCallback(() => setMode("pan"), []);
  const useSelectMode = useCallback(() => setMode("select"), []);
  const toggleSource = useCallback(() => setShowSource((current) => !current), []);
  const runtimeHeight = Math.max(visible?.height ?? 240, 1);
  const runtimeWidth = Math.max(visible?.width ?? 320, 1);

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityLabel={t("common.actions.close")}
          onPress={onClose}
          style={styles.modalBackdrop}
        />
        <View style={styles.modalContent}>
          <View style={styles.modalToolbar}>
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
            <View style={styles.modeGroup}>
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
            </View>
            <DiagramAction
              icon={showSource ? Workflow : Code}
              label={
                showSource ? t("message.diagram.viewDiagram") : t("message.diagram.viewSource")
              }
              onPress={toggleSource}
              selected={showSource}
            />
            <DiagramAction
              icon={copied ? Check : Copy}
              label={copied ? t("message.actions.copied") : t("message.actions.copyMermaidSource")}
              onPress={copySource}
            />
            <DiagramAction icon={X} label={t("common.actions.close")} onPress={onClose} />
          </View>
          <View testID="mermaid-expanded-surface" style={styles.expandedSurface}>
            <div ref={viewportRef} style={expandedViewportStyle}>
              <div ref={contentRef} data-testid="mermaid-expanded-content">
                <MermaidIframeRuntime
                  iframeRef={iframeRef}
                  request={request}
                  height={runtimeHeight}
                  width={runtimeWidth}
                  interactive
                  pointerEvents={mode === "select" ? "auto" : "none"}
                  onRendered={handleRendered}
                  onRenderFailed={renderFailed}
                />
              </div>
            </div>
            {showSource ? (
              <ScrollView style={styles.sourceOverlay} contentContainerStyle={styles.sourceScroll}>
                <HighlightedCodeBlock
                  code={source}
                  language="mermaid"
                  inheritedStyles={inheritedStyles}
                  textStyle={textStyle}
                />
              </ScrollView>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const COPIED_RESET_MS = 1_500;

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
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const copySource = useCallback(async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    if (copiedResetRef.current) {
      clearTimeout(copiedResetRef.current);
    }
    copiedResetRef.current = setTimeout(() => {
      setCopied(false);
      copiedResetRef.current = null;
    }, COPIED_RESET_MS);
  }, [code]);
  useEffect(
    () => () => {
      if (copiedResetRef.current) {
        clearTimeout(copiedResetRef.current);
      }
    },
    [],
  );
  const toggleSource = useCallback(() => setShowSource((current) => !current), []);
  const openExpanded = useCallback(() => setExpanded(true), []);
  const closeExpanded = useCallback(() => setExpanded(false), []);
  const visible = state.visible;
  const canShowDiagram = visible !== null && hasRuntimeContent;
  const diagramVisible = canShowDiagram && !showSource;
  const runtimeHeight = Math.max(visible?.height ?? 240, 1);
  const sourceView = useMemo(() => sourcePresentation(textStyle), [textStyle]);
  const rootStyle = resolveRootStyle(canShowDiagram, textStyle, sourceView);
  const runtimeStyle = diagramVisible ? inlineViewportStyle(runtimeHeight) : measuringRuntimeStyle;

  return (
    <View style={rootStyle}>
      {canShowDiagram ? (
        <View style={styles.toolbar}>
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
            onPress={copySource}
          />
          <DiagramAction
            icon={Maximize2}
            label={t("message.actions.expandMermaidDiagram")}
            onPress={openExpanded}
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
      <div
        role={diagramVisible ? "img" : undefined}
        aria-label={diagramVisible ? t("message.diagram.diagram") : undefined}
        aria-hidden={!diagramVisible}
        style={runtimeStyle}
      >
        <MermaidIframeRuntime
          request={request}
          height={runtimeHeight}
          interactive={false}
          pointerEvents={diagramVisible ? "auto" : "none"}
          onRendered={handleRendered}
          onRenderFailed={renderFailed}
        />
      </div>
      {expanded && visible ? (
        <ExpandedDiagram
          source={visible.source}
          colorScheme={visible.colorScheme}
          inheritedStyles={inheritedStyles}
          textStyle={textStyle}
          onClose={closeExpanded}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  frame: {
    overflow: "hidden",
    position: "relative",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
  toolbar: {
    minHeight: 32,
    paddingHorizontal: theme.spacing[2],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  action: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.base,
  },
  actionSelected: { backgroundColor: theme.colors.surface2 },
  actionHovered: { backgroundColor: theme.colors.surface2 },
  tooltipText: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.xs,
  },
  modalRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  modalBackdrop: {
    position: "absolute",
    inset: 0,
    backgroundColor: "rgba(0, 0, 0, 0.58)",
  },
  modalContent: {
    width: "100%",
    height: "90%",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
  modalToolbar: {
    minHeight: 40,
    paddingHorizontal: theme.spacing[2],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  modeGroup: {
    flexDirection: "row",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.base,
  },
  expandedSurface: { flex: 1, overflow: "hidden", position: "relative" },
  sourceOverlay: {
    position: "absolute",
    inset: 0,
    backgroundColor: theme.colors.surface0,
  },
  sourceScroll: { padding: theme.spacing[4] },
}));

const sourceContainerStyle: ViewStyle = { position: "relative" };
const measuringRuntimeStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  height: 240,
  opacity: 0,
  pointerEvents: "none",
  overflow: "hidden",
};
const expandedViewportStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  overflow: "hidden",
};
function inlineViewportStyle(height: number): React.CSSProperties {
  return { width: "100%", height, overflow: "hidden", userSelect: "text" };
}
const mapColorScheme = (theme: Theme) => ({ colorScheme: theme.colorScheme });
const ThemedMermaidFenceHost = withUnistyles(MermaidFenceHostImpl);

export function MermaidFenceHost(props: MarkdownFenceRendererProps) {
  return <ThemedMermaidFenceHost {...props} uniProps={mapColorScheme} />;
}
