import { MAX_EXPLICIT_AGENT_TITLE_CHARS } from "@getpaseo/protocol/agent-title-limits";
import type { FirstAgentContext } from "@getpaseo/protocol/messages";

const MAX_INITIAL_AGENT_TITLE_CHARS = Math.min(60, MAX_EXPLICIT_AGENT_TITLE_CHARS);

type TitleLanguage = NonNullable<FirstAgentContext["titleLanguage"]>;

const LOCALIZED_FIRST_AGENT_TITLES = {
  ar: "جلسة جديدة",
  en: "New chat",
  es: "Nueva conversación",
  fr: "Nouvelle conversation",
  ja: "新しい会話",
  ko: "새 대화",
  "pt-BR": "Nova conversa",
  ru: "Новый чат",
  "zh-CN": "新会话",
} satisfies Record<TitleLanguage, string>;

const TITLE_LANGUAGE_SCRIPT_PATTERNS: Partial<Record<TitleLanguage, RegExp>> = {
  ar: /\p{Script=Arabic}/u,
  ja: /(?:\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana})/u,
  ko: /\p{Script=Hangul}/u,
  ru: /\p{Script=Cyrillic}/u,
  "zh-CN": /\p{Script=Han}/u,
};

/** Checks whether a prompt-derived title uses a locally distinguishable script */
function titleMatchesRequestedLanguage(title: string, titleLanguage: TitleLanguage): boolean {
  const pattern = TITLE_LANGUAGE_SCRIPT_PATTERNS[titleLanguage];
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
}): { explicitTitle: string | null; provisionalTitle: string | null } {
  const explicitTitle =
    typeof options.configTitle === "string" && options.configTitle.trim().length > 0
      ? options.configTitle.trim()
      : null;
  const trimmedPrompt = options.initialPrompt?.trim();
  const provisionalTitle =
    explicitTitle ?? (trimmedPrompt ? deriveInitialAgentTitle(trimmedPrompt) : null);

  return {
    explicitTitle,
    provisionalTitle,
  };
}

/** Resolves a prompt title or a localized fallback for the requested title language */
export function resolveFirstAgentPromptTitle(firstAgentContext?: FirstAgentContext): string | null {
  const provisionalTitle = resolveCreateAgentTitles({
    initialPrompt: firstAgentContext?.prompt,
  }).provisionalTitle;
  const titleLanguage = firstAgentContext?.titleLanguage;
  if (
    !titleLanguage ||
    (provisionalTitle && titleMatchesRequestedLanguage(provisionalTitle, titleLanguage))
  ) {
    return provisionalTitle;
  }
  return LOCALIZED_FIRST_AGENT_TITLES[titleLanguage];
}
