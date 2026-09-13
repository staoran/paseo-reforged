import { describe, expect, test } from "vitest";

import {
  buildWorkspaceDraftFirstAgentContext,
  shouldAllowEmptyDraftText,
  validateDraftSubmission,
} from "./workspace-tab-core";

const baseComposerState = {
  providerDefinitions: [{ id: "codewhale" }],
  selectedProvider: "codewhale",
  isModelLoading: false,
  effectiveModelId: "",
  availableModels: [],
};

function validate(overrides = {}) {
  return validateDraftSubmission({
    text: "hello",
    allowsEmptyAutoSubmit: false,
    composerState: baseComposerState,
    autoSubmitConfig: null,
    workspaceDirectory: "/tmp/project",
    hasClient: true,
    ...overrides,
  });
}

describe("workspace draft agent model validation", () => {
  test("allows a ready provider with no models to submit without a selected model", () => {
    expect(validate({})).toBeNull();
  });

  test("keeps waiting while model defaults are loading", () => {
    expect(
      validate({
        composerState: {
          ...baseComposerState,
          isModelLoading: true,
        },
      }),
    ).toBe("Model defaults are still loading");
  });

  test("still requires a selected model when the provider exposes models", () => {
    expect(
      validate({
        composerState: {
          ...baseComposerState,
          availableModels: [{ id: "deepseek/deepseek-v4-pro" }],
        },
      }),
    ).toBe("No model is available for the selected provider");
  });
});

describe("workspace draft empty text readiness", () => {
  test("allows attachment-only retries after a fork draft create fails", () => {
    expect(
      shouldAllowEmptyDraftText({
        allowsEmptyAutoSubmit: false,
        attachments: [{ kind: "chat_history" }],
      }),
    ).toBe(true);
  });

  test("still rejects empty drafts with no auto-submit and no attachments", () => {
    expect(
      shouldAllowEmptyDraftText({
        allowsEmptyAutoSubmit: false,
        attachments: [],
      }),
    ).toBe(false);
  });
});

describe("workspace draft title language context", () => {
  test("keeps the resolved title language with the first draft prompt", () => {
    expect(
      buildWorkspaceDraftFirstAgentContext({
        text: "  Fix the login flow  ",
        attachments: [],
        titleLanguage: "zh-CN",
      }),
    ).toEqual({
      prompt: "Fix the login flow",
      titleLanguage: "zh-CN",
    });
  });

  test("keeps the resolved title language for attachment-only submissions", () => {
    const attachment = {
      type: "github_issue" as const,
      mimeType: "application/github-issue" as const,
      number: 42,
      title: "Fix login flow",
      url: "https://github.com/acme/repo/issues/42",
    };

    expect(
      buildWorkspaceDraftFirstAgentContext({
        text: "",
        attachments: [attachment],
        titleLanguage: "zh-CN",
      }),
    ).toEqual({
      attachments: [attachment],
      titleLanguage: "zh-CN",
    });
  });
});
