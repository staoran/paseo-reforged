import assert from "node:assert/strict";
import test from "node:test";
import { resolveNpmInvocation } from "./build-daemon-web-ui.mjs";

test("uses the active npm CLI without a shell when npm_execpath is available", () => {
  assert.deepEqual(
    resolveNpmInvocation(["run", "build:web"], {
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      npmExecPath: "E:\\npm-global\\node_modules\\npm\\bin\\npm-cli.js",
    }),
    {
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: ["E:\\npm-global\\node_modules\\npm\\bin\\npm-cli.js", "run", "build:web"],
    },
  );
});

test("falls back to npm when the script is not running under npm", () => {
  assert.deepEqual(
    resolveNpmInvocation(["run", "build:web"], {
      execPath: "node",
      npmExecPath: "",
    }),
    {
      command: "npm",
      args: ["run", "build:web"],
    },
  );
});
