import assert from "node:assert/strict";
import test from "node:test";
import { assertReleaseModeEnabled, resolveNpmInvocation } from "./set-release-version.mjs";

test("runs npm through the active Node executable when npm_execpath is available", () => {
  assert.deepEqual(
    resolveNpmInvocation(["version", "0.2.0-beta.2"], {
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      npmExecPath: "E:\\npm-global\\node_modules\\npm\\bin\\npm-cli.js",
    }),
    {
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: ["E:\\npm-global\\node_modules\\npm\\bin\\npm-cli.js", "version", "0.2.0-beta.2"],
    },
  );
});

test("falls back to npm outside an npm lifecycle", () => {
  assert.deepEqual(
    resolveNpmInvocation(["version", "0.2.0-beta.2"], {
      execPath: "node",
      npmExecPath: "",
    }),
    {
      command: "npm",
      args: ["version", "0.2.0-beta.2"],
    },
  );
});

test("blocks stable release mutations while allowing beta modes", () => {
  assert.doesNotThrow(() => assertReleaseModeEnabled("beta-next"));
  assert.doesNotThrow(() => assertReleaseModeEnabled("beta-patch"));
  for (const mode of ["patch", "minor", "major", "promote"]) {
    assert.throws(() => assertReleaseModeEnabled(mode), /Stable release mode/);
  }
});
