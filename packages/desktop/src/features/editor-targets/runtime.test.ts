import type { SpawnOptions } from "node:child_process";
import { describe, expect, it } from "vitest";

import { createEditorTargetRuntime } from "./runtime.js";

interface SpawnRecord {
  command: string;
  args: string[];
  options: SpawnOptions;
  unrefed: boolean;
}

describe("editor target runtime", () => {
  it("resolves accessible Windows application aliases when stat lookup is denied", () => {
    /** WindowsApps alias exposed through the user's PATH. */
    const aliasPath = "C:/Users/test/AppData/Local/Microsoft/WindowsApps/wt.exe";
    const runtime = createEditorTargetRuntime({
      platform: "win32",
      env: { PATH: "C:/Users/test/AppData/Local/Microsoft/WindowsApps" },
      pathExists: () => false,
      pathAccessible: (targetPath) => targetPath === aliasPath,
    });

    expect(runtime.resolveCommand(["wt"])).toBe(aliasPath);
  });

  it("does not use the alias fallback for ordinary Windows PATH entries", () => {
    /** Ordinary executable outside the WindowsApps alias directory. */
    const ordinaryPath = "C:/Tools/Editors/code.exe";
    const runtime = createEditorTargetRuntime({
      platform: "win32",
      env: { PATH: "C:/Tools/Editors" },
      pathExists: () => false,
      pathAccessible: (targetPath) => targetPath === ordinaryPath,
    });

    expect(runtime.resolveCommand(["code"])).toBeNull();
  });

  it("resolves command aliases and safely launches Windows command scripts", async () => {
    const records: SpawnRecord[] = [];
    const runtime = createEditorTargetRuntime({
      platform: "win32",
      env: {
        PATH: "C:/Program Files/Editors & Tools/bin",
        ELECTRON_RUN_AS_NODE: "1",
      },
      pathExists: (targetPath) => targetPath === "C:/Program Files/Editors & Tools/bin/code.cmd",
      spawn: (command, args, options) => {
        const record = { command, args, options, unrefed: false };
        records.push(record);
        const child = {
          once(event: "error" | "spawn", handler: (error?: Error) => void) {
            if (event === "spawn") queueMicrotask(() => handler());
            return child;
          },
          unref() {
            record.unrefed = true;
          },
        };
        return child;
      },
    });

    const command = runtime.resolveCommand(["missing", "code"]);
    if (!command) throw new Error("Expected the editor command to resolve");
    await runtime.spawnDetached({
      command,
      args: ["C:/repo & workspace", "C:/repo/src/file & calculator.ts"],
    });

    expect(records).toEqual([
      {
        command: '"C:/Program Files/Editors & Tools/bin/code.cmd"',
        args: ['"C:/repo & workspace"', '"C:/repo/src/file & calculator.ts"'],
        options: {
          detached: true,
          env: { PATH: "C:/Program Files/Editors & Tools/bin" },
          shell: true,
          stdio: "ignore",
        },
        unrefed: true,
      },
    ]);
  });
});
