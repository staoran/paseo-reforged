import assert from "node:assert/strict";
import test from "node:test";
import {
  assertExpectedReleaseBranch,
  assertExpectedOriginUrls,
  assertRemoteTagCompatible,
  buildAtomicReleasePushArgs,
  getRemoteTagCommit,
  parseRemoteTagCommit,
  EXPECTED_ORIGIN_URL,
  EXPECTED_RELEASE_BRANCH,
} from "./push-current-release-tag.mjs";

test("release pushes only to the Paseo Reforged origin", () => {
  assert.doesNotThrow(() => assertExpectedOriginUrls([EXPECTED_ORIGIN_URL], "fetch"));
  assert.throws(
    () => assertExpectedOriginUrls(["https://github.com/getpaseo/paseo.git"], "fetch"),
    /Refusing to release/,
  );
  assert.throws(
    () =>
      assertExpectedOriginUrls(
        [EXPECTED_ORIGIN_URL, "ssh://git@github.com/other/paseo.git"],
        "push",
      ),
    /expected only/,
  );
});

test("release pushes only main", () => {
  assert.doesNotThrow(() => assertExpectedReleaseBranch(EXPECTED_RELEASE_BRANCH));
  assert.throws(() => assertExpectedReleaseBranch("feature/release"), /expected main/);
});

test("release preflight rejects an occupied tag before pushing", () => {
  assert.doesNotThrow(() => assertRemoteTagCompatible("v0.2.0-beta.2", "", "local"));
  assert.doesNotThrow(() =>
    assertRemoteTagCompatible("v0.2.0-beta.2", "same-commit", "same-commit"),
  );
  assert.throws(
    () => assertRemoteTagCompatible("v0.2.0-beta.2", "remote", "local"),
    /Refusing to reuse/,
  );
});

test("remote tag parsing prefers the peeled commit for annotated tags", () => {
  const output = [
    "tag-object\trefs/tags/v0.2.0-beta.2",
    "tag-commit\trefs/tags/v0.2.0-beta.2^{}",
  ].join("\n");

  assert.equal(parseRemoteTagCommit(output, "v0.2.0-beta.2"), "tag-commit");
  assert.equal(
    parseRemoteTagCommit("lightweight\trefs/tags/v0.2.0-beta.2", "v0.2.0-beta.2"),
    "lightweight",
  );
});

test("remote tag lookup distinguishes a missing tag from a query failure", () => {
  assert.equal(
    getRemoteTagCommit("v0.2.0-beta.2", () => ""),
    "",
  );
  assert.throws(
    () =>
      getRemoteTagCommit("v0.2.0-beta.2", () => {
        throw new Error("network unavailable");
      }),
    /network unavailable/,
  );
});

test("release branch and tag use one atomic push", () => {
  assert.deepEqual(buildAtomicReleasePushArgs("main", "v0.2.0-beta.2"), [
    "push",
    "--atomic",
    "origin",
    "HEAD:refs/heads/main",
    "refs/tags/v0.2.0-beta.2:refs/tags/v0.2.0-beta.2",
  ]);
  assert.deepEqual(buildAtomicReleasePushArgs("main", "v0.2.0-beta.2", true), [
    "push",
    "--atomic",
    "origin",
    "HEAD:refs/heads/main",
  ]);
});
