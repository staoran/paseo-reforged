import { describe, expect, it } from "vitest";
import { createAssistantMarkdownParser } from "./assistant-markdown-parser";
import { createMarkdownParser } from "./markdown-parser";

describe("createAssistantMarkdownParser", () => {
  it.each([
    ["completed", false],
    ["streaming", true],
  ])("renders the reported adjacent-punctuation strong in %s text", (_phase, streaming) => {
    const parser = createAssistantMarkdownParser({ streaming });
    const source =
      "**外发员工预请款要单列一条线。**例如财务先给员工运营款 300 元，员工现场付承运方 220 元，再退回 80 元";

    expect(parser.renderInline(source)).toBe(
      "<strong>外发员工预请款要单列一条线。</strong>例如财务先给员工运营款 300 元，员工现场付承运方 220 元，再退回 80 元",
    );
  });

  it("keeps strong stable while the punctuation-adjacent closing marker arrives", () => {
    const parser = createAssistantMarkdownParser({ streaming: true });

    for (const source of ["**外发。", "**外发。*", "**外发。**"]) {
      expect(parser.renderInline(source)).toBe("<strong>外发。</strong>");
    }
    expect(parser.renderInline("**外发。**例如")).toBe("<strong>外发。</strong>例如");
  });

  it("preserves nested strong when the punctuation-adjacent marker already has a match", () => {
    for (const streaming of [false, true]) {
      expect(createAssistantMarkdownParser({ streaming }).renderInline("**A。**B**C**")).toBe(
        "<strong>A。<strong>B</strong>C</strong>",
      );
    }
  });

  it.each([
    ["**核销”**这些", "<strong>核销”</strong>这些"],
    ["前文。**后续**", "前文。<strong>后续</strong>"],
    [
      "[**句末。**后续](https://example.com)",
      '<a href="https://example.com"><strong>句末。</strong>后续</a>',
    ],
  ])("pairs adjacent strong without changing surrounding Markdown: %s", (source, expected) => {
    expect(createAssistantMarkdownParser().renderInline(source)).toBe(expected);
  });

  it("keeps the tolerance in assistant prose and leaves literal stars alone", () => {
    const parser = createAssistantMarkdownParser();
    const source = "**外发。**例如";

    expect(createMarkdownParser({ linkify: true }).renderInline(source)).toBe(source);
    expect(parser.renderInline("\\*\\*外发。\\*\\*例如")).toBe(source);
    expect(parser.renderInline("`**外发。**例如`")).toBe("<code>**外发。**例如</code>");
    expect(parser.render("```md\n**外发。**例如\n```")).not.toContain("<strong>");
    expect(parser.render("```md\n**外发。**例如\n```")).toContain(source);
  });

  it("keeps bold text bold through every partial closing marker", () => {
    const parser = createAssistantMarkdownParser({ streaming: true });

    for (const source of ["**bold", "**bold*", "**bold**"]) {
      expect(parser.renderInline(source)).toBe("<strong>bold</strong>");
    }
  });

  it("shows the growing link label and only links a complete destination", () => {
    const parser = createAssistantMarkdownParser({ streaming: true });
    const source = "[docs](https://example.com/path)";
    for (let length = 1; length < source.length; length++) {
      expect(parser.renderInline(source.slice(0, length))).toBe(
        "docs".slice(0, Math.max(0, length - 1)),
      );
    }
    expect(parser.renderInline(source)).toBe('<a href="https://example.com/path">docs</a>');
  });

  it.each([
    ["**", "strong"],
    ["__", "strong"],
    ["*", "em"],
    ["_", "em"],
    ["~~", "s"],
    ["`", "code"],
    ["``", "code"],
  ])("keeps %s formatting stable as text and closing markers arrive", (marker, tag) => {
    const parser = createAssistantMarkdownParser({ streaming: true });
    for (let length = 1; length <= 4; length++) {
      expect(parser.renderInline(marker + "text".slice(0, length))).toBe(
        `<${tag}>${"text".slice(0, length)}</${tag}>`,
      );
    }
    for (let length = 0; length <= marker.length; length++) {
      expect(parser.renderInline(marker + "text" + marker.slice(0, length))).toBe(
        `<${tag}>text</${tag}>`,
      );
    }
  });

  it("keeps combined and nested emphasis stable through closing markers", () => {
    const parser = createAssistantMarkdownParser({ streaming: true });
    for (const closing of ["", "*", "**", "***"]) {
      expect(parser.renderInline("***both" + closing)).toBe("<em><strong>both</strong></em>");
    }
    expect(parser.renderInline("**bold and *italic")).toBe(
      "<strong>bold and <em>italic</em></strong>",
    );
    expect(parser.renderInline("*italic and **bold")).toBe(
      "<em>italic and <strong>bold</strong></em>",
    );
  });

  it.each(["*", "**", "***", "_", "__", "~~", "`", "``"])(
    "hides an opening %s while waiting for its text",
    (marker) => {
      expect(
        createAssistantMarkdownParser({ streaming: true }).renderInline("hello " + marker),
      ).toBe("hello ");
    },
  );

  it.each([
    "[docs](https://example.com/a(b)c)",
    '[docs](https://example.com "a title)")',
    "[docs](<https://example.com/a(b)>)",
    "[docs](file:///tmp/example.ts)",
  ])("waits for the entire destination of %s", (source) => {
    const parser = createAssistantMarkdownParser({ streaming: true });
    for (let length = 6; length < source.length; length++) {
      expect(parser.renderInline(source.slice(0, length))).toBe("docs");
    }
    expect(parser.renderInline(source)).toBe(createAssistantMarkdownParser().renderInline(source));
  });

  it("preserves formatting in incomplete labels and around incomplete links", () => {
    const parser = createAssistantMarkdownParser({ streaming: true });
    expect(parser.renderInline("[**bold")).toBe("<strong>bold</strong>");
    expect(parser.renderInline("[**bold**](https://exam")).toBe("<strong>bold</strong>");
    expect(parser.renderInline("**see [docs](https://exam")).toBe("<strong>see docs</strong>");
  });

  it("does not auto-link a URL label before the destination is complete", () => {
    const parser = createAssistantMarkdownParser({ streaming: true });
    expect(parser.renderInline("Read [example.com](https://exam")).toBe("Read example.com");
    expect(parser.renderInline("Read [example.com](https://example.org)")).toBe(
      'Read <a href="https://example.org">example.com</a>',
    );
  });

  it.each([
    "\\*literal",
    "\\[literal",
    "some_identifier",
    "some__identifier",
    "`**literal [link](url`",
    "``a ` b``",
    "**already closed** after",
    "[bad](javascript:alert(1))",
    "<component",
    "$$price",
    "20~25",
  ])("preserves literal and complete inline text: %s", (source) => {
    expect(createAssistantMarkdownParser({ streaming: true }).renderInline(source)).toBe(
      createAssistantMarkdownParser().renderInline(source),
    );
  });

  it.each([
    "```md\n**literal [link](url",
    "~~~md\n**literal [link](url",
    "    **literal [link](url",
    "**earlier\n\nplain tail",
    "- **earlier\n- plain tail",
  ])("leaves literal code and earlier blocks alone: %s", (source) => {
    expect(createAssistantMarkdownParser({ streaming: true }).render(source)).toBe(
      createAssistantMarkdownParser().render(source),
    );
  });

  it("completes inline formatting inside the final list item", () => {
    expect(createAssistantMarkdownParser({ streaming: true }).render("- first\n- **bold")).toBe(
      "<ul>\n<li>first</li>\n<li><strong>bold</strong></li>\n</ul>\n",
    );
  });

  it("hides incomplete images until their source is complete", () => {
    const parser = createAssistantMarkdownParser({ streaming: true });
    expect(parser.renderInline("before ![alt](https://exam")).toBe("before ");
    expect(parser.renderInline("before ![alt](https://example.com/image.png)")).toBe(
      'before <img src="https://example.com/image.png" alt="alt">',
    );
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
