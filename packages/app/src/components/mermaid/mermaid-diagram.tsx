import React, { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Check, Copy, FileText, Maximize2, X, type LucideIcon } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { createMermaidRenderTheme } from "@/components/mermaid/mermaid-render-theme";
import { MermaidSurface } from "@/components/mermaid/mermaid-surface";
import type { MermaidRenderStatus } from "@/components/mermaid/mermaid-surface-types";

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
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void | Promise<void>;
}) {
  return (
    <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityLabel={label}
          accessibilityRole="button"
          hitSlop={6}
          onPress={onPress}
          style={styles.action}
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
            <DiagramAction icon={X} label={t("common.actions.close")} onPress={onClose} />
          </View>
          <View style={styles.expandedSurface}>
            {visible ? (
              <ThemedMermaidSurface
                source={source}
                onStatusChange={setStatus}
                style={styles.surfaceHost}
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
    maxWidth: 1400,
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
