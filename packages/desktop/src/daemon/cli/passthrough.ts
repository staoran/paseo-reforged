import { pathToFileURL } from "node:url";
import { resolvePassthroughCliEntrypoint } from "./entrypoints.js";

/** Signal from the packaged CLI shim, including launches without arguments */
const DESKTOP_CLI_ENV = "PASEO_DESKTOP_CLI";
/** Electron and platform switches unrelated to CLI requests */
const IGNORED_ARG_PREFIXES = ["-psn_", "--class=", "--no-sandbox", "--remote-debugging-port="];

export type PassthroughCliRunner = (argv: string[]) => Promise<number>;

/** Returns CLI arguments or null when Electron should start the GUI */
export function parsePassthroughCliArgs(input: {
  argv: string[];
  isDefaultApp: boolean;
  forceCli: boolean;
}): string[] | null {
  const startIndex = input.isDefaultApp ? 2 : 1;
  const effective: string[] = [];

  for (const arg of input.argv.slice(startIndex)) {
    // NSIS relaunches the GUI with this exact argument after an update
    if (
      (!input.forceCli && arg === "--updated") ||
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

/** Reads Electron's launch mode and the packaged CLI shim signal */
export function parsePassthroughCliArgsFromArgv(argv: string[]): string[] | null {
  return parsePassthroughCliArgs({
    argv,
    isDefaultApp: process.defaultApp,
    forceCli: process.env[DESKTOP_CLI_ENV] === "1",
  });
}

/** Loads the CLI entrypoint only after a launch is classified as CLI */
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

/** Runs a classified CLI launch through its programmatic entrypoint */
export async function runPassthroughCli(
  args: string[],
  options: { runCli?: PassthroughCliRunner } = {},
): Promise<number> {
  const runCli = options.runCli ?? (await importPassthroughCliRunner());
  return await runCli(args);
}
