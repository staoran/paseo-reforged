import type { DraftAgentControlsProps } from "@/composer/agent-controls";
import type { AgentMode } from "@getpaseo/protocol/agent-types";
import type { AgentModeColorTier } from "@getpaseo/protocol/provider-manifest";

interface ModeAccentColors {
  foregroundMuted: string;
  modeAcceptEdits: string;
  modeDanger: string;
  modeModerate: string;
  modePlanning: string;
}

export function resolveModeAccentColor(
  modeId: string,
  colorTier: AgentModeColorTier | undefined,
  colors: ModeAccentColors,
): string {
  if (colorTier?.startsWith("#")) return colorTier;
  if (modeId === "acceptEdits") return colors.modeAcceptEdits;
  switch (colorTier) {
    case "dangerous":
      return colors.modeDanger;
    case "planning":
      return colors.modePlanning;
    case "moderate":
      return colors.modeModerate;
    default:
      return colors.foregroundMuted;
  }
}

export function resolveNextAgentModeId({
  modeOptions,
  selectedMode,
}: {
  modeOptions: readonly AgentMode[];
  selectedMode: string | null | undefined;
}): string | null {
  if (modeOptions.length < 2) return null;

  const selectedIndex = modeOptions.findIndex((mode) => mode.id === selectedMode);
  const currentIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const nextIndex = (currentIndex + 1) % modeOptions.length;
  return modeOptions[nextIndex]?.id ?? null;
}

export function resolveAgentControlsMode(agentControls?: DraftAgentControlsProps) {
  return agentControls ? "draft" : "ready";
}
