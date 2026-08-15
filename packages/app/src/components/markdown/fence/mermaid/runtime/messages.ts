import type { DiagramColorScheme, DiagramDimensions } from "../render-model";
import type { MermaidViewportCommand, MermaidViewportMode } from "../viewport-controller";

export interface MermaidRuntimeRenderMessage {
  type: "render";
  revision: number;
  source: string;
  colorScheme: DiagramColorScheme;
  interactive: boolean;
}

export interface MermaidRuntimeViewportMessage {
  type: "viewport";
  revision: number;
  mode: MermaidViewportMode;
  command: MermaidRuntimeViewportCommand | null;
}

export interface MermaidRuntimeViewportCommand {
  id: number;
  type: MermaidViewportCommand;
}

export type MermaidRuntimeInboundMessage =
  | MermaidRuntimeRenderMessage
  | MermaidRuntimeViewportMessage;

export type MermaidRuntimeMessage =
  | { type: "bridgeReady" }
  | ({
      type: "rendered";
      revision: number;
      source: string;
      colorScheme: DiagramColorScheme;
    } & DiagramDimensions)
  | { type: "renderError"; revision: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isColorScheme(value: unknown): value is DiagramColorScheme {
  return value === "light" || value === "dark";
}

function isViewportMode(value: unknown): value is MermaidViewportMode {
  return value === "pan" || value === "select";
}

function isViewportCommand(value: unknown): value is MermaidRuntimeViewportCommand {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    Number.isInteger(value.id) &&
    value.id >= 0 &&
    (value.type === "fit" ||
      value.type === "reset" ||
      value.type === "zoom-in" ||
      value.type === "zoom-out")
  );
}

export function parseMermaidRuntimeRenderMessage(
  value: unknown,
): MermaidRuntimeRenderMessage | null {
  if (
    !isRecord(value) ||
    value.type !== "render" ||
    typeof value.revision !== "number" ||
    !Number.isInteger(value.revision) ||
    typeof value.source !== "string" ||
    !isColorScheme(value.colorScheme) ||
    typeof value.interactive !== "boolean"
  ) {
    return null;
  }
  return {
    type: "render",
    revision: value.revision,
    source: value.source,
    colorScheme: value.colorScheme,
    interactive: value.interactive,
  };
}

export function parseMermaidRuntimeInboundMessage(
  value: unknown,
): MermaidRuntimeInboundMessage | null {
  const renderMessage = parseMermaidRuntimeRenderMessage(value);
  if (renderMessage) {
    return renderMessage;
  }
  if (
    !isRecord(value) ||
    value.type !== "viewport" ||
    typeof value.revision !== "number" ||
    !Number.isInteger(value.revision) ||
    !isViewportMode(value.mode) ||
    (value.command !== null && !isViewportCommand(value.command))
  ) {
    return null;
  }
  return {
    type: "viewport",
    revision: value.revision,
    mode: value.mode,
    command: value.command,
  };
}

export function parseMermaidRuntimeMessage(value: unknown): MermaidRuntimeMessage | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }
  if (value.type === "bridgeReady") {
    return { type: "bridgeReady" };
  }
  if (
    value.type === "renderError" &&
    typeof value.revision === "number" &&
    Number.isInteger(value.revision)
  ) {
    return { type: "renderError", revision: value.revision };
  }
  if (
    value.type === "rendered" &&
    typeof value.revision === "number" &&
    Number.isInteger(value.revision) &&
    typeof value.source === "string" &&
    isColorScheme(value.colorScheme) &&
    typeof value.height === "number" &&
    Number.isFinite(value.height) &&
    typeof value.width === "number" &&
    Number.isFinite(value.width)
  ) {
    return {
      type: "rendered",
      revision: value.revision,
      source: value.source,
      colorScheme: value.colorScheme,
      height: value.height,
      width: value.width,
    };
  }
  return null;
}

export function serializeMermaidRuntimeRenderMessage(message: MermaidRuntimeRenderMessage): string {
  return JSON.stringify(message).replace(/<\/script/gi, "<\\/script");
}

export function serializeMermaidRuntimeInboundMessage(
  message: MermaidRuntimeInboundMessage,
): string {
  return JSON.stringify(message).replace(/<\/script/gi, "<\\/script");
}
