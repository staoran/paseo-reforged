import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { RootErrorFallback } from "./root-error-boundary";

const { runtime, theme } = vi.hoisted(() => ({
  runtime: { breakpoint: "xs" },
  theme: {
    spacing: { 2: 8, 3: 12, 4: 16, 6: 24, 8: 32 },
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
      surface0: "#111",
      surface1: "#181818",
      surface2: "#222",
      surface3: "#333",
    },
    opacity: { 50: 0.5 },
  },
}));

vi.mock("@/utils/copy-to-clipboard", () => ({
  copyToClipboard: vi.fn(),
}));

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
  vi.mocked(copyToClipboard).mockReset();
  vi.mocked(copyToClipboard).mockResolvedValue(true);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
});

describe("RootErrorFallback", () => {
  for (const breakpoint of ["xs", "lg"]) {
    it(`keeps the safe-area header and retry action outside the scrollable details on ${breakpoint}`, () => {
      runtime.breakpoint = breakpoint;
      act(() => {
        root?.render(<RootErrorFallback error={"failure\n".repeat(200)} onRetry={vi.fn()} />);
      });

      const screen = document.querySelector('[data-testid="root-error-boundary"]');
      const header = document.querySelector('[data-testid="root-error-boundary-header"]');
      const details = document.querySelector('[data-testid="root-error-boundary-details"]');
      const retry = document.querySelector('[data-testid="root-error-boundary-retry"]');

      expect(screen).not.toBeNull();
      expect(header).not.toBeNull();
      expect(details).not.toBeNull();
      expect(retry).not.toBeNull();
      expect(screen?.getAttribute("style")).toContain("padding: 47px 3px 34px 5px");
      expect(details?.contains(header)).toBe(false);
      expect(details?.contains(retry)).toBe(false);
      expect(screen?.contains(retry)).toBe(true);
    });
  }

  it("keeps multiline details in one selectable text node", () => {
    const error = "first line\nsecond line\nthird line";
    act(() => {
      root?.render(<RootErrorFallback error={error} onRetry={vi.fn()} />);
    });

    const details = document.querySelector('[data-testid="root-error-boundary-details"]');
    const textNode = findTextNode(details, error);

    expect(textNode).not.toBeNull();
    const range = document.createRange();
    range.selectNodeContents(textNode!);
    expect(range.toString()).toBe(error);
  });

  it("copies the complete multiline error details", async () => {
    const error = "first line\nsecond line\nthird line";
    act(() => {
      root?.render(<RootErrorFallback error={error} onRetry={vi.fn()} />);
    });

    const copy = document.querySelector('[data-testid="root-error-boundary-copy"]');
    expect(copy).not.toBeNull();
    expect(copy?.getAttribute("aria-label")).toBe("rootError.copyDetails");

    await act(async () => {
      copy?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(copyToClipboard).toHaveBeenCalledOnce();
    expect(copyToClipboard).toHaveBeenCalledWith(error);
    expect(document.body.textContent).toContain("rootError.copySuccess");
  });

  it("keeps an unsuccessful Web clipboard fallback visible beside the details", async () => {
    vi.mocked(copyToClipboard).mockResolvedValueOnce(false);
    act(() => {
      root?.render(<RootErrorFallback error="first line\nsecond line" onRetry={vi.fn()} />);
    });

    const copy = document.querySelector('[data-testid="root-error-boundary-copy"]');
    expect(copy).not.toBeNull();

    await act(async () => {
      copy?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("rootError.copyFailed");
  });

  it("keeps a rejected clipboard copy visible beside the details", async () => {
    vi.mocked(copyToClipboard).mockRejectedValueOnce(new Error("Clipboard unavailable"));
    act(() => {
      root?.render(<RootErrorFallback error="first line\nsecond line" onRetry={vi.fn()} />);
    });

    const copy = document.querySelector('[data-testid="root-error-boundary-copy"]');
    expect(copy).not.toBeNull();

    await act(async () => {
      copy?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("rootError.copyFailed");
  });
});

/** Returns the text node that contains the complete expected error value */
function findTextNode(node: Element | null, expected: string): Text | null {
  if (!node) return null;
  for (const child of node.childNodes) {
    if (child.nodeType === window.Node.TEXT_NODE && child.textContent === expected) {
      return child as Text;
    }
    if (child.nodeType === window.Node.ELEMENT_NODE) {
      const match = findTextNode(child as Element, expected);
      if (match) return match;
    }
  }
  return null;
}
