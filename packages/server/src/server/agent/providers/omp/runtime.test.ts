import { expect, test } from "vitest";

import { buildOmpLaunch } from "./runtime.js";
import { OmpHarness } from "./test-utils/omp-harness.js";

test("rejects disabling extensions when the same-session edit bridge is required", () => {
  expect(() =>
    buildOmpLaunch({
      command: ["omp", "--no-extensions"],
      session: {
        cwd: "/workspace/project",
        extensionPaths: ["/tmp/paseo-integration.mjs"],
      },
    }),
  ).toThrow("OMP extensions cannot be disabled when the Paseo edit bridge is required");
});

test("falls back to progress when the event subscription is unavailable", async () => {
  const omp = new OmpHarness();
  omp.failEventSubscription(new Error("events unsupported"));
  await omp.start();

  await expect(omp.waitForSubscriptionFallback()).resolves.toEqual(["events", "progress"]);
});
