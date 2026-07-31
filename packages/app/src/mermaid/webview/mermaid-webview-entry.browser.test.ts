import { describe, expect, it, vi } from "vitest";

interface PostedMessage {
  type: string;
  requestId?: number;
  height?: number;
}

async function waitForMessage(
  messages: PostedMessage[],
  type: string,
  timeoutMs = 5_000,
): Promise<PostedMessage> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    const message = messages.find((candidate) => candidate.type === type);
    if (message) return message;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  throw new Error(`Timed out waiting for ${type}`);
}

describe("Mermaid WebView entry", () => {
  it("renders selectable SVG and reports the active request height", async () => {
    const messages: PostedMessage[] = [];
    const postMessage = vi.fn((data: string) => {
      messages.push(JSON.parse(data) as PostedMessage);
    });
    Object.assign(window, {
      ReactNativeWebView: { postMessage },
    });

    await import("./mermaid-webview-entry");
    await waitForMessage(messages, "ready");

    const receive = (
      window as typeof window & {
        __PASEO_MERMAID_WEBVIEW_RECEIVE__?: (message: unknown) => void;
      }
    ).__PASEO_MERMAID_WEBVIEW_RECEIVE__;
    expect(receive).toBeTypeOf("function");

    receive?.({
      type: "render",
      requestId: 4,
      source: 'flowchart LR\n  Start["Start"] --> Finish["Finish"]',
      theme: {
        background: "#ffffff",
        border: "#e4e4e7",
        foreground: "#111111",
        foregroundMuted: "#666666",
        fontFamily: "Arial, sans-serif",
        surface: "#fafafa",
        surfaceRaised: "#f4f4f5",
      },
    });

    const rendered = await waitForMessage(messages, "rendered");
    expect(rendered.requestId).toBe(4);
    expect(rendered.height).toBeGreaterThan(0);

    const startLabel = Array.from(document.querySelectorAll("svg text")).find(
      (element) => element.textContent === "Start",
    );
    expect(startLabel).toBeDefined();

    const range = document.createRange();
    range.selectNodeContents(startLabel as SVGTextElement);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(selection?.toString()).toBe("Start");
  });
});
