import React, { memo, useCallback } from "react";
import { Text, TextInput, View, type PressableStateCallbackType } from "react-native";
import { Check, Pencil, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Theme } from "@/styles/theme";

const ThemedPencil = withUnistyles(Pencil);
const ThemedCheck = withUnistyles(Check);
const ThemedX = withUnistyles(X);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

export const LastUserMessageEditAction = memo(function LastUserMessageEditAction({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  const triggerStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.iconButton,
      (hovered || pressed) && styles.iconButtonActive,
    ],
    [],
  );

  return (
    <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        accessibilityLabel={label}
        accessibilityRole="button"
        onPress={onPress}
        style={triggerStyle}
        testID="edit-last-user-message-trigger"
      >
        <ThemedPencil size={16} uniProps={foregroundMutedColorMapping} />
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
});

interface LastUserMessageEditorProps {
  value: string;
  controls: { canEdit: boolean; canCancel: boolean; canSubmit: boolean };
  isPending: boolean;
  labels: { input: string; cancel: string; submit: string };
  onChangeText: (text: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

function EditorIconButton({
  label,
  disabled,
  onPress,
  children,
  testID,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
  children: React.ReactNode;
  testID: string;
}) {
  const triggerStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.editorIconButton,
      (hovered || pressed) && !disabled ? styles.iconButtonActive : null,
      disabled ? styles.iconButtonDisabled : null,
    ],
    [disabled],
  );

  return (
    <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        accessibilityLabel={label}
        accessibilityRole="button"
        disabled={disabled}
        onPress={onPress}
        style={triggerStyle}
        testID={testID}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

export const LastUserMessageEditor = memo(function LastUserMessageEditor({
  value,
  controls,
  isPending,
  labels,
  onChangeText,
  onCancel,
  onSubmit,
}: LastUserMessageEditorProps) {
  return (
    <View style={styles.editor} testID="edit-last-user-message-editor">
      <TextInput
        accessibilityLabel={labels.input}
        autoFocus
        editable={controls.canEdit}
        multiline
        onChangeText={onChangeText}
        style={styles.editorInput}
        testID="edit-last-user-message-input"
        textAlignVertical="top"
        value={value}
      />
      <View style={styles.editorActions}>
        <EditorIconButton
          label={labels.cancel}
          disabled={!controls.canCancel}
          onPress={onCancel}
          testID="edit-last-user-message-cancel"
        >
          <ThemedX size={16} uniProps={foregroundMutedColorMapping} />
        </EditorIconButton>
        <EditorIconButton
          label={labels.submit}
          disabled={!controls.canSubmit}
          onPress={onSubmit}
          testID="edit-last-user-message-submit"
        >
          {isPending ? (
            <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
          ) : (
            <ThemedCheck size={16} uniProps={foregroundMutedColorMapping} />
          )}
        </EditorIconButton>
      </View>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  iconButton: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.lg,
    backgroundColor: "transparent",
  },
  iconButtonActive: {
    backgroundColor: theme.colors.surface2,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
  },
  editor: {
    width: 480,
    maxWidth: "100%",
    minWidth: 0,
    flexShrink: 1,
    backgroundColor: theme.colors.surface3,
    borderRadius: theme.borderRadius["2xl"],
    borderTopRightRadius: theme.borderRadius.sm,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
  },
  editorInput: {
    minHeight: 96,
    maxHeight: 240,
    padding: 0,
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.workspace,
    fontSize: theme.workspaceFontSize.base,
    lineHeight: Math.round(theme.workspaceFontSize.base * 1.4),
  },
  editorActions: {
    minHeight: 24,
    marginTop: theme.spacing[2],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[1],
  },
  editorIconButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface2,
  },
  iconButtonDisabled: {
    opacity: theme.opacity[50],
  },
}));
