import type { EditorTarget } from "../target.js";

/** Windows Terminal's command-line launcher name. */
const COMMANDS = ["wt"] as const;

/** Opens the selected workspace in the installed Windows Terminal application. */
export const terminalTarget: EditorTarget = {
  id: "terminal",

  /** Returns the menu descriptor and bundled Windows Terminal icon. */
  async describe(runtime) {
    return {
      id: this.id,
      label: "Terminal",
      kind: "editor",
      icon: await runtime.loadIcon("windows-terminal.png"),
    };
  },

  /** Shows the target only when the Windows Terminal launcher is available on Windows. */
  async isInstalled(runtime) {
    return runtime.platform === "win32" && runtime.resolveCommand(COMMANDS) !== null;
  },

  /** Starts Windows Terminal with the workspace as its initial directory. */
  async launch(input, runtime) {
    const command = runtime.resolveCommand(COMMANDS);
    if (!command) throw new Error("Windows Terminal is not installed");
    await runtime.spawnDetached({ command, args: ["-d", input.workspacePath] });
  },
};
