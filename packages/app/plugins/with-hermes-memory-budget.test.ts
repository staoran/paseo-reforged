import { describe, expect, it } from "vitest";

const { configureHermesMemoryBudget } = require("./with-hermes-memory-budget");

const appBuildGradle = "react {\n    autolinkLibrariesWithApp()\n}\n";

describe("withHermesMemoryBudget", () => {
  it("keeps Metro source maps enabled for local release builds", () => {
    const configured = configureHermesMemoryBudget(appBuildGradle, false);

    expect(configured).toContain('hermesFlags = ["-O"]');
    expect(configured).not.toContain("extraPackagerArgs");
  });

  it("overrides Metro source map output for remote release builds", () => {
    const configured = configureHermesMemoryBudget(appBuildGradle, true);

    expect(configured).toContain('extraPackagerArgs = ["--sourcemap-output", ""]');
  });

  it("replaces its existing block when the source map policy changes", () => {
    const local = configureHermesMemoryBudget(appBuildGradle, false);
    const remote = configureHermesMemoryBudget(local, true);

    expect(remote.match(/@paseo-hermes-memory-budget/g)).toHaveLength(1);
    expect(remote).toContain('extraPackagerArgs = ["--sourcemap-output", ""]');
  });
});
