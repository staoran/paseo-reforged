import { pathToFileURL } from "node:url";
import { resolvePassthroughCliEntrypoint } from "./entrypoints.js";

/** Environment flag set by the packaged CLI shim to force CLI mode. */
const DESKTOP_CLI_ENV = "PASEO_DESKTOP_CLI";

/** Exact packaging arguments that still represent a GUI launch. */
const IGNORED_GUI_ARGS = new Set(["--updated"]);

/** Argument prefixes injected by platform and Electron wrappers. */
const IGNORED_ARG_PREFIXES = ["-psn_", "--class=", "--no-sandbox", "--remote-debugging-port="];

export type PassthroughCliRunner = (argv: string[]) => Promise<number>;

/** Selects CLI arguments from an Electron launch, or null for a GUI launch. */
export function parsePassthroughCliArgs(input: {
  argv: string[];
  isDefaultApp: boolean;
  forceCli: boolean;
}): string[] | null {
  const startIndex = input.isDefaultApp ? 2 : 1;
  const effective: string[] = [];

  for (const arg of input.argv.slice(startIndex)) {
    if (
      (!input.forceCli && IGNORED_GUI_ARGS.has(arg)) ||
      IGNORED_ARG_PREFIXES.some((prefix) => arg.startsWith(prefix))
    ) {
      continue;
    }
    effective.push(arg);
  }

  if (input.forceCli) {
    return effective;
  }

  return effective.length > 0 ? effective : null;
}

/** Parses the current Electron process arguments using its launch mode. */
export function parsePassthroughCliArgsFromArgv(argv: string[]): string[] | null {
  return parsePassthroughCliArgs({
    argv,
    isDefaultApp: process.defaultApp,
    forceCli: process.env[DESKTOP_CLI_ENV] === "1",
  });
}

/** Loads the packaged CLI runner only after a launch is classified as CLI. */
async function importPassthroughCliRunner(): Promise<PassthroughCliRunner> {
  const entrypoint = resolvePassthroughCliEntrypoint();
  const imported = (await import(pathToFileURL(entrypoint).href)) as {
    runCli?: unknown;
  };
  if (typeof imported.runCli !== "function") {
    throw new Error(`Passthrough CLI entrypoint did not export runCli: ${entrypoint}`);
  }
  return imported.runCli as PassthroughCliRunner;
}

/** Executes a classified passthrough CLI launch through its programmatic entrypoint. */
export async function runPassthroughCli(
  args: string[],
  options: { runCli?: PassthroughCliRunner } = {},
): Promise<number> {
  const runCli = options.runCli ?? (await importPassthroughCliRunner());
  return await runCli(args);
}
