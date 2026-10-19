import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import { createAssistantMarkdownParser } from "@/utils/assistant-markdown-parser";

/** One inline-content line can omit a quote or list prefix present in the source */
interface StreamingLine {
  /** First mapped character in the inline token */
  start: number;
  /** End of the mapped inline-content line */
  end: number;
  /** Original source position of the first mapped character */
  sourceStart: number;
}

/** Source edits are render-only and never enter the saved message or clipboard */
interface StreamingEdits {
  /** Preserve the original line endings while markdown-it normalizes its parser input */
  source: string;
  /** Line mappings exclude container prefixes and synthesized indentation */
  lines: StreamingLine[];
  /** Incomplete source fragments to hide until more text arrives */
  cuts: Array<{ start: number; end: number }>;
  /** Provisional closers passed to the shared MD4C renderer */
  suffix: string;
}

/** Delimiter matching uses the same escape and nesting rules as clipboard parsing */
const parser = createAssistantMarkdownParser();

/** Complete only the final inline block and leave earlier blocks and literal fences alone */
parser.core.ruler.at("inline", (state) => {
  /** Only the final inline block may receive provisional formatting */
  const tail = state.tokens.findLast((token) => token.nesting !== -1);
  if (tail?.type !== "inline" || !tail.content) return;
  /** Table body cells inherit their last row from the enclosing mapped block */
  const location = tail.map ?? state.tokens.findLast((token) => token.map !== null)?.map;
  if (!location) return;
  /** An ordinary inline token begins at its mapped line, while the final table cell is on the last row */
  const firstLine = tail.map ? location[0] : location[1] - 1;
  /** Source offsets must address the caller's text rather than markdown-it's normalized copy */
  const edits = state.env as StreamingEdits;
  const sourceLines = [...edits.source.matchAll(/([^\r\n]*)(?:\r\n|\r|\n|$)/g)];
  /** Position within the prefix-free inline token */
  let contentStart = 0;
  for (const [index, line] of tail.content.split("\n").entries()) {
    /** Trimming virtual indentation also handles partially expanded container tabs */
    const content = line.trimStart();
    const sourceLine = sourceLines[firstLine + index];
    /** Null replacement changes spelling but preserves source offsets */
    const normalizedLine = sourceLine[1].split("\0").join("\uFFFD");
    const column = normalizedLine.lastIndexOf(content);
    if (column < 0) return;
    edits.lines.push({
      start: contentStart + line.length - content.length,
      end: contentStart + line.length,
      sourceStart: sourceLine.index + column,
    });
    contentStart += line.length + 1;
  }
  state.md.inline.parse(tail.content, state.md, edits, []);
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
  /** Each parse owns its source mappings and delimiter edits */
  const edits: StreamingEdits = { source, lines: [], cuts: [], suffix: "" };
  parser.parse(source, edits);
  /** The last mapped character precedes any trailing source whitespace or container syntax */
  const lastLine = edits.lines.at(-1);
  if (!lastLine) return source;
  const end = lastLine.sourceStart + lastLine.end - lastLine.start;
  /** Split removals by line so source-only prefixes and line endings remain untouched */
  const replacements = [{ start: end, end, text: edits.suffix }];
  for (const cut of edits.cuts) {
    for (const line of edits.lines) {
      /** Intersection expressed in the prefix-free inline token's coordinates */
      const start = Math.max(cut.start, line.start);
      const stop = Math.min(cut.end, line.end);
      if (start >= stop) continue;
      replacements.push({
        start: line.sourceStart + start - line.start,
        end: line.sourceStart + stop - line.start,
        text: "",
      });
    }
  }
  /** Apply source edits backwards so earlier offsets stay valid */
  let rendered = source;
  // React Native 0.81 Hermes lacks toSorted and this parse owns the replacements
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    rendered =
      rendered.slice(0, replacement.start) + replacement.text + rendered.slice(replacement.end);
  }
  return rendered;
}
