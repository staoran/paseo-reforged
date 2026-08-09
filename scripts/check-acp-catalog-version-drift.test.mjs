import assert from "node:assert/strict";
import test from "node:test";
import { resolveNpmInvocation } from "./check-acp-catalog-version-drift.mjs";

test("runs npm through the active Node executable during npm lifecycle scripts", () => {
  assert.deepEqual(
    resolveNpmInvocation(["view", "example-package", "version"], {
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      npmExecPath: "E:\\npm-global\\node_modules\\npm\\bin\\npm-cli.js",
      platform: "win32",
      comSpec: "C:\\Windows\\System32\\cmd.exe",
    }),
    {
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: [
        "E:\\npm-global\\node_modules\\npm\\bin\\npm-cli.js",
        "view",
        "example-package",
        "version",
      ],
    },
  );
});

test("uses cmd.exe when npm is invoked directly on Windows", () => {
  assert.deepEqual(
    resolveNpmInvocation(["view", "example-package", "version"], {
      execPath: "node",
      npmExecPath: "",
      platform: "win32",
      comSpec: "C:\\Windows\\System32\\cmd.exe",
    }),
    {
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "npm", "view", "example-package", "version"],
    },
  );
});

test("invokes npm directly outside Windows", () => {
  assert.deepEqual(
    resolveNpmInvocation(["view", "example-package", "version"], {
      execPath: "node",
      npmExecPath: "",
      platform: "linux",
      comSpec: "",
    }),
    {
      command: "npm",
      args: ["view", "example-package", "version"],
    },
  );
});
