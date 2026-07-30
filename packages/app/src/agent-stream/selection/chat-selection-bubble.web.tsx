import React, { useCallback, useMemo, useState, type CSSProperties, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import {
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { getOverlayRoot, useOverlayLayer } from "@/lib/overlay-root";
import { BORDER_RADIUS, BORDER_WIDTH, type Theme } from "@/styles/theme";
import type { ChatSelectionBubbleProps } from "./types";

const VIEWPORT_GAP = 8;

function clampBubbleCenter(center: number, bubbleWidth: number): number {
  const availableWidth = Math.max(0, window.innerWidth - VIEWPORT_GAP * 2);
  if (bubbleWidth <= 0 || bubbleWidth >= availableWidth) return window.innerWidth / 2;
  const halfWidth = bubbleWidth / 2;
  return Math.min(
    Math.max(center, VIEWPORT_GAP + halfWidth),
    window.innerWidth - VIEWPORT_GAP - halfWidth,
  );
}

export function ChatSelectionBubble({
  selection,
  onAsk,
  onAskInNewWindow,
  onSavePreset,
}: ChatSelectionBubbleProps) {
  const { t } = useTranslation();
  const floatingLayer = useOverlayLayer("floating");
  const [bubbleWidth, setBubbleWidth] = useState(0);
  const rect = selection?.rect ?? null;
  const positionStyle = useMemo<CSSProperties | null>(() => {
    if (!rect) return null;
    return {
      position: "fixed",
      left: clampBubbleCenter(rect.left + rect.width / 2, bubbleWidth),
      top: Math.max(VIEWPORT_GAP, rect.top - VIEWPORT_GAP),
      maxWidth: `calc(100vw - ${VIEWPORT_GAP * 2}px)`,
      opacity: bubbleWidth > 0 ? 1 : 0,
      pointerEvents: "auto",
      transform: "translate(-50%, -100%)",
      zIndex: floatingLayer,
    };
  }, [bubbleWidth, floatingLayer, rect]);

  const text = selection?.text ?? "";
  const handleAsk = useCallback(() => onAsk(text), [onAsk, text]);
  const handleAskNew = useCallback(() => onAskInNewWindow(text), [onAskInNewWindow, text]);
  const handleSave = useCallback(() => onSavePreset(text), [onSavePreset, text]);
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setBubbleWidth((current) => (Math.abs(current - width) > 0.5 ? width : current));
  }, []);
  const preventSelectionClear = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);

  if (!selection || !positionStyle || typeof document === "undefined") return null;

  return createPortal(
    <div style={positionStyle} onMouseDown={preventSelectionClear}>
      <View style={styles.bubble} testID="chat-selection-bubble" onLayout={handleLayout}>
        <BubbleButton
          label={t("composer.selection.ask")}
          onPress={handleAsk}
          testID="chat-selection-ask"
        />
        <View style={styles.divider} />
        <BubbleButton
          label={t("composer.selection.askInNewWindow")}
          onPress={handleAskNew}
          testID="chat-selection-ask-new-window"
        />
        <View style={styles.divider} />
        <BubbleButton
          label={t("composer.selection.savePreset")}
          onPress={handleSave}
          testID="chat-selection-save-preset"
        />
      </View>
    </div>,
    getOverlayRoot(),
  );
}

function BubbleButton({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const style = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.button,
      Boolean(hovered) && styles.buttonHovered,
    ],
    [],
  );
  return (
    <Pressable onPress={onPress} style={style} accessibilityRole="button" testID={testID}>
      <Text style={styles.buttonText} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  bubble: {
    flexDirection: "row",
    alignItems: "stretch",
    maxWidth: "100%",
    backgroundColor: theme.colors.surface1,
    borderWidth: BORDER_WIDTH[1],
    borderColor: theme.colors.border,
    borderRadius: BORDER_RADIUS.lg,
    overflow: "hidden",
    boxShadow: "0 4px 16px rgba(0, 0, 0, 0.18)",
  },
  button: {
    minWidth: 0,
    flexShrink: 1,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    alignItems: "center",
    justifyContent: "center",
  },
  buttonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  buttonText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.normal,
  },
  divider: {
    width: BORDER_WIDTH[1],
    backgroundColor: theme.colors.border,
  },
})) as unknown as Record<string, object>;
