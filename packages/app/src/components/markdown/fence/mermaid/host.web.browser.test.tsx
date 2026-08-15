import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { MermaidFenceHost } from "./host.web";

void i18n;

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  React,
});

const SOURCE = 'flowchart LR\n  Start["Start"] --> Finish["Finish"]';
const EMPTY_STYLE = {};

async function nextPaint(): Promise<void> {
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

function button(label: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[role="button"][aria-label="${label}"]`);
  if (!element) {
    throw new Error(`Missing ${label} button`);
  }
  return element;
}

async function waitForButton(label: string): Promise<HTMLElement> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < 10_000) {
    const element = document.querySelector<HTMLElement>(`[role="button"][aria-label="${label}"]`);
    if (element) {
      return element;
    }
    await nextPaint();
  }
  throw new Error(`Timed out waiting for ${label} button`);
}

async function waitForExpandedTransform(previous = ""): Promise<HTMLElement> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < 10_000) {
    const content = document.querySelector<HTMLElement>('[data-testid="mermaid-expanded-content"]');
    if (content?.style.transform && content.style.transform !== previous) {
      return content;
    }
    await nextPaint();
  }
  throw new Error(`Timed out waiting for expanded transform after ${previous || "mount"}`);
}

describe("Mermaid fence Web host", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  it("preserves source controls and expanded viewport interactions", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <MermaidFenceHost
          code={SOURCE}
          phase="complete"
          inheritedStyles={EMPTY_STYLE}
          textStyle={EMPTY_STYLE}
        />,
      );
    });

    await waitForButton("Expand Mermaid diagram");
    act(() => button("Show Mermaid source").click());
    expect(button("Hide Mermaid source")).toBeDefined();
    expect(document.body.textContent).toContain("Start");
    act(() => button("Hide Mermaid source").click());

    act(() => button("Expand Mermaid diagram").click());
    const content = await waitForExpandedTransform();
    const initialTransform = content.style.transform;
    act(() => button("Zoom in").click());
    await waitForExpandedTransform(initialTransform);

    act(() => button("Select text").click());
    expect(button("Select text").getAttribute("aria-selected")).toBe("true");
    const expandedFrame = document.querySelector<HTMLIFrameElement>(
      '[data-testid="mermaid-expanded-content"] iframe',
    );
    expect(expandedFrame?.style.pointerEvents).toBe("auto");

    const selectedTransform = content.style.transform;
    act(() => button("Pan diagram").click());
    expect(button("Pan diagram").getAttribute("aria-selected")).toBe("true");
    expect(expandedFrame?.style.pointerEvents).toBe("none");
    expect(content.style.transform).toBe(selectedTransform);

    act(() => button("Close").click());
    await nextPaint();
    expect(document.querySelector('[data-testid="mermaid-expanded-content"]')).toBeNull();
  });
});
