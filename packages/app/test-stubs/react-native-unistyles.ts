import { createElement, type ComponentType } from "react";

const testTheme = {
  colorScheme: "light",
  colors: {
    foreground: "#111111",
    foregroundMuted: "#666666",
    statusSuccess: "#15803d",
    statusDanger: "#b91c1c",
    statusWarning: "#d97706",
    statusMerged: "#7c3aed",
    surface1: "#fafafa",
    surface2: "#f4f4f5",
    border: "#e4e4e7",
    palette: {
      amber: { 500: "#f59e0b", 700: "#b45309" },
      blue: { 500: "#3b82f6" },
      green: { 500: "#22c55e" },
      purple: { 500: "#a855f7" },
      red: { 500: "#ef4444" },
    },
  },
  spacing: [0, 4, 8, 12, 16, 20, 24, 28, 32],
  fontSize: {
    xs: 12,
    sm: 14,
  },
  fontFamily: {
    ui: "Arial, sans-serif",
    workspace: "Arial, sans-serif",
    mono: "monospace",
  },
  fontWeight: {
    normal: "400",
    medium: "500",
  },
  borderRadius: {
    base: 4,
    md: 6,
  },
  iconSize: {
    sm: 12,
    md: 16,
  },
  shadow: {
    md: {},
  },
};

type StyleFactory<T> = (theme: typeof testTheme) => T;

function isStyleFactory<T>(styles: T | StyleFactory<T>): styles is StyleFactory<T> {
  return typeof styles === "function";
}

export const StyleSheet = {
  create: <T>(styles: T | StyleFactory<T>): T =>
    isStyleFactory(styles) ? styles(testTheme) : styles,
};

export function withUnistyles<Props extends object>(
  Component: ComponentType<Props>,
  mapThemeToProps?: (theme: typeof testTheme) => Partial<Props>,
): ComponentType<Props> {
  if (!mapThemeToProps) return Component;

  return function TestThemedComponent(props: Props) {
    return createElement(Component, { ...props, ...mapThemeToProps(testTheme) });
  };
}

export const useUnistyles = () => ({
  theme: testTheme,
  rt: {},
  breakpoint: undefined,
});

export const UnistylesRuntime = {
  setTheme: () => undefined,
  themeName: "light",
};
