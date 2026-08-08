import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useCompactTimeAgo } from "@/hooks/use-compact-time-ago";

export function SidebarWorkspaceActivityTime({ lastActivityAt }: { lastActivityAt: Date }) {
  const label = useCompactTimeAgo(lastActivityAt);

  return (
    <Text style={styles.label} numberOfLines={1} testID="sidebar-workspace-activity-time">
      {label}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  label: {
    height: 20,
    lineHeight: 20,
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    flexShrink: 0,
  },
}));
