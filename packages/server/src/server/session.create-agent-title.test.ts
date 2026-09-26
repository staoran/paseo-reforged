import { describe, expect, test } from "vitest";

import {
  resolveCreateAgentTitles,
  resolveFirstAgentPromptTitle,
} from "./agent/create-agent-title.js";

describe("resolveCreateAgentTitles", () => {
  test("derives a provisional title from prompt when explicit title is absent", () => {
    const resolved = resolveCreateAgentTitles({
      configTitle: undefined,
      initialPrompt: "Implement auth retries with backoff\n\ninclude tests",
    });

    expect(resolved.explicitTitle).toBeNull();
    expect(resolved.provisionalTitle).toBe("Implement auth retries with backoff");
  });

  test("preserves explicit title and does not treat it as provisional", () => {
    const resolved = resolveCreateAgentTitles({
      configTitle: "  Keep This Title  ",
      initialPrompt: "Ignored prompt title",
    });

    expect(resolved.explicitTitle).toBe("Keep This Title");
    expect(resolved.provisionalTitle).toBe("Keep This Title");
  });

  test("returns null values when prompt and title are empty", () => {
    const resolved = resolveCreateAgentTitles({
      configTitle: "   ",
      initialPrompt: "   ",
    });

    expect(resolved.explicitTitle).toBeNull();
    expect(resolved.provisionalTitle).toBeNull();
  });

  test("uses a localized fallback for English prompts in a Chinese app", () => {
    expect(resolveFirstAgentPromptTitle({ prompt: "Fix the login flow", locale: "zh-CN" })).toBe(
      "新会话",
    );
    expect(
      resolveCreateAgentTitles({ initialPrompt: "Fix the login flow", locale: "zh-CN" })
        .provisionalTitle,
    ).toBe("新会话");
    expect(resolveFirstAgentPromptTitle({ prompt: "修复登录流程", locale: "zh-CN" })).toBe(
      "修复登录流程",
    );
    expect(
      resolveCreateAgentTitles({ configTitle: "My title", locale: "zh-CN" }).provisionalTitle,
    ).toBe("My title");
  });
});
