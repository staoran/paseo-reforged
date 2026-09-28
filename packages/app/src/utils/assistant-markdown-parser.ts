import type MarkdownIt from "markdown-it";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import { createMarkdownParser } from "@/utils/markdown-parser";
import { enableStreamingMarkdown } from "@/utils/streaming-markdown";

/** Lets assistant-authored strong close after punctuation before adjacent prose */
function allowPunctuationAdjacentStrong(state: StateInline): boolean {
  let changed = false;
  const delimiterLists = [
    state.delimiters,
    ...state.tokens_meta.flatMap((meta) => (meta ? [meta.delimiters] : [])),
  ];

  for (const delimiters of delimiterLists) {
    for (let index = 0; index + 1 < delimiters.length; index++) {
      const first = delimiters[index];
      const second = delimiters[index + 1];
      if (
        first.marker !== 0x2a ||
        first.length !== 2 ||
        first.close ||
        first.end !== -1 ||
        second.marker !== 0x2a ||
        second.length !== 2 ||
        second.close ||
        second.end !== -1 ||
        second.token !== first.token + 1
      ) {
        continue;
      }

      const previous = state.tokens[first.token - 1];
      const next = state.tokens[second.token + 1];
      const punctuation = previous?.type === "text" ? previous.content.at(-1) : undefined;
      if (next?.type !== "text" || !next.content || !punctuation) continue;

      const isPunctuation =
        state.md.utils.isMdAsciiPunct(punctuation.charCodeAt(0)) ||
        state.md.utils.isPunctChar(punctuation);
      if (isPunctuation) {
        first.close = true;
        second.close = true;
        changed = true;
      }
    }
  }

  return changed;
}

export function createAssistantMarkdownParser({ streaming = false } = {}): MarkdownIt {
  const parser = createMarkdownParser({ linkify: true });
  const defaultValidateLink = parser.validateLink.bind(parser);

  // Assistant messages are the only surface allowed to link into the
  // filesystem. Every other parser keeps markdown-it's stricter default.
  parser.validateLink = (url: string) =>
    url.trim().toLowerCase().startsWith("file://") || defaultValidateLink(url);

  if (streaming) {
    enableStreamingMarkdown(parser);
  }

  // The first inline postprocessing rule is markdown-it's original pair matcher
  const [balancePairs] = parser.inline.ruler2.getRules("");
  parser.inline.ruler2.after("balance_pairs", "assistant_adjacent_strong", (state) => {
    if (allowPunctuationAdjacentStrong(state)) balancePairs(state);
    return false;
  });

  return parser;
}
