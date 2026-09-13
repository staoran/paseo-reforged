import { describe, expect, it } from "vitest";
import { buildCreateAgentFirstAgentContext } from "./create-agent-context.js";

describe("buildCreateAgentFirstAgentContext", () => {
  it("retains the requested title language when overlaying the wire prompt", () => {
    const context = buildCreateAgentFirstAgentContext({
      requestContext: {
        titleLanguage: "zh-CN",
        prompt: "stale prompt",
        attachments: [],
      },
      initialPrompt: "  Fix the login flow  ",
      attachments: [],
    });

    expect(context).toEqual({
      titleLanguage: "zh-CN",
      prompt: "Fix the login flow",
      attachments: [],
    });
  });

  it("keeps legacy context empty when no optional context is supplied", () => {
    expect(
      buildCreateAgentFirstAgentContext({
        initialPrompt: undefined,
        attachments: undefined,
      }),
    ).toEqual({});
  });
});
