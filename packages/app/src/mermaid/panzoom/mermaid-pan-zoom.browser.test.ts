import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { createMermaidPanZoom } from "./mermaid-pan-zoom";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

async function nextPaint(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitForScale(svg: SVGSVGElement, expected: number): Promise<void> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < 1_000) {
    const match = /scale\(([^)]+)\)/.exec(svg.style.transform);
    if (match?.[1] && Math.abs(Number(match[1]) - expected) < 0.00001) return;
    await nextPaint();
  }
  throw new Error(
    `Timed out waiting for scale ${expected}; received ${svg.style.transform || "none"}`,
  );
}

function scaleOf(svg: SVGSVGElement): number {
  const match = /scale\(([^)]+)\)/.exec(svg.style.transform);
  if (!match?.[1]) throw new Error(`Missing scale transform: ${svg.style.transform}`);
  return Number(match[1]);
}

describe("Mermaid pan/zoom controller", () => {
  let viewport: HTMLDivElement | null = null;

  afterEach(() => {
    viewport?.remove();
    viewport = null;
  });

  it("fits an oversized SVG and restores fit or 100% zoom on command", async () => {
    viewport = document.createElement("div");
    viewport.style.width = "800px";
    viewport.style.height = "600px";
    document.body.appendChild(viewport);

    const svg = document.createElementNS(SVG_NAMESPACE, "svg");
    svg.setAttribute("viewBox", "0 0 1600 800");
    viewport.appendChild(svg);

    const controller = createMermaidPanZoom(viewport, svg);
    await nextPaint();
    expect(scaleOf(svg)).toBeCloseTo(0.5, 5);
    const initialBounds = svg.getBoundingClientRect();
    const initialViewportBounds = viewport.getBoundingClientRect();
    expect(initialBounds.left).toBeGreaterThanOrEqual(initialViewportBounds.left);
    expect(initialBounds.right).toBeLessThanOrEqual(initialViewportBounds.right);
    expect(initialBounds.left + initialBounds.width / 2).toBeCloseTo(
      initialViewportBounds.left + initialViewportBounds.width / 2,
      1,
    );

    for (let id = 1; id <= 20; id += 1) {
      controller.execute({ id, type: "zoom-in" });
    }
    await nextPaint();
    expect(scaleOf(svg)).toBe(4);

    for (let id = 21; id <= 60; id += 1) {
      controller.execute({ id, type: "zoom-out" });
    }
    await nextPaint();
    expect(scaleOf(svg)).toBe(0.125);

    controller.execute({ id: 61, type: "fit" });
    await nextPaint();
    expect(scaleOf(svg)).toBeCloseTo(0.5, 5);
    const refitBounds = svg.getBoundingClientRect();
    expect(refitBounds.left).toBeGreaterThanOrEqual(initialViewportBounds.left);
    expect(refitBounds.right).toBeLessThanOrEqual(initialViewportBounds.right);
    expect(refitBounds.left + refitBounds.width / 2).toBeCloseTo(
      initialViewportBounds.left + initialViewportBounds.width / 2,
      1,
    );

    controller.execute({ id: 62, type: "reset" });
    await nextPaint();
    expect(scaleOf(svg)).toBe(1);

    const bounds = svg.getBoundingClientRect();
    const viewportBounds = viewport.getBoundingClientRect();
    expect(bounds.left + bounds.width / 2).toBeCloseTo(
      viewportBounds.left + viewportBounds.width / 2,
      1,
    );

    controller.destroy();
  });

  it("switches between viewport gestures and selectable SVG text", async () => {
    viewport = document.createElement("div");
    viewport.style.width = "400px";
    viewport.style.height = "300px";
    document.body.appendChild(viewport);

    const svg = document.createElementNS(SVG_NAMESPACE, "svg");
    svg.setAttribute("viewBox", "0 0 1600 100");
    const label = document.createElementNS(SVG_NAMESPACE, "text");
    label.setAttribute("x", "600");
    label.setAttribute("y", "50");
    label.textContent = "Selectable";
    svg.appendChild(label);
    viewport.appendChild(svg);

    const selection = window.getSelection();
    selection?.removeAllRanges();
    await userEvent.dblClick(label);
    expect(selection?.toString()).toBe("Selectable");
    selection?.removeAllRanges();

    const controller = createMermaidPanZoom(viewport, svg);
    await nextPaint();

    const panWheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: 200,
      clientY: 150,
      deltaY: -120,
    });
    viewport.dispatchEvent(panWheel);
    await nextPaint();
    expect(panWheel.defaultPrevented).toBe(true);
    expect(scaleOf(svg)).toBeGreaterThan(0.25);
    const zoomedBounds = svg.getBoundingClientRect();
    const viewportBounds = viewport.getBoundingClientRect();
    expect(zoomedBounds.left + zoomedBounds.width / 2).toBeCloseTo(
      viewportBounds.left + viewportBounds.width / 2,
      1,
    );

    selection?.removeAllRanges();
    await userEvent.dblClick(label);
    expect(selection?.toString()).toBe("");

    controller.setMode("select");
    expect(viewport.style.userSelect).toBe("text");
    expect(svg.style.userSelect).toBe("text");

    const range = document.createRange();
    range.selectNodeContents(label);
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(selection?.toString()).toBe("Selectable");

    selection?.removeAllRanges();
    await userEvent.dblClick(label);
    expect(selection?.toString()).toBe("Selectable");
    selection?.removeAllRanges();

    const selectScale = scaleOf(svg);
    const selectWheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: 200,
      clientY: 150,
      deltaY: -120,
    });
    viewport.dispatchEvent(selectWheel);
    await nextPaint();
    expect(selectWheel.defaultPrevented).toBe(false);
    expect(scaleOf(svg)).toBe(selectScale);

    controller.execute({ id: 1, type: "reset" });
    await nextPaint();
    await nextPaint();
    expect(scaleOf(svg)).toBe(1);
    const resetBounds = svg.getBoundingClientRect();
    expect(resetBounds.left + resetBounds.width / 2).toBeCloseTo(
      viewportBounds.left + viewportBounds.width / 2,
      1,
    );
    expect(resetBounds.top + resetBounds.height / 2).toBeCloseTo(
      viewportBounds.top + viewportBounds.height / 2,
      1,
    );

    controller.destroy();
  });

  it("keeps a recoverable edge visible after an extreme drag", async () => {
    viewport = document.createElement("div");
    viewport.style.width = "400px";
    viewport.style.height = "300px";
    document.body.appendChild(viewport);

    const svg = document.createElementNS(SVG_NAMESPACE, "svg");
    svg.setAttribute("viewBox", "0 0 800 400");
    viewport.appendChild(svg);

    const controller = createMermaidPanZoom(viewport, svg);
    controller.execute({ id: 1, type: "reset" });
    await nextPaint();

    viewport.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        buttons: 1,
        clientX: 200,
        clientY: 150,
        pointerId: 1,
        pointerType: "mouse",
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        buttons: 1,
        clientX: 5_000,
        clientY: 5_000,
        pointerId: 1,
        pointerType: "mouse",
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        button: 0,
        buttons: 0,
        clientX: 5_000,
        clientY: 5_000,
        pointerId: 1,
        pointerType: "mouse",
      }),
    );
    await nextPaint();

    const bounds = svg.getBoundingClientRect();
    const viewportBounds = viewport.getBoundingClientRect();
    expect(bounds.left).toBeLessThanOrEqual(viewportBounds.right - 40);
    expect(bounds.top).toBeLessThanOrEqual(viewportBounds.bottom - 40);

    controller.destroy();
  });

  it("refits when the viewport resizes and restores styles when destroyed", async () => {
    viewport = document.createElement("div");
    viewport.style.width = "800px";
    viewport.style.height = "600px";
    document.body.appendChild(viewport);

    const svg = document.createElementNS(SVG_NAMESPACE, "svg");
    svg.setAttribute("viewBox", "0 0 1600 800");
    svg.style.userSelect = "text";
    viewport.appendChild(svg);

    const originalSvgStyle = svg.getAttribute("style");
    const controller = createMermaidPanZoom(viewport, svg);
    controller.execute({ id: 1, type: "reset" });
    await waitForScale(svg, 1);

    viewport.style.width = "400px";
    await waitForScale(svg, 0.25);

    controller.destroy();
    expect(svg.getAttribute("style")).toBe(originalSvgStyle);
  });
});
