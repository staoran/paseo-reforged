import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import type { TurnChangesModel } from "./turn-changes";
import { TurnChangesCard } from "./turn-changes-card";

const model: TurnChangesModel = {
  turnId: "turn-1",
  fileCount: 5,
  additions: 15,
  deletions: 5,
  files: [
    { path: "src/one.ts", additions: 1, deletions: 1 },
    { path: "src/two.ts", additions: 2, deletions: 1 },
    { path: "src/three.ts", additions: 3, deletions: 1 },
    { path: "src/four.ts", additions: 4, deletions: 1 },
    { path: "src/five.ts", additions: 5, deletions: 1 },
  ],
};
const newerTurnModel: TurnChangesModel = { ...model, turnId: "turn-2" };
const noop = () => {};

function visiblePaths(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-testid="turn-change-file-path"]')).map(
    (element) => element.textContent ?? "",
  );
}

describe("TurnChangesCard", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  it("shows three files by default and expands the remaining files", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<TurnChangesCard model={model} onFilePress={noop} />));

    expect(container.querySelector('[data-testid="turn-changes-card"]')?.textContent).toContain(
      i18n.t("toolCallGroup.editedFiles.other", { count: 5 }),
    );
    expect(visiblePaths(container)).toEqual(["src/one.ts", "src/two.ts", "src/three.ts"]);

    const expand = container.querySelector<HTMLElement>('[data-testid="turn-changes-expand"]');
    expect(expand?.textContent).toContain("2");
    act(() => expand?.click());

    expect(visiblePaths(container)).toEqual([
      "src/one.ts",
      "src/two.ts",
      "src/three.ts",
      "src/four.ts",
      "src/five.ts",
    ]);
  });

  it("opens the selected file in the main pane through the card callback", () => {
    const onFilePress = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<TurnChangesCard model={model} onFilePress={onFilePress} />));

    const firstFile = container.querySelector<HTMLElement>('[data-testid="turn-change-file"]');
    act(() => firstFile?.click());

    expect(onFilePress).toHaveBeenCalledWith("src/one.ts", "main");
  });

  it("opens the selected file in a side pane on Ctrl-click", () => {
    const onFilePress = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<TurnChangesCard model={model} onFilePress={onFilePress} />));

    const firstFile = container.querySelector<HTMLElement>('[data-testid="turn-change-file"]');
    act(() =>
      firstFile?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }),
      ),
    );

    expect(onFilePress).toHaveBeenCalledTimes(1);
    expect(onFilePress).toHaveBeenCalledWith("src/one.ts", "side");
  });

  it("resets the expanded state when a newer turn replaces the card", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<TurnChangesCard model={model} onFilePress={noop} />));
    act(() =>
      container?.querySelector<HTMLElement>('[data-testid="turn-changes-expand"]')?.click(),
    );
    expect(visiblePaths(container)).toHaveLength(5);

    act(() => root?.render(<TurnChangesCard model={newerTurnModel} onFilePress={noop} />));

    expect(visiblePaths(container)).toHaveLength(3);
  });
});
