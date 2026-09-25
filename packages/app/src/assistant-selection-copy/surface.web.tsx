import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { getOverlayRoot, useOverlayLayer } from "@/lib/overlay-root";
import { createAssistantSelectionClipboardContent } from "./content.web";

interface AssistantSelectionCopySurfaceProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onComposeSelection?: (text: string, action: "ask" | "rewrite") => void;
}

interface SelectionAction {
  text: string;
  rect: { top: number; bottom: number; left: number; width: number };
}

const DISPLAY_CONTENTS: CSSProperties = { display: "contents" };
const VIEWPORT_GAP = 8;

/** Keep the selected text intact until a toolbar action runs */
function preserveSelection(event: MouseEvent<HTMLDivElement>): void {
  event.preventDefault();
}

/** Clamp the anchored toolbar after its translated labels have been measured */
function getSelectionActionPosition(
  rect: SelectionAction["rect"],
  size: { width: number; height: number },
  layer: number,
): CSSProperties {
  const center = rect.left + rect.width / 2;
  const halfWidth = size.width / 2;
  const left =
    size.width > 0
      ? Math.min(
          Math.max(center, VIEWPORT_GAP + halfWidth),
          window.innerWidth - VIEWPORT_GAP - halfWidth,
        )
      : window.innerWidth / 2;
  const showAbove = rect.top >= size.height + VIEWPORT_GAP * 2;
  const top = showAbove
    ? rect.top - VIEWPORT_GAP - size.height
    : Math.min(rect.bottom + VIEWPORT_GAP, window.innerHeight - VIEWPORT_GAP - size.height);
  return {
    position: "fixed",
    left,
    top: Math.max(VIEWPORT_GAP, top),
    transform: "translateX(-50%)",
    maxWidth: `calc(100vw - ${VIEWPORT_GAP * 2}px)`,
    opacity: size.width > 0 ? 1 : 0,
    pointerEvents: "auto",
    zIndex: layer,
  };
}

/** Preserve rich copy behavior and expose selected assistant text actions on web */
export function AssistantSelectionCopySurface({
  children,
  style,
  onComposeSelection,
}: AssistantSelectionCopySurfaceProps) {
  const { t } = useTranslation();
  const overlayLayer = useOverlayLayer("floating");
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const [selectionAction, setSelectionAction] = useState<SelectionAction | null>(null);
  const [toolbarSize, setToolbarSize] = useState({ width: 0, height: 0 });

  const updateSelection = useCallback(() => {
    const selection = window.getSelection();
    const root = rootRef.current;
    if (
      !onComposeSelection ||
      !selection ||
      selection.rangeCount !== 1 ||
      !root ||
      !selection.anchorNode ||
      !selection.focusNode ||
      !root.contains(selection.anchorNode) ||
      !root.contains(selection.focusNode)
    ) {
      setSelectionAction(null);
      return;
    }
    const text = selection.toString().trim();
    if (!text || !createAssistantSelectionClipboardContent(selection)) {
      setSelectionAction(null);
      return;
    }
    const bounds = selection.getRangeAt(0).getBoundingClientRect();
    if (bounds.width === 0 && bounds.height === 0) {
      setSelectionAction(null);
      return;
    }
    setSelectionAction({
      text,
      rect: { top: bounds.top, bottom: bounds.bottom, left: bounds.left, width: bounds.width },
    });
  }, [onComposeSelection]);

  useEffect(() => {
    if (!onComposeSelection) {
      setSelectionAction(null);
      return;
    }
    const scheduleUpdate = () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        updateSelection();
      });
    };
    const clearSelection = () => setSelectionAction(null);
    document.addEventListener("selectionchange", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("blur", clearSelection);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      document.removeEventListener("selectionchange", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("blur", clearSelection);
    };
  }, [onComposeSelection, updateSelection]);

  const compose = useCallback(
    (action: "ask" | "rewrite") => {
      if (!selectionAction) return;
      onComposeSelection?.(selectionAction.text, action);
      window.getSelection()?.removeAllRanges();
      setSelectionAction(null);
    },
    [onComposeSelection, selectionAction],
  );
  const handleAsk = useCallback(() => compose("ask"), [compose]);
  const handleRewrite = useCallback(() => compose("rewrite"), [compose]);
  const handleToolbarLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setToolbarSize((current) =>
      current.width === width && current.height === height ? current : { width, height },
    );
  }, []);
  const actionStyle = useMemo(
    () =>
      selectionAction
        ? getSelectionActionPosition(selectionAction.rect, toolbarSize, overlayLayer)
        : undefined,
    [overlayLayer, selectionAction, toolbarSize],
  );
  const handleCopy = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const content = createAssistantSelectionClipboardContent(window.getSelection());
    if (!content) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", content.plainText);
    event.clipboardData.setData("text/html", content.html);
  }, []);

  return (
    <div
      ref={rootRef}
      onCopy={handleCopy}
      onMouseUp={updateSelection}
      onKeyUp={updateSelection}
      style={DISPLAY_CONTENTS}
    >
      <View style={style}>{children}</View>
      {selectionAction && onComposeSelection && actionStyle
        ? createPortal(
            <div style={actionStyle} onMouseDown={preserveSelection}>
              <View
                style={styles.toolbar}
                onLayout={handleToolbarLayout}
                testID="chat-selection-actions"
              >
                <Pressable
                  onPress={handleAsk}
                  style={styles.action}
                  accessibilityRole="button"
                  testID="chat-selection-ask"
                >
                  <Text style={styles.actionText}>{t("message.actions.ask")}</Text>
                </Pressable>
                <View style={styles.divider} />
                <Pressable
                  onPress={handleRewrite}
                  style={styles.action}
                  accessibilityRole="button"
                  testID="chat-selection-rewrite"
                >
                  <Text style={styles.actionText}>{t("message.actions.rewrite")}</Text>
                </Pressable>
              </View>
            </div>,
            getOverlayRoot(),
          )
        : null}
    </div>
  );
}

const styles = StyleSheet.create((theme) => ({
  toolbar: {
    flexDirection: "row",
    alignItems: "stretch",
    maxWidth: "100%",
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    boxShadow: "0 4px 16px rgba(0, 0, 0, 0.18)",
    overflow: "hidden",
  },
  action: {
    minWidth: 0,
    flexShrink: 1,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  divider: { width: 1, backgroundColor: theme.colors.border },
}));
