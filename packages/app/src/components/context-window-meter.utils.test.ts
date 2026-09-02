import { describe, expect, it } from "vitest";
import { formatSessionCost, resolveSessionUsageDisplay } from "./context-window-meter.utils";

describe("resolveSessionUsageDisplay", () => {
  it("keeps each valid token field and cost independently visible", () => {
    expect(
      resolveSessionUsageDisplay({
        inputTokens: 12_345,
        cachedInputTokens: 678,
        outputTokens: 90,
        totalCostUsd: 0.0042,
      }),
    ).toEqual({
      inputTokens: "12k",
      cachedInputTokens: "678",
      outputTokens: "90",
      cost: "$0.0042",
      hasAny: true,
    });
  });

  it("hides missing and invalid fields instead of inventing values", () => {
    expect(
      resolveSessionUsageDisplay({
        inputTokens: Number.NaN,
        cachedInputTokens: -1,
        outputTokens: undefined,
        totalCostUsd: 0,
      }),
    ).toEqual({
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      cost: null,
      hasAny: false,
    });
  });
});

describe("formatSessionCost", () => {
  it("uses more precision for sub-cent costs", () => {
    expect(formatSessionCost(0.0001)).toBe("$0.0001");
    expect(formatSessionCost(1.234)).toBe("$1.23");
  });

  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -1, 0])(
    "hides unsupported cost %s",
    (value) => {
      expect(formatSessionCost(value)).toBeNull();
    },
  );
});
