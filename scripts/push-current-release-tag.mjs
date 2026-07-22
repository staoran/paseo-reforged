import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(import.meta.url);
const __dirname = path.dirname(modulePath);
const rootDir = path.resolve(__dirname, "..");
const rootPackagePath = path.join(rootDir, "package.json");
export const EXPECTED_ORIGIN_URL = "https://github.com/staoran/paseo-reforged.git";
export const EXPECTED_RELEASE_BRANCH = "main";

export function assertExpectedOriginUrls(originUrls, kind) {
  const urls = originUrls.map((url) => url.trim()).filter(Boolean);
  if (urls.length !== 1 || urls[0] !== EXPECTED_ORIGIN_URL) {
    throw new Error(
      `Refusing to release with origin ${kind} URLs ${urls.join(", ") || "<none>"}; ` +
        `expected only ${EXPECTED_ORIGIN_URL}`,
    );
  }
}

export function assertExpectedReleaseBranch(branch) {
  if (branch !== EXPECTED_RELEASE_BRANCH) {
    throw new Error(
      `Refusing to release branch ${branch || "<detached>"}; expected ${EXPECTED_RELEASE_BRANCH}`,
    );
  }
}

export function assertRemoteTagCompatible(tag, remoteTagCommit, localTagCommit) {
  if (remoteTagCommit && remoteTagCommit !== localTagCommit) {
    throw new Error(
      `Remote tag ${tag} points to ${remoteTagCommit}, but local tag points to ${localTagCommit}. ` +
        "Refusing to reuse an existing release tag for a different commit.",
    );
  }
}

export function parseRemoteTagCommit(output, tag) {
  const refs = new Map(
    output
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/, 2))
      .filter((entry) => entry.length === 2)
      .map(([commit, ref]) => [ref, commit]),
  );
  return refs.get(`refs/tags/${tag}^{}`) ?? refs.get(`refs/tags/${tag}`) ?? "";
}

export function buildAtomicReleasePushArgs(branch, tag, remoteTagExists = false) {
  const refs = [`HEAD:refs/heads/${branch}`];
  if (!remoteTagExists) {
    refs.push(`refs/tags/${tag}:refs/tags/${tag}`);
  }
  return ["push", "--atomic", "origin", ...refs];
}

function usageAndExit(code = 0) {
  process.stderr.write(`Usage: node scripts/push-current-release-tag.mjs [--branch <name>]\n`);
  process.exit(code);
}

function run(cmd, args) {
  execFileSync(cmd, args, { cwd: rootDir, stdio: "inherit" });
}

function runQuiet(cmd, args) {
  return execFileSync(cmd, args, { cwd: rootDir, encoding: "utf8" }).trim();
}

export function getRemoteTagCommit(tag, runGit = runQuiet) {
  return parseRemoteTagCommit(
    runGit("git", ["ls-remote", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`]),
    tag,
  );
}

function getOriginUrls(push) {
  const args = ["remote", "get-url", ...(push ? ["--push"] : []), "--all", "origin"];
  return runQuiet("git", args).split(/\r?\n/);
}

function parseArgs(argv) {
  const args = {
    branch: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--branch") {
      args.branch = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      usageAndExit(0);
    }
    usageAndExit(1);
  }

  return args;
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  assertExpectedOriginUrls(getOriginUrls(false), "fetch");
  assertExpectedOriginUrls(getOriginUrls(true), "push");

  const rootPackage = JSON.parse(readFileSync(rootPackagePath, "utf8"));
  const version = typeof rootPackage.version === "string" ? rootPackage.version.trim() : "";
  if (!version) {
    throw new Error('Root package.json must contain a valid "version"');
  }

  const tag = `v${version}`;
  const headCommit = runQuiet("git", ["rev-parse", "HEAD"]);

  const currentBranch = runQuiet("git", ["branch", "--show-current"]);
  assertExpectedReleaseBranch(currentBranch);
  const branchRef = args.branch || currentBranch;
  if (!branchRef) {
    throw new Error("Cannot determine branch to push. Pass --branch <name>.");
  }
  assertExpectedReleaseBranch(branchRef);

  let localTagCommit = "";
  try {
    localTagCommit = runQuiet("git", ["rev-list", "-n", "1", tag]);
  } catch {
    localTagCommit = "";
  }

  if (localTagCommit && localTagCommit !== headCommit) {
    throw new Error(
      `Local tag ${tag} points to ${localTagCommit}, but HEAD is ${headCommit}. ` +
        "Create a new release commit before pushing this tag.",
    );
  }

  const remoteTagCommit = getRemoteTagCommit(tag);
  assertRemoteTagCompatible(tag, remoteTagCommit, localTagCommit || headCommit);

  if (!localTagCommit) {
    run("git", ["tag", "-a", tag, "-m", tag]);
    localTagCommit = runQuiet("git", ["rev-list", "-n", "1", tag]);
    if (localTagCommit !== headCommit) {
      throw new Error(`Created local tag ${tag} does not point to HEAD ${headCommit}.`);
    }
  }

  run("git", buildAtomicReleasePushArgs(branchRef, tag, Boolean(remoteTagCommit)));

  console.log(
    remoteTagCommit
      ? `Release push complete: branch HEAD updated; tag ${tag} already exists on origin`
      : `Release push complete: branch HEAD and tag ${tag} updated atomically`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(modulePath)) {
  main();
}
