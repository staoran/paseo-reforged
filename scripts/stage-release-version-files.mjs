import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(modulePath), "..");
const rootPackagePath = path.join(rootDir, "package.json");

export function getReleaseVersionFiles(rootPackage, fileExists = existsSync) {
  const workspaces = Array.isArray(rootPackage.workspaces) ? rootPackage.workspaces : [];
  const files = ["package.json", "package-lock.json"];

  for (const workspace of workspaces) {
    const packagePath = path.posix.join(workspace.replaceAll("\\", "/"), "package.json");
    if (fileExists(path.join(rootDir, packagePath))) {
      files.push(packagePath);
    }
  }

  return files;
}

export function main() {
  const rootPackage = JSON.parse(readFileSync(rootPackagePath, "utf8"));
  execFileSync("git", ["add", "--", ...getReleaseVersionFiles(rootPackage)], {
    cwd: rootDir,
    stdio: "inherit",
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(modulePath)) {
  main();
}
