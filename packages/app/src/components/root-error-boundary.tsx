import React, { Component, useCallback, useState, type ErrorInfo, type ReactNode } from "react";
import * as Clipboard from "expo-clipboard";
import { Check, Copy } from "lucide-react-native";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { ScrollableCodeSurface } from "@/components/ui/scrollable-code-surface";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor } from "@/constants/layout";
import { formatCaughtValue } from "./root-error-details";

interface RootErrorBoundaryProps {
  children: ReactNode;
  onReload: () => void;
}

interface RootErrorBoundaryState {
  error: string | null;
}

export class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: unknown): Partial<RootErrorBoundaryState> {
    return { error: formatCaughtValue(error) };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error("[RootErrorBoundary] Unhandled render error", {
      error: formatCaughtValue(error),
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    const { error } = this.state;
    if (error !== null) {
      return <RootErrorFallback error={error} onReload={this.props.onReload} />;
    }

    return this.props.children;
  }
}

// A stack trace is reference material, not the screen. Cap it so the message and
// the reload action stay the shape of the page; the rest scrolls.
const DETAILS_MAX_HEIGHT = 300;

interface RootErrorFallbackProps {
  error: string;
  onReload: () => void;
}

export function RootErrorFallback({ error, onReload }: RootErrorFallbackProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const isCompact = useIsCompactFormFactor();
  // Clipboard operation state remains available after app providers unmount
  const [copyStatus, setCopyStatus] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  // Clipboard acknowledgement for assistive technology and the tooltip
  const copyLabel = copyStatus === "copied" ? t("common.states.copied") : t("common.actions.copy");
  // Success glyph preserves the copy button's dimensions
  const CopyIcon = copyStatus === "copied" ? Check : Copy;

  /** Copy all details without relying on providers inside the failed app */
  const copyDetails = useCallback(async () => {
    setCopyStatus("copying");
    try {
      // Web clipboard writes can report failure without rejecting
      const copied = await Clipboard.setStringAsync(error);
      setCopyStatus(copied ? "copied" : "failed");
    } catch {
      setCopyStatus("failed");
    }
  }, [error]);

  const reload = (
    <Button variant="default" onPress={onReload} testID="root-error-boundary-reload">
      {t("common.actions.reload")}
    </Button>
  );

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top,
          paddingRight: insets.right,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
        },
      ]}
      testID="root-error-boundary"
    >
      <View style={styles.content}>
        <View style={styles.header} testID="root-error-boundary-header">
          <Text style={styles.title}>{t("rootError.title")}</Text>
          <Text style={styles.body}>{t("rootError.body")}</Text>
        </View>
        <View style={styles.details}>
          <View style={styles.detailsHeader}>
            <Text style={styles.detailsLabel}>{t("rootError.details")}</Text>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  style={styles.copyButton}
                  leftIcon={CopyIcon}
                  loading={copyStatus === "copying"}
                  accessibilityLabel={copyLabel}
                  onPress={copyDetails}
                  testID="root-error-boundary-copy"
                />
              </TooltipTrigger>
              <TooltipContent>
                <Text style={styles.tooltipText}>{copyLabel}</Text>
              </TooltipContent>
            </Tooltip>
          </View>
          {copyStatus === "failed" ? (
            <Text style={styles.copyError} accessibilityRole="alert">
              {t("common.errors.unableToCopy")}
            </Text>
          ) : null}
          <ScrollableCodeSurface
            maxHeight={isCompact ? undefined : DETAILS_MAX_HEIGHT}
            style={styles.detailsSurface}
            scrollStyle={styles.detailsScroll}
            testID="root-error-boundary-details"
          >
            {error}
          </ScrollableCodeSurface>
        </View>
        {isCompact ? null : reload}
      </View>
      {isCompact ? <View style={styles.footer}>{reload}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  content: {
    flex: 1,
    alignSelf: "center",
    width: "100%",
    maxWidth: 420,
    justifyContent: "center",
    gap: theme.spacing[6],
    paddingHorizontal: theme.spacing[6],
    paddingVertical: theme.spacing[8],
  },
  header: {
    alignItems: "center",
    gap: theme.spacing[2],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    textAlign: "center",
  },
  body: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    lineHeight: 20,
    textAlign: "center",
  },
  details: {
    flexShrink: 1,
    gap: theme.spacing[2],
  },
  detailsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  detailsLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  copyButton: {
    width: 32,
    paddingHorizontal: 0,
    flexShrink: 0,
  },
  copyError: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  detailsSurface: {
    flexShrink: 1,
  },
  detailsScroll: {
    flexShrink: 1,
  },
  footer: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 420,
    paddingHorizontal: theme.spacing[6],
    paddingBottom: theme.spacing[6],
  },
}));
