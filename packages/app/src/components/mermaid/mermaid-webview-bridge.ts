import type { MermaidRenderTheme } from "@/components/mermaid/mermaid-render-theme";
import type {
  MermaidViewportCommand,
  MermaidViewportConfig,
} from "@/components/mermaid/mermaid-surface-types";

export interface MermaidWebViewRenderMessage {
  type: "render";
  requestId: number;
  source: string;
  theme: MermaidRenderTheme;
  viewport: MermaidViewportConfig | null;
}

export interface MermaidWebViewViewportMessage {
  type: "viewport";
  requestId: number;
  viewport: MermaidViewportConfig;
}

export type MermaidWebViewInboundMessage =
  | MermaidWebViewRenderMessage
  | MermaidWebViewViewportMessage;

export type MermaidWebViewOutboundMessage =
  | { type: "ready" }
  | { type: "rendered"; requestId: number; height: number }
  | { type: "height"; requestId: number; height: number }
  | { type: "error"; requestId: number; code: string };

export interface MermaidBridgeState {
  activeRequestId: number;
  bridgeReady: boolean;
  height: number;
  status: "error" | "loading" | "ready";
}

const INITIAL_MERMAID_HEIGHT = 80;
const MIN_MERMAID_HEIGHT = 40;
const MAX_MERMAID_HEIGHT = 10_000;
const MERMAID_THEME_KEYS: readonly (keyof MermaidRenderTheme)[] = [
  "background",
  "border",
  "foreground",
  "foregroundMuted",
  "fontFamily",
  "surface",
  "surfaceRaised",
];
const MERMAID_VIEWPORT_COMMAND_TYPES = new Set<MermaidViewportCommand["type"]>([
  "fit",
  "reset",
  "zoom-in",
  "zoom-out",
]);

function normalizeHeight(height: number): number {
  return Math.min(MAX_MERMAID_HEIGHT, Math.max(MIN_MERMAID_HEIGHT, Math.ceil(height)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRequestId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isHeight(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isMermaidRenderTheme(value: unknown): value is MermaidRenderTheme {
  return isRecord(value) && MERMAID_THEME_KEYS.every((key) => typeof value[key] === "string");
}

function isMermaidViewportCommand(value: unknown): value is MermaidViewportCommand {
  return (
    isRecord(value) &&
    isRequestId(value.id) &&
    typeof value.type === "string" &&
    MERMAID_VIEWPORT_COMMAND_TYPES.has(value.type as MermaidViewportCommand["type"])
  );
}

function isMermaidViewportConfig(value: unknown): value is MermaidViewportConfig {
  return (
    isRecord(value) &&
    (value.mode === "pan" || value.mode === "select") &&
    (value.command === null || isMermaidViewportCommand(value.command))
  );
}

export function parseMermaidWebViewInboundMessage(
  value: unknown,
): MermaidWebViewInboundMessage | null {
  if (!isRecord(value) || !isRequestId(value.requestId)) return null;

  if (value.type === "render") {
    if (
      typeof value.source !== "string" ||
      !isMermaidRenderTheme(value.theme) ||
      (value.viewport !== null && !isMermaidViewportConfig(value.viewport))
    ) {
      return null;
    }
    return {
      type: "render",
      requestId: value.requestId,
      source: value.source,
      theme: value.theme,
      viewport: value.viewport,
    };
  }

  if (value.type === "viewport" && isMermaidViewportConfig(value.viewport)) {
    return {
      type: "viewport",
      requestId: value.requestId,
      viewport: value.viewport,
    };
  }

  return null;
}

export function parseMermaidWebViewMessage(data: string): MermaidWebViewOutboundMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || typeof parsed.type !== "string") return null;
  if (parsed.type === "ready") return { type: "ready" };
  if (!isRequestId(parsed.requestId)) return null;

  if (parsed.type === "rendered" || parsed.type === "height") {
    if (!isHeight(parsed.height)) return null;
    return { type: parsed.type, requestId: parsed.requestId, height: parsed.height };
  }

  if (parsed.type === "error" && typeof parsed.code === "string") {
    return { type: "error", requestId: parsed.requestId, code: parsed.code };
  }

  return null;
}

export function createMermaidBridgeState(activeRequestId: number): MermaidBridgeState {
  return {
    activeRequestId,
    bridgeReady: false,
    height: INITIAL_MERMAID_HEIGHT,
    status: "loading",
  };
}

export function reduceMermaidBridgeState(
  state: MermaidBridgeState,
  message: MermaidWebViewOutboundMessage,
): MermaidBridgeState {
  if (message.type !== "ready" && message.requestId !== state.activeRequestId) {
    return state;
  }

  switch (message.type) {
    case "ready":
      return { ...state, bridgeReady: true };
    case "rendered":
      return { ...state, height: normalizeHeight(message.height), status: "ready" };
    case "height":
      return { ...state, height: normalizeHeight(message.height) };
    case "error":
      return { ...state, status: "error" };
  }
}
