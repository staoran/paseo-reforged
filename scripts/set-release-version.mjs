import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeNextAvailableBetaVersion,
  computeNextReleaseVersion,
  parseReleaseVersion,
} from "./release-version-utils.mjs";

const modulePath = fileURLToPath(import.meta.url);
const __dirname = path.dirname(modulePath);
const rootDir = path.resolve(__dirname, "..");
const rootPackagePath = path.join(rootDir, "package.json");

export function resolveNpmInvocation(
  args,
  { execPath = process.execPath, npmExecPath = process.env.npm_execpath } = {},
) {
  if (npmExecPath) {
    return { command: execPath, args: [npmExecPath, ...args] };
  }
  return { command: "npm", args };
}

export function assertReleaseModeEnabled(mode) {
  if (["patch", "minor", "major", "promote"].includes(mode)) {
    throw new Error(
      `Stable release mode ${mode} is blocked until signing and deployment gates are enabled.`,
    );
  }
}

function listOccupiedBetaVersions(currentVersion) {
  const baseVersion = parseReleaseVersion(currentVersion).baseVersion;
  const tagPattern = `v${baseVersion}-beta.*`;
  const tags = execFileSync("git", ["tag", "--list", tagPattern], {
    cwd: rootDir,
    encoding: "utf8",
  });
  const exactTagPattern = new RegExp(`^v${baseVersion.replaceAll(".", "\\.")}-beta\\.\\d+$`);

  return tags
    .split(/\r?\n/)
    .map((tag) => tag.trim())
    .filter((tag) => exactTagPattern.test(tag))
    .map((tag) => tag.slice(1));
}

function usageAndExit(code = 1) {
  process.stderr.write(`Usage: node scripts/set-release-version.mjs --mode <mode> [--print]\n`);
  process.stderr.write(
    "Modes: patch, minor, major, beta-patch, beta-minor, beta-major, beta-next, promote\n",
  );
  process.exit(code);
}

function parseArgs(argv) {
  const args = {
    mode: "",
    print: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mode") {
      args.mode = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--print") {
      args.print = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      usageAndExit(0);
    }
    usageAndExit();
  }

  if (!args.mode) {
    usageAndExit();
  }

  return args;
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const rootPackage = JSON.parse(readFileSync(rootPackagePath, "utf8"));
  const currentVersion = typeof rootPackage.version === "string" ? rootPackage.version.trim() : "";

  if (!currentVersion) {
    throw new Error('Root package.json must contain a valid "version".');
  }

  const nextVersion =
    args.mode === "beta-next"
      ? computeNextAvailableBetaVersion(currentVersion, listOccupiedBetaVersions(currentVersion))
      : computeNextReleaseVersion(currentVersion, args.mode);

  if (args.print) {
    process.stdout.write(`${nextVersion}\n`);
    return;
  }

  assertReleaseModeEnabled(args.mode);

  const invocation = resolveNpmInvocation([
    "version",
    nextVersion,
    "--include-workspace-root",
    "--message",
    "chore(release): cut %s",
  ]);
  execFileSync(invocation.command, invocation.args, { cwd: rootDir, stdio: "inherit" });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(modulePath)) {
  main();
}
