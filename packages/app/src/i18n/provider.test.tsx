/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { I18nProvider, useAppLocale } from "./provider";

// i18next keeps its old language while an asynchronous switch is pending
const pendingI18n = vi.hoisted(() => ({
  language: "en",
  changeLanguage: vi.fn(() => new Promise<void>(() => {})),
}));

vi.mock("./i18next", () => ({ i18n: pendingI18n }));
vi.mock("expo-localization", () => ({ getLocales: () => [{ languageTag: "en-US" }] }));
vi.mock("@/hooks/use-settings", () => ({
  useAppSettings: () => ({ settings: { language: "zh-CN" } }),
}));

/** Expose the locale a creation handler would read in the current render */
function LocaleProbe() {
  return <span>{useAppLocale()}</span>;
}

test("creation handlers read the selected locale while i18next still reports English", () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        <I18nProvider>
          <LocaleProbe />
        </I18nProvider>,
      ),
    );
    expect(pendingI18n.changeLanguage).toHaveBeenCalledWith("zh-CN");
    expect(pendingI18n.language).toBe("en");
    expect(container.textContent).toBe("zh-CN");
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
