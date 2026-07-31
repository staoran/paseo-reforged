import { useMemo } from "react";
import type { MermaidRenderTheme } from "@/components/mermaid/mermaid-render-theme";

export function useStableMermaidRenderTheme(theme: MermaidRenderTheme): MermaidRenderTheme {
  const { background, border, foreground, foregroundMuted, fontFamily, surface, surfaceRaised } =
    theme;

  return useMemo(
    () => ({
      background,
      border,
      foreground,
      foregroundMuted,
      fontFamily,
      surface,
      surfaceRaised,
    }),
    [background, border, foreground, foregroundMuted, fontFamily, surface, surfaceRaised],
  );
}
