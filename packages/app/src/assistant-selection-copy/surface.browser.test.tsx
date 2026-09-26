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

  it("shows the three legacy actions for chat text and clears after each action", async () => {
    const onSelectionAction = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <AssistantSelectionCopySurface enabled onSelectionAction={onSelectionAction}>
          <div data-testid="agent-chat-scroll">
            <span>Selected chat text</span>
          </div>
        </AssistantSelectionCopySurface>,
      );
    });

    selectText(container.querySelector("span")!);
    await updateSelection();

    const ask = document.querySelector<HTMLButtonElement>('[data-testid="chat-selection-ask"]');
    const askNew = document.querySelector<HTMLButtonElement>(
      '[data-testid="chat-selection-ask-new-window"]',
    );
    const save = document.querySelector<HTMLButtonElement>(
      '[data-testid="chat-selection-save-preset"]',
    );
    expect(ask?.textContent).toBe(i18n.t("composer.selection.ask"));
    expect(askNew?.textContent).toBe(i18n.t("composer.selection.askInNewWindow"));
    expect(save?.textContent).toBe(i18n.t("composer.selection.savePreset"));

    await act(async () => ask?.click());
    expect(onSelectionAction).toHaveBeenCalledWith("Selected chat text", "ask");
    expect(window.getSelection()?.rangeCount).toBe(0);
    expect(document.querySelector('[data-testid="chat-selection-actions"]')).toBeNull();

    selectText(container.querySelector("span")!);
    await updateSelection();
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('[data-testid="chat-selection-ask-new-window"]')
        ?.click(),
    );
    expect(onSelectionAction).toHaveBeenCalledWith("Selected chat text", "askInNewWindow");

    selectText(container.querySelector("span")!);
    await updateSelection();
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('[data-testid="chat-selection-save-preset"]')
        ?.click(),
    );
    expect(onSelectionAction).toHaveBeenCalledWith("Selected chat text", "savePreset");
    expect(onSelectionAction).toHaveBeenCalledTimes(3);
  });

  it("does not expose actions for a selection outside the surface", async () => {
    const onSelectionAction = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <>
          <AssistantSelectionCopySurface enabled onSelectionAction={onSelectionAction}>
            <div data-testid="agent-chat-scroll">
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

  it("rejects selections across chat streams and clears when the pane loses focus", async () => {
    const onSelectionAction = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const render = (enabled: boolean) => (
      <AssistantSelectionCopySurface enabled={enabled} onSelectionAction={onSelectionAction}>
        <div data-testid="agent-chat-scroll">
          <span>First message</span>
        </div>
        <div data-testid="agent-chat-scroll">
          <span>Second message</span>
        </div>
      </AssistantSelectionCopySurface>
    );
    act(() => root?.render(render(true)));

    const spans = container.querySelectorAll("span");
    const range = document.createRange();
    range.setStart(spans[0]!.firstChild!, 0);
    range.setEnd(spans[1]!.firstChild!, spans[1]!.textContent!.length);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    await updateSelection();
    expect(document.querySelector('[data-testid="chat-selection-actions"]')).toBeNull();

    selectText(spans[0]!);
    await updateSelection();
    expect(document.querySelector('[data-testid="chat-selection-actions"]')).not.toBeNull();
    act(() => root?.render(render(false)));
    expect(document.querySelector('[data-testid="chat-selection-actions"]')).toBeNull();
    expect(window.getSelection()?.rangeCount).toBe(0);
  });
});
