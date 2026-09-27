import { useCallback, useMemo, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { formatDuration } from "@/utils/time";
import { isWeb } from "@/constants/platform";
import type { StreamItem } from "@/types/stream";
import type { ActivityFold } from "./activity";
import { getStreamItemMessageId } from "./presentation";

/** Displays the process header independently from member expansion states */
export function ActivityFoldView({
  fold,
  expanded,
  onExpandedChange,
  children,
}: {
  fold: ActivityFold;
  expanded: boolean;
  onExpandedChange: (id: string, expanded: boolean) => void;
  children: ReactNode;
}) {
  /** Localized completion label */
  const { t } = useTranslation();
  /** Running segments have no completion duration */
  let label = t("agentControls.thinking.title");
  if (fold.completed) {
    label = t("message.activity.completed");
    if (fold.durationMs !== null) {
      label = t("message.activity.completedWithDuration", {
        duration: formatDuration(fold.durationMs),
      });
    }
  }
  /** Chevron mirrors the effective expansion */
  const Chevron = expanded ? ChevronDown : ChevronRight;
  /** Reports forced expansion while the ending final still streams */
  const accessibilityState = useMemo(
    () => ({ expanded, disabled: !fold.completed }),
    [expanded, fold.completed],
  );
  /** Active segments remain open until the final stops streaming */
  const toggle = useCallback(
    () => onExpandedChange(fold.id, !expanded),
    [expanded, fold.id, onExpandedChange],
  );
  return (
    <View>
      <Pressable
        testID={`activity-fold-${fold.id}`}
        accessibilityRole="button"
        accessibilityState={accessibilityState}
        disabled={!fold.completed}
        onPress={toggle}
        style={styles.header}
      >
        <Text style={styles.label}>{label}</Text>
        <Chevron size={14} color={styles.icon.color} />
      </Pressable>
      {children}
    </View>
  );
}

/** Keeps original message addressing and spacing inside the single Activity host */
export function ActivityMemberView({
  item,
  gapBelow,
  children,
}: {
  item: StreamItem;
  gapBelow: number;
  children: ReactNode;
}) {
  /** Members share the host's horizontal alignment */
  const style = useMemo(() => ({ marginBottom: gapBelow }), [gapBelow]);
  /** Search resolves the original message inside its virtualized host */
  const messageId = getStreamItemMessageId(item);
  const dataSet = useMemo(
    () => (isWeb ? { messageId, historyRowId: item.id } : undefined),
    [item.id, messageId],
  );
  return (
    <View style={style} dataSet={dataSet}>
      {children}
    </View>
  );
}

/** Activity chrome uses transcript density and muted completion styling */
const styles = StyleSheet.create((theme) => ({
  header: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  label: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.sm,
    lineHeight: Math.round(theme.fontSize.sm * 1.4),
  },
  icon: { color: theme.colors.foregroundMuted },
}));
