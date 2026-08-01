import React, { useCallback, useState, type CSSProperties, type MouseEvent } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { ChevronDown, SquarePen } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { DiffStat } from "@/components/diff-stat";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import type { OpenFileDisposition } from "@/workspace/file-open";
import type { TurnChangeFile, TurnChangesModel } from "./turn-changes";

const DEFAULT_VISIBLE_FILE_COUNT = 3;
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedSquarePen = withUnistyles(SquarePen);
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const foregroundColorMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
});

interface TurnChangesCardProps {
  model: TurnChangesModel;
  onFilePress: (path: string, disposition: OpenFileDisposition) => void;
}

function TurnChangeFileRow({
  file,
  onFilePress,
}: {
  file: TurnChangeFile;
  onFilePress: (path: string, disposition: OpenFileDisposition) => void;
}) {
  const rowStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.fileRow,
      (Boolean(hovered) || pressed) && styles.interactiveHovered,
    ],
    [],
  );
  const handlePress = useCallback(() => onFilePress(file.path, "main"), [file.path, onFilePress]);
  const handleAnchorClickCapture = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      if (!event.metaKey && !event.ctrlKey) {
        return;
      }
      event.stopPropagation();
      onFilePress(file.path, "side");
    },
    [file.path, onFilePress],
  );

  const row = (
    <Pressable
      accessibilityRole={isWeb ? undefined : "button"}
      accessibilityLabel={file.path}
      onPress={handlePress}
      style={rowStyle}
      testID="turn-change-file"
    >
      {({ hovered, pressed }) => (
        <>
          <Text
            style={hovered || pressed ? styles.filePathHovered : styles.filePath}
            numberOfLines={1}
            testID="turn-change-file-path"
          >
            {file.path}
          </Text>
          <DiffStat additions={file.additions} deletions={file.deletions} />
        </>
      )}
    </Pressable>
  );

  return isWeb ? (
    <a
      href={file.path}
      onClickCapture={handleAnchorClickCapture}
      onAuxClickCapture={preventAnchorNavigation}
      style={LINK_ANCHOR_STYLE}
    >
      {row}
    </a>
  ) : (
    row
  );
}

const LINK_ANCHOR_STYLE: CSSProperties = {
  display: "contents",
  color: "inherit",
  textDecoration: "none",
};

function preventAnchorNavigation(event: MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault();
}

export function TurnChangesCard({ model, onFilePress }: TurnChangesCardProps) {
  const { t } = useTranslation();
  const [expandedTurnId, setExpandedTurnId] = useState<string | null>(null);
  const expanded = expandedTurnId === model.turnId;
  const visibleFiles = expanded ? model.files : model.files.slice(0, DEFAULT_VISIBLE_FILE_COUNT);
  const remainingFileCount = model.files.length - DEFAULT_VISIBLE_FILE_COUNT;
  const toggleLabel = expanded
    ? t("sidebar.workspace.actions.showLess")
    : `${t("sidebar.workspace.actions.showMore")} (${remainingFileCount})`;
  const toggleStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.toggle,
      (Boolean(hovered) || pressed) && styles.interactiveHovered,
    ],
    [],
  );
  const handleToggle = useCallback(
    () => setExpandedTurnId((value) => (value === model.turnId ? null : model.turnId)),
    [model.turnId],
  );

  return (
    <View style={styles.card} testID="turn-changes-card">
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <ThemedSquarePen size={16} uniProps={foregroundMutedColorMapping} />
        </View>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {t(`toolCallGroup.editedFiles.${model.fileCount === 1 ? "one" : "other"}`, {
              count: model.fileCount,
            })}
          </Text>
          <DiffStat additions={model.additions} deletions={model.deletions} />
        </View>
      </View>

      <View style={styles.fileList}>
        {visibleFiles.map((file) => (
          <TurnChangeFileRow key={file.path} file={file} onFilePress={onFilePress} />
        ))}
        {remainingFileCount > 0 ? (
          <Pressable
            accessibilityRole={isWeb ? undefined : "button"}
            accessibilityLabel={toggleLabel}
            onPress={handleToggle}
            style={toggleStyle}
            testID="turn-changes-expand"
          >
            {({ hovered, pressed }) => (
              <>
                <Text style={hovered || pressed ? styles.toggleTextHovered : styles.toggleText}>
                  {toggleLabel}
                </Text>
                {expanded ? (
                  <ThemedChevronDown
                    size={14}
                    style={styles.chevronExpanded}
                    uniProps={
                      hovered || pressed ? foregroundColorMapping : foregroundMutedColorMapping
                    }
                  />
                ) : (
                  <ThemedChevronDown
                    size={14}
                    uniProps={
                      hovered || pressed ? foregroundColorMapping : foregroundMutedColorMapping
                    }
                  />
                )}
              </>
            )}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    width: "100%",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
  header: {
    minHeight: 64,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerIcon: {
    width: 36,
    height: 36,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  headerCopy: {
    minWidth: 0,
    flexShrink: 1,
  },
  headerTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  fileList: {
    paddingVertical: theme.spacing[1],
  },
  fileRow: {
    minHeight: 36,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  filePath: {
    minWidth: 0,
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  filePathHovered: {
    minWidth: 0,
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  toggle: {
    minHeight: 36,
    marginHorizontal: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: theme.spacing[2],
    userSelect: "none",
  },
  interactiveHovered: {
    backgroundColor: theme.colors.surface2,
  },
  chevronExpanded: {
    transform: [{ rotate: "180deg" }],
  },
  toggleText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  toggleTextHovered: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
