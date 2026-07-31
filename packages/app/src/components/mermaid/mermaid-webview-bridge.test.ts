import { describe, expect, it } from "vitest";
import {
  createMermaidBridgeState,
  parseMermaidWebViewMessage,
  reduceMermaidBridgeState,
} from "./mermaid-webview-bridge";

describe("Mermaid WebView bridge", () => {
  it("becomes ready and accepts the rendered height for the active request", () => {
    const initial = createMermaidBridgeState(7);
    const ready = reduceMermaidBridgeState(initial, { type: "ready" });
    const rendered = reduceMermaidBridgeState(ready, {
      type: "rendered",
      requestId: 7,
      height: 180,
    });

    expect(rendered).toEqual({
      activeRequestId: 7,
      bridgeReady: true,
      height: 180,
      status: "ready",
    });
  });

  it("ignores messages from a stale request", () => {
    const active = {
      ...createMermaidBridgeState(9),
      bridgeReady: true,
      height: 120,
    };

    expect(
      reduceMermaidBridgeState(active, {
        type: "rendered",
        requestId: 8,
        height: 999,
      }),
    ).toBe(active);
  });

  it("parses only valid bridge messages", () => {
    expect(parseMermaidWebViewMessage('{"type":"height","requestId":9,"height":240}')).toEqual({
      type: "height",
      requestId: 9,
      height: 240,
    });
    expect(parseMermaidWebViewMessage('{"type":"height","requestId":"9","height":240}')).toBe(null);
    expect(parseMermaidWebViewMessage("not json")).toBe(null);
  });

  it("caps reported height to protect the message layout", () => {
    const state = { ...createMermaidBridgeState(3), bridgeReady: true };

    expect(
      reduceMermaidBridgeState(state, {
        type: "rendered",
        requestId: 3,
        height: 1_000_000,
      }).height,
    ).toBe(10_000);
  });

  it("applies height updates and errors for the active request", () => {
    const ready = {
      ...createMermaidBridgeState(5),
      bridgeReady: true,
      status: "ready" as const,
    };
    const resized = reduceMermaidBridgeState(ready, {
      type: "height",
      requestId: 5,
      height: 260.2,
    });
    const failed = reduceMermaidBridgeState(resized, {
      type: "error",
      requestId: 5,
      code: "render-failed",
    });

    expect(resized.height).toBe(261);
    expect(failed.status).toBe("error");
  });
});
