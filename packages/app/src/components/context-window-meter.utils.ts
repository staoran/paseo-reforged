import type { AgentUsage } from "@getpaseo/protocol/agent-types";

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${Math.round(value / 1_000_000)}m`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return Math.round(value).toString();
}

/** Formats a provider-reported session cost, hiding missing, invalid, and zero values. */
export function formatSessionCost(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  if (value < 0.01) {
    return `$${value.toFixed(4)}`;
  }
  return `$${value.toFixed(2)}`;
}

/** Formats only finite, non-negative token fields supplied by an Agent provider. */
function formatUsageTokens(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return formatTokenCount(value);
}

export interface SessionUsageDisplay {
  inputTokens: string | null;
  cachedInputTokens: string | null;
  outputTokens: string | null;
  cost: string | null;
  hasAny: boolean;
}

type SessionUsageFields = {
  [K in keyof Pick<
    AgentUsage,
    "inputTokens" | "cachedInputTokens" | "outputTokens" | "totalCostUsd"
  >]?:
    | Pick<AgentUsage, "inputTokens" | "cachedInputTokens" | "outputTokens" | "totalCostUsd">[K]
    | null;
};

/** Resolves optional usage fields into independently renderable display values. */
export function resolveSessionUsageDisplay(usage: SessionUsageFields = {}): SessionUsageDisplay {
  const inputTokens = formatUsageTokens(usage.inputTokens);
  const cachedInputTokens = formatUsageTokens(usage.cachedInputTokens);
  const outputTokens = formatUsageTokens(usage.outputTokens);
  const cost = formatSessionCost(usage.totalCostUsd);
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    cost,
    hasAny:
      inputTokens !== null || cachedInputTokens !== null || outputTokens !== null || cost !== null,
  };
}
