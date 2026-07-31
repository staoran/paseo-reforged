export type PreparedMermaidSource =
  | { ok: true; source: string }
  | {
      ok: false;
      reason: "click" | "directive" | "empty" | "external-reference" | "frontmatter" | "too-large";
    };

const MAX_MERMAID_SOURCE_LENGTH = 100_000;
const MERMAID_DIRECTIVE_PATTERN = /%%\s*\{/;
const MERMAID_CLICK_PATTERN = /^\s*click(?:\s|$)/im;
const MERMAID_FRONTMATTER_PATTERN = /^\s*---(?:[ \t]*\r?\n|[ \t]*$)/;
const EXTERNAL_URI_PATTERN = /\b(?:data|file|ftp|https?|javascript|mailto|tel):|["']\s*\/\/[^/]/i;

export function prepareMermaidSource(source: string): PreparedMermaidSource {
  if (source.length > MAX_MERMAID_SOURCE_LENGTH) {
    return { ok: false, reason: "too-large" };
  }

  if (source.trim().length === 0) {
    return { ok: false, reason: "empty" };
  }

  if (MERMAID_FRONTMATTER_PATTERN.test(source)) {
    return { ok: false, reason: "frontmatter" };
  }

  if (MERMAID_DIRECTIVE_PATTERN.test(source)) {
    return { ok: false, reason: "directive" };
  }

  if (MERMAID_CLICK_PATTERN.test(source)) {
    return { ok: false, reason: "click" };
  }

  if (EXTERNAL_URI_PATTERN.test(source)) {
    return { ok: false, reason: "external-reference" };
  }

  return { ok: true, source };
}
