import mermaid from "mermaid";
import {
  parseMermaidRuntimeInboundMessage,
  type MermaidRuntimeInboundMessage,
  type MermaidRuntimeMessage,
  type MermaidRuntimeRenderMessage,
} from "./messages";
import {
  createMermaidViewportController,
  type MermaidViewportController,
  type MermaidViewportMode,
} from "../viewport-controller";

declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage?: (data: string) => void;
    };
    __PASEO_MERMAID_RUNTIME_RECEIVE__?: (message: unknown) => void;
  }
}

function sendToHost(message: MermaidRuntimeMessage): void {
  window.ReactNativeWebView?.postMessage?.(JSON.stringify(message));
  if (window.parent !== window) {
    window.parent.postMessage(message, "*");
  }
}

function initializeMermaid(colorScheme: "light" | "dark"): void {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    maxTextSize: 100_000,
    theme: colorScheme === "dark" ? "dark" : "default",
    secure: [
      "secure",
      "securityLevel",
      "startOnLoad",
      "maxTextSize",
      "suppressErrorRendering",
      "maxEdges",
      "theme",
      "themeVariables",
      "themeCSS",
    ],
    flowchart: { htmlLabels: false },
    class: { htmlLabels: false },
  });
}

function setViewport(interactive: boolean): void {
  document.documentElement.dataset.interactive = interactive ? "true" : "false";
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute(
      "content",
      interactive
        ? "width=device-width, initial-scale=1, maximum-scale=8"
        : "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
    );
}

let latestRevision = 0;
let pendingRender: MermaidRuntimeRenderMessage | null = null;
let isRendering = false;
let isDrainScheduled = false;
let viewportController: MermaidViewportController | null = null;
let viewportMode: MermaidViewportMode = "pan";
let lastViewportCommandId: number | null = null;

function replaceViewportController(
  interactive: boolean,
  dimensions: { height: number; width: number },
  svgNode: SVGSVGElement | null,
): void {
  viewportController?.destroy();
  viewportController = null;
  if (!interactive || !svgNode) {
    return;
  }
  const viewport = document.getElementById("viewport");
  const content = document.getElementById("diagram");
  if (!viewport || !content) {
    return;
  }
  viewportController = createMermaidViewportController({
    viewport,
    content,
    interactiveElement: svgNode,
    contentSize: dimensions,
  });
  viewportController.setMode(viewportMode);
}

async function render(message: MermaidRuntimeRenderMessage): Promise<void> {
  try {
    initializeMermaid(message.colorScheme);
    const { svg } = await mermaid.render(`paseo-mermaid-${message.revision}`, message.source);
    if (message.revision !== latestRevision) {
      return;
    }
    setViewport(message.interactive);
    const host = document.getElementById("diagram");
    if (!host) {
      return;
    }
    viewportController?.destroy();
    viewportController = null;
    host.innerHTML = svg;
    const svgNode = host.querySelector<SVGSVGElement>("svg");
    if (svgNode) {
      svgNode.style.userSelect = "text";
      svgNode.style.webkitUserSelect = "text";
    }
    const rect = svgNode?.getBoundingClientRect();
    const dimensions = {
      height: Math.ceil(rect?.height ?? host.scrollHeight),
      width: Math.ceil(rect?.width ?? host.scrollWidth),
    };
    replaceViewportController(message.interactive, dimensions, svgNode);
    sendToHost({
      type: "rendered",
      revision: message.revision,
      source: message.source,
      colorScheme: message.colorScheme,
      ...dimensions,
    });
  } catch {
    if (message.revision === latestRevision) {
      sendToHost({ type: "renderError", revision: message.revision });
    }
  }
}

async function drainRenderQueue(): Promise<void> {
  if (isRendering) {
    return;
  }
  isRendering = true;
  try {
    while (pendingRender) {
      const next = pendingRender;
      pendingRender = null;
      await render(next);
    }
  } finally {
    isRendering = false;
  }
}

function receiveMessage(value: unknown): void {
  const message: MermaidRuntimeInboundMessage | null = parseMermaidRuntimeInboundMessage(value);
  if (!message) {
    return;
  }
  if (message.type === "viewport") {
    if (message.revision !== latestRevision || !viewportController) {
      return;
    }
    viewportMode = message.mode;
    viewportController.setMode(message.mode);
    if (message.command && message.command.id !== lastViewportCommandId) {
      lastViewportCommandId = message.command.id;
      viewportController.execute(message.command.type);
    }
    return;
  }
  latestRevision = message.revision;
  pendingRender = message;
  if (isRendering || isDrainScheduled) {
    return;
  }
  isDrainScheduled = true;
  window.setTimeout(() => {
    isDrainScheduled = false;
    void drainRenderQueue();
  }, 0);
}

window.__PASEO_MERMAID_RUNTIME_RECEIVE__ = receiveMessage;
window.addEventListener("message", (event) => {
  if (event.source === window.parent) {
    receiveMessage(event.data);
  }
});

sendToHost({ type: "bridgeReady" });
