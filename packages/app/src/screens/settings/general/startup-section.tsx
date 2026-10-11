import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { SettingsCard, SettingsSection, SettingsSelect } from "@/components/settings";
import { useAppSettings, type StartupBehavior } from "@/hooks/use-settings";

/** Available startup choices in menu order */
const STARTUP_BEHAVIORS: readonly StartupBehavior[] = ["new-workspace", "restore"];

/** Configure the next launch without navigating away from Settings */
export function StartupSection() {
  const { t } = useTranslation();
  const { settings, isLoading, updateSettings } = useAppSettings();
  const options = useMemo(
    () =>
      STARTUP_BEHAVIORS.map((value) => ({
        value,
        label: t(`settings.general.startup.options.${value}`),
      })),
    [t],
  );
  const save = useMutation({
    mutationFn: (startupBehavior: StartupBehavior) => updateSettings({ startupBehavior }),
  });
  const hint = save.isPending
    ? t("settings.general.startup.saving")
    : t(`settings.general.startup.descriptions.${settings.startupBehavior}`);
  const error = save.isError ? t("settings.general.startup.saveError") : undefined;
  const disabled = isLoading || save.isPending;

  return (
    <SettingsSection title={t("settings.general.startup.title")}>
      <SettingsCard>
        <SettingsSelect
          label={t("settings.general.startup.label")}
          hint={hint}
          error={error}
          value={settings.startupBehavior}
          options={options}
          onValueChange={save.mutate}
          disabled={disabled}
          testID="settings-startup-behavior"
        />
      </SettingsCard>
    </SettingsSection>
  );
}
