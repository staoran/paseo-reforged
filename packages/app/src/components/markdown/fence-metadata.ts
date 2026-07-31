interface MarkdownFenceToken {
  type: string;
  map?: [number, number] | null;
  markup?: string;
  meta?: unknown;
}

interface MarkdownCoreState {
  src: string;
  tokens: MarkdownFenceToken[];
}

interface MarkdownParserWithCoreRules {
  core: {
    ruler: {
      after: (
        ruleName: string,
        addedRuleName: string,
        rule: (state: MarkdownCoreState) => void,
      ) => void;
    };
  };
}

interface FenceMetadata {
  paseoFenceClosed?: boolean;
}

const configuredParsers = new WeakSet<object>();

function hasClosingFence(lines: string[], token: MarkdownFenceToken): boolean {
  const map = token.map;
  const openingMarkup = token.markup;
  if (!map || !openingMarkup) return false;

  const closingLine = lines[map[1] - 1]?.replace(/\r$/, "");
  if (!closingLine) return false;
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(closingLine);
  if (!match) return false;

  const closingMarkup = match[1];
  return closingMarkup[0] === openingMarkup[0] && closingMarkup.length >= openingMarkup.length;
}

export function configureMarkdownFenceMetadata<T extends MarkdownParserWithCoreRules>(
  parser: T,
): T {
  if (configuredParsers.has(parser)) return parser;
  configuredParsers.add(parser);

  parser.core.ruler.after("block", "paseo_fence_metadata", (state) => {
    const lines = state.src.split("\n");
    for (const token of state.tokens) {
      if (token.type !== "fence") continue;
      const existingMeta = typeof token.meta === "object" && token.meta !== null ? token.meta : {};
      token.meta = {
        ...existingMeta,
        paseoFenceClosed: hasClosingFence(lines, token),
      };
    }
  });

  return parser;
}

export function isMarkdownFenceClosed(sourceMeta: unknown): boolean {
  return (sourceMeta as FenceMetadata | null)?.paseoFenceClosed === true;
}

export function isMarkdownFenceNodeClosed(node: unknown): boolean {
  return isMarkdownFenceClosed((node as { sourceMeta?: unknown } | null)?.sourceMeta);
}
