import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { Pencil, Trash2 } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { usePromptPresetsStore, type PromptPreset } from "@/stores/prompt-presets-store";
import { confirmDialog } from "@/utils/confirm-dialog";

interface PromptPresetsSheetProps {
  visible: boolean;
  currentText: string;
  onClose: () => void;
  onInsert: (text: string) => void;
}

/** Save, edit, remove, and insert local prompt presets */
export function PromptPresetsSheet({
  visible,
  currentText,
  onClose,
  onInsert,
}: PromptPresetsSheetProps) {
  const { t } = useTranslation();
  const presets = usePromptPresetsStore((state) => state.presets);
  const savePreset = usePromptPresetsStore((state) => state.savePreset);
  const deletePreset = usePromptPresetsStore((state) => state.deletePreset);
  const [editing, setEditing] = useState<PromptPreset | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const header = useMemo<SheetHeader>(
    () => ({
      title: editing ? t("composer.presets.editTitle") : t("composer.presets.title"),
    }),
    [editing, t],
  );
  const close = useCallback(() => {
    setEditing(null);
    onClose();
  }, [onClose]);
  const startNew = useCallback(() => {
    setTitle("");
    setContent(currentText);
    setEditing("new");
  }, [currentText]);
  const edit = useCallback((preset: PromptPreset) => {
    setTitle(preset.title);
    setContent(preset.content);
    setEditing(preset);
  }, []);
  const save = useCallback(() => {
    if (!title.trim() || !content.trim()) return;
    savePreset({ id: editing && editing !== "new" ? editing.id : undefined, title, content });
    setEditing(null);
  }, [content, editing, savePreset, title]);
  const cancelEditing = useCallback(() => setEditing(null), []);
  const insert = useCallback(
    (preset: PromptPreset) => {
      onInsert(preset.content);
      close();
    },
    [close, onInsert],
  );
  const remove = useCallback(
    async (preset: PromptPreset) => {
      const confirmed = await confirmDialog({
        title: t("composer.presets.delete"),
        message: preset.title,
        confirmLabel: t("composer.presets.delete"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      });
      if (confirmed) deletePreset(preset.id);
    },
    [deletePreset, t],
  );

  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={close}
      header={header}
      testID="prompt-presets-sheet"
    >
      <View style={styles.body}>
        {editing ? (
          <>
            <AdaptiveTextInput
              initialValue={title}
              resetKey={editing === "new" ? "new-title" : editing.id}
              onChangeText={setTitle}
              placeholder={t("composer.presets.name")}
              style={styles.input}
            />
            <AdaptiveTextInput
              initialValue={content}
              resetKey={editing === "new" ? "new-content" : editing.id}
              onChangeText={setContent}
              placeholder={t("composer.presets.content")}
              multiline
              style={styles.contentInput}
            />
            <View style={styles.actions}>
              <Button variant="secondary" size="sm" onPress={cancelEditing}>
                {t("common.actions.cancel")}
              </Button>
              <Button
                variant="default"
                size="sm"
                onPress={save}
                disabled={!title.trim() || !content.trim()}
              >
                {t("composer.presets.save")}
              </Button>
            </View>
          </>
        ) : (
          <>
            <Button variant="secondary" size="sm" onPress={startNew} testID="prompt-preset-new">
              {t("composer.presets.new")}
            </Button>
            {presets.length === 0 ? (
              <Text style={styles.empty}>{t("composer.presets.empty")}</Text>
            ) : null}
            {presets.map((preset) => (
              <PromptPresetRow
                key={preset.id}
                preset={preset}
                onInsert={insert}
                onEdit={edit}
                onDelete={remove}
              />
            ))}
          </>
        )}
      </View>
    </AdaptiveModalSheet>
  );
}

interface PromptPresetRowProps {
  preset: PromptPreset;
  onInsert: (preset: PromptPreset) => void;
  onEdit: (preset: PromptPreset) => void;
  onDelete: (preset: PromptPreset) => void;
}

/** Render one saved prompt and its management actions */
function PromptPresetRow({ preset, onInsert, onEdit, onDelete }: PromptPresetRowProps) {
  const { t } = useTranslation();
  const insert = useCallback(() => onInsert(preset), [onInsert, preset]);
  const edit = useCallback(() => onEdit(preset), [onEdit, preset]);
  const remove = useCallback(() => onDelete(preset), [onDelete, preset]);
  return (
    <View style={styles.row}>
      <Pressable
        onPress={insert}
        style={styles.rowMain}
        accessibilityRole="button"
        testID={`prompt-preset-insert-${preset.id}`}
      >
        <Text style={styles.title} numberOfLines={1}>
          {preset.title}
        </Text>
        <Text style={styles.preview} numberOfLines={1}>
          {preset.content}
        </Text>
      </Pressable>
      <Button
        variant="ghost"
        size="sm"
        onPress={edit}
        leftIcon={Pencil}
        accessibilityLabel={t("composer.presets.edit")}
      />
      <Button
        variant="ghost"
        size="sm"
        onPress={remove}
        leftIcon={Trash2}
        accessibilityLabel={t("composer.presets.delete")}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: { gap: theme.spacing[3], paddingBottom: theme.spacing[2] },
  input: {
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[2],
  },
  contentInput: {
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[2],
    minHeight: 120,
    textAlignVertical: "top",
  },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[2] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingVertical: theme.spacing[2],
  },
  rowMain: { flex: 1, minWidth: 0 },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  preview: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  empty: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
}));
