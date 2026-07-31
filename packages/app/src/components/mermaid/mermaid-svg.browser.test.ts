import { describe, expect, it } from "vitest";
import { parseAndValidateMermaidSvg } from "./mermaid-svg";

describe("parseAndValidateMermaidSvg", () => {
  it("rejects external references", () => {
    expect(() =>
      parseAndValidateMermaidSvg(
        '<svg xmlns="http://www.w3.org/2000/svg"><a href="https://example.com"><text>A</text></a></svg>',
      ),
    ).toThrow("external reference");
  });

  it("rejects executable elements", () => {
    expect(() =>
      parseAndValidateMermaidSvg(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ),
    ).toThrow("prohibited element");
  });

  it("rejects embedded content", () => {
    expect(() =>
      parseAndValidateMermaidSvg(
        '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>HTML</div></foreignObject></svg>',
      ),
    ).toThrow("prohibited element");
  });

  it("rejects event handler attributes", () => {
    expect(() =>
      parseAndValidateMermaidSvg(
        '<svg xmlns="http://www.w3.org/2000/svg"><text onclick="alert(1)">A</text></svg>',
      ),
    ).toThrow("event handler");
  });

  it("rejects external resources in styles", () => {
    expect(() =>
      parseAndValidateMermaidSvg(
        '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url("https://example.com/style.css");</style></svg>',
      ),
    ).toThrow("unsafe style");
  });
});
