import { describe, expect, it } from "vitest";
import type { AgentMode } from "@getpaseo/protocol/agent-types";
import {
  darkClaudeTheme,
  darkGhosttyTheme,
  darkMidnightTheme,
  darkTheme,
  darkZincTheme,
  lightTheme,
} from "@/styles/theme";
import { resolveAgentControlsMode, resolveModeAccentColor, resolveNextAgentModeId } from "./mode";

const PLAN_MODE = { id: "plan", label: "Plan" } satisfies AgentMode;

const MODES = [
  PLAN_MODE,
  { id: "build", label: "Build" },
  { id: "full-access", label: "Full Access" },
] satisfies AgentMode[];

const MODE_ACCENT_COLORS = {
  foregroundMuted: "#71717a",
  modeDanger: "#b91c1c",
  modeModerate: "#b45309",
  modeAcceptEdits: "#7c3aed",
  modePlanning: "#0e7490",
};

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

describe("resolveAgentControlsMode", () => {
  it("uses ready mode when no controlled agent controls are provided", () => {
    expect(resolveAgentControlsMode(undefined)).toBe("ready");
  });

  it("uses draft mode when controlled agent controls are provided", () => {
    expect(
      resolveAgentControlsMode({
        providerDefinitions: [],
        selectedProvider: "codex",
        modeOptions: [],
        selectedMode: "",
        onSelectMode: () => undefined,
        models: [],
        selectedModel: "",
        onSelectModel: () => undefined,
        isModelLoading: false,
        modelSelectorProviders: [],
        isAllModelsLoading: false,
        onSelectProviderAndModel: () => undefined,
        thinkingOptions: [],
        selectedThinkingOptionId: "",
        onSelectThinkingOption: () => undefined,
        onApplyAgentProfile: () => undefined,
      }),
    ).toBe("draft");
  });
});

describe("resolveNextAgentModeId", () => {
  it("cycles from the selected mode to the next mode", () => {
    expect(resolveNextAgentModeId({ modeOptions: MODES, selectedMode: "build" })).toBe(
      "full-access",
    );
  });

  it("wraps from the last mode to the first mode", () => {
    expect(resolveNextAgentModeId({ modeOptions: MODES, selectedMode: "full-access" })).toBe(
      "plan",
    );
  });

  it("treats an empty selection as the visible first mode", () => {
    expect(resolveNextAgentModeId({ modeOptions: MODES, selectedMode: "" })).toBe("build");
  });

  it("treats a stale selection as the visible first mode", () => {
    expect(resolveNextAgentModeId({ modeOptions: MODES, selectedMode: "deleted-mode" })).toBe(
      "build",
    );
  });

  it("returns null when there are fewer than two modes", () => {
    expect(resolveNextAgentModeId({ modeOptions: [], selectedMode: "" })).toBeNull();
    expect(resolveNextAgentModeId({ modeOptions: [PLAN_MODE], selectedMode: "plan" })).toBeNull();
  });
});

describe("resolveModeAccentColor", () => {
  it("projects mode risk tiers to their visible colors", () => {
    expect({
      safe: resolveModeAccentColor("default", "safe", MODE_ACCENT_COLORS),
      planning: resolveModeAccentColor("plan", "planning", MODE_ACCENT_COLORS),
      dangerous: resolveModeAccentColor("bypass", "dangerous", MODE_ACCENT_COLORS),
      custom: resolveModeAccentColor("custom", "#123abc", MODE_ACCENT_COLORS),
      customAcceptEdits: resolveModeAccentColor("acceptEdits", "#123abc", MODE_ACCENT_COLORS),
    }).toEqual({
      safe: "#71717a",
      planning: "#0e7490",
      dangerous: "#b91c1c",
      custom: "#123abc",
      customAcceptEdits: "#123abc",
    });
  });

  it("projects the remaining built-in modes and keeps unknown modes muted", () => {
    expect({
      moderate: resolveModeAccentColor("auto", "moderate", MODE_ACCENT_COLORS),
      acceptEdits: resolveModeAccentColor("acceptEdits", "safe", MODE_ACCENT_COLORS),
      unknown: resolveModeAccentColor("unknown", undefined, MODE_ACCENT_COLORS),
    }).toEqual({
      moderate: "#b45309",
      acceptEdits: "#7c3aed",
      unknown: "#71717a",
    });
  });

  it("keeps built-in risk accents readable on mode control surfaces", () => {
    for (const theme of [
      lightTheme,
      darkTheme,
      darkZincTheme,
      darkMidnightTheme,
      darkClaudeTheme,
      darkGhosttyTheme,
    ]) {
      const accents = [
        resolveModeAccentColor("auto", "moderate", theme.colors),
        resolveModeAccentColor("plan", "planning", theme.colors),
        resolveModeAccentColor("bypass", "dangerous", theme.colors),
        resolveModeAccentColor("acceptEdits", "moderate", theme.colors),
      ];
      const surfaces = [theme.colors.surface0, theme.colors.surface1, theme.colors.surface2];

      for (const accent of accents) {
        for (const surface of surfaces) {
          expect(contrastRatio(accent, surface)).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});
