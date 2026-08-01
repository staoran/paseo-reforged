import Panzoom from "@panzoom/panzoom";
import type {
  MermaidViewportCommand,
  MermaidViewportMode,
} from "@/components/mermaid/mermaid-surface-types";

const MAX_SCALE = 4;
const MIN_SCALE = 0.125;
const MIN_VISIBLE_EDGE = 40;
const ZOOM_STEP = 0.3;

export interface MermaidPanZoomController {
  execute: (command: MermaidViewportCommand) => void;
  setMode: (mode: MermaidViewportMode) => void;
  destroy: () => void;
}

interface SvgSize {
  width: number;
  height: number;
}

function readSvgSize(svg: SVGSVGElement): SvgSize {
  const viewBox = svg.viewBox.baseVal;
  if (viewBox.width > 0 && viewBox.height > 0) {
    return { width: viewBox.width, height: viewBox.height };
  }

  const bounds = svg.getBoundingClientRect();
  return {
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
  };
}

function readViewportSize(viewport: HTMLElement): SvgSize {
  const bounds = viewport.getBoundingClientRect();
  return {
    width: Math.max(1, viewport.clientWidth || bounds.width),
    height: Math.max(1, viewport.clientHeight || bounds.height),
  };
}

function restoreStyle(element: HTMLElement | SVGElement, style: string | null): void {
  if (style === null) {
    element.removeAttribute("style");
  } else {
    element.setAttribute("style", style);
  }
}

function clampPanOffset(offset: number, scaledContentSize: number, viewportSize: number): number {
  if (scaledContentSize <= viewportSize) {
    return Math.min(viewportSize - scaledContentSize, Math.max(0, offset));
  }
  return Math.min(
    viewportSize - MIN_VISIBLE_EDGE,
    Math.max(MIN_VISIBLE_EDGE - scaledContentSize, offset),
  );
}

// Panzoom treats a root <svg> as HTML, so its focal zoom math uses a 50% transform origin.
function visualOffsetFromPan(contentSize: number, pan: number, scale: number): number {
  return ((1 - scale) * contentSize) / 2 + pan * scale;
}

function panFromVisualOffset(contentSize: number, offset: number, scale: number): number {
  return (offset - ((1 - scale) * contentSize) / 2) / scale;
}

function centeredPan(contentSize: number, viewportSize: number, scale: number): number {
  const centeredOffset = (viewportSize - contentSize * scale) / 2;
  return panFromVisualOffset(contentSize, centeredOffset, scale);
}

export function createMermaidPanZoom(
  viewport: HTMLElement,
  svg: SVGSVGElement,
): MermaidPanZoomController {
  const originalViewportStyle = viewport.getAttribute("style");
  const originalSvgStyle = svg.getAttribute("style");
  const svgSize = readSvgSize(svg);
  const viewportSize = readViewportSize(viewport);
  const fitScale = Math.min(
    1,
    viewportSize.width / svgSize.width,
    viewportSize.height / svgSize.height,
  );
  const startX = centeredPan(svgSize.width, viewportSize.width, fitScale);
  const startY = centeredPan(svgSize.height, viewportSize.height, fitScale);

  svg.style.width = `${svgSize.width}px`;
  svg.style.height = `${svgSize.height}px`;
  svg.style.maxWidth = "none";

  let panzoomForCorrection: ReturnType<typeof Panzoom> | null = null;
  let correctingPan = false;
  const panzoom = Panzoom(svg, {
    canvas: true,
    cursor: "grab",
    maxScale: MAX_SCALE,
    minScale: Math.min(MIN_SCALE, fitScale),
    origin: "50% 50%",
    pinchAndPan: true,
    startScale: fitScale,
    startX,
    startY,
    step: ZOOM_STEP,
    setTransform: (element, { x, y, scale }) => {
      const currentViewportSize = readViewportSize(viewport);
      const clampedLeft = clampPanOffset(
        visualOffsetFromPan(svgSize.width, x, scale),
        svgSize.width * scale,
        currentViewportSize.width,
      );
      const clampedTop = clampPanOffset(
        visualOffsetFromPan(svgSize.height, y, scale),
        svgSize.height * scale,
        currentViewportSize.height,
      );
      const clampedX = panFromVisualOffset(svgSize.width, clampedLeft, scale);
      const clampedY = panFromVisualOffset(svgSize.height, clampedTop, scale);
      element.style.transform = `scale(${scale}) translate(${clampedX}px, ${clampedY}px)`;

      if (panzoomForCorrection && !correctingPan && (clampedX !== x || clampedY !== y)) {
        correctingPan = true;
        panzoomForCorrection.pan(clampedX, clampedY, {
          animate: false,
          force: true,
          silent: true,
        });
        correctingPan = false;
      }
    },
  });
  panzoomForCorrection = panzoom;
  let mode: MermaidViewportMode = "pan";
  let pointerEventsBound = true;

  const handleWheel = (event: WheelEvent) => {
    if (mode === "select") return;
    panzoom.zoomWithWheel(event, { force: true });
  };
  viewport.addEventListener("wheel", handleWheel, { passive: false });

  const centerAtScale = (scale: number) => {
    const nextViewportSize = readViewportSize(viewport);
    panzoom.reset({
      animate: false,
      force: true,
      startScale: scale,
      startX: centeredPan(svgSize.width, nextViewportSize.width, scale),
      startY: centeredPan(svgSize.height, nextViewportSize.height, scale),
    });
  };

  const fit = () => {
    const nextViewportSize = readViewportSize(viewport);
    const nextFitScale = Math.min(
      1,
      nextViewportSize.width / svgSize.width,
      nextViewportSize.height / svgSize.height,
    );
    panzoom.setOptions({ minScale: Math.min(MIN_SCALE, nextFitScale) });
    centerAtScale(nextFitScale);
  };

  const zoomBy = (direction: 1 | -1) => {
    const bounds = viewport.getBoundingClientRect();
    const nextScale = Math.min(
      MAX_SCALE,
      Math.max(
        panzoom.getOptions().minScale ?? MIN_SCALE,
        panzoom.getScale() * Math.exp(direction * ZOOM_STEP),
      ),
    );
    panzoom.zoomToPoint(
      nextScale,
      {
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + bounds.height / 2,
      },
      { force: true },
    );
  };

  let observedViewportSize = viewportSize;
  const resizeObserver =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          const nextViewportSize = readViewportSize(viewport);
          if (
            nextViewportSize.width === observedViewportSize.width &&
            nextViewportSize.height === observedViewportSize.height
          ) {
            return;
          }
          observedViewportSize = nextViewportSize;
          fit();
        });
  resizeObserver?.observe(viewport);

  return {
    execute(command) {
      switch (command.type) {
        case "fit":
          fit();
          return;
        case "reset":
          centerAtScale(1);
          return;
        case "zoom-in":
          zoomBy(1);
          return;
        case "zoom-out":
          zoomBy(-1);
          return;
      }
    },
    setMode(nextMode) {
      if (mode === nextMode) return;
      mode = nextMode;

      if (mode === "select") {
        if (pointerEventsBound) {
          panzoom.destroy();
          pointerEventsBound = false;
        }
        panzoom.setOptions({
          cursor: "text",
          disablePan: true,
          disableZoom: true,
          touchAction: "auto",
        });
        viewport.style.userSelect = "text";
        svg.style.userSelect = "text";
        return;
      }

      panzoom.setOptions({
        cursor: "grab",
        disablePan: false,
        disableZoom: false,
        touchAction: "none",
      });
      viewport.style.userSelect = "none";
      svg.style.userSelect = "none";
      if (!pointerEventsBound) {
        panzoom.bind();
        pointerEventsBound = true;
      }
    },
    destroy() {
      resizeObserver?.disconnect();
      viewport.removeEventListener("wheel", handleWheel);
      if (pointerEventsBound) panzoom.destroy();
      restoreStyle(viewport, originalViewportStyle);
      restoreStyle(svg, originalSvgStyle);
    },
  };
}
