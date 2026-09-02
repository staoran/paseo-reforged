import { describe, expect, it } from "vitest";
import { filterDisplayableProviderUsages, isProviderUsageDisplayable } from "./display";
import type { ProviderUsage } from "./types";

function usage(overrides: Partial<ProviderUsage>): ProviderUsage {
  return {
    providerId: "mock",
    displayName: "Mock",
    status: "available",
    planLabel: null,
    windows: [],
    balances: [],
    details: [],
    error: null,
    ...overrides,
  };
}

describe("provider usage display policy", () => {
  it("only displays successful provider results", () => {
    expect(isProviderUsageDisplayable(usage({ status: "available" }))).toBe(true);
    expect(
      isProviderUsageDisplayable(usage({ status: "available", error: "partial failure" })),
    ).toBe(false);
    expect(isProviderUsageDisplayable(usage({ status: "unavailable" }))).toBe(false);
    expect(isProviderUsageDisplayable(usage({ status: "error", error: "auth expired" }))).toBe(
      false,
    );
  });

  it("returns an empty list when every provider is unavailable or failed", () => {
    expect(
      filterDisplayableProviderUsages([
        usage({ providerId: "claude", status: "unavailable" }),
        usage({ providerId: "codex", status: "error", error: "auth expired" }),
      ]),
    ).toEqual([]);
  });
});
