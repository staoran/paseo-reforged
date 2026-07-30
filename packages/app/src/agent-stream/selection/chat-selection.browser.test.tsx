import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { View } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import { ChatSelectionBubble } from "./chat-selection-bubble.web";
import { useChatTextSelection } from "./use-chat-text-selection.web";

const BUBBLE_SELECTION = {
  text: "Selected context",
  rect: { top: 120, left: 80, width: 100, height: 20 },
};
const PANE_A_DATA_SET = { chatSelectionOwner: "pane-a" };
const PANE_B_DATA_SET = { chatSelectionOwner: "pane-b" };

function SelectionHarness({ enabled = true }: { enabled?: boolean }) {
  const { selection } = useChatTextSelection({ enabled, ownerId: "pane-a" });

  return (
    <>
      <View dataSet={PANE_A_DATA_SET}>
        <div data-testid="agent-chat-scroll">
          <span data-testid="selection-source">Selected context</span>
        </div>
        <div data-testid="agent-chat-scroll">
          <span data-testid="selection-source-second">Second stream</span>
        </div>
      </View>
      <View dataSet={PANE_B_DATA_SET}>
        <div data-testid="agent-chat-scroll">
          <span data-testid="selection-source-other-pane">Other pane</span>
        </div>
      </View>
      <output data-testid="selection-result">{selection?.text ?? ""}</output>
    </>
  );
}

async function dispatchSelectionChange(): Promise<void> {
  await act(async () => {
    document.dispatchEvent(new Event("selectionchange"));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

describe("chat text selection", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    window.getSelection()?.removeAllRanges();
    document.getElementById("overlay-root")?.replaceChildren();
    container = null;
    root = null;
  });

  it("tracks non-empty text selected inside the focused pane's chat stream", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<SelectionHarness />));

    const source = container.querySelector('[data-testid="selection-source"]');
    const textNode = source?.firstChild;
    if (!textNode) throw new Error("Expected selection source text");

    const range = document.createRange();
    range.selectNodeContents(textNode);
    const browserSelection = window.getSelection();
    browserSelection?.removeAllRanges();
    browserSelection?.addRange(range);

    await dispatchSelectionChange();

    expect(container.querySelector('[data-testid="selection-result"]')?.textContent).toBe(
      "Selected context",
    );
  });

  it("ignores selections from another pane or spanning two chat streams", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<SelectionHarness />));

    const first = container.querySelector('[data-testid="selection-source"]')?.firstChild;
    const second = container.querySelector('[data-testid="selection-source-second"]')?.firstChild;
    const otherPane = container.querySelector(
      '[data-testid="selection-source-other-pane"]',
    )?.firstChild;
    if (!first || !second || !otherPane) throw new Error("Expected selection source text");

    const crossStreamRange = document.createRange();
    crossStreamRange.setStart(first, 0);
    crossStreamRange.setEnd(second, second.textContent?.length ?? 0);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(crossStreamRange);
    await dispatchSelectionChange();
    expect(container.querySelector('[data-testid="selection-result"]')?.textContent).toBe("");

    const otherPaneRange = document.createRange();
    otherPaneRange.selectNodeContents(otherPane);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(otherPaneRange);
    await dispatchSelectionChange();
    expect(container.querySelector('[data-testid="selection-result"]')?.textContent).toBe("");
  });

  it("clears the browser selection when its pane loses focus", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<SelectionHarness />));

    const source = container.querySelector('[data-testid="selection-source"]')?.firstChild;
    if (!source) throw new Error("Expected selection source text");
    const range = document.createRange();
    range.selectNodeContents(source);
    window.getSelection()?.addRange(range);
    await dispatchSelectionChange();

    act(() => root?.render(<SelectionHarness enabled={false} />));
    expect(window.getSelection()?.rangeCount).toBe(0);
    expect(container.querySelector('[data-testid="selection-result"]')?.textContent).toBe("");
  });

  it("renders and dispatches all three old-project selection actions", () => {
    const onAsk = vi.fn();
    const onAskInNewWindow = vi.fn();
    const onSavePreset = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() =>
      root?.render(
        <ChatSelectionBubble
          selection={BUBBLE_SELECTION}
          onAsk={onAsk}
          onAskInNewWindow={onAskInNewWindow}
          onSavePreset={onSavePreset}
        />,
      ),
    );

    const bubble = document.querySelector('[data-testid="chat-selection-bubble"]');
    expect(bubble?.querySelectorAll('[role="button"]')).toHaveLength(3);

    const ask = document.querySelector<HTMLElement>('[data-testid="chat-selection-ask"]');
    const askNew = document.querySelector<HTMLElement>(
      '[data-testid="chat-selection-ask-new-window"]',
    );
    const save = document.querySelector<HTMLElement>('[data-testid="chat-selection-save-preset"]');
    expect(ask?.textContent).toBe(i18n.t("composer.selection.ask"));
    expect(askNew?.textContent).toBe(i18n.t("composer.selection.askInNewWindow"));
    expect(save?.textContent).toBe(i18n.t("composer.selection.savePreset"));

    ask?.click();
    askNew?.click();
    save?.click();
    expect(onAsk).toHaveBeenCalledWith("Selected context");
    expect(onAskInNewWindow).toHaveBeenCalledWith("Selected context");
    expect(onSavePreset).toHaveBeenCalledWith("Selected context");
  });
});
