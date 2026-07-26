import { describe, expect, it } from "vitest";
import {
  buildImportedSessionWorkspaceNavigation,
  ImportedSessionWorkspaceMissingError,
  isNewWorkspaceImportSessionDisabled,
} from "./import-session-entry-model";

describe("buildImportedSessionWorkspaceNavigation", () => {
  it("targets the imported agent in its authoritative workspace", () => {
    expect(
      buildImportedSessionWorkspaceNavigation({
        serverId: "server-1",
        agent: { id: "agent-imported", workspaceId: "workspace-imported" },
      }),
    ).toEqual({
      serverId: "server-1",
      workspaceId: "workspace-imported",
      target: { kind: "agent", agentId: "agent-imported" },
    });
  });

  it("rejects an import response without a workspace target", () => {
    let thrown: unknown;
    try {
      buildImportedSessionWorkspaceNavigation({
        serverId: "server-1",
        agent: { id: "agent-imported" },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toEqual(
      expect.objectContaining({
        name: "ImportedSessionWorkspaceMissingError",
        message: "Imported agent is missing a workspace ID",
        agentId: "agent-imported",
      }),
    );
    expect(thrown).toBeInstanceOf(ImportedSessionWorkspaceMissingError);
  });
});

describe("isNewWorkspaceImportSessionDisabled", () => {
  it("requires a ready client, current project directory, and idle page", () => {
    expect(
      [
        { blocked: false, hasClient: true, cwd: "/repo/paseo" },
        { blocked: true, hasClient: true, cwd: "/repo/paseo" },
        { blocked: false, hasClient: false, cwd: "/repo/paseo" },
        { blocked: false, hasClient: true, cwd: null },
      ].map(isNewWorkspaceImportSessionDisabled),
    ).toEqual([false, true, true, true]);
  });
});
