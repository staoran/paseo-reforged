import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";

void i18n;

vi.mock("react-native-reanimated", () => ({
  default: {
    View: "div",
  },
  FadeIn: {},
  FadeOut: {},
}));

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  React,
});

async function findVisibleDiagram(
  container: HTMLElement,
  timeoutMs: number,
): Promise<HTMLElement | null> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    const diagram = container.querySelector<HTMLElement>('[role="img"]');
    if (diagram && getComputedStyle(diagram).display !== "none") {
      return diagram;
    }
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  }
  return null;
}

async function waitForDiagram(container: HTMLElement): Promise<HTMLElement> {
  const diagram = await findVisibleDiagram(container, 5_000);
  if (diagram) return diagram;
  throw new Error("Timed out waiting for Mermaid diagram");
}

async function waitForFrameCount(container: HTMLElement, count: number): Promise<void> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < 5_000) {
    if (container.querySelectorAll("iframe").length >= count) return;
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  }
  throw new Error(`Timed out waiting for ${count} Mermaid frames`);
}

describe("MarkdownRenderer Mermaid fences", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  it("renders a closed Mermaid fence through a sandboxed runtime", async () => {
    const { MarkdownRenderer } = await import("./renderer");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <MarkdownRenderer
          enableHtmlish={false}
          text={'```mermaid\nflowchart LR\n  Start["Start"] --> Finish["Finish"]\n```'}
        />,
      );
    });

    const diagram = await waitForDiagram(container);
    const frame = diagram.querySelector("iframe");
    expect(frame?.sandbox.contains("allow-scripts")).toBe(true);
    expect(frame?.sandbox.contains("allow-same-origin")).toBe(false);
  });

  it("keeps an unclosed Mermaid fence as source while content is streaming", async () => {
    const { MarkdownRenderer } = await import("./renderer");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <MarkdownRenderer
          enableHtmlish={false}
          text={'```mermaid\nflowchart LR\n  Start["Start"] --> Finish["Finish"]'}
        />,
      );
    });

    expect(await findVisibleDiagram(container, 1_500)).toBeNull();
    expect(container.textContent).toContain("flowchart LR");
  });

  it("keeps non-Mermaid fences as source code", async () => {
    const { MarkdownRenderer } = await import("./renderer");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <MarkdownRenderer enableHtmlish={false} text={"```typescript\nconst answer = 42;\n```"} />,
      );
    });

    expect(container.querySelector('[role="img"]')).toBeNull();
    expect(container.textContent).toContain("const answer = 42;");
  });

  it("falls back to source when a Mermaid init directive is present", async () => {
    const { MarkdownRenderer } = await import("./renderer");
    const source = '%%{init: {"securityLevel": "loose"}}%%\nflowchart LR\n  A --> B';
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <MarkdownRenderer enableHtmlish={false} text={`\`\`\`mermaid\n${source}\n\`\`\``} />,
      );
    });

    expect(await findVisibleDiagram(container, 1_500)).toBeNull();
    expect(container.textContent).toContain(source);
  });

  it("falls back to source when a Mermaid click action is present", async () => {
    const { MarkdownRenderer } = await import("./renderer");
    const source = 'flowchart LR\n  A --> B\n  click A "https://example.com"';
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <MarkdownRenderer enableHtmlish={false} text={`\`\`\`mermaid\n${source}\n\`\`\``} />,
      );
    });

    expect(await findVisibleDiagram(container, 1_500)).toBeNull();
    expect(container.textContent).toContain(source);
  });

  it("falls back to source when Mermaid frontmatter is present", async () => {
    const { MarkdownRenderer } = await import("./renderer");
    const source = "---\nconfig:\n  theme: dark\n---\nflowchart LR\n  A --> B";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <MarkdownRenderer enableHtmlish={false} text={`\`\`\`mermaid\n${source}\n\`\`\``} />,
      );
    });

    expect(await findVisibleDiagram(container, 1_500)).toBeNull();
    expect(container.textContent).toContain(source);
  });

  it("renders Mermaid labels with HTML line breaks instead of falling back to source", async () => {
    const { MarkdownRenderer } = await import("./renderer");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <MarkdownRenderer
          enableHtmlish={false}
          text={'```mermaid\nflowchart LR\n  A["First line<br/>Second line"]\n```'}
        />,
      );
    });

    await waitForDiagram(container);
    expect(container.textContent).not.toContain("flowchart LR");
  });

  it("offers source, copy, and expanded preview actions after rendering", async () => {
    const { MarkdownRenderer } = await import("./renderer");
    const clipboard = (await import("expo-clipboard")) as unknown as {
      getClipboardStringForTests: () => string;
    };
    const source = "flowchart LR\n  A --> B";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <MarkdownRenderer enableHtmlish={false} text={`\`\`\`mermaid\n${source}\n\`\`\``} />,
      );
    });

    await waitForDiagram(container);

    const [showSource, copySource, expand] = Array.from(
      container.querySelectorAll<HTMLElement>('[role="button"]'),
    );
    expect(showSource?.getAttribute("aria-label")).toBeTruthy();
    expect(copySource?.getAttribute("aria-label")).toBeTruthy();
    expect(expand?.getAttribute("aria-label")).toBeTruthy();

    act(() => showSource?.click());
    expect(container.textContent).toContain(source);

    await act(async () => {
      copySource?.click();
      await Promise.resolve();
    });
    expect(clipboard.getClipboardStringForTests()).toBe(`${source}\n`);

    act(() => expand?.click());
    await waitForFrameCount(document.body, 2);
  });

  it("falls back to source when Mermaid syntax is invalid", async () => {
    const { MarkdownRenderer } = await import("./renderer");
    const source = "this is not a Mermaid diagram";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <MarkdownRenderer enableHtmlish={false} text={`\`\`\`mermaid\n${source}\n\`\`\``} />,
      );
    });

    expect(await findVisibleDiagram(container, 1_500)).toBeNull();
    expect(container.textContent).toContain(source);
  });

  it("keeps only the latest SVG when source changes during rendering", async () => {
    const { MarkdownRenderer } = await import("./renderer");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <MarkdownRenderer
          enableHtmlish={false}
          text={'```mermaid\nflowchart LR\n  A["Old"]\n```'}
        />,
      );
    });
    await act(async () => {
      root?.render(
        <MarkdownRenderer
          enableHtmlish={false}
          text={'```mermaid\nflowchart LR\n  A["New"]\n```'}
        />,
      );
    });

    await waitForDiagram(container);
    const showSource = container.querySelector<HTMLElement>('[role="button"]');
    act(() => showSource?.click());
    expect(container.textContent).toContain('A["New"]');
    expect(container.textContent).not.toContain('A["Old"]');
  });
});
