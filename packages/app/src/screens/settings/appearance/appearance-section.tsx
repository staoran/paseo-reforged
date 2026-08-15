import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Text, TextInput, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, Monitor, Moon, Sun } from "lucide-react-native";
import {
  SYNTAX_THEME_OPTIONS,
  type SyntaxThemeId,
  type SyntaxThemeOption,
} from "@getpaseo/highlight";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/screens/settings/settings-section";
import {
  MAX_CODE_FONT_SIZE,
  MAX_UI_FONT_SIZE,
  MAX_WORKSPACE_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_UI_FONT_SIZE,
  MIN_WORKSPACE_FONT_SIZE,
  parseClampedFontSize,
  sanitizeFontFamily,
  useAppSettings,
  type AppSettings,
} from "@/hooks/use-settings";
import {
  DEFAULT_MONO_FONT_STACK,
  DEFAULT_UI_FONT_STACK,
  ICON_SIZE,
  THEME_OPTIONS,
  THEME_SWATCHES,
  type Theme,
} from "@/styles/theme";
import { isNative } from "@/constants/platform";
import { settingsStyles } from "@/styles/settings";
import { AppearancePreview } from "./appearance-preview";

// ---------------------------------------------------------------------------
// Theme-reactive leaf icons (withUnistyles + uniProps color mapping — no
// useUnistyles). Icon sizes read the static ICON_SIZE token; the appearance
// feature does not scale icons.
// ---------------------------------------------------------------------------

const ThemedSun = withUnistyles(Sun);
const ThemedMoon = withUnistyles(Moon);
const ThemedMonitor = withUnistyles(Monitor);
const ThemedChevronDown = withUnistyles(ChevronDown);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function getThemeLabel(t: TFunction, value: AppSettings["theme"]): string {
  return t(`settings.appearance.theme.options.${value}`);
}

// Platform default stacks can be the bare native tokens ("normal"/"monospace");
// those read as a bug, so show a human label in the placeholder instead.
const BARE_DEFAULT_STACKS: ReadonlySet<string> = new Set(["normal", "monospace"]);

function resolveDefaultStackPlaceholder(t: TFunction, stack: string): string {
  return BARE_DEFAULT_STACKS.has(stack) ? t("settings.appearance.fonts.systemDefault") : stack;
}

// Local size string (digits only) -> preview override number. Empty/invalid
// yields undefined so the preview falls back to the committed theme value.
function sizeDraftToOverride(value: string): number | undefined {
  if (value.length === 0) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

type FontFamilyField = "uiFontFamily" | "workspaceFontFamily" | "monoFontFamily";
type FontSizeField = "uiFontSize" | "workspaceFontSize" | "codeFontSize";
type UpdateAppSettings = (updates: Partial<AppSettings>) => Promise<void>;

interface FontFamilyDraftInput {
  field: FontFamilyField;
  value: string;
  updateSettings: UpdateAppSettings;
}

function useFontFamilyDraft({ field, value, updateSettings }: FontFamilyDraftInput) {
  const [draft, setDraft] = useState(value);
  const commit = useCallback(
    (candidate: string) => {
      const sanitized = sanitizeFontFamily(candidate);
      if (sanitized === null) {
        setDraft(value);
        return;
      }
      setDraft(sanitized);
      if (sanitized !== value) {
        void updateSettings({ [field]: sanitized });
      }
    },
    [field, updateSettings, value],
  );
  return { commit, draft, setDraft };
}

interface FontSizeDraftInput {
  field: FontSizeField;
  value: number;
  min: number;
  max: number;
  updateSettings: UpdateAppSettings;
}

function useFontSizeDraft({ field, value, min, max, updateSettings }: FontSizeDraftInput) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  const changeDraft = useCallback((candidate: string) => {
    setDraft(candidate.replace(/[^\d]/g, ""));
  }, []);
  const commit = useCallback(() => {
    const next = parseClampedFontSize(draft, { min, max }) ?? value;
    setDraft(String(next));
    if (next !== value) {
      void updateSettings({ [field]: next });
    }
  }, [draft, field, max, min, updateSettings, value]);
  return { changeDraft, commit, draft };
}

function dropdownTriggerStyle({ pressed }: PressableStateCallbackType) {
  return [styles.trigger, pressed ? styles.triggerPressed : null];
}

// ---------------------------------------------------------------------------
// Theme picker
// ---------------------------------------------------------------------------

interface ThemeLeadingProps {
  themeValue: AppSettings["theme"];
}

function ThemeLeading({ themeValue }: ThemeLeadingProps) {
  switch (themeValue) {
    case "light":
      return <ThemedSun size={ICON_SIZE.md} uniProps={mutedColorMapping} />;
    case "dark":
      return <ThemedMoon size={ICON_SIZE.md} uniProps={mutedColorMapping} />;
    case "auto":
      return <ThemedMonitor size={ICON_SIZE.md} uniProps={mutedColorMapping} />;
    default:
      return <ThemeSwatch color={THEME_SWATCHES[themeValue]} />;
  }
}

interface ThemeSwatchProps {
  color: string;
}

function ThemeSwatch({ color }: ThemeSwatchProps) {
  const swatchStyle = useMemo(() => [styles.swatch, { backgroundColor: color }], [color]);
  return <View style={swatchStyle} />;
}

interface ThemeMenuItemProps {
  themeValue: AppSettings["theme"];
  selected: boolean;
  onChange: (theme: AppSettings["theme"]) => void;
}

function ThemeMenuItem({ themeValue, selected, onChange }: ThemeMenuItemProps) {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => {
    onChange(themeValue);
  }, [onChange, themeValue]);
  const leading = useMemo(() => <ThemeLeading themeValue={themeValue} />, [themeValue]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect} leading={leading}>
      {getThemeLabel(t, themeValue)}
    </DropdownMenuItem>
  );
}

interface ThemeRowProps {
  value: AppSettings["theme"];
  onChange: (theme: AppSettings["theme"]) => void;
}

function ThemeRow({ value, onChange }: ThemeRowProps) {
  const { t } = useTranslation();
  const selectedLabel = getThemeLabel(t, value);
  return (
    <View style={settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("settings.appearance.theme.title")}</Text>
      </View>
      <DropdownMenu>
        <DropdownMenuTrigger
          style={dropdownTriggerStyle}
          accessibilityLabel={t("settings.appearance.theme.accessibilityLabel", {
            value: selectedLabel,
          })}
        >
          <ThemeLeading themeValue={value} />
          <Text style={styles.triggerText}>{selectedLabel}</Text>
          <ThemedChevronDown size={ICON_SIZE.sm} uniProps={mutedColorMapping} />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end" width={200}>
          {THEME_OPTIONS.map((option, index) => {
            const previousOption = THEME_OPTIONS[index - 1];
            return (
              <Fragment key={option.name}>
                {previousOption && previousOption.group !== option.group ? (
                  <DropdownMenuSeparator />
                ) : null}
                <ThemeMenuItem
                  themeValue={option.name}
                  selected={value === option.name}
                  onChange={onChange}
                />
              </Fragment>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

interface ExpansionSwitchRowProps {
  label: string;
  description: string;
  value: boolean;
  withBorder?: boolean;
  onChange: (value: boolean) => void;
}

function ExpansionSwitchRow({
  label,
  description,
  value,
  withBorder = false,
  onChange,
}: ExpansionSwitchRowProps) {
  return (
    <View style={withBorder ? [settingsStyles.row, settingsStyles.rowBorder] : settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{label}</Text>
        <Text style={settingsStyles.rowHint}>{description}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
}

interface ChatOutlineRowProps {
  value: boolean;
  onChange: (value: boolean) => void;
}

function ChatOutlineRow({ value, onChange }: ChatOutlineRowProps) {
  const { t } = useTranslation();
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("settings.appearance.chatOutline.title")}</Text>
        <Text style={settingsStyles.rowHint}>
          {t("settings.appearance.chatOutline.description")}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={t("settings.appearance.chatOutline.title")}
      />
    </View>
  );
}

const TOOL_CALL_DETAIL_LEVELS: readonly AppSettings["toolCallDetailLevel"][] = [
  "detailed",
  "overview",
];

function getToolCallDetailLevelLabel(
  t: TFunction,
  value: AppSettings["toolCallDetailLevel"],
): string {
  return t(`settings.general.toolCallDetail.options.${value}`);
}

interface ToolCallDetailMenuItemProps {
  value: AppSettings["toolCallDetailLevel"];
  selected: boolean;
  onChange: (value: AppSettings["toolCallDetailLevel"]) => void;
}

function ToolCallDetailMenuItem({ value, selected, onChange }: ToolCallDetailMenuItemProps) {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => onChange(value), [onChange, value]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {getToolCallDetailLevelLabel(t, value)}
    </DropdownMenuItem>
  );
}

interface ToolCallDetailRowProps {
  value: AppSettings["toolCallDetailLevel"];
  onChange: (value: AppSettings["toolCallDetailLevel"]) => void;
}

function ToolCallDetailRow({ value, onChange }: ToolCallDetailRowProps) {
  const { t } = useTranslation();
  const selectedLabel = getToolCallDetailLevelLabel(t, value);
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("settings.general.toolCallDetail.label")}</Text>
        <Text style={settingsStyles.rowHint}>
          {t("settings.general.toolCallDetail.description")}
        </Text>
      </View>
      <DropdownMenu>
        <DropdownMenuTrigger
          style={dropdownTriggerStyle}
          accessibilityLabel={t("settings.general.toolCallDetail.accessibilityLabel", {
            value: selectedLabel,
          })}
        >
          <Text style={styles.triggerText}>{selectedLabel}</Text>
          <ThemedChevronDown size={ICON_SIZE.sm} uniProps={mutedColorMapping} />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end" width={200}>
          {TOOL_CALL_DETAIL_LEVELS.map((option) => (
            <ToolCallDetailMenuItem
              key={option}
              value={option}
              selected={value === option}
              onChange={onChange}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Fonts: family text fields + numeric size fields (commit on blur/submit)
// ---------------------------------------------------------------------------

interface FontFamilyRowProps {
  title: string;
  hint: string;
  accessibilityLabel: string;
  placeholder: string;
  value: string;
  draft: string;
  withBorder: boolean;
  onChangeDraft: (value: string) => void;
  onCommit: (value: string) => void;
}

function FontFamilyRow({
  title,
  hint,
  accessibilityLabel,
  placeholder,
  value,
  draft,
  withBorder,
  onChangeDraft,
  onCommit,
}: FontFamilyRowProps) {
  const handleCommit = useCallback(() => {
    onCommit(draft);
  }, [draft, onCommit]);

  // Resync from the committed value when it changes elsewhere.
  useEffect(() => {
    onChangeDraft(value);
    // Only resync on external value changes, not on local keystrokes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <View style={withBorder ? styles.rowWithBorder : settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
      <TextInput
        value={draft}
        onChangeText={onChangeDraft}
        onBlur={handleCommit}
        onSubmitEditing={handleCommit}
        placeholder={placeholder}
        placeholderTextColor={styles.placeholderColor.color}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        style={styles.fontFamilyInput}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

interface FontSizeRowProps {
  title: string;
  accessibilityLabel: string;
  draft: string;
  withBorder?: boolean;
  onChangeDraft: (value: string) => void;
  onCommit: () => void;
}

function FontSizeRow({
  title,
  accessibilityLabel,
  draft,
  withBorder = true,
  onChangeDraft,
  onCommit,
}: FontSizeRowProps) {
  return (
    <View style={withBorder ? styles.rowWithBorder : settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
      </View>
      <View style={styles.sizeField}>
        <TextInput
          value={draft}
          onChangeText={onChangeDraft}
          onBlur={onCommit}
          onSubmitEditing={onCommit}
          keyboardType="number-pad"
          inputMode="numeric"
          selectTextOnFocus
          style={styles.sizeInput}
          accessibilityLabel={accessibilityLabel}
        />
        <Text style={styles.unit}>px</Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Syntax highlight theme picker (commits immediately)
// ---------------------------------------------------------------------------

function syntaxLabelForId(id: SyntaxThemeId): string {
  const option = SYNTAX_THEME_OPTIONS.find((entry) => entry.id === id);
  return option ? option.label : id;
}

interface SyntaxMenuItemProps {
  option: SyntaxThemeOption;
  selected: boolean;
  onChange: (id: SyntaxThemeId) => void;
}

function SyntaxMenuItem({ option, selected, onChange }: SyntaxMenuItemProps) {
  const handleSelect = useCallback(() => {
    onChange(option.id);
  }, [onChange, option.id]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {option.label}
    </DropdownMenuItem>
  );
}

interface SyntaxRowProps {
  value: SyntaxThemeId;
  onChange: (id: SyntaxThemeId) => void;
}

function SyntaxRow({ value, onChange }: SyntaxRowProps) {
  const { t } = useTranslation();
  const selectedLabel = syntaxLabelForId(value);
  return (
    <View style={settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>
          {t("settings.appearance.syntax.highlightTheme")}
        </Text>
        <Text style={settingsStyles.rowHint}>
          {t("settings.appearance.syntax.highlightThemeHint")}
        </Text>
      </View>
      <DropdownMenu>
        <DropdownMenuTrigger
          style={dropdownTriggerStyle}
          accessibilityLabel={t("settings.appearance.syntax.highlightThemeAccessibility", {
            value: selectedLabel,
          })}
        >
          <Text style={styles.triggerText}>{selectedLabel}</Text>
          <ThemedChevronDown size={ICON_SIZE.sm} uniProps={mutedColorMapping} />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end" width={200}>
          {SYNTAX_THEME_OPTIONS.map((option) => (
            <SyntaxMenuItem
              key={option.id}
              option={option}
              selected={value === option.id}
              onChange={onChange}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AppearanceSection() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const showFontFamilyRows = !isNative;
  const uiFontPlaceholder = resolveDefaultStackPlaceholder(t, DEFAULT_UI_FONT_STACK);
  const monoFontPlaceholder = resolveDefaultStackPlaceholder(t, DEFAULT_MONO_FONT_STACK);

  const uiFont = useFontFamilyDraft({
    field: "uiFontFamily",
    value: settings.uiFontFamily,
    updateSettings,
  });
  const workspaceFont = useFontFamilyDraft({
    field: "workspaceFontFamily",
    value: settings.workspaceFontFamily,
    updateSettings,
  });
  const monoFont = useFontFamilyDraft({
    field: "monoFontFamily",
    value: settings.monoFontFamily,
    updateSettings,
  });
  const uiSize = useFontSizeDraft({
    field: "uiFontSize",
    value: settings.uiFontSize,
    min: MIN_UI_FONT_SIZE,
    max: MAX_UI_FONT_SIZE,
    updateSettings,
  });
  const workspaceSize = useFontSizeDraft({
    field: "workspaceFontSize",
    value: settings.workspaceFontSize,
    min: MIN_WORKSPACE_FONT_SIZE,
    max: MAX_WORKSPACE_FONT_SIZE,
    updateSettings,
  });
  const codeSize = useFontSizeDraft({
    field: "codeFontSize",
    value: settings.codeFontSize,
    min: MIN_CODE_FONT_SIZE,
    max: MAX_CODE_FONT_SIZE,
    updateSettings,
  });

  const handleThemeChange = useCallback(
    (theme: AppSettings["theme"]) => {
      void updateSettings({ theme });
    },
    [updateSettings],
  );

  const handleSyntaxThemeChange = useCallback(
    (syntaxTheme: SyntaxThemeId) => {
      void updateSettings({ syntaxTheme });
    },
    [updateSettings],
  );

  const handleAutoExpandReasoningChange = useCallback(
    (autoExpandReasoning: boolean) => {
      void updateSettings({ autoExpandReasoning });
    },
    [updateSettings],
  );

  const handleAutoExpandActivityChange = useCallback(
    (autoExpandActivity: boolean) => {
      void updateSettings({ autoExpandActivity });
    },
    [updateSettings],
  );

  const handleToolCallDetailLevelChange = useCallback(
    (toolCallDetailLevel: AppSettings["toolCallDetailLevel"]) => {
      void updateSettings({ toolCallDetailLevel });
    },
    [updateSettings],
  );

  const handleChatOutlineChange = useCallback(
    (chatOutlineEnabled: boolean) => {
      void updateSettings({ chatOutlineEnabled });
    },
    [updateSettings],
  );

  // Live-while-typing: the in-progress drafts drive the preview without
  // committing to the global theme. Empty/invalid fields fall back to the
  // theme value inside the preview.
  const previewOverrides = useMemo(
    () => ({
      monoFontFamily: monoFont.draft,
      codeFontSize: sizeDraftToOverride(codeSize.draft),
    }),
    [codeSize.draft, monoFont.draft],
  );

  return (
    <View>
      <SettingsSection title={t("settings.appearance.theme.title")}>
        <View style={settingsStyles.card}>
          <ThemeRow value={settings.theme} onChange={handleThemeChange} />
        </View>
      </SettingsSection>
      <SettingsSection title={t("settings.appearance.detailLevel.title")}>
        <View style={settingsStyles.card}>
          <ExpansionSwitchRow
            label={t("settings.general.autoExpandActivity.label")}
            description={t("settings.general.autoExpandActivity.description")}
            value={settings.autoExpandActivity}
            onChange={handleAutoExpandActivityChange}
          />
          <ExpansionSwitchRow
            label={t("settings.general.autoExpandReasoning.label")}
            description={t("settings.general.autoExpandReasoning.description")}
            value={settings.autoExpandReasoning}
            withBorder
            onChange={handleAutoExpandReasoningChange}
          />
          <ToolCallDetailRow
            value={settings.toolCallDetailLevel}
            onChange={handleToolCallDetailLevelChange}
          />
          {!isNative ? (
            <ChatOutlineRow
              value={settings.chatOutlineEnabled}
              onChange={handleChatOutlineChange}
            />
          ) : null}
        </View>
      </SettingsSection>
      <SettingsSection title={t("settings.appearance.fonts.title")}>
        <View style={settingsStyles.card}>
          {showFontFamilyRows ? (
            <FontFamilyRow
              title={t("settings.appearance.fonts.interfaceFont")}
              hint={t("settings.appearance.fonts.interfaceFontHint")}
              accessibilityLabel={t("settings.appearance.fonts.interfaceFontAccessibility")}
              placeholder={uiFontPlaceholder}
              value={settings.uiFontFamily}
              draft={uiFont.draft}
              withBorder={false}
              onChangeDraft={uiFont.setDraft}
              onCommit={uiFont.commit}
            />
          ) : null}
          <FontSizeRow
            title={t("settings.appearance.fonts.interfaceSize")}
            accessibilityLabel={t("settings.appearance.fonts.interfaceSizeAccessibility")}
            draft={uiSize.draft}
            withBorder={showFontFamilyRows}
            onChangeDraft={uiSize.changeDraft}
            onCommit={uiSize.commit}
          />
          {showFontFamilyRows ? (
            <FontFamilyRow
              title={t("settings.appearance.fonts.workspaceFont")}
              hint={t("settings.appearance.fonts.workspaceFontHint")}
              accessibilityLabel={t("settings.appearance.fonts.workspaceFontAccessibility")}
              placeholder={uiFontPlaceholder}
              value={settings.workspaceFontFamily}
              draft={workspaceFont.draft}
              withBorder
              onChangeDraft={workspaceFont.setDraft}
              onCommit={workspaceFont.commit}
            />
          ) : null}
          <FontSizeRow
            title={t("settings.appearance.fonts.workspaceSize")}
            accessibilityLabel={t("settings.appearance.fonts.workspaceSizeAccessibility")}
            draft={workspaceSize.draft}
            onChangeDraft={workspaceSize.changeDraft}
            onCommit={workspaceSize.commit}
          />
          {showFontFamilyRows ? (
            <FontFamilyRow
              title={t("settings.appearance.fonts.codeFont")}
              hint={t("settings.appearance.fonts.codeFontHint")}
              accessibilityLabel={t("settings.appearance.fonts.codeFontAccessibility")}
              placeholder={monoFontPlaceholder}
              value={settings.monoFontFamily}
              draft={monoFont.draft}
              withBorder
              onChangeDraft={monoFont.setDraft}
              onCommit={monoFont.commit}
            />
          ) : null}
          <FontSizeRow
            title={t("settings.appearance.fonts.codeSize")}
            accessibilityLabel={t("settings.appearance.fonts.codeSizeAccessibility")}
            draft={codeSize.draft}
            onChangeDraft={codeSize.changeDraft}
            onCommit={codeSize.commit}
          />
        </View>
      </SettingsSection>
      <SettingsSection title={t("settings.appearance.syntax.title")}>
        <View style={settingsStyles.card}>
          <SyntaxRow value={settings.syntaxTheme} onChange={handleSyntaxThemeChange} />
        </View>
        <View style={styles.preview}>
          <AppearancePreview overrides={previewOverrides} />
        </View>
      </SettingsSection>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  preview: {
    marginTop: theme.spacing[4],
  },
  rowWithBorder: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  triggerPressed: {
    opacity: 0.85,
  },
  triggerText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  swatch: {
    width: ICON_SIZE.md,
    height: ICON_SIZE.md,
    borderRadius: ICON_SIZE.md / 2,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  fontFamilyInput: {
    flexGrow: 1,
    flexShrink: 1,
    maxWidth: 280,
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    textAlign: "left",
  },
  sizeField: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  sizeInput: {
    width: 64,
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    textAlign: "right",
  },
  unit: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  placeholderColor: {
    color: theme.colors.foregroundMuted,
  },
}));
