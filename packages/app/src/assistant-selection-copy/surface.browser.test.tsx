/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import { AssistantSelectionCopySurface } from "./surface.web";

function selectText(element: Element): void {
  const node = element.firstChild;
  if (!node) throw new Error("Expected text node");
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

async function updateSelection(): Promise<void> {
  await act(async () => {
    document.dispatchEvent(new Event("selectionchange"));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

describe("assistant selection actions", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    document.getElementById("overlay-root")?.remove();
    window.getSelection()?.removeAllRanges();
    root = null;
    container = null;
    vi.unstubAllGlobals();
  });

  it("shows ask and rewrite only for a valid assistant selection and clears after action", async () => {
    const onComposeSelection = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <AssistantSelectionCopySurface onComposeSelection={onComposeSelection}>
          <div data-testid="assistant-message">
            <span>Selected answer</span>
          </div>
        </AssistantSelectionCopySurface>,
      );
    });

    selectText(container.querySelector("span")!);
    await updateSelection();

    const ask = document.querySelector<HTMLButtonElement>('[data-testid="chat-selection-ask"]');
    const rewrite = document.querySelector<HTMLButtonElement>(
      '[data-testid="chat-selection-rewrite"]',
    );
    expect(ask?.textContent).toBe(i18n.t("message.actions.ask"));
    expect(rewrite?.textContent).toBe(i18n.t("message.actions.rewrite"));

    await act(async () => ask?.click());
    expect(onComposeSelection).toHaveBeenCalledWith("Selected answer", "ask");
    expect(window.getSelection()?.rangeCount).toBe(0);
    expect(document.querySelector('[data-testid="chat-selection-actions"]')).toBeNull();
  });

  it("does not expose actions for a selection outside the surface", async () => {
    const onComposeSelection = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <>
          <AssistantSelectionCopySurface onComposeSelection={onComposeSelection}>
            <div data-testid="assistant-message">
              <span>Inside answer</span>
            </div>
          </AssistantSelectionCopySurface>
          <span data-testid="outside">Outside</span>
        </>,
      );
    });

    selectText(container.querySelector('[data-testid="outside"]')!);
    await updateSelection();
    expect(document.querySelector('[data-testid="chat-selection-actions"]')).toBeNull();
  });
});
