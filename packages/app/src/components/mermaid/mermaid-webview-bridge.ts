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
