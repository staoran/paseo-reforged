import mermaid from "mermaid";
import {
  createMermaidConfig,
  type MermaidRenderTheme,
} from "@/components/mermaid/mermaid-render-theme";
import { prepareMermaidSource } from "@/components/mermaid/mermaid-source";
import { parseAndValidateMermaidSvg } from "@/components/mermaid/mermaid-svg";

interface RenderMessage {
  type: "render";
  requestId: number;
  source: string;
  theme: MermaidRenderTheme;
}

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

const THEME_KEYS: readonly (keyof MermaidRenderTheme)[] = [
  "background",
  "border",
  "foreground",
  "foregroundMuted",
  "fontFamily",
  "surface",
  "surfaceRaised",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRenderMessage(value: unknown): value is RenderMessage {
  if (!isRecord(value) || value.type !== "render") return false;
  if (!Number.isInteger(value.requestId) || (value.requestId as number) < 0) return false;
  const theme = value.theme;
  if (typeof value.source !== "string" || !isRecord(theme)) return false;
  return THEME_KEYS.every((key) => typeof theme[key] === "string");
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

function measureHeight(): number {
  const bounds = root.getBoundingClientRect();
  return Math.max(1, Math.ceil(root.scrollHeight || bounds.height));
}

function reportHeight(type: "height" | "rendered", requestId: number): void {
  sendToNative({ type, requestId, height: measureHeight() });
}

async function renderMessage(message: RenderMessage): Promise<void> {
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
  svgNode.style.maxWidth = "100%";
  svgNode.style.userSelect = "text";
  root.replaceChildren(svgNode);
  renderedRequestId = message.requestId;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  if (message.requestId === activeRequestId) {
    reportHeight("rendered", message.requestId);
  }
}

window.__PASEO_MERMAID_WEBVIEW_RECEIVE__ = (value: unknown) => {
  if (!isRenderMessage(value)) return;
  activeRequestId = value.requestId;
  renderedRequestId = -1;
  root.replaceChildren();

  const run = () => renderMessage(value);
  const result = renderQueue.then(run, run);
  renderQueue = result.then(
    () => undefined,
    () => undefined,
  );
  void result.catch(() => {
    if (value.requestId !== activeRequestId) return;
    root.replaceChildren();
    sendToNative({ type: "error", requestId: value.requestId, code: "render-failed" });
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
