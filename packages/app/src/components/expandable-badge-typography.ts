import type { Theme } from "@/styles/theme";

type ExpandableBadgeTypographyTheme = Pick<
  Theme,
  "fontFamily" | "fontWeight" | "workspaceFontSize"
>;

interface ExpandableBadgeTextStyle {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  fontWeight: Theme["fontWeight"]["normal"];
}

/**
 * Builds the shared typography used by expandable badge titles and summaries
 */
export function createExpandableBadgeTextStyle(
  theme: ExpandableBadgeTypographyTheme,
): ExpandableBadgeTextStyle {
  return {
    fontFamily: theme.fontFamily.workspace,
    fontSize: theme.workspaceFontSize.base,
    lineHeight: Math.round(theme.workspaceFontSize.base * 1.4),
    fontWeight: theme.fontWeight.normal,
  };
}
