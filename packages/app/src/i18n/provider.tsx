import * as Localization from "expo-localization";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { I18nextProvider } from "react-i18next";
import { isWeb } from "@/constants/platform";
import { useAppSettings } from "@/hooks/use-settings";
import { i18n } from "./i18next";
import { resolveSupportedLocale, type SupportedLocale } from "./locales";
import { ensureI18nLanguageForRender } from "./sync-language";

interface I18nProviderProps {
  children: ReactNode;
}

// Locale resolved synchronously from settings and the system language
const AppLocaleContext = createContext<SupportedLocale | null>(null);

function getSystemLocales(): string[] {
  if (isWeb && typeof navigator !== "undefined" && navigator.languages.length > 0) {
    return [...navigator.languages];
  }

  return Localization.getLocales().map((locale) => locale.languageTag);
}

export function I18nProvider({ children }: I18nProviderProps) {
  const { settings } = useAppSettings();
  const systemLocales = useMemo(() => getSystemLocales(), []);
  const locale = resolveSupportedLocale(settings.language, systemLocales);

  ensureI18nLanguageForRender(locale, i18n);

  return (
    <AppLocaleContext.Provider value={locale}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </AppLocaleContext.Provider>
  );
}

/** Read the current render's locale before the asynchronous i18next switch completes */
export function useAppLocale(): SupportedLocale {
  const locale = useContext(AppLocaleContext);
  if (!locale) throw new Error("useAppLocale must be used within I18nProvider");
  return locale;
}
