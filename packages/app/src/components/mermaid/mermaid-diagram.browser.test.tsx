import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { i18n } from "@/i18n/i18next";
import { MermaidDiagram } from "./mermaid-diagram";

void i18n;

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  React,
});

const SOURCE = 'flowchart LR\n  Start["Start"] --> Finish["Finish"]';
const FALLBACK = <span>{SOURCE}</span>;

function nextPaint(): Promise<void> {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitForSvgCount(count: number): Promise<SVGSVGElement[]> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < 5_000) {
    const svgs = Array.from(document.querySelectorAll<SVGSVGElement>("svg"));
    if (svgs.length >= count) return svgs;
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  }
  throw new Error(`Timed out waiting for ${count} Mermaid SVGs`);
}

async function waitForExpandedSvg(): Promise<SVGSVGElement> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < 5_000) {
    const svg = document.querySelector<SVGSVGElement>(
      '[data-testid="mermaid-expanded-surface"] svg',
    );
    if (svg) return svg;
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  }
  throw new Error("Timed out waiting for expanded Mermaid SVG");
}

async function waitForTransformChange(svg: SVGSVGElement, previous: string): Promise<void> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < 2_000) {
    if (svg.style.transform !== previous) return;
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  }
  throw new Error(
    `Timed out waiting for Mermaid viewport transform: ${previous} -> ${svg.style.transform}`,
  );
}

async function waitForTransform(svg: SVGSVGElement): Promise<string> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < 2_000) {
    if (svg.style.transform) return svg.style.transform;
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  }
  throw new Error("Timed out waiting for Mermaid viewport transform");
}

async function waitForExpandedClose(): Promise<void> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < 2_000) {
    if (!document.querySelector('[data-testid="mermaid-expanded-surface"]')) return;
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  }
  throw new Error("Timed out waiting for expanded Mermaid diagram to close");
}

function scaleOf(svg: SVGSVGElement): number {
  const match = /scale\(([^)]+)\)/.exec(svg.style.transform);
  if (!match?.[1]) throw new Error(`Missing scale transform: ${svg.style.transform}`);
  return Number(match[1]);
}

function button(label: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[role="button"][aria-label="${label}"]`);
  if (!element) throw new Error(`Missing ${label} button`);
  return element;
}

function contentWidthRatio(content: HTMLElement, parent: HTMLElement): number {
  const parentStyle = getComputedStyle(parent);
  const horizontalPadding =
    Number.parseFloat(parentStyle.paddingLeft) + Number.parseFloat(parentStyle.paddingRight);
  const availableWidth = parent.getBoundingClientRect().width - horizontalPadding;
  return content.getBoundingClientRect().width / availableWidth;
}

describe("MermaidDiagram expanded viewport", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  it("zooms only the expanded Mermaid diagram", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<MermaidDiagram source={SOURCE} fallback={FALLBACK} />);
    });

    const [inlineSvg] = await waitForSvgCount(1);
    const inlineTransform = inlineSvg.style.transform;

    act(() => button("Expand Mermaid diagram").click());
    const expandedSvg = await waitForExpandedSvg();
    const initialExpandedTransform = expandedSvg.style.transform;

    act(() => button("Zoom in").click());
    await waitForTransformChange(expandedSvg, initialExpandedTransform);

    expect(inlineSvg.style.transform).toBe(inlineTransform);
    expect(expandedSvg.style.transform).not.toBe(initialExpandedTransform);
  });

  it("maps every viewport control and restores the initial mode when reopened", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<MermaidDiagram source={SOURCE} fallback={FALLBACK} />);
    });

    await waitForSvgCount(1);
    act(() => button("Expand Mermaid diagram").click());
    let expandedSvg = await waitForExpandedSvg();
    const initialFitTransform = await waitForTransform(expandedSvg);
    const initialFitScale = scaleOf(expandedSvg);

    act(() => button("Zoom out").click());
    await waitForTransformChange(expandedSvg, initialFitTransform);
    expect(scaleOf(expandedSvg)).toBeLessThan(initialFitScale);

    act(() => button("Fit to view").click());
    await act(nextPaint);
    expect(scaleOf(expandedSvg)).toBeCloseTo(initialFitScale, 5);

    act(() => button("Reset zoom").click());
    await act(nextPaint);
    expect(scaleOf(expandedSvg)).toBe(1);

    act(() => button("Select text").click());
    expect(button("Select text").getAttribute("aria-selected")).toBe("true");
    expect(expandedSvg.style.userSelect).toBe("text");
    const expandedSurface = document.querySelector<HTMLElement>(
      '[data-testid="mermaid-expanded-surface"]',
    );
    const surfaceBounds = expandedSurface?.getBoundingClientRect();
    const expandedLabel = Array.from(expandedSvg.querySelectorAll<SVGTextElement>("text")).find(
      (label) => {
        if (!label.textContent?.trim() || !surfaceBounds) return false;
        const bounds = label.getBoundingClientRect();
        return (
          bounds.width > 0 &&
          bounds.height > 0 &&
          bounds.right > surfaceBounds.left &&
          bounds.left < surfaceBounds.right &&
          bounds.bottom > surfaceBounds.top &&
          bounds.top < surfaceBounds.bottom
        );
      },
    );
    if (!expandedLabel) throw new Error("Missing expanded Mermaid text");
    expandedLabel.setAttribute("data-testid", "expanded-mermaid-label");
    const selection = window.getSelection();
    selection?.removeAllRanges();
    await act(() => userEvent.dblClick(expandedLabel));
    expect(selection?.toString().length).toBeGreaterThan(0);
    selection?.removeAllRanges();

    const resetTransform = expandedSvg.style.transform;
    act(() => button("Zoom in").click());
    await waitForTransformChange(expandedSvg, resetTransform);

    act(() => button("Close").click());
    await waitForExpandedClose();
    act(() => button("Expand Mermaid diagram").click());
    expandedSvg = await waitForExpandedSvg();
    await waitForTransform(expandedSvg);

    expect(button("Pan diagram").getAttribute("aria-selected")).toBe("true");
    expect(expandedSvg.style.userSelect).toBe("none");
    expect(scaleOf(expandedSvg)).toBeCloseTo(initialFitScale, 5);
  });

  it("keeps the expanded dialog proportional as its parent window grows", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<MermaidDiagram source={SOURCE} fallback={FALLBACK} />);
    });

    await waitForSvgCount(1);
    act(() => button("Expand Mermaid diagram").click());
    await waitForExpandedSvg();

    const expandedSurface = document.querySelector<HTMLElement>(
      '[data-testid="mermaid-expanded-surface"]',
    );
    const modalContent = expandedSurface?.parentElement;
    const modalRoot = modalContent?.parentElement;
    if (!modalContent || !modalRoot) throw new Error("Missing expanded Mermaid dialog layout");

    modalRoot.style.width = "1000px";
    await act(nextPaint);
    const narrowRatio = contentWidthRatio(modalContent, modalRoot);

    modalRoot.style.width = "2000px";
    await act(nextPaint);
    const wideWidth = modalContent.getBoundingClientRect().width;
    const wideRatio = contentWidthRatio(modalContent, modalRoot);

    expect(wideWidth).toBeGreaterThan(1400);
    expect(wideRatio).toBeCloseTo(narrowRatio, 2);
  });
});
