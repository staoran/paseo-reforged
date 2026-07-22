import assert from "node:assert/strict";
import test from "node:test";
import { getReleaseVersionFiles } from "./stage-release-version-files.mjs";

test("stages only root and workspace version manifests", () => {
  const files = getReleaseVersionFiles(
    {
      workspaces: ["packages/app", "packages/server", "packages/missing"],
    },
    (file) => !file.includes("missing"),
  );

  assert.deepEqual(files, [
    "package.json",
    "package-lock.json",
    "packages/app/package.json",
    "packages/server/package.json",
  ]);
  assert.equal(
    files.some((file) => file.startsWith("mydocs/")),
    false,
  );
  assert.equal(
    files.some((file) => file.endsWith(".ts")),
    false,
  );
});
