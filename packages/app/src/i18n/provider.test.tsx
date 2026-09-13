/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useAppLocale } from "./provider";

const { changeLanguageMock } = vi.hoisted(() => ({
  changeLanguageMock: vi.fn(),
}));

vi.mock("@/constants/platform", () => ({ isWeb: false }));
vi.mock("@/hooks/use-settings", () => ({
  useAppSettings: () => ({ settings: { language: "system" } }),
}));
vi.mock("expo-localization", () => ({
  getLocales: () => [{ languageTag: "zh-CN" }],
}));
vi.mock("./i18next", () => ({
  i18n: {
    language: "en",
    changeLanguage: changeLanguageMock,
  },
}));
vi.mock("react-i18next", () => ({
  I18nextProvider: ({ children }: { children: React.ReactNode }) => children,
}));

function LocaleProbe() {
  return <output data-testid="locale">{useAppLocale()}</output>;
}

describe("I18nProvider", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    changeLanguageMock.mockImplementation(() => new Promise(() => undefined));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    changeLanguageMock.mockReset();
  });

  it("exposes the resolved system locale while i18next is still switching", () => {
    act(() => {
      root.render(
        <I18nProvider>
          <LocaleProbe />
        </I18nProvider>,
      );
    });

    expect(container.querySelector("[data-testid=locale]")?.textContent).toBe("zh-CN");
    expect(changeLanguageMock).toHaveBeenCalledWith("zh-CN");
  });
});
