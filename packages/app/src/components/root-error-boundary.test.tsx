import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RootErrorFallback } from "./root-error-boundary";

const { clipboard, runtime, theme } = vi.hoisted(() => ({
  // Clipboard is a platform boundary without a Node implementation
  clipboard: { setStringAsync: vi.fn<(text: string) => Promise<boolean>>() },
  runtime: { breakpoint: "xs" },
  theme: {
    spacing: { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32 },
    borderWidth: { 1: 1 },
    borderRadius: { md: 6, lg: 8, xl: 12 },
    fontFamily: { ui: "system-ui", mono: "monospace" },
    fontSize: { xs: 11, code: 12, sm: 13, base: 15, xl: 20 },
    fontWeight: { normal: "400", medium: "500", semibold: "600" },
    colors: {
      accent: "#369",
      accentForeground: "#fff",
      border: "#333",
      borderAccent: "#444",
      destructive: "#c33",
      foreground: "#fff",
      foregroundMuted: "#aaa",
      popover: "#222",
      surface0: "#111",
      surface1: "#181818",
      surface2: "#222",
      surface3: "#333",
    },
    opacity: { 50: 0.5 },
    shadow: { md: {} },
  },
}));

vi.mock("expo-clipboard", () => clipboard);

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  useUnistyles: () => ({ theme, rt: runtime }),
  withUnistyles: (component: unknown) => component,
}));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 3, bottom: 34, left: 5 }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let root: Root | null = null;

beforeEach(() => {
  clipboard.setStringAsync.mockReset().mockResolvedValue(true);
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("navigator", dom.window.navigator);

  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
});

describe("RootErrorFallback", () => {
  for (const breakpoint of ["xs", "lg"]) {
    it(`keeps the safe-area header and actions outside the scrollable details on ${breakpoint}`, () => {
      runtime.breakpoint = breakpoint;
      act(() => {
        root?.render(<RootErrorFallback error={"failure\n".repeat(200)} onReload={vi.fn()} />);
      });

      const screen = document.querySelector('[data-testid="root-error-boundary"]');
      const header = document.querySelector('[data-testid="root-error-boundary-header"]');
      const details = document.querySelector('[data-testid="root-error-boundary-details"]');
      const reload = document.querySelector('[data-testid="root-error-boundary-reload"]');
      // Copy remains reachable while long details scroll
      const copy = document.querySelector('[data-testid="root-error-boundary-copy"]');

      expect(screen).not.toBeNull();
      expect(header).not.toBeNull();
      expect(details).not.toBeNull();
      expect(reload).not.toBeNull();
      expect(copy).not.toBeNull();
      expect(reload?.textContent).toBe("common.actions.reload");
      expect(screen?.getAttribute("style")).toContain("padding: 47px 3px 34px 5px");
      expect(details?.contains(header)).toBe(false);
      expect(details?.contains(reload)).toBe(false);
      expect(details?.contains(copy)).toBe(false);
      expect(screen?.contains(reload)).toBe(true);
      expect(screen?.contains(copy)).toBe(true);
    });
  }

  it("copies the complete error details and acknowledges success", async () => {
    // Multiline details exceed the visible scroll area
    const error =
      "Name: Error\nMessage: failure\nStack:\n" + "  at render (app.tsx:1:1)\n".repeat(200);
    act(() => {
      root?.render(<RootErrorFallback error={error} onReload={vi.fn()} />);
    });
    // React Native Web exposes the pressable as an HTML element
    const copy = document.querySelector<HTMLElement>('[data-testid="root-error-boundary-copy"]');

    await act(async () => copy?.click());

    expect(clipboard.setStringAsync).toHaveBeenCalledExactlyOnceWith(error);
    expect(copy?.getAttribute("aria-label")).toBe("common.states.copied");
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  for (const failure of ["rejection", "false return"]) {
    it(`shows a copy failure after a ${failure} and allows retry`, async () => {
      if (failure === "rejection") {
        clipboard.setStringAsync.mockRejectedValueOnce(new Error("Clipboard permission denied"));
      } else {
        clipboard.setStringAsync.mockResolvedValueOnce(false);
      }
      act(() => {
        root?.render(<RootErrorFallback error="failure details" onReload={vi.fn()} />);
      });
      // Keep the same button for a retry after clipboard access fails
      const copy = document.querySelector<HTMLElement>('[data-testid="root-error-boundary-copy"]');

      await act(async () => copy?.click());

      expect(document.querySelector('[role="alert"]')?.textContent).toBe(
        "common.errors.unableToCopy",
      );
      expect(copy?.getAttribute("aria-label")).toBe("common.actions.copy");
      expect(copy?.getAttribute("aria-disabled")).not.toBe("true");

      await act(async () => copy?.click());

      expect(clipboard.setStringAsync).toHaveBeenCalledTimes(2);
      expect(clipboard.setStringAsync).toHaveBeenLastCalledWith("failure details");
      expect(copy?.getAttribute("aria-label")).toBe("common.states.copied");
      expect(document.querySelector('[role="alert"]')).toBeNull();
    });
  }
});
