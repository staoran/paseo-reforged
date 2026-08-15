import { afterEach, describe, expect, it } from "vitest";
import { mermaidRuntimeHtml } from "./html.gen";
import { parseMermaidRuntimeMessage, type MermaidRuntimeMessage } from "./messages";

const mountedFrames: HTMLIFrameElement[] = [];

function waitForRuntimeMessage(
  frame: HTMLIFrameElement,
  predicate: (message: MermaidRuntimeMessage) => boolean,
): Promise<MermaidRuntimeMessage> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", receive);
      reject(new Error("Timed out waiting for Mermaid runtime"));
    }, 10_000);
    function receive(event: MessageEvent): void {
      if (event.source !== frame.contentWindow) {
        return;
      }
      const message = parseMermaidRuntimeMessage(event.data);
      if (!message || !predicate(message)) {
        return;
      }
      window.clearTimeout(timeout);
      window.removeEventListener("message", receive);
      resolve(message);
    }
    window.addEventListener("message", receive);
  });
}

async function mountRuntime({
  sandbox = true,
}: { sandbox?: boolean } = {}): Promise<HTMLIFrameElement> {
  const frame = document.createElement("iframe");
  if (sandbox) {
    frame.sandbox.add("allow-scripts");
  }
  const ready = waitForRuntimeMessage(frame, (message) => message.type === "bridgeReady");
  frame.srcdoc = mermaidRuntimeHtml;
  document.body.append(frame);
  mountedFrames.push(frame);
  await ready;
  return frame;
}

function render(
  frame: HTMLIFrameElement,
  input: { revision: number; source: string; interactive?: boolean },
): Promise<MermaidRuntimeMessage> {
  const response = waitForRuntimeMessage(
    frame,
    (message) =>
      message.type !== "bridgeReady" &&
      "revision" in message &&
      message.revision === input.revision,
  );
  frame.contentWindow?.postMessage(
    {
      type: "render",
      revision: input.revision,
      source: input.source,
      colorScheme: "dark",
      interactive: input.interactive ?? false,
    },
    "*",
  );
  return response;
}

afterEach(() => {
  for (const frame of mountedFrames.splice(0)) {
    frame.remove();
  }
});

describe("Mermaid sandbox runtime", () => {
  it("renders successive valid streaming prefixes and reports an invalid prefix", async () => {
    const frame = await mountRuntime();
    const firstSource = "flowchart TD\nA --> B";
    const secondSource = `${firstSource}\nB --> C`;

    const first = await render(frame, { revision: 1, source: firstSource });
    const invalid = await render(frame, { revision: 2, source: "not a mermaid diagram" });
    const second = await render(frame, { revision: 3, source: secondSource });

    expect(first).toMatchObject({ type: "rendered", revision: 1, source: firstSource });
    expect(invalid).toEqual({ type: "renderError", revision: 2 });
    expect(second).toMatchObject({ type: "rendered", revision: 3, source: secondSource });
  });

  it("coalesces queued input and never reports an obsolete result", async () => {
    const frame = await mountRuntime();
    const obsoleteSource = `flowchart TD\n${Array.from({ length: 250 }, (_, index) => `A${index} --> A${index + 1}`).join("\n")}`;
    const currentSource = "flowchart TD\nCurrent --> Result";
    const obsoleteResponses: MermaidRuntimeMessage[] = [];
    function collect(event: MessageEvent): void {
      if (event.source !== frame.contentWindow) {
        return;
      }
      const message = parseMermaidRuntimeMessage(event.data);
      if (message && message.type !== "bridgeReady" && message.revision === 10) {
        obsoleteResponses.push(message);
      }
    }
    window.addEventListener("message", collect);
    frame.contentWindow?.postMessage(
      {
        type: "render",
        revision: 10,
        source: obsoleteSource,
        colorScheme: "dark",
        interactive: false,
      },
      "*",
    );
    const current = await render(frame, { revision: 11, source: currentSource });
    window.removeEventListener("message", collect);

    expect(current).toMatchObject({ type: "rendered", revision: 11, source: currentSource });
    expect(obsoleteResponses).toEqual([]);
  });

  it("renders selectable multiline text and applies native viewport commands once", async () => {
    const frame = await mountRuntime({ sandbox: false });
    const source = 'flowchart TD\n  A["first<br/>second"] --> B[Done]';
    const response = await render(frame, { revision: 20, source, interactive: true });
    expect(response).toMatchObject({ type: "rendered", revision: 20, source });

    const frameDocument = frame.contentDocument;
    const svg = frameDocument?.querySelector<SVGSVGElement>("#diagram svg");
    const content = frameDocument?.querySelector<HTMLElement>("#diagram");
    expect(svg?.textContent).toContain("first");
    expect(svg?.textContent).toContain("second");
    expect(svg?.style.userSelect).toBe("text");
    expect(content?.style.userSelect).toBe("none");
    expect(content?.style.transform).toContain("scale(");

    frame.contentWindow?.postMessage(
      {
        type: "viewport",
        revision: 20,
        mode: "select",
        command: null,
      },
      "*",
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(svg?.style.pointerEvents).toBe("auto");
    expect(content?.style.userSelect).toBe("text");

    const initialTransform = content?.style.transform;
    frame.contentWindow?.postMessage(
      {
        type: "viewport",
        revision: 20,
        mode: "pan",
        command: { id: 1, type: "zoom-in" },
      },
      "*",
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(content?.style.transform).not.toBe(initialTransform);

    const zoomedTransform = content?.style.transform;
    frame.contentWindow?.postMessage(
      {
        type: "viewport",
        revision: 20,
        mode: "select",
        command: { id: 1, type: "zoom-in" },
      },
      "*",
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(content?.style.transform).toBe(zoomedTransform);
  });
});
