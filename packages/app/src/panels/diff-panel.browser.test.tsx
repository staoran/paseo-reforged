import React, { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { ParsedDiffFile } from "@/git/use-diff-query";
import { DEFAULT_CHANGES_PREFERENCES } from "@/hooks/use-changes-preferences";
import { WorkingDiffPanel } from "./diff-panel";

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  React,
});

const files: ParsedDiffFile[] = [
  createFile("src/a.ts"),
  createFile("src/b.ts"),
  createFile("src/c.ts"),
];
const noop = () => {};

function createFile(path: string): ParsedDiffFile {
  return {
    path,
    isNew: false,
    isDeleted: false,
    additions: 1,
    deletions: 0,
    hunks: [],
  };
}

function createPanelProps(
  target: ComponentProps<typeof WorkingDiffPanel>["target"],
): ComponentProps<typeof WorkingDiffPanel> {
  return {
    target,
    cwd: "/workspace",
    isConnected: true,
    panelPreferences: {
      preferences: DEFAULT_CHANGES_PREFERENCES,
      isCompact: false,
      canUseSplitLayout: true,
      displayPreferences: {
        layout: "unified",
        wrapLines: false,
        codeFontSize: 12,
        monoFontFamily: "",
      },
      toggleLayout: noop,
      toggleWrapLines: noop,
      toggleHideWhitespace: noop,
    },
    workingDiff: {
      status: null,
      isStatusLoading: false,
      isGit: true,
      notGit: false,
      statusErrorMessage: null,
      baseRef: undefined,
      currentBranchName: null,
      diffMode: "uncommitted",
      selectUncommitted: noop,
      selectBase: noop,
      files,
      diffPayloadError: null,
      isDiffLoading: false,
      diffTooLarge: false,
      reviewActions: {
        commentsByTarget: new Map(),
        editor: null,
        onStartComment: noop,
        onEditComment: noop,
        onCancelEditor: noop,
        onSaveEditor: noop,
        onDeleteComment: noop,
      },
      reviewAttachment: null,
    },
    refreshSupported: false,
    isRefreshing: false,
    onRefresh: noop,
  };
}

async function renderPanel(root: Root, target: ComponentProps<typeof WorkingDiffPanel>["target"]) {
  await act(async () => {
    root.render(<WorkingDiffPanel {...createPanelProps(target)} />);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

describe("WorkingDiffPanel", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  it("keeps every file body collapsed when opened without a requested file", async () => {
    container = document.createElement("div");
    container.style.width = "900px";
    container.style.height = "700px";
    document.body.appendChild(container);
    root = createRoot(container);

    await renderPanel(root, { kind: "working_diff" });

    expect(container.querySelector('[data-testid="diff-file-0"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="diff-file-1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="diff-file-2"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="diff-file-0-body"]')).toBeNull();
    expect(container.querySelector('[data-testid="diff-file-1-body"]')).toBeNull();
    expect(container.querySelector('[data-testid="diff-file-2-body"]')).toBeNull();
  });

  it("opens only the requested file body while keeping every file header visible", async () => {
    container = document.createElement("div");
    container.style.width = "900px";
    container.style.height = "700px";
    document.body.appendChild(container);
    root = createRoot(container);

    await renderPanel(root, { kind: "working_diff", focusPath: "src/b.ts", focusRequestId: 1 });

    expect(container.querySelector('[data-testid="diff-file-0"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="diff-file-1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="diff-file-2"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="diff-file-0-body"]')).toBeNull();
    expect(container.querySelector('[data-testid="diff-file-1-body"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="diff-file-2-body"]')).toBeNull();
  });

  it("switches the open file body when a newer focus request targets another file", async () => {
    container = document.createElement("div");
    container.style.width = "900px";
    container.style.height = "700px";
    document.body.appendChild(container);
    root = createRoot(container);

    await renderPanel(root, { kind: "working_diff", focusPath: "src/b.ts", focusRequestId: 1 });
    expect(container.querySelector('[data-testid="diff-file-1-body"]')).not.toBeNull();

    await renderPanel(root, { kind: "working_diff", focusPath: "src/c.ts", focusRequestId: 2 });

    expect(container.querySelector('[data-testid="diff-file-0-body"]')).toBeNull();
    expect(container.querySelector('[data-testid="diff-file-1-body"]')).toBeNull();
    expect(container.querySelector('[data-testid="diff-file-2-body"]')).not.toBeNull();
  });
});
