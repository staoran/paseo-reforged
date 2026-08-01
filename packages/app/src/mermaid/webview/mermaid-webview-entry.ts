import mermaid from "mermaid";
import { createMermaidConfig } from "@/components/mermaid/mermaid-render-theme";
import { prepareMermaidSource } from "@/components/mermaid/mermaid-source";
import { parseAndValidateMermaidSvg } from "@/components/mermaid/mermaid-svg";
import {
  parseMermaidWebViewInboundMessage,
  type MermaidWebViewRenderMessage,
} from "@/components/mermaid/mermaid-webview-bridge";
import type { MermaidViewportConfig } from "@/components/mermaid/mermaid-surface-types";
import {
  createMermaidPanZoom,
  type MermaidPanZoomController,
} from "@/mermaid/panzoom/mermaid-pan-zoom";

type OutboundMessage =
  | { type: "ready" }
  | { type: "rendered"; requestId: number; height: number }
  | { type: "height"; requestId: number; height: number }
  | { type: "error"; requestId: number; code: string };

declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage?: (data: string) => void;
    };
    __PASEO_MERMAID_WEBVIEW_RECEIVE__?: (message: unknown) => void;
  }
}

function sendToNative(message: OutboundMessage): void {
  window.ReactNativeWebView?.postMessage?.(JSON.stringify(message));
}

function installDocument(): HTMLDivElement {
  const style = document.createElement("style");
  style.textContent = `
html,
body {
  width: 100%;
  min-height: 1px;
  margin: 0;
  padding: 0;
  overflow-x: auto;
  overflow-y: hidden;
  background: transparent;
  overscroll-behavior: contain;
  -webkit-user-select: text;
  user-select: text;
}
#mermaid-root {
  box-sizing: border-box;
  width: 100%;
  min-height: 1px;
  padding: 0;
  -webkit-user-select: text;
  user-select: text;
}
.mermaid-viewport,
.mermaid-viewport body,
.mermaid-viewport #mermaid-root {
  height: 100%;
  overflow: hidden;
}
#mermaid-root svg {
  display: block;
  max-width: 100%;
  height: auto;
  -webkit-user-select: text;
  user-select: text;
}
`;
  document.head.appendChild(style);

  const existing = document.getElementById("mermaid-root");
  existing?.remove();
  const root = document.createElement("div");
  root.id = "mermaid-root";
  document.body.appendChild(root);
  return root;
}

const root = installDocument();
let activeRequestId = -1;
let renderedRequestId = -1;
let renderQueue = Promise.resolve();
let activeViewport: MermaidViewportConfig | null = null;
let panZoomController: MermaidPanZoomController | null = null;
let lastViewportCommandId = -1;

function setViewportLayout(enabled: boolean): void {
  document.documentElement.classList.toggle("mermaid-viewport", enabled);
}

function destroyPanZoomController(): void {
  panZoomController?.destroy();
  panZoomController = null;
}

function applyActiveViewport(): void {
  if (!activeViewport || !panZoomController) return;
  panZoomController.setMode(activeViewport.mode);
  const command = activeViewport.command;
  if (!command || command.id <= lastViewportCommandId) return;
  lastViewportCommandId = command.id;
  panZoomController.execute(command);
}

function measureHeight(): number {
  const bounds = root.getBoundingClientRect();
  return Math.max(1, Math.ceil(root.scrollHeight || bounds.height));
}

function reportHeight(type: "height" | "rendered", requestId: number): void {
  sendToNative({ type, requestId, height: measureHeight() });
}

async function renderMessage(message: MermaidWebViewRenderMessage): Promise<void> {
  const prepared = prepareMermaidSource(message.source);
  if (!prepared.ok) {
    throw new Error(`source-${prepared.reason}`);
  }

  mermaid.initialize(createMermaidConfig(message.theme));
  const { svg } = await mermaid.render(
    `paseo-mermaid-native-${message.requestId}`,
    prepared.source,
  );
  if (message.requestId !== activeRequestId) return;

  const svgNode = parseAndValidateMermaidSvg(svg);
  svgNode.style.display = "block";
  svgNode.style.height = "auto";
  svgNode.style.userSelect = "text";
  if (!activeViewport) svgNode.style.maxWidth = "100%";
  root.replaceChildren(svgNode);
  if (activeViewport) {
    setViewportLayout(true);
    panZoomController = createMermaidPanZoom(root, svgNode);
    applyActiveViewport();
  }
  renderedRequestId = message.requestId;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  if (message.requestId === activeRequestId) {
    reportHeight("rendered", message.requestId);
  }
}

window.__PASEO_MERMAID_WEBVIEW_RECEIVE__ = (value: unknown) => {
  const message = parseMermaidWebViewInboundMessage(value);
  if (!message) return;

  if (message.type === "viewport") {
    if (message.requestId !== activeRequestId) return;
    activeViewport = message.viewport;
    setViewportLayout(true);
    applyActiveViewport();
    return;
  }

  activeRequestId = message.requestId;
  renderedRequestId = -1;
  activeViewport = message.viewport;
  lastViewportCommandId = -1;
  destroyPanZoomController();
  setViewportLayout(activeViewport !== null);
  root.replaceChildren();

  const run = () => renderMessage(message);
  const result = renderQueue.then(run, run);
  renderQueue = result.then(
    () => undefined,
    () => undefined,
  );
  void result.catch(() => {
    if (message.requestId !== activeRequestId) return;
    destroyPanZoomController();
    root.replaceChildren();
    sendToNative({ type: "error", requestId: message.requestId, code: "render-failed" });
  });
};

if (typeof ResizeObserver !== "undefined") {
  const observer = new ResizeObserver(() => {
    if (renderedRequestId === activeRequestId && renderedRequestId >= 0) {
      reportHeight("height", renderedRequestId);
    }
  });
  observer.observe(root);
}

sendToNative({ type: "ready" });
