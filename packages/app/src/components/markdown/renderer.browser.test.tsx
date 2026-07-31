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

async function findVisibleSvg(
  container: HTMLElement,
  timeoutMs: number,
): Promise<SVGSVGElement | null> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    const svg = container.querySelector<SVGSVGElement>("svg");
    if (svg?.parentElement && getComputedStyle(svg.parentElement).display !== "none") {
      return svg;
    }
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  }
  return null;
}

async function waitForSvg(container: HTMLElement): Promise<SVGSVGElement> {
  const svg = await findVisibleSvg(container, 5_000);
  if (svg) return svg;
  throw new Error("Timed out waiting for Mermaid SVG");
}

async function waitForSvgCount(container: HTMLElement, count: number): Promise<void> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < 5_000) {
    if (container.querySelectorAll("svg").length >= count) return;
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  }
  throw new Error(`Timed out waiting for ${count} Mermaid SVGs`);
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

  it("renders a closed Mermaid fence as selectable SVG text", async () => {
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

    const svg = await waitForSvg(container);
    const startLabel = Array.from(svg.querySelectorAll("text")).find(
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

    expect(await findVisibleSvg(container, 1_500)).toBeNull();
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

    expect(container.querySelector("svg")).toBeNull();
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

    expect(await findVisibleSvg(container, 1_500)).toBeNull();
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

    expect(await findVisibleSvg(container, 1_500)).toBeNull();
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

    expect(await findVisibleSvg(container, 1_500)).toBeNull();
    expect(container.textContent).toContain(source);
  });

  it("renders br labels as selectable multiline SVG text", async () => {
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

    const svg = await waitForSvg(container);
    const label = Array.from(svg.querySelectorAll("text")).find((element) =>
      element.textContent?.includes("First line"),
    );
    const lines = Array.from(label?.querySelectorAll(":scope > tspan.text-outer-tspan") ?? [])
      .map((element) => element.textContent?.trim())
      .filter(Boolean);

    expect(lines).toEqual(["First line", "Second line"]);
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

    await waitForSvg(container);

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
    await waitForSvgCount(document.body, 2);
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

    expect(await findVisibleSvg(container, 1_500)).toBeNull();
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

    const svg = await waitForSvg(container);
    expect(svg.textContent).toContain("New");
    expect(svg.textContent).not.toContain("Old");
  });
});
