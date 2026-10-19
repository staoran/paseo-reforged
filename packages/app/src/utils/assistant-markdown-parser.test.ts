import { describe, expect, it } from "vitest";
import { createAssistantMarkdownParser } from "./assistant-markdown-parser";

describe("createAssistantMarkdownParser", () => {
  it.each([
    ["**外发。**例如", "<strong>外发。</strong>例如"],
    ["**核销”**这些", "<strong>核销”</strong>这些"],
    ["**A。**B**C**", "<strong>A。<strong>B</strong>C</strong>"],
    [
      "[**句末。**后续](https://example.com)",
      '<a href="https://example.com"><strong>句末。</strong>后续</a>',
    ],
    ["\\*\\*外发。\\*\\*例如", "**外发。**例如"],
  ])("keeps completed clipboard strong and literal text intact: %s", (source, expected) => {
    expect(createAssistantMarkdownParser().renderInline(source)).toBe(expected);
  });
  it("keeps ordinary parsing for completed messages", () => {
    const parser = createAssistantMarkdownParser();
    expect(parser.renderInline("**unfinished")).toBe("**unfinished");
    expect(parser.renderInline("[unfinished")).toBe("[unfinished");
  });

  it("renders agent text verbatim", () => {
    const parser = createAssistantMarkdownParser();

    // The reported bug, plus the substitutions that share its cause.
    expect(parser.renderInline("(c) (C) (r) (tm) (p)")).toBe("(c) (C) (r) (tm) (p)");
    expect(parser.renderInline("wait for it...")).toBe("wait for it...");
    expect(parser.renderInline("a -- b")).toBe("a -- b");
    // Smart quotes are off too: a curled quote is not pasteable into a shell.
    expect(parser.renderInline(`run --name="my repo"`)).toBe("run --name=&quot;my repo&quot;");
    expect(parser.renderInline("it's fine")).toBe("it's fine");
  });

  it("allows file:// links, unlike every other parser", () => {
    const parser = createAssistantMarkdownParser();

    expect(parser.render("[open](file:///tmp/a.ts)")).toContain('href="file:///tmp/a.ts"');
  });

  it("still rejects javascript: links", () => {
    const parser = createAssistantMarkdownParser();

    expect(parser.render("[x](javascript:alert(1))")).not.toContain("href");
  });
});
