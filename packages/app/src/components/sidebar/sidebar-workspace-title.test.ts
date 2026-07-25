import { describe, expect, it } from "vitest";
import { resolveSidebarWorkspacePrimaryLabel } from "@/components/sidebar/sidebar-workspace-title";

describe("resolveSidebarWorkspacePrimaryLabel", () => {
  it("prefers the raw workspace title in title mode", () => {
    const label = resolveSidebarWorkspacePrimaryLabel({
      workspace: {
        name: "fix/search",
        title: "Investigate search",
        currentBranch: "fix/search",
      },
      workspaceTitleSource: "title",
    });

    expect(label).toBe("Investigate search");
  });

  it("falls back to the workspace name in title mode", () => {
    const label = resolveSidebarWorkspacePrimaryLabel({
      workspace: { name: "Local folder", title: null, currentBranch: null },
      workspaceTitleSource: "title",
    });

    expect(label).toBe("Local folder");
  });

  it("uses the branch name in branch mode", () => {
    const label = resolveSidebarWorkspacePrimaryLabel({
      workspace: { name: "Investigate search", title: "Raw title", currentBranch: "fix/search" },
      workspaceTitleSource: "branch",
    });

    expect(label).toBe("fix/search");
  });

  it("falls back to the workspace name in branch mode without a branch", () => {
    const label = resolveSidebarWorkspacePrimaryLabel({
      workspace: { name: "Local folder", title: "Raw title", currentBranch: null },
      workspaceTitleSource: "branch",
    });

    expect(label).toBe("Local folder");
  });
});
