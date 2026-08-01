import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import {
  Check,
  Copy,
  FileText,
  Hand,
  Maximize2,
  MousePointer2,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { createMermaidRenderTheme } from "@/components/mermaid/mermaid-render-theme";
import { MermaidSurface } from "@/components/mermaid/mermaid-surface";
import type {
  MermaidRenderStatus,
  MermaidViewportCommand,
  MermaidViewportMode,
} from "@/components/mermaid/mermaid-surface-types";

interface MermaidDiagramProps {
  source: string;
  fallback: ReactNode;
}

const COPIED_RESET_MS = 1_500;
const ThemedMermaidSurface = withUnistyles(MermaidSurface, (theme) => ({
  theme: createMermaidRenderTheme(theme),
}));

function DiagramActionIcon({ icon: Icon, color }: { icon: LucideIcon; color: string }) {
  return <Icon size={14} color={color} />;
}

const ThemedDiagramActionIcon = withUnistyles(DiagramActionIcon, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

export function MermaidDiagram({ source, fallback }: MermaidDiagramProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<MermaidRenderStatus>("loading");
  const [showSource, setShowSource] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedResetRef.current) clearTimeout(copiedResetRef.current);
    },
    [],
  );

  const handleCopy = useCallback(async () => {
    await Clipboard.setStringAsync(source);
    setCopied(true);
    if (copiedResetRef.current) clearTimeout(copiedResetRef.current);
    copiedResetRef.current = setTimeout(() => {
      setCopied(false);
      copiedResetRef.current = null;
    }, COPIED_RESET_MS);
  }, [source]);

  const handleToggleSource = useCallback(() => setShowSource((value) => !value), []);
  const handleExpand = useCallback(() => setExpanded(true), []);
  const handleCloseExpanded = useCallback(() => setExpanded(false), []);
  const sourceLabel = showSource
    ? t("message.actions.hideMermaidSource")
    : t("message.actions.showMermaidSource");

  return (
    <>
      {status !== "ready" ? fallback : null}
      <View style={[styles.frame, status !== "ready" && styles.hidden]}>
        <View style={styles.toolbar}>
          <DiagramAction icon={FileText} label={sourceLabel} onPress={handleToggleSource} />
          <DiagramAction
            icon={copied ? Check : Copy}
            label={copied ? t("message.actions.copied") : t("message.actions.copyMermaidSource")}
            onPress={handleCopy}
          />
          <DiagramAction
            icon={Maximize2}
            label={t("message.actions.expandMermaidDiagram")}
            onPress={handleExpand}
          />
        </View>
        <View style={styles.surface}>
          <ThemedMermaidSurface
            source={source}
            onStatusChange={setStatus}
            style={styles.surfaceHost}
          />
        </View>
      </View>
      {status === "ready" && showSource ? fallback : null}
      <ExpandedDiagram
        visible={expanded && status === "ready"}
        source={source}
        onClose={handleCloseExpanded}
      />
    </>
  );
}

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
    <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityLabel={label}
          accessibilityRole="button"
          accessibilityState={accessibilityState}
          aria-selected={selected}
          hitSlop={6}
          onPress={onPress}
          style={[styles.action, selected && styles.actionSelected]}
        >
          <ThemedDiagramActionIcon icon={Icon} />
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={6}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function ExpandedDiagram({
  visible,
  source,
  onClose,
}: {
  visible: boolean;
  source: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<MermaidRenderStatus>("loading");
  const [mode, setMode] = useState<MermaidViewportMode>("pan");
  const [command, setCommand] = useState<MermaidViewportCommand | null>(null);
  const commandIdRef = useRef(0);

  const issueCommand = useCallback((type: MermaidViewportCommand["type"]) => {
    commandIdRef.current += 1;
    setCommand({ id: commandIdRef.current, type });
  }, []);
  const handleZoomOut = useCallback(() => issueCommand("zoom-out"), [issueCommand]);
  const handleZoomIn = useCallback(() => issueCommand("zoom-in"), [issueCommand]);
  const handleFit = useCallback(() => issueCommand("fit"), [issueCommand]);
  const handleReset = useCallback(() => issueCommand("reset"), [issueCommand]);
  const handlePanMode = useCallback(() => setMode("pan"), []);
  const handleSelectMode = useCallback(() => setMode("select"), []);
  const viewport = useMemo(() => ({ command, mode }), [command, mode]);

  useEffect(() => {
    if (visible) return;
    setStatus("loading");
    setMode("pan");
    setCommand(null);
  }, [visible]);

  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={onClose}
      statusBarTranslucent
    >
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
              onPress={handleZoomOut}
            />
            <DiagramAction
              icon={ZoomIn}
              label={t("message.actions.zoomInMermaidDiagram")}
              onPress={handleZoomIn}
            />
            <DiagramAction
              icon={Maximize2}
              label={t("message.actions.fitMermaidDiagram")}
              onPress={handleFit}
            />
            <DiagramAction
              icon={RotateCcw}
              label={t("message.actions.resetMermaidDiagram")}
              onPress={handleReset}
            />
            <View style={styles.modeGroup}>
              <DiagramAction
                icon={Hand}
                label={t("message.actions.panMermaidDiagram")}
                onPress={handlePanMode}
                selected={mode === "pan"}
              />
              <DiagramAction
                icon={MousePointer2}
                label={t("message.actions.selectMermaidText")}
                onPress={handleSelectMode}
                selected={mode === "select"}
              />
            </View>
            <DiagramAction icon={X} label={t("common.actions.close")} onPress={onClose} />
          </View>
          <View testID="mermaid-expanded-surface" style={styles.expandedSurface}>
            {visible ? (
              <ThemedMermaidSurface
                source={source}
                onStatusChange={setStatus}
                style={styles.expandedSurfaceHost}
                viewport={viewport}
              />
            ) : null}
            {status === "error" ? <Text style={styles.expandedError}>{source}</Text> : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create((theme) => ({
  frame: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
  hidden: {
    display: "none",
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
  actionSelected: {
    backgroundColor: theme.colors.surface2,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.xs,
  },
  surface: {
    minHeight: 80,
    padding: theme.spacing[3],
    overflow: "hidden",
  },
  surfaceHost: {
    width: "100%",
    minHeight: 1,
  },
  expandedSurfaceHost: {
    flex: 1,
    width: "100%",
    minHeight: 1,
  },
  modalRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  modalBackdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
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
  expandedSurface: {
    flex: 1,
    padding: theme.spacing[4],
    overflow: "hidden",
  },
  expandedError: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
}));
