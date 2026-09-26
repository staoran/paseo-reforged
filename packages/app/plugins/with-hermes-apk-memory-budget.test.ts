import { describe, expect, it } from "vitest";

const { configureHermesApkMemoryBudget } = require("./with-hermes-apk-memory-budget");

describe("withHermesApkMemoryBudget", () => {
  it("keeps Hermes source maps while limiting APK compilation memory", () => {
    const source = "react {\n    entryFile = file('index.js')\n}\n";
    const configured = configureHermesApkMemoryBudget(source);

    expect(configured).toContain('hermesFlags = ["-Og", "-output-source-map"]');
    expect(configureHermesApkMemoryBudget(configured)).toBe(configured);
  });

  it("fails if the React Native Gradle block cannot be found", () => {
    expect(() => configureHermesApkMemoryBudget("plugins {}\n")).toThrow(/react block/);
  });
});
