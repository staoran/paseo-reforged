import { beforeEach, describe, expect, it, vi } from "vitest";
import { darkHighlightColors, resolveSyntaxColors } from "@getpaseo/highlight";
import { darkTheme, DEFAULT_UI_FONT_STACK, REGISTERED_THEMES } from "@/styles/theme";
import { applyAppearance, type AppearanceInput } from "./apply-appearance";

// Override the global react-native-unistyles mock (vitest.setup.ts) so that
// UnistylesRuntime.updateTheme is a spy that records (themeName, updater) calls.
const { runtime, updateTheme } = vi.hoisted(() => {
  const updateThemeSpy = vi.fn();
  return {
    runtime: { themeName: undefined as string | undefined, updateTheme: updateThemeSpy },
    updateTheme: updateThemeSpy,
  };
});
vi.mock("react-native-unistyles", () => ({ UnistylesRuntime: runtime }));

const ALL_THEME_KEYS = Object.keys(REGISTERED_THEMES);

// The signature of the updater passed to UnistylesRuntime.updateTheme.
type ThemeUpdater = (theme: FakeTheme) => FakeTheme;

// The subset of the theme shape the updater reads / spreads. The real Theme type
// is a frozen `as const` literal; the updater only touches these fields. Casting a
// fake of this shape through `unknown` to ThemeUpdater's param is test-only.
interface FakeTheme {
  colorScheme: "light" | "dark";
  fontFamily: { ui: string; workspace: string; mono: string };
  fontSize: {
    xs: number;
    code: number;
    sm: number;
    base: number;
    lg: number;
    xl: number;
    "2xl": number;
    "3xl": number;
    "4xl": number;
  };
  workspaceFontSize: {
    xs: number;
    sm: number;
    base: number;
    lg: number;
    xl: number;
    "2xl": number;
    "3xl": number;
    "4xl": number;
  };
  lineHeight: { diff: number };
  colors: { foreground: string; syntax: Record<string, string> };
}

function makeFakeTheme(): FakeTheme {
  return {
    colorScheme: "dark",
    fontFamily: {
      ui: "seed-ui-stack",
      workspace: "seed-workspace-stack",
      mono: "seed-mono-stack",
    },
    fontSize: {
      xs: 16,
      code: 12,
      sm: 16,
      base: 16,
      lg: 16,
      xl: 16,
      "2xl": 16,
      "3xl": 16,
      "4xl": 16,
    },
    workspaceFontSize: {
      xs: 12,
      sm: 14,
      base: 16,
      lg: 18,
      xl: 20,
      "2xl": 22,
      "3xl": 26,
      "4xl": 34,
    },
    lineHeight: { diff: 22 },
    colors: { foreground: "#fff", syntax: {} },
  };
}

function makeInput(overrides: Partial<AppearanceInput> = {}): AppearanceInput {
  return {
    uiFontFamily: "",
    workspaceFontFamily: "",
    monoFontFamily: "",
    uiFontSize: 16,
    workspaceFontSize: 16,
    codeFontSize: 12,
    syntaxTheme: "one",
    ...overrides,
  };
}

// Run a single captured updater (default the first) against a fresh fake theme.
function runCapturedUpdater(call = 0): FakeTheme {
  const updater = updateTheme.mock.calls[call]?.[1] as unknown as ThemeUpdater;
  return updater(makeFakeTheme());
}

describe("applyAppearance", () => {
  beforeEach(() => {
    updateTheme.mockClear();
    runtime.themeName = undefined;
  });

  it("starts with one default interface font size", () => {
    expect(darkTheme.fontSize).toEqual({
      xs: 16,
      code: 12,
      sm: 16,
      base: 16,
      lg: 16,
      xl: 16,
      "2xl": 16,
      "3xl": 16,
      "4xl": 16,
    });
  });

  it("patches every registered Unistyles theme exactly once", () => {
    applyAppearance(makeInput());

    expect(updateTheme).toHaveBeenCalledTimes(ALL_THEME_KEYS.length);
    expect(updateTheme.mock.calls.map((call) => call[0])).toEqual([...ALL_THEME_KEYS]);
  });

  it("patches the active theme before inactive registry entries", () => {
    runtime.themeName = "darkPureBlack";

    applyAppearance(makeInput({ uiFontSize: 17 }));

    expect(updateTheme.mock.calls.map((call) => call[0])).toEqual([
      "darkPureBlack",
      ...ALL_THEME_KEYS.filter((key) => key !== "darkPureBlack"),
    ]);
  });

  it("resolves an empty UI font family to the default stack", () => {
    applyAppearance(makeInput({ uiFontFamily: "" }));

    expect(runCapturedUpdater().fontFamily.ui).toBe(DEFAULT_UI_FONT_STACK);
  });

  it("passes a non-empty UI font family through trimmed", () => {
    applyAppearance(makeInput({ uiFontFamily: "  Menlo  " }));

    expect(runCapturedUpdater().fontFamily.ui).toBe("Menlo");
  });

  it("patches UI, workspace, and code typography independently", () => {
    applyAppearance(
      makeInput({
        uiFontFamily: "Interface",
        workspaceFontFamily: "Workspace",
        monoFontFamily: "Code",
        uiFontSize: 14,
        workspaceFontSize: 18,
        codeFontSize: 10,
      }),
    );

    const patched = runCapturedUpdater();
    expect(patched.fontFamily).toEqual({
      ui: "Interface",
      workspace: "Workspace",
      mono: "Code",
    });
    expect(patched.fontSize.base).toBe(14);
    expect(patched.workspaceFontSize.base).toBe(18);
    expect(patched.fontSize.code).toBe(10);
  });

  it("sets every interface font-size token to the configured size", () => {
    applyAppearance(makeInput({ uiFontSize: 20 }));

    expect(runCapturedUpdater().fontSize).toEqual({
      xs: 20,
      code: 12,
      sm: 20,
      base: 20,
      lg: 20,
      xl: 20,
      "2xl": 20,
      "3xl": 20,
      "4xl": 20,
    });
  });

  it("derives the interface size from the setting, not the live theme", () => {
    applyAppearance(makeInput({ uiFontSize: 14 }));

    // Simulate a theme already patched by a prior apply. The updater must ignore it.
    const updater = updateTheme.mock.calls[0]?.[1] as unknown as ThemeUpdater;
    const alreadyScaled = makeFakeTheme();
    alreadyScaled.fontSize = {
      xs: 4,
      code: 4,
      sm: 4,
      base: 4,
      lg: 4,
      xl: 4,
      "2xl": 4,
      "3xl": 4,
      "4xl": 4,
    };

    const { fontSize } = updater(alreadyScaled);
    expect(fontSize.base).toBe(14);
    expect(fontSize.lg).toBe(14);
  });

  it("derives the workspace ramp from canonical sizes without compounding", () => {
    applyAppearance(makeInput({ workspaceFontSize: 18 }));

    const updater = updateTheme.mock.calls[0]?.[1] as unknown as ThemeUpdater;
    const alreadyScaled = makeFakeTheme();
    alreadyScaled.workspaceFontSize = {
      xs: 4,
      sm: 4,
      base: 4,
      lg: 4,
      xl: 4,
      "2xl": 4,
      "3xl": 4,
      "4xl": 4,
    };

    const { workspaceFontSize } = updater(alreadyScaled);
    expect(workspaceFontSize.base).toBe(18);
    expect(workspaceFontSize.lg).toBe(20);
  });

  it("leaves the interface size unchanged when only the code size changes", () => {
    applyAppearance(makeInput({ uiFontSize: 16, codeFontSize: 10 }));

    const { fontSize } = runCapturedUpdater();
    expect(fontSize.base).toBe(16);
    expect(fontSize.sm).toBe(16);
    expect(fontSize.code).toBe(10);
  });

  it("sets fontSize.code to codeFontSize regardless of the UI font size", () => {
    applyAppearance(makeInput({ uiFontSize: 14, codeFontSize: 18 }));

    expect(runCapturedUpdater().fontSize.code).toBe(18);
  });

  it("couples lineHeight.diff to the code font size", () => {
    applyAppearance(makeInput({ codeFontSize: 18 }));

    expect(runCapturedUpdater().lineHeight.diff).toBe(Math.round(18 * 1.5)); // 27
  });

  it("swaps colors.syntax to the resolved palette for the named theme", () => {
    applyAppearance(makeInput({ syntaxTheme: "dracula" }));

    const { colors } = runCapturedUpdater();
    expect(colors.syntax).toEqual(resolveSyntaxColors("dracula", "dark"));
  });

  it("resolves a syntax theme using the theme's own color scheme", () => {
    applyAppearance(makeInput({ syntaxTheme: "github" }));

    // makeFakeTheme().colorScheme === "dark" -> github resolves to the dark palette.
    expect(runCapturedUpdater().colors.syntax).toEqual(darkHighlightColors);
    expect(runCapturedUpdater().colors.syntax).toEqual(resolveSyntaxColors("github", "dark"));
  });
});
