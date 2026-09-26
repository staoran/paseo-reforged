import { MAX_EXPLICIT_AGENT_TITLE_CHARS } from "@getpaseo/protocol/agent-title-limits";
import type { FirstAgentContext } from "@getpaseo/protocol/messages";

const MAX_INITIAL_AGENT_TITLE_CHARS = Math.min(60, MAX_EXPLICIT_AGENT_TITLE_CHARS);

// Local titles used when the requested script is absent from the prompt
const LOCALIZED_FIRST_AGENT_TITLES: Readonly<Record<string, string | undefined>> = {
  ar: "جلسة جديدة",
  en: "New chat",
  es: "Nueva conversación",
  fr: "Nouvelle conversation",
  ja: "新しい会話",
  ko: "새 대화",
  "pt-BR": "Nova conversa",
  ru: "Новый чат",
  "zh-CN": "新会话",
};

// Locally distinguishable scripts used by the supported title languages
const TITLE_LANGUAGE_SCRIPT_PATTERNS: Readonly<Record<string, RegExp | undefined>> = {
  ar: /\p{Script=Arabic}/u,
  ja: /(?:\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana})/u,
  ko: /\p{Script=Hangul}/u,
  ru: /\p{Script=Cyrillic}/u,
  "zh-CN": /\p{Script=Han}/u,
};

/** Reject titles that cannot contain wording in the requested non-Latin language */
export function titleMatchesRequestedLanguage(title: string, locale: string): boolean {
  const pattern = TITLE_LANGUAGE_SCRIPT_PATTERNS[locale];
  return !pattern || pattern.test(title);
}

function deriveInitialAgentTitle(prompt: string): string | null {
  const firstContentLine = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstContentLine) {
    return null;
  }
  const normalized = firstContentLine.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  const clamped = normalized.slice(0, MAX_INITIAL_AGENT_TITLE_CHARS).trim();
  return clamped.length > 0 ? clamped : null;
}

export function resolveCreateAgentTitles(options: {
  configTitle?: string | null;
  initialPrompt?: string | null;
  locale?: string;
}): { explicitTitle: string | null; provisionalTitle: string | null } {
  const explicitTitle =
    typeof options.configTitle === "string" && options.configTitle.trim().length > 0
      ? options.configTitle.trim()
      : null;
  const trimmedPrompt = options.initialPrompt?.trim();
  let provisionalTitle =
    explicitTitle ?? (trimmedPrompt ? deriveInitialAgentTitle(trimmedPrompt) : null);
  if (
    !explicitTitle &&
    options.locale &&
    (!provisionalTitle || !titleMatchesRequestedLanguage(provisionalTitle, options.locale))
  ) {
    provisionalTitle = LOCALIZED_FIRST_AGENT_TITLES[options.locale] ?? provisionalTitle;
  }

  return {
    explicitTitle,
    provisionalTitle,
  };
}

export function resolveFirstAgentPromptTitle(firstAgentContext?: FirstAgentContext): string | null {
  return (
    resolveCreateAgentTitles({
      initialPrompt: firstAgentContext?.prompt,
      locale: firstAgentContext?.locale,
    }).provisionalTitle ?? null
  );
}
