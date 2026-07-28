import { describe, expect, it } from "vitest";
import { resolveOpenInFileManagerPath } from "./availability";

describe("resolveOpenInFileManagerPath", () => {
  it("returns the trimmed path for a local Electron host", () => {
    expect(
      resolveOpenInFileManagerPath({
        isElectron: true,
        isLocalDaemon: true,
        path: " C:\\repo ",
      }),
    ).toBe("C:\\repo");
  });

  it("rejects paths from a remote host", () => {
    expect(
      resolveOpenInFileManagerPath({
        isElectron: true,
        isLocalDaemon: false,
        path: "/srv/repo",
      }),
    ).toBeNull();
  });

  it("rejects local paths outside Electron", () => {
    expect(
      resolveOpenInFileManagerPath({
        isElectron: false,
        isLocalDaemon: true,
        path: "/repo",
      }),
    ).toBeNull();
  });

  it("rejects null, missing, and blank paths", () => {
    const localElectronHost = {
      isElectron: true,
      isLocalDaemon: true,
    };

    expect([
      resolveOpenInFileManagerPath({ ...localElectronHost, path: null }),
      resolveOpenInFileManagerPath(localElectronHost),
      resolveOpenInFileManagerPath({ ...localElectronHost, path: "   " }),
    ]).toEqual([null, null, null]);
  });
});
