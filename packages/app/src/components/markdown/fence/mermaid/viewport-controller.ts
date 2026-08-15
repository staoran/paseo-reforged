export type MermaidViewportMode = "pan" | "select";
export type MermaidViewportCommand = "fit" | "reset" | "zoom-in" | "zoom-out";

export interface MermaidViewportController {
  execute: (command: MermaidViewportCommand) => void;
  setMode: (mode: MermaidViewportMode) => void;
  destroy: () => void;
}

interface DiagramSize {
  width: number;
  height: number;
}

type StyledElement = HTMLElement | SVGElement;

interface ViewportTransform {
  x: number;
  y: number;
  scale: number;
}

const MAX_SCALE = 4;
const MIN_SCALE = 0.125;
const MIN_VISIBLE_EDGE = 40;
const ZOOM_FACTOR = 1.35;

function readViewportSize(viewport: HTMLElement): DiagramSize {
  const bounds = viewport.getBoundingClientRect();
  return {
    width: Math.max(1, viewport.clientWidth || bounds.width),
    height: Math.max(1, viewport.clientHeight || bounds.height),
  };
}

function fitScale(content: DiagramSize, viewport: DiagramSize): number {
  return Math.min(1, viewport.width / content.width, viewport.height / content.height);
}

function centeredTransform(
  content: DiagramSize,
  viewport: DiagramSize,
  scale: number,
): ViewportTransform {
  return {
    x: (viewport.width - content.width * scale) / 2,
    y: (viewport.height - content.height * scale) / 2,
    scale,
  };
}

function clampOffset(offset: number, scaledContent: number, viewport: number): number {
  if (scaledContent <= viewport) {
    return (viewport - scaledContent) / 2;
  }
  return Math.min(viewport - MIN_VISIBLE_EDGE, Math.max(MIN_VISIBLE_EDGE - scaledContent, offset));
}

function clampTransform(
  transform: ViewportTransform,
  content: DiagramSize,
  viewport: DiagramSize,
): ViewportTransform {
  return {
    x: clampOffset(transform.x, content.width * transform.scale, viewport.width),
    y: clampOffset(transform.y, content.height * transform.scale, viewport.height),
    scale: transform.scale,
  };
}

function restoreStyle(element: StyledElement, style: string | null): void {
  if (style === null) {
    element.removeAttribute("style");
  } else {
    element.setAttribute("style", style);
  }
}

export function createMermaidViewportController({
  viewport,
  content,
  interactiveElement,
  contentSize,
}: {
  viewport: HTMLElement;
  content: HTMLElement;
  interactiveElement: StyledElement;
  contentSize: DiagramSize;
}): MermaidViewportController {
  const normalizedContentSize = {
    width: Math.max(1, contentSize.width),
    height: Math.max(1, contentSize.height),
  };
  const originalViewportStyle = viewport.getAttribute("style");
  const originalContentStyle = content.getAttribute("style");
  const originalInteractiveStyle = interactiveElement.getAttribute("style");
  let transform = centeredTransform(
    normalizedContentSize,
    readViewportSize(viewport),
    fitScale(normalizedContentSize, readViewportSize(viewport)),
  );
  let mode: MermaidViewportMode = "pan";
  let drag:
    | {
        pointerId: number;
        startX: number;
        startY: number;
        originX: number;
        originY: number;
      }
    | undefined;

  function applyTransform(next: ViewportTransform): void {
    transform = clampTransform(next, normalizedContentSize, readViewportSize(viewport));
    content.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
  }

  function setInteractionMode(nextMode: MermaidViewportMode): void {
    mode = nextMode;
    const selecting = mode === "select";
    viewport.style.cursor = selecting ? "text" : "grab";
    viewport.style.touchAction = selecting ? "auto" : "none";
    viewport.style.userSelect = selecting ? "text" : "none";
    content.style.userSelect = selecting ? "text" : "none";
    interactiveElement.style.pointerEvents = selecting ? "auto" : "none";
  }

  function zoomAt(scale: number, clientX: number, clientY: number): void {
    const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    const bounds = viewport.getBoundingClientRect();
    const x = clientX - bounds.left;
    const y = clientY - bounds.top;
    const contentX = (x - transform.x) / transform.scale;
    const contentY = (y - transform.y) / transform.scale;
    applyTransform({
      x: x - contentX * nextScale,
      y: y - contentY * nextScale,
      scale: nextScale,
    });
  }

  function centerAtScale(scale: number): void {
    applyTransform(centeredTransform(normalizedContentSize, readViewportSize(viewport), scale));
  }

  function fit(): void {
    const viewportSize = readViewportSize(viewport);
    applyTransform(
      centeredTransform(
        normalizedContentSize,
        viewportSize,
        fitScale(normalizedContentSize, viewportSize),
      ),
    );
  }

  function handleWheel(event: WheelEvent): void {
    if (mode === "select") {
      return;
    }
    event.preventDefault();
    const factor = Math.min(1.25, Math.max(0.8, Math.exp(-event.deltaY * 0.003)));
    zoomAt(transform.scale * factor, event.clientX, event.clientY);
  }

  function handlePointerDown(event: PointerEvent): void {
    if (mode === "select" || event.button !== 0) {
      return;
    }
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: transform.x,
      originY: transform.y,
    };
    viewport.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    applyTransform({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
      scale: transform.scale,
    });
  }

  function handlePointerUp(event: PointerEvent): void {
    if (drag?.pointerId === event.pointerId) {
      drag = undefined;
    }
  }

  content.style.width = `${normalizedContentSize.width}px`;
  content.style.height = `${normalizedContentSize.height}px`;
  content.style.transformOrigin = "0 0";
  viewport.style.overflow = "hidden";
  viewport.addEventListener("wheel", handleWheel, { passive: false });
  viewport.addEventListener("pointerdown", handlePointerDown);
  document.addEventListener("pointermove", handlePointerMove);
  document.addEventListener("pointerup", handlePointerUp);
  document.addEventListener("pointercancel", handlePointerUp);
  const resizeObserver =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => fit());
  resizeObserver?.observe(viewport);
  setInteractionMode("pan");
  applyTransform(transform);

  return {
    execute(command) {
      if (command === "fit") {
        fit();
        return;
      }
      if (command === "reset") {
        centerAtScale(1);
        return;
      }
      const bounds = viewport.getBoundingClientRect();
      zoomAt(
        transform.scale * (command === "zoom-in" ? ZOOM_FACTOR : 1 / ZOOM_FACTOR),
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      );
    },
    setMode(nextMode) {
      if (nextMode !== mode) {
        setInteractionMode(nextMode);
      }
    },
    destroy() {
      resizeObserver?.disconnect();
      viewport.removeEventListener("wheel", handleWheel);
      viewport.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerUp);
      restoreStyle(viewport, originalViewportStyle);
      restoreStyle(content, originalContentStyle);
      restoreStyle(interactiveElement, originalInteractiveStyle);
    },
  };
}
