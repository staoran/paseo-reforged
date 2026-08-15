import { UnistylesRuntime } from "react-native-unistyles";
import { resolveSyntaxColors, type SyntaxThemeId } from "@getpaseo/highlight";
import {
  DEFAULT_UI_FONT_STACK,
  DEFAULT_MONO_FONT_STACK,
  WORKSPACE_FONT_SIZE,
  REGISTERED_THEMES,
  type Theme,
} from "@/styles/theme";
import { applyRootUiFont } from "./apply-root-font";

const ALL_THEME_KEYS = Object.keys(REGISTERED_THEMES) as (keyof typeof REGISTERED_THEMES)[];

// The workspace font size at which the ramp is authored (1.0 scale factor).
const BASE_WORKSPACE_REFERENCE = WORKSPACE_FONT_SIZE.base; // 16

export interface AppearanceInput {
  uiFontFamily: string; // "" -> default stack
  workspaceFontFamily: string; // "" -> default stack
  monoFontFamily: string; // "" -> default stack
  uiFontSize: number; // already clamped
  workspaceFontSize: number; // already clamped
  codeFontSize: number; // already clamped
  syntaxTheme: SyntaxThemeId;
}

function createInterfaceFontSize(size: number): Omit<Theme["fontSize"], "code"> {
  return {
    xs: size,
    sm: size,
    base: size,
    lg: size,
    xl: size,
    "2xl": size,
    "3xl": size,
    "4xl": size,
  };
}

/** Build the workspace hierarchy from the canonical ramp without compounding. */
function scaleWorkspaceFontSize(size: number): Theme["workspaceFontSize"] {
  const r = size / BASE_WORKSPACE_REFERENCE;
  return {
    xs: Math.round(WORKSPACE_FONT_SIZE.xs * r),
    sm: Math.round(WORKSPACE_FONT_SIZE.sm * r),
    base: Math.round(WORKSPACE_FONT_SIZE.base * r),
    lg: Math.round(WORKSPACE_FONT_SIZE.lg * r),
    xl: Math.round(WORKSPACE_FONT_SIZE.xl * r),
    "2xl": Math.round(WORKSPACE_FONT_SIZE["2xl"] * r),
    "3xl": Math.round(WORKSPACE_FONT_SIZE["3xl"] * r),
    "4xl": Math.round(WORKSPACE_FONT_SIZE["4xl"] * r),
  };
}

/**
 * Patch every registered Unistyles theme with the user's appearance choices.
 * All keys in `ALL_THEME_KEYS` are patched because the active theme can change
 * and adaptive mode can flip light/dark — patching all keys keeps the active key
 * always current and makes ordering vs `setTheme`/`setAdaptiveThemes` irrelevant.
 *
 * The updater preserves the active theme wholesale (surfaces, accents,
 * terminal) and only patches the font ramp and syntax palette.
 * `updateTheme` replaces the stored theme rather than merging, so we spread
 * `...t` first.
 */
export function applyAppearance(input: AppearanceInput): void {
  const ui = input.uiFontFamily.trim() || DEFAULT_UI_FONT_STACK;
  const workspace = input.workspaceFontFamily.trim() || DEFAULT_UI_FONT_STACK;
  const mono = input.monoFontFamily.trim() || DEFAULT_MONO_FONT_STACK;
  const diffLineHeight = Math.round(input.codeFontSize * 1.5); // couple to code size
  const activeTheme = UnistylesRuntime.themeName;
  // Unistyles web emits after each registry patch. Updating the mounted theme
  // first ensures subscribers receive its new numeric tokens in this render;
  // updating it last makes Pure black appear one committed value behind.
  const themeKeys = activeTheme
    ? [activeTheme, ...ALL_THEME_KEYS.filter((key) => key !== activeTheme)]
    : ALL_THEME_KEYS;

  for (const key of themeKeys) {
    UnistylesRuntime.updateTheme(key, (t) => {
      const fontFamily = { ui, workspace, mono };
      const fontSize = {
        ...createInterfaceFontSize(input.uiFontSize),
        code: input.codeFontSize,
      };
      const workspaceFontSize = scaleWorkspaceFontSize(input.workspaceFontSize);
      const lineHeight = { ...t.lineHeight, diff: diffLineHeight };
      if (t.colorScheme === "light") {
        return {
          ...t,
          fontFamily,
          fontSize,
          workspaceFontSize,
          lineHeight,
          colors: { ...t.colors, syntax: resolveSyntaxColors(input.syntaxTheme, t.colorScheme) },
        };
      }
      return {
        ...t,
        fontFamily,
        fontSize,
        workspaceFontSize,
        lineHeight,
        colors: { ...t.colors, syntax: resolveSyntaxColors(input.syntaxTheme, t.colorScheme) },
      };
    });
  }

  // Web: apply the UI font app-wide (RN-web stamps a default font on every text
  // element, so it can't be done through the theme alone). No-op on native.
  applyRootUiFont(ui, workspace);
}
