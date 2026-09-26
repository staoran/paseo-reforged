import type { EditorTarget } from "../target.js";

/** Open a local workspace directory in Windows Terminal */
export const windowsTerminalTarget: EditorTarget = {
  id: "windows-terminal",
  async describe(runtime) {
    return {
      id: this.id,
      label: "Windows Terminal",
      kind: "terminal",
      icon: await runtime.loadIcon("windows-terminal.png"),
    };
  },
  async isInstalled(runtime) {
    return runtime.platform === "win32" && runtime.resolveCommand(["wt.exe"]) !== null;
  },
  async launch(input, runtime) {
    if (input.filePath) {
      throw new Error("Windows Terminal opens directories, not files");
    }
    const command = runtime.resolveCommand(["wt.exe"]);
    if (!command) throw new Error("Windows Terminal is not installed");
    await runtime.spawnDetached({ command, args: ["-d", input.workspacePath] });
  },
};
