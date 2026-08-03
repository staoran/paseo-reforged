import React from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { formatRelativeTime } from "@/utils/time";

const RELATIVE_TIME_REFRESH_MS = 30_000;

export function SidebarWorkspaceActivityTime({ lastActivityAt }: { lastActivityAt: Date }) {
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(() => new Date());
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const label = formatRelativeTime(lastActivityAt, {
    locale,
    now,
    justNowLabel: t("sidebar.workspace.activity.justNow"),
  });

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), RELATIVE_TIME_REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <Text style={styles.label} numberOfLines={1} testID="sidebar-workspace-activity-time">
      {label}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    lineHeight: Math.round(theme.fontSize.xs * 1.25),
    fontVariant: ["tabular-nums"],
    flexShrink: 0,
  },
}));
