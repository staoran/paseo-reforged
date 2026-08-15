import { afterEach, describe, expect, it } from "vitest";
import { createMermaidViewportController } from "./viewport-controller";

async function nextPaint(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function scaleOf(content: HTMLElement): number {
  const match = /scale\(([^)]+)\)/.exec(content.style.transform);
  if (!match?.[1]) {
    throw new Error(`Missing scale transform: ${content.style.transform}`);
  }
  return Number(match[1]);
}

function createFixture({
  viewportWidth,
  viewportHeight,
  contentWidth,
  contentHeight,
}: {
  viewportWidth: number;
  viewportHeight: number;
  contentWidth: number;
  contentHeight: number;
}) {
  const viewport = document.createElement("div");
  viewport.style.width = `${viewportWidth}px`;
  viewport.style.height = `${viewportHeight}px`;
  const content = document.createElement("div");
  const interactive = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  interactive.setAttribute("width", String(contentWidth));
  interactive.setAttribute("height", String(contentHeight));
  content.append(interactive);
  viewport.append(content);
  document.body.append(viewport);
  const originalViewportStyle = viewport.getAttribute("style");
  const originalContentStyle = content.getAttribute("style");
  const originalInteractiveStyle = interactive.getAttribute("style");
  return {
    viewport,
    content,
    interactive,
    originalViewportStyle,
    originalContentStyle,
    originalInteractiveStyle,
    controller: createMermaidViewportController({
      viewport,
      content,
      interactiveElement: interactive,
      contentSize: { width: contentWidth, height: contentHeight },
    }),
  };
}

describe("Mermaid viewport controller", () => {
  const mounted: HTMLElement[] = [];

  afterEach(() => {
    for (const element of mounted.splice(0)) {
      element.remove();
    }
  });

  it("fits an oversized diagram and clamps command zoom", async () => {
    const fixture = createFixture({
      viewportWidth: 800,
      viewportHeight: 600,
      contentWidth: 1_600,
      contentHeight: 800,
    });
    mounted.push(fixture.viewport);

    expect(scaleOf(fixture.content)).toBeCloseTo(0.5, 5);
    for (let index = 0; index < 20; index += 1) {
      fixture.controller.execute("zoom-in");
    }
    expect(scaleOf(fixture.content)).toBe(4);

    for (let index = 0; index < 40; index += 1) {
      fixture.controller.execute("zoom-out");
    }
    expect(scaleOf(fixture.content)).toBe(0.125);

    fixture.controller.execute("fit");
    expect(scaleOf(fixture.content)).toBeCloseTo(0.5, 5);
    fixture.controller.execute("reset");
    expect(scaleOf(fixture.content)).toBe(1);
    fixture.controller.destroy();
  });

  it("switches between pan gestures and selectable diagram text", async () => {
    const fixture = createFixture({
      viewportWidth: 400,
      viewportHeight: 300,
      contentWidth: 1_600,
      contentHeight: 100,
    });
    mounted.push(fixture.viewport);
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.textContent = "Selectable";
    fixture.interactive.append(label);

    const panWheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: 200,
      clientY: 150,
      deltaY: -120,
    });
    fixture.viewport.dispatchEvent(panWheel);
    expect(panWheel.defaultPrevented).toBe(true);
    expect(fixture.interactive.style.pointerEvents).toBe("none");

    fixture.controller.setMode("select");
    expect(fixture.viewport.style.userSelect).toBe("text");
    expect(fixture.content.style.userSelect).toBe("text");
    expect(fixture.interactive.style.pointerEvents).toBe("auto");
    const range = document.createRange();
    range.selectNodeContents(label);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    expect(window.getSelection()?.toString()).toBe("Selectable");

    const selectScale = scaleOf(fixture.content);
    const selectWheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: 200,
      clientY: 150,
      deltaY: -120,
    });
    fixture.viewport.dispatchEvent(selectWheel);
    expect(selectWheel.defaultPrevented).toBe(false);
    expect(scaleOf(fixture.content)).toBe(selectScale);
    window.getSelection()?.removeAllRanges();
    fixture.controller.destroy();
  });

  it("keeps a recoverable edge visible after an extreme drag", () => {
    const fixture = createFixture({
      viewportWidth: 400,
      viewportHeight: 300,
      contentWidth: 800,
      contentHeight: 400,
    });
    mounted.push(fixture.viewport);
    fixture.controller.execute("reset");

    fixture.viewport.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        buttons: 1,
        clientX: 200,
        clientY: 150,
        pointerId: 1,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        buttons: 1,
        clientX: 5_000,
        clientY: 5_000,
        pointerId: 1,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        button: 0,
        clientX: 5_000,
        clientY: 5_000,
        pointerId: 1,
      }),
    );

    const transform = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(fixture.content.style.transform);
    expect(Number(transform?.[1])).toBeLessThanOrEqual(360);
    expect(Number(transform?.[2])).toBeLessThanOrEqual(260);
    fixture.controller.destroy();
  });

  it("refits after resize and restores all mutated styles", async () => {
    const fixture = createFixture({
      viewportWidth: 800,
      viewportHeight: 600,
      contentWidth: 1_600,
      contentHeight: 800,
    });
    mounted.push(fixture.viewport);
    fixture.controller.execute("reset");
    fixture.viewport.style.width = "400px";
    await nextPaint();
    await nextPaint();
    expect(scaleOf(fixture.content)).toBeCloseTo(0.25, 5);

    fixture.controller.destroy();
    expect(fixture.viewport.getAttribute("style") || null).toBe(fixture.originalViewportStyle);
    expect(fixture.content.getAttribute("style") || null).toBe(fixture.originalContentStyle);
    expect(fixture.interactive.getAttribute("style") || null).toBe(
      fixture.originalInteractiveStyle,
    );
  });
});
