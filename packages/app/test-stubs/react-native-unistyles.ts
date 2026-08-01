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
    popover: "#f4f4f5",
    border: "#e4e4e7",
    borderAccent: "#ececf1",
    syntax: {
      keyword: "#7c3aed",
      comment: "#666666",
      string: "#15803d",
      number: "#b45309",
      literal: "#b45309",
      function: "#1d4ed8",
      definition: "#1d4ed8",
      class: "#7c3aed",
      type: "#7c3aed",
      tag: "#b91c1c",
      attribute: "#b45309",
      property: "#1d4ed8",
      variable: "#111111",
      operator: "#111111",
      punctuation: "#666666",
      regexp: "#15803d",
      escape: "#b45309",
      meta: "#666666",
      heading: "#1d4ed8",
      link: "#1d4ed8",
    },
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
  workspaceFontSize: {
    sm: 14,
  },
  fontFamily: {
    ui: "Arial, sans-serif",
    workspace: "Arial, sans-serif",
    mono: "monospace",
  },
  lineHeight: {
    diff: 22,
  },
  fontWeight: {
    normal: "400",
    medium: "500",
  },
  borderRadius: {
    base: 4,
    md: 6,
    xl: 8,
  },
  borderWidth: {
    1: 1,
  },
  opacity: {
    0: 0,
    50: 0.5,
    100: 1,
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
