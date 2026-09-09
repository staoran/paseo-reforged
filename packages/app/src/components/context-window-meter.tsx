import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ProviderUsageTooltipSection } from "@/provider-usage/tooltip-section";
import { useProviderUsage } from "@/provider-usage/use-provider-usage";
import type { ProviderUsageView } from "@/provider-usage/types";
import {
  formatTokenCount,
  resolveSessionUsageDisplay,
  type SessionUsageDisplay,
} from "./context-window-meter.utils";

interface ContextWindowMeterProps {
  maxTokens: number | null;
  usedTokens: number | null;
  inputTokens?: number | null;
  cachedInputTokens?: number | null;
  outputTokens?: number | null;
  totalCostUsd?: number | null;
  showPercentage?: boolean;
  serverId?: string;
  /** The Paseo provider key, e.g. "claude", "gemini", "codex" */
  provider?: string | null;
  /** Reserve the meter footprint and show a loading ring while usage is pending. */
  pending?: boolean;
  /** Optional glyph envelope for icon-toolbar alignment. */
  glyphSize?: number;
}

const SVG_SIZE = 14;
const COMPACT_SVG_SIZE = 12;
const COMPACT_CENTER = COMPACT_SVG_SIZE / 2;
const COMPACT_RADIUS = 5;
const STROKE_WIDTH = 2;
const COMPACT_STROKE_WIDTH = 1.75;
const COMPACT_CIRCUMFERENCE = 2 * Math.PI * COMPACT_RADIUS;

function isValidMaxTokens(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isValidUsedTokens(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function getUsagePercentage(maxTokens: number, usedTokens: number): number | null {
  if (!isValidMaxTokens(maxTokens) || !isValidUsedTokens(usedTokens)) {
    return null;
  }
  return (usedTokens / maxTokens) * 100;
}

function clampPercentage(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function getMeterColors(
  percentage: number,
  theme: ReturnType<typeof useUnistyles>["theme"],
): { progress: string; track: string } {
  const track = theme.colors.surface3;
  if (percentage > 90) {
    return { progress: theme.colors.destructive, track };
  }
  if (percentage >= 70) {
    return { progress: theme.colors.palette.amber[500], track };
  }
  return { progress: theme.colors.foregroundMuted, track };
}

function getMeterGeometry(showPercentage: boolean, glyphSize?: number) {
  if (showPercentage) {
    return {
      svgSize: COMPACT_SVG_SIZE,
      center: COMPACT_CENTER,
      radius: COMPACT_RADIUS,
      strokeWidth: COMPACT_STROKE_WIDTH,
      circumference: COMPACT_CIRCUMFERENCE,
      containerStyle: styles.containerWithLabel,
    };
  }
  const resolvedSize = glyphSize ?? SVG_SIZE;
  const resolvedStrokeWidth = glyphSize ? 2 : STROKE_WIDTH;
  return {
    svgSize: resolvedSize,
    center: resolvedSize / 2,
    radius: (resolvedSize - resolvedStrokeWidth) / 2,
    strokeWidth: resolvedStrokeWidth,
    circumference: Math.PI * (resolvedSize - resolvedStrokeWidth),
    containerStyle: styles.container,
  };
}

interface ContextWindowTooltipSummaryProps {
  roundedPercentage: number;
  usedTokens: number | null;
  maxTokens: number | null;
}

/** Renders the context-window values that are available for the active agent. */
function ContextWindowTooltipSummary({
  roundedPercentage,
  usedTokens,
  maxTokens,
}: ContextWindowTooltipSummaryProps) {
  const { t } = useTranslation();
  return (
    <>
      <Text style={styles.tooltipText}>
        {t("contextWindow.used", { percentage: roundedPercentage })}
      </Text>
      <Text style={styles.tooltipDetail}>
        {t("contextWindow.tokens", {
          used: formatTokenCount(usedTokens ?? 0),
          max: formatTokenCount(maxTokens ?? 0),
        })}
      </Text>
    </>
  );
}

interface SessionUsageTooltipDetailsProps {
  usage: SessionUsageDisplay;
}

/** Renders each valid provider-reported token and cost field independently. */
function SessionUsageTooltipDetails({ usage }: SessionUsageTooltipDetailsProps) {
  const { t } = useTranslation();
  return (
    <>
      {usage.inputTokens ? (
        <Text style={styles.tooltipDetail}>
          {t("contextWindow.inputTokens", { count: usage.inputTokens })}
        </Text>
      ) : null}
      {usage.cachedInputTokens ? (
        <Text style={styles.tooltipDetail}>
          {t("contextWindow.cachedInputTokens", { count: usage.cachedInputTokens })}
        </Text>
      ) : null}
      {usage.outputTokens ? (
        <Text style={styles.tooltipDetail}>
          {t("contextWindow.outputTokens", { count: usage.outputTokens })}
        </Text>
      ) : null}
      {usage.cost ? (
        <Text style={styles.tooltipDetail}>
          {t("contextWindow.sessionCost", { cost: usage.cost })}
        </Text>
      ) : null}
    </>
  );
}

interface ContextWindowTooltipProps extends ContextWindowTooltipSummaryProps {
  hasContextWindow: boolean;
  sessionUsage: SessionUsageDisplay;
  providerUsageView: ProviderUsageView;
  provider?: string | null;
}

/** Composes context, session usage, and optional provider quota details. */
function ContextWindowTooltip({
  hasContextWindow,
  roundedPercentage,
  usedTokens,
  maxTokens,
  sessionUsage,
  providerUsageView,
  provider,
}: ContextWindowTooltipProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.tooltipContent}>
      <Text style={styles.tooltipTitle}>{t("contextWindow.title")}</Text>
      {hasContextWindow ? (
        <ContextWindowTooltipSummary
          roundedPercentage={roundedPercentage}
          usedTokens={usedTokens}
          maxTokens={maxTokens}
        />
      ) : null}
      <SessionUsageTooltipDetails usage={sessionUsage} />
      <ProviderUsageTooltipSection view={providerUsageView} activeProviderId={provider} />
    </View>
  );
}

export function ContextWindowMeter({
  maxTokens,
  usedTokens,
  inputTokens,
  cachedInputTokens,
  outputTokens,
  totalCostUsd,
  showPercentage = false,
  serverId,
  provider,
  pending = false,
  glyphSize,
}: ContextWindowMeterProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const { view: providerUsageView, refresh: refreshProviderUsage } = useProviderUsage(
    serverId ?? null,
    { enabled: isTooltipOpen },
  );
  const percentage =
    maxTokens !== null && usedTokens !== null ? getUsagePercentage(maxTokens, usedTokens) : null;
  const sessionUsage = resolveSessionUsageDisplay({
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalCostUsd,
  });
  const hasContextWindow = percentage !== null && maxTokens !== null && usedTokens !== null;
  const handleTooltipOpenChange = useCallback(
    (nextOpen: boolean) => {
      setIsTooltipOpen(nextOpen);
      if (nextOpen) {
        void refreshProviderUsage().catch(() => {});
      }
    },
    [refreshProviderUsage],
  );

  const geometry = getMeterGeometry(showPercentage, glyphSize);
  const hasAnyUsage = hasContextWindow || sessionUsage.hasAny;

  // No usage yet: reserve the footprint with a track-only ring while a session is
  // active so the real ring fades in without shifting siblings. Render nothing when
  // no usage is expected.
  if (!hasAnyUsage) {
    if (!pending) {
      return null;
    }
    return (
      <View style={geometry.containerStyle}>
        <Svg
          width={geometry.svgSize}
          height={geometry.svgSize}
          viewBox={`0 0 ${geometry.svgSize} ${geometry.svgSize}`}
          style={styles.svg}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Circle
            cx={geometry.center}
            cy={geometry.center}
            r={geometry.radius}
            fill="none"
            stroke={theme.colors.surface3}
            strokeWidth={geometry.strokeWidth}
          />
        </Svg>
        {showPercentage ? <View style={styles.skeletonLabel} /> : null}
      </View>
    );
  }

  const resolvedPercentage = percentage ?? 0;
  const clampedPercentage = clampPercentage(resolvedPercentage);
  const roundedPercentage = Math.round(resolvedPercentage);
  const { svgSize, center, radius, strokeWidth, circumference, containerStyle } = geometry;
  const dashOffset = circumference - (clampedPercentage / 100) * circumference;
  const colors = getMeterColors(clampedPercentage, theme);

  return (
    <Tooltip
      open={isTooltipOpen}
      onOpenChange={handleTooltipOpenChange}
      delayDuration={0}
      enabledOnDesktop
      enabledOnMobile
    >
      <TooltipTrigger asChild triggerRefProp="ref">
        <Pressable
          style={containerStyle}
          testID="context-window-meter"
          accessibilityRole="image"
          accessibilityLabel={
            hasContextWindow
              ? t("contextWindow.accessibility", { percentage: roundedPercentage })
              : t("contextWindow.accessibilityUsage")
          }
        >
          <Svg
            width={svgSize}
            height={svgSize}
            viewBox={`0 0 ${svgSize} ${svgSize}`}
            style={styles.svg}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={colors.track}
              strokeWidth={strokeWidth}
            />
            {hasContextWindow ? (
              <Circle
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                stroke={colors.progress}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
              />
            ) : null}
          </Svg>
          {showPercentage && hasContextWindow ? (
            <Text style={styles.percentageLabel}>{`${roundedPercentage}%`}</Text>
          ) : null}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <ContextWindowTooltip
          hasContextWindow={hasContextWindow}
          roundedPercentage={roundedPercentage}
          usedTokens={usedTokens}
          maxTokens={maxTokens}
          sessionUsage={sessionUsage}
          providerUsageView={providerUsageView}
          provider={provider}
        />
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  containerWithLabel: {
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
  },
  svg: {
    transform: [{ rotate: "-90deg" }],
  },
  percentageLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  skeletonLabel: {
    width: 22,
    height: theme.fontSize.base,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
  },
  tooltipContent: {
    gap: theme.spacing[1.5],
    minWidth: 200,
  },
  tooltipTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.4,
  },
  tooltipDetail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
}));
