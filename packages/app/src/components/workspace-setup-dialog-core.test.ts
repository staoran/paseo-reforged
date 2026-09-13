import { describe, expect, it } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

import {
  buildWorkspaceSetupFirstAgentContext,
  createWorkspaceForSetup,
} from "./workspace-setup-dialog-core";

describe("Workspace Setup title language context", () => {
  it("includes the resolved language when creating a worktree workspace", async () => {
    const firstAgentContext = buildWorkspaceSetupFirstAgentContext({
      text: "  Fix the login flow  ",
      attachments: [],
      titleLanguage: "zh-CN",
    });
    let request: Parameters<DaemonClient["createPaseoWorktree"]>[0] | null = null;
    const client: Pick<DaemonClient, "createPaseoWorktree" | "createWorkspace"> = {
      async createPaseoWorktree(input) {
        request = input;
        return {} as Awaited<ReturnType<DaemonClient["createPaseoWorktree"]>>;
      },
      async createWorkspace() {
        return {} as Awaited<ReturnType<DaemonClient["createWorkspace"]>>;
      },
    };

    await createWorkspaceForSetup({
      creationMethod: "create_worktree",
      client,
      cwd: "/repo",
      firstAgentContext,
    });

    expect(request).toMatchObject({
      cwd: "/repo",
      firstAgentContext: { prompt: "Fix the login flow", titleLanguage: "zh-CN" },
    });
  });

  it("includes the resolved language when opening a directory workspace", async () => {
    const firstAgentContext = buildWorkspaceSetupFirstAgentContext({
      text: "",
      attachments: [
        {
          type: "github_issue",
          mimeType: "application/github-issue",
          number: 42,
          title: "Fix login flow",
          url: "https://github.com/acme/repo/issues/42",
        },
      ],
      titleLanguage: "zh-CN",
    });
    let request: Parameters<DaemonClient["createWorkspace"]>[0] | null = null;
    const client: Pick<DaemonClient, "createPaseoWorktree" | "createWorkspace"> = {
      async createPaseoWorktree() {
        return {} as Awaited<ReturnType<DaemonClient["createPaseoWorktree"]>>;
      },
      async createWorkspace(input) {
        request = input;
        return {} as Awaited<ReturnType<DaemonClient["createWorkspace"]>>;
      },
    };

    await createWorkspaceForSetup({
      creationMethod: "open_project",
      client,
      cwd: "/repo",
      firstAgentContext,
    });

    expect(request).toEqual({
      source: { kind: "directory", path: "/repo" },
      firstAgentContext: {
        attachments: [
          {
            type: "github_issue",
            mimeType: "application/github-issue",
            number: 42,
            title: "Fix login flow",
            url: "https://github.com/acme/repo/issues/42",
          },
        ],
        titleLanguage: "zh-CN",
      },
    });
  });
});
