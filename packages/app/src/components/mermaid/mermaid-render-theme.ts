import type { Theme } from "@/styles/theme";

export interface MermaidRenderTheme {
  background: string;
  border: string;
  foreground: string;
  foregroundMuted: string;
  fontFamily: string;
  surface: string;
  surfaceRaised: string;
}

export function createMermaidRenderTheme(theme: Theme): MermaidRenderTheme {
  return {
    background: theme.colors.surface1,
    border: theme.colors.border,
    foreground: theme.colors.foreground,
    foregroundMuted: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.workspace,
    surface: theme.colors.surface1,
    surfaceRaised: theme.colors.surface2,
  };
}

export function createMermaidConfig(theme: MermaidRenderTheme) {
  return {
    startOnLoad: false,
    securityLevel: "strict" as const,
    suppressErrorRendering: true,
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    maxTextSize: 100_000,
    secure: [
      "flowchart",
      "htmlLabels",
      "maxTextSize",
      "securityLevel",
      "secure",
      "startOnLoad",
      "suppressErrorRendering",
      "theme",
      "themeVariables",
    ],
    theme: "base" as const,
    themeVariables: {
      background: theme.background,
      fontFamily: theme.fontFamily,
      primaryColor: theme.surfaceRaised,
      primaryTextColor: theme.foreground,
      primaryBorderColor: theme.border,
      lineColor: theme.foregroundMuted,
      secondaryColor: theme.surface,
      tertiaryColor: theme.background,
      noteBkgColor: theme.surfaceRaised,
      noteTextColor: theme.foreground,
      noteBorderColor: theme.border,
      clusterBkg: theme.surface,
      clusterBorder: theme.border,
      titleColor: theme.foreground,
      edgeLabelBackground: theme.background,
    },
  };
}
