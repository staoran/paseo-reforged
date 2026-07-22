import { describe, expect, it } from "vitest";
import {
  getLatestAndroidVersionFromReleases,
  getLatestReadyReleaseFromReleases,
  type GitHubRelease,
} from "./latest-release";

function release({
  version,
  hasApk,
  prerelease = false,
}: {
  version: string;
  hasApk: boolean;
  prerelease?: boolean;
}): GitHubRelease {
  const tag = `v${version}`;
  return {
    tag_name: tag,
    assets: hasApk ? [{ name: `Paseo-Reforged-${tag}-android.apk` }] : [],
    prerelease,
    draft: false,
  };
}

describe("getLatestAndroidVersionFromReleases", () => {
  it("selects the latest stable release that contains an Android APK", () => {
    const releases = [
      release({ version: "0.1.109", hasApk: true, prerelease: true }),
      release({ version: "0.1.108", hasApk: false }),
      release({ version: "0.1.107", hasApk: true }),
    ];

    expect(getLatestAndroidVersionFromReleases(releases)).toBe("0.1.107");
  });
});

describe("getLatestReadyReleaseFromReleases", () => {
  it("requires Paseo Reforged desktop assets", () => {
    const upstreamShaped: GitHubRelease = {
      tag_name: "v0.2.1",
      assets: [
        { name: "Paseo-0.2.1-arm64.dmg" },
        { name: "Paseo-x86_64.AppImage" },
        { name: "Paseo-Setup-0.2.1-x64.exe" },
      ],
      prerelease: false,
      draft: false,
    };
    const reforged: GitHubRelease = {
      tag_name: "v0.2.0",
      assets: [
        { name: "Paseo-Reforged-0.2.0-arm64.dmg" },
        { name: "Paseo-Reforged-x86_64.AppImage" },
        { name: "Paseo-Reforged-Setup-0.2.0-x64.exe" },
      ],
      prerelease: false,
      draft: false,
    };

    expect(getLatestReadyReleaseFromReleases([upstreamShaped, reforged])).toEqual({
      version: "0.2.0",
      linuxAppImageAsset: "Paseo-Reforged-x86_64.AppImage",
      windowsX64Asset: "Paseo-Reforged-Setup-0.2.0-x64.exe",
      windowsArm64Asset: null,
    });
  });
});
