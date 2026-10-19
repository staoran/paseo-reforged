import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import { createAssistantMarkdownParser } from "@/utils/assistant-markdown-parser";

/** Source edits are render-only and never enter the saved message or clipboard */
interface StreamingEdits {
  /** Final inline block as recognized by the existing delimiter scanner */
  content: string;
  /** Position of that block in the original source */
  offset: number;
  /** Incomplete source fragments to hide until more text arrives */
  cuts: Array<{ start: number; end: number }>;
  /** Provisional closers passed to the shared MD4C renderer */
  suffix: string;
}

/** Delimiter matching uses the same escape and nesting rules as clipboard parsing */
const parser = createAssistantMarkdownParser();

/** Complete only the final inline block and leave earlier blocks and literal fences alone */
parser.core.ruler.at("inline", (state) => {
  const tail = state.tokens.findLast((token) => token.nesting !== -1);
  if (tail?.type !== "inline" || !tail.content) return;
  const edits = state.env as StreamingEdits;
  edits.content = tail.content;
  edits.offset = state.src.lastIndexOf(tail.content);
  if (edits.offset >= 0) state.md.inline.parse(tail.content, state.md, edits, []);
});

/** Hide an opener with no content while its first character is still arriving */
parser.inline.ruler.before("strikethrough", "streaming_source_marker", (state, silent) => {
  if (silent || !/^(?:\*{1,3}|_{1,3}|~{1,2})$/.test(state.src.slice(state.pos))) return false;
  if (state.scanDelims(state.pos, state.src[state.pos] !== "_").can_close) return false;
  (state.env as StreamingEdits).cuts.push({ start: state.pos, end: state.posMax });
  state.pos = state.posMax;
  return true;
});

/** Code content stays literal even if it contains stars or link-looking text */
parser.inline.ruler.before("backticks", "streaming_source_code", (state, silent) => {
  if (silent || state.src[state.pos] !== "`") return false;
  const runs = /`+/g;
  runs.lastIndex = state.pos;
  const opening = runs.exec(state.src)!;
  let closing: RegExpExecArray | null;
  while ((closing = runs.exec(state.src))) {
    if (closing[0].length === opening[0].length) return false;
  }
  const edits = state.env as StreamingEdits;
  const remaining = state.src.slice(state.pos + opening[0].length);
  if (!remaining) edits.cuts.push({ start: state.pos, end: state.posMax });
  else {
    const partial = remaining.match(/`+$/);
    if (partial) edits.cuts.push({ start: state.posMax - partial[0].length, end: state.posMax });
    edits.suffix += opening[0];
  }
  state.pos = state.posMax;
  return true;
});

/** Wait for the complete link destination before creating a clickable link */
function hasClosedDestination(source: string, start: number): boolean {
  let depth = 0;
  let quote = "";
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\") index += 1;
    else if (quote) {
      if (character === quote) quote = "";
    } else if (character === "<") quote = ">";
    else if ((character === '"' || character === "'") && /\s/.test(source[index - 1]))
      quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")" && --depth === 0) return true;
  }
  return false;
}

/** Keep a growing label visible and keep incomplete images hidden */
parser.inline.ruler.after("image", "streaming_source_link", (state, silent) => {
  if (silent) return false;
  const image = state.src[state.pos] === "!";
  const start = state.pos + (image ? 1 : 0);
  if (state.src[start] !== "[") return false;
  const labelEnd = state.md.helpers.parseLinkLabel(state, start, false);
  if (
    labelEnd !== -1 &&
    labelEnd + 1 < state.posMax &&
    (state.src[labelEnd + 1] !== "(" || hasClosedDestination(state.src, labelEnd + 1))
  )
    return false;
  const edits = state.env as StreamingEdits;
  const end = state.posMax;
  if (image) edits.cuts.push({ start: state.pos, end });
  else {
    edits.cuts.push({ start, end: start + 1 });
    if (labelEnd !== -1) edits.cuts.push({ start: labelEnd, end });
    state.pos = start + 1;
    state.posMax = labelEnd === -1 ? end : labelEnd;
    state.md.inline.tokenize(state);
  }
  state.pos = state.posMax = end;
  return true;
});

/** Append only unmatched openers outside spans the scanner already paired */
parser.inline.ruler2.after(
  "assistant_adjacent_strong",
  "streaming_source_emphasis",
  (state: StateInline) => {
    const open = [];
    let closedThrough = -1;
    for (const [index, delimiter] of state.delimiters.entries()) {
      if (delimiter.end !== -1) closedThrough = Math.max(closedThrough, delimiter.end);
      else if (index > closedThrough && delimiter.open) open.push(delimiter);
    }
    const edits = state.env as StreamingEdits;
    for (const delimiter of open.toReversed()) {
      if (delimiter.marker === 126 && /(?<![\\~])~$/.test(state.src)) {
        edits.cuts.push({ start: state.src.length - 1, end: state.src.length });
      }
      edits.suffix += String.fromCharCode(delimiter.marker).repeat(
        delimiter.marker === 126 ? 2 : 1,
      );
    }
    return true;
  },
);

/** Give MD4C complete display syntax while preserving the original streaming source */
export function completeStreamingMarkdownSource(source: string): string {
  const edits: StreamingEdits = { content: "", offset: -1, cuts: [], suffix: "" };
  parser.parse(source, edits);
  if (edits.offset < 0) return source;
  let content = edits.content;
  // React Native 0.81 Hermes lacks toSorted and this parse owns the cuts
  for (const cut of edits.cuts.sort((a, b) => b.start - a.start)) {
    content = content.slice(0, cut.start) + content.slice(cut.end);
  }
  return (
    source.slice(0, edits.offset) +
    content +
    edits.suffix +
    source.slice(edits.offset + edits.content.length)
  );
}
