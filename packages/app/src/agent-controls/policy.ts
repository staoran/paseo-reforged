import type { AgentMode } from "@getpaseo/protocol/agent-types";
import type { Theme } from "@/styles/theme";

export const PLAN_MODE_FEATURE_ID = "plan_mode";
export const FAST_MODE_FEATURE_ID = "fast_mode";

/** Resolve a mode's risk signal against the active theme */
export function resolveAgentModeColor(
  modeId: string,
  colorTier: string | undefined,
  colors: Theme["colors"],
): string {
  if (colorTier?.startsWith("#") && /^#[\da-fA-F]{3}(?:[\da-fA-F]{3})?$/u.test(colorTier)) {
    return colorTier;
  }
  if (modeId === "acceptEdits") return colors.modeAcceptEdits;
  switch (colorTier) {
    case "moderate":
      return colors.modeModerate;
    case "dangerous":
      return colors.modeDanger;
    case "planning":
      return colors.modePlanning;
    default:
      return colors.foregroundMuted;
  }
}

export function isPlanningAgentMode(mode: Pick<AgentMode, "id" | "colorTier">): boolean {
  return mode.colorTier === "planning" || mode.id === "plan" || mode.id.endsWith("#plan");
}

export function resolveNonPlanningModeId(
  modes: readonly AgentMode[],
  defaultModeId: string | null,
): string | null {
  const defaultMode = modes.find((mode) => mode.id === defaultModeId);
  if (defaultMode && !isPlanningAgentMode(defaultMode)) {
    return defaultMode.id;
  }
  return modes.find((mode) => !isPlanningAgentMode(mode))?.id ?? null;
}
