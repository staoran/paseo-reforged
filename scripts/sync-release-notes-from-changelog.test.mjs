import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { syncReleaseNotes } from "./sync-release-notes-from-changelog.mjs";

function withTempChangelog(fn, changelogText = "## 0.1.60-beta.1 - 2026-04-20\n\n- Beta notes.\n") {
  const previousCwd = process.cwd();
  const tempDir = mkdtempSync(path.join(tmpdir(), "paseo-release-notes-test-"));
  process.chdir(tempDir);
  writeFileSync("CHANGELOG.md", changelogText);

  try {
    fn();
  } finally {
    process.chdir(previousCwd);
    rmSync(tempDir, { force: true, recursive: true });
  }
}

test("updates an existing release body through the release id API", () => {
  withTempChangelog(() => {
    const calls = [];

    const execFileSync = (command, args, options) => {
      calls.push({ args, command, options });

      if (args[0] === "api" && args[1] === "repos/getpaseo/paseo/releases/tags/v0.1.60-beta.1") {
        return JSON.stringify({ id: 311163621 });
      }

      if (args[0] === "api" && args[1] === "-X" && args[2] === "PATCH") {
        const notesArg = args.find((arg) => arg.startsWith("body=@"));
        assert.ok(notesArg, "PATCH should send the notes body from a file");
        const notesPath = notesArg.slice("body=@".length);
        assert.match(notesPath, /v0\.1\.60-beta\.1-notes\.md$/);
        return "";
      }

      throw new Error(`Unexpected gh call: ${command} ${args.join(" ")}`);
    };

    syncReleaseNotes(["--repo", "getpaseo/paseo", "--tag", "v0.1.60-beta.1"], {
      execFileSync,
    });

    assert.equal(
      calls.some((call) => call.args[0] === "release" && call.args[1] === "edit"),
      false,
      "retagged releases should not use gh release edit because it can resend tag_name",
    );
    assert.equal(
      calls.some(
        (call) =>
          call.args[0] === "api" &&
          call.args[1] === "-X" &&
          call.args[2] === "PATCH" &&
          call.args[3] === "repos/getpaseo/paseo/releases/311163621",
      ),
      true,
      "existing releases should be patched by release id",
    );
  });
});

test("converts contributor profile links to mentions in synced release notes", () => {
  const changelogText = [
    "## 0.1.60-beta.1 - 2026-04-20",
    "",
    "- Beta notes. ([#526](https://github.com/getpaseo/paseo/pull/526) by [@therainisme](https://github.com/therainisme))",
    "",
  ].join("\n");

  withTempChangelog(() => {
    let syncedNotes = "";

    const execFileSync = (command, args) => {
      if (args[0] === "api" && args[1] === "repos/getpaseo/paseo/releases/tags/v0.1.60-beta.1") {
        return JSON.stringify({ id: 311163621 });
      }

      if (args[0] === "api" && args[1] === "-X" && args[2] === "PATCH") {
        const notesArg = args.find((arg) => arg.startsWith("body=@"));
        assert.ok(notesArg, "PATCH should send the notes body from a file");
        syncedNotes = readFileSync(notesArg.slice("body=@".length), "utf8");
        return "";
      }

      throw new Error(`Unexpected gh call: ${command} ${args.join(" ")}`);
    };

    syncReleaseNotes(["--repo", "getpaseo/paseo", "--tag", "v0.1.60-beta.1"], {
      execFileSync,
    });

    assert.match(syncedNotes, /by @therainisme\)/);
    assert.doesNotMatch(syncedNotes, /\[@therainisme\]\(https:\/\/github\.com\/therainisme\)/);
  }, changelogText);
});

test("creates a missing prerelease with the Paseo Reforged title", () => {
  withTempChangelog(() => {
    const calls = [];

    const execFileSync = (command, args) => {
      calls.push({ args, command });

      if (
        args[0] === "api" &&
        args[1] === "repos/staoran/paseo-reforged/releases/tags/v0.1.60-beta.1"
      ) {
        throw new Error("release not found");
      }

      if (args[0] === "release" && args[1] === "create") {
        return "";
      }

      throw new Error(`Unexpected gh call: ${command} ${args.join(" ")}`);
    };

    syncReleaseNotes(
      ["--repo", "staoran/paseo-reforged", "--tag", "v0.1.60-beta.1", "--create-if-missing"],
      { execFileSync },
    );

    const createCall = calls.find(
      (call) => call.args[0] === "release" && call.args[1] === "create",
    );
    assert.ok(createCall, "the missing prerelease should be created");
    assert.deepEqual(createCall.args.slice(0, 5), [
      "release",
      "create",
      "v0.1.60-beta.1",
      "--repo",
      "staoran/paseo-reforged",
    ]);
    assert.equal(
      createCall.args[createCall.args.indexOf("--title") + 1],
      "Paseo Reforged v0.1.60-beta.1",
    );
    assert.equal(createCall.args.includes("--prerelease"), true);
  });
});

test("refuses to create a missing stable release", () => {
  const changelogText = "## 0.1.60 - 2026-04-20\n\n- Stable notes.\n";

  withTempChangelog(() => {
    const execFileSync = (command, args) => {
      if (args[0] === "api" && args[1].endsWith("/releases/tags/v0.1.60")) {
        throw new Error("release not found");
      }
      throw new Error(`Unexpected gh call: ${command} ${args.join(" ")}`);
    };

    assert.throws(
      () =>
        syncReleaseNotes(
          ["--repo", "staoran/paseo-reforged", "--tag", "v0.1.60", "--create-if-missing"],
          { execFileSync },
        ),
      /Refusing to create missing stable release/,
    );
  }, changelogText);
});
