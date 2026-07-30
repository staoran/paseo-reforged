import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, MessageSquareQuote } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isWeb } from "@/constants/platform";
import { useCommitMessagePresetsStore } from "@/git/commit-message-presets-store";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ThemedMessageSquareQuote = withUnistyles(MessageSquareQuote);
const ThemedChevronLeft = withUnistyles(ChevronLeft);
const ThemedChevronRight = withUnistyles(ChevronRight);
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const BACK_LEADING = <ThemedChevronLeft size={14} uniProps={mutedIconMapping} />;
const MANAGE_TRAILING = <ThemedChevronRight size={14} uniProps={mutedIconMapping} />;
const TRIGGER_ICON_SIZE = isWeb ? ICON_SIZE.md : ICON_SIZE.lg;

export function ComposerPresetsMenu({
  currentText,
  onPick,
}: {
  currentText: string;
  onPick: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [managing, setManaging] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const presets = useCommitMessagePresetsStore((state) => state.presets);
  const addPreset = useCommitMessagePresetsStore((state) => state.addPreset);
  const removePreset = useCommitMessagePresetsStore((state) => state.removePreset);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setManaging(false);
  }, []);
  const handleBack = useCallback(() => setManaging(false), []);
  const handleSaveCurrent = useCallback(() => addPreset(currentText), [addPreset, currentText]);
  const handleAdd = useCallback(() => setAddOpen(true), []);
  const handleManage = useCallback(() => setManaging(true), []);
  const handleAddClose = useCallback(() => setAddOpen(false), []);

  return (
    <>
      <DropdownMenu open={open} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger
          accessibilityRole="button"
          accessibilityLabel={t("composer.presets.trigger")}
          style={triggerButtonStyle}
          testID="composer-presets-menu"
        >
          <ThemedMessageSquareQuote size={TRIGGER_ICON_SIZE} uniProps={mutedIconMapping} />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="end"
          offset={8}
          width={260}
          testID="composer-presets-content"
        >
          {managing ? (
            <>
              <DropdownMenuItem closeOnSelect={false} onSelect={handleBack} leading={BACK_LEADING}>
                {t("composer.presets.delete")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {presets.length === 0 ? (
                <DropdownMenuItem disabled>{t("composer.presets.empty")}</DropdownMenuItem>
              ) : (
                presets.map((preset) => (
                  <PresetMenuItem
                    key={preset}
                    preset={preset}
                    onAction={removePreset}
                    destructive
                    stayOpen
                  />
                ))
              )}
            </>
          ) : (
            <>
              {presets.length === 0 ? (
                <DropdownMenuItem disabled>{t("composer.presets.empty")}</DropdownMenuItem>
              ) : (
                presets.map((preset) => (
                  <PresetMenuItem key={preset} preset={preset} onAction={onPick} />
                ))
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!currentText.trim()} onSelect={handleSaveCurrent}>
                {t("composer.presets.saveCurrent")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleAdd}>{t("composer.presets.add")}</DropdownMenuItem>
              {presets.length > 0 ? (
                <DropdownMenuItem
                  closeOnSelect={false}
                  onSelect={handleManage}
                  trailing={MANAGE_TRAILING}
                >
                  {t("composer.presets.delete")}
                </DropdownMenuItem>
              ) : null}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AdaptiveRenameModal
        visible={addOpen}
        title={t("composer.presets.addTitle")}
        initialValue=""
        placeholder={t("composer.presets.placeholder")}
        multiline
        onClose={handleAddClose}
        onSubmit={addPreset}
      />
    </>
  );
}

function PresetMenuItem({
  preset,
  onAction,
  destructive = false,
  stayOpen = false,
}: {
  preset: string;
  onAction: (preset: string) => void;
  destructive?: boolean;
  stayOpen?: boolean;
}) {
  const handleSelect = useCallback(() => onAction(preset), [onAction, preset]);
  return (
    <DropdownMenuItem closeOnSelect={!stayOpen} onSelect={handleSelect} destructive={destructive}>
      {preset}
    </DropdownMenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  triggerButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  triggerButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
}));

function triggerButtonStyle({ hovered }: { hovered?: boolean }) {
  return [styles.triggerButton, Boolean(hovered) && styles.triggerButtonHovered];
}
