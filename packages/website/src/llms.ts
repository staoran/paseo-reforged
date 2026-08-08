import { getAlternativePages } from "~/data/alternative-pages";
import { AGENT_PAGES } from "~/data/agent-pages";
import { type Doc, getDocs } from "~/docs";

const SITE_URL = "https://paseo.sh";

const PRODUCT_PREAMBLE = `# Paseo Reforged

> Mobile and desktop app for monitoring and controlling your local AI coding agents from anywhere. Your dev environment, in your pocket.

Paseo Reforged is an independently maintained fork of Paseo that lets you run AI coding agents on your own machine and drive them from Android, desktop, a self-hosted browser UI, or the terminal. Your code stays local - Paseo Reforged connects directly to your real development environment instead of running agents in someone else's cloud.

A self-hosted daemon manages agent lifecycle, exposes a WebSocket API, and ships with an MCP server so other agents can talk to it. Reforged releases desktop apps for macOS, Windows, and Linux plus an Android APK; the daemon can serve the browser UI itself. The CLI ("paseo run", "paseo ls", "paseo logs", "paseo wait") gives you scripting access. An end-to-end encrypted relay lets compatible clients reach your daemon over the public internet without exposing it.

Paseo Reforged supports every major coding agent: Claude Code, Codex, GitHub Copilot, OpenCode, Cursor, Gemini, Cline, Goose, Amp, Aider, and 30+ others. Each agent runs as its own process; Paseo Reforged handles I/O, persistence, git worktree isolation, schedules, and skills.

Distribution: Reforged GitHub release assets for Mac, Windows, Linux, and Android; Nix for the daemon and CLI; self-hosted browser UI. Reforged does not currently publish npm, Docker, app-store, or hosted web-app releases. Source: AGPL-3.0 at https://github.com/staoran/paseo-reforged.
`;

function docLine(doc: Doc): string {
  const url = `${SITE_URL}${doc.href}.md`;
  const description = doc.frontmatter.description?.trim();
  const suffix = description ? `: ${description}` : "";
  return `- [${doc.frontmatter.title}](${url})${suffix}`;
}

function agentLine(agent: (typeof AGENT_PAGES)[number]): string {
  return `- [${agent.name}](${SITE_URL}/${agent.slug}): ${agent.subtitle}`;
}

function alternativeLine(page: ReturnType<typeof getAlternativePages>[number]): string {
  const description = page.description.trim();
  const suffix = description ? `: ${description}` : "";
  return `- [${page.title}](${SITE_URL}${page.href})${suffix}`;
}

function topLevelDocs(): Doc[] {
  return getDocs().filter((d) => !d.slug.includes("/"));
}

export function buildLlmsTxt(): string {
  const docs = topLevelDocs().map(docLine).join("\n");
  const alternatives = getAlternativePages().map(alternativeLine).join("\n");
  const agents = AGENT_PAGES.map(agentLine).join("\n");

  return `${PRODUCT_PREAMBLE}
## Docs

${docs}

## Alternatives

${alternatives}

## Supported agents

${agents}

## Optional

- [Changelog](${SITE_URL}/changelog): Release notes for the Paseo Reforged daemon, CLI, desktop, and mobile apps.
- [Download](${SITE_URL}/download): Install Paseo Reforged on Mac, Windows, Linux, or Android, or run its daemon and CLI with Nix.
- [Upstream Paseo Hub](${SITE_URL}/hub): Optional upstream service for GitHub, Slack, and Discord triggers; it is not operated or released by Paseo Reforged.
- [Blog](${SITE_URL}/blog): Paseo Reforged updates and archived technical posts from upstream Paseo.
- [Privacy](${SITE_URL}/privacy): Privacy policy.
- [GitHub](https://github.com/staoran/paseo-reforged): Source code, issues, and releases.
`;
}
