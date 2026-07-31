import { describe, expect, it } from "vitest";
import { prepareMermaidSource } from "./mermaid-source";

describe("prepareMermaidSource", () => {
  it("rejects source larger than 100,000 characters", () => {
    expect(prepareMermaidSource("x".repeat(100_001))).toEqual({
      ok: false,
      reason: "too-large",
    });
  });

  it("rejects empty source", () => {
    expect(prepareMermaidSource(" \n\t ")).toEqual({
      ok: false,
      reason: "empty",
    });
  });

  it("rejects an unterminated directive", () => {
    expect(prepareMermaidSource("%%{init: {\nflowchart LR\n  A --> B")).toEqual({
      ok: false,
      reason: "directive",
    });
  });

  it("rejects external resource URLs before Mermaid can load them", () => {
    expect(
      prepareMermaidSource('flowchart LR\n  image@{ img: "https://example.com/image.png" }'),
    ).toEqual({
      ok: false,
      reason: "external-reference",
    });
  });
});
