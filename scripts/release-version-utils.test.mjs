import assert from "node:assert/strict";
import test from "node:test";
import {
  computeNextAvailableBetaVersion,
  computeNextReleaseVersion,
  getReleaseInfoFromSourceTag,
  parseReleaseVersion,
} from "./release-version-utils.mjs";

test("computes the next beta patch from a stable version", () => {
  assert.equal(computeNextReleaseVersion("0.1.59", "beta-patch"), "0.1.60-beta.1");
});

test("starts a beta line on the adopted stable upstream version", () => {
  assert.equal(computeNextReleaseVersion("0.2.5", "beta-next"), "0.2.5-beta.1");
});

test("starts after immutable beta tags already occupying the adopted stable version", () => {
  assert.equal(
    computeNextAvailableBetaVersion("0.3.0", [
      "0.3.0-beta.1",
      "0.3.0-beta.2",
      "0.3.0-beta.3",
      "0.3.0-beta.4",
    ]),
    "0.3.0-beta.5",
  );
});

test("ignores occupied beta tags from other upstream bases", () => {
  assert.equal(
    computeNextAvailableBetaVersion("0.3.0", ["0.2.5-beta.9", "0.3.0-beta.2"]),
    "0.3.0-beta.3",
  );
});

test("advances beta versions", () => {
  assert.equal(computeNextReleaseVersion("0.1.60-beta.1", "beta-next"), "0.1.60-beta.2");
});

test("promotes beta versions to stable", () => {
  assert.equal(computeNextReleaseVersion("0.1.60-beta.2", "promote"), "0.1.60");
});

test("parses beta release metadata", () => {
  assert.deepEqual(parseReleaseVersion("0.1.60-beta.1"), {
    version: "0.1.60-beta.1",
    major: 0,
    minor: 1,
    patch: 60,
    prerelease: "beta.1",
    baseVersion: "0.1.60",
    isPrerelease: true,
    isBeta: true,
    betaNumber: 1,
  });
});

test("emits beta release info from tags", () => {
  assert.deepEqual(getReleaseInfoFromSourceTag("v0.1.60-beta.1"), {
    sourceTag: "v0.1.60-beta.1",
    releaseTag: "v0.1.60-beta.1",
    version: "0.1.60-beta.1",
    baseVersion: "0.1.60",
    prerelease: "beta.1",
    isPrerelease: true,
    isBeta: true,
    betaNumber: 1,
    releaseType: "prerelease",
    releaseChannel: "beta",
    isSmokeTag: false,
  });
});

test("rejects non-beta prerelease versions", () => {
  assert.throws(() => parseReleaseVersion("0.1.60-canary.1"), /Expected beta prerelease versions/);
});
