import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { CodexProviderOptionsSchema } from "./providers/codex/options.js";
import { ClaudeProviderOptionsSchema } from "./providers/claude/options.js";
import {
  finalizeHubExecutionCreate,
  resolveCompatibleAgentConfig,
  resolveHubExecutionCreatePreflight,
  type AgentConfigCompatibilityProvider,
} from "./agent-config-compat.js";

const codexProvider: AgentConfigCompatibilityProvider = {
  provider: "codex",
  legacyFamily: "codex",
  validateOptions: (options) =>
    options === undefined ? undefined : CodexProviderOptionsSchema.parse(options),
  applyToolPolicy: (config, toolPolicy) => ({ ...config, toolPolicy }),
};

const unsupportedProvider: AgentConfigCompatibilityProvider = {
  provider: "pi",
  validateOptions: (options) => options,
};

const claudeProvider: AgentConfigCompatibilityProvider = {
  provider: "claude",
  legacyFamily: "claude",
  validateOptions: (options) =>
    options === undefined ? undefined : ClaudeProviderOptionsSchema.parse(options),
  applyToolPolicy: (config, toolPolicy) => ({ ...config, toolPolicy }),
};

describe("Agent config compatibility", () => {
  test("preserves legacy Claude options and env beside canonical options", async () => {
    const resolved = await resolveCompatibleAgentConfig(
      {
        provider: "claude",
        cwd: resolve("fixtures", "claude"),
        providerOptions: { allowedTools: ["Read"] },
        extra: {
          claude: {
            additionalDirectories: ["/shared/docs"],
            env: { CLAUDE_LEGACY_TOKEN: "legacy-value" },
          },
        },
      },
      claudeProvider,
    );

    expect(resolved.resolvedProviderOptions).toEqual({
      allowedTools: ["Read"],
      additionalDirectories: ["/shared/docs"],
      env: { CLAUDE_LEGACY_TOKEN: "legacy-value" },
    });
  });

  test("rejects non-string legacy Claude env values", async () => {
    await expect(
      resolveCompatibleAgentConfig(
        {
          provider: "claude",
          cwd: resolve("fixtures", "claude"),
          extra: { claude: { env: { INVALID_PORT: 6767 } } },
        },
        claudeProvider,
      ),
    ).rejects.toMatchObject({
      name: "LegacyAgentConfigError",
      code: "legacy_agent_config_invalid",
      path: "extra.claude.env.INVALID_PORT",
    });
  });

  test("prepares legacy Codex policy without creating a workspace or worktree", async () => {
    const input = {
      executionId: "execution-legacy",
      provider: "codex",
      cwd: resolve("fixtures", "source"),
      prompt: "  keep the read-only policy  ",
      modeId: "read-only",
      featureValues: { fast_mode: false },
      env: { PASEO_TEST_SECRET: "redact-me" },
      mcpServers: {
        hub: { type: "http" as const, url: "https://hub.invalid/mcp" },
      },
      toolPolicy: {
        preapproved: [{ kind: "mcp" as const, server: "hub", tool: "finish" }],
      },
      approvalPolicy: "never",
      sandboxMode: "read-only",
      networkAccess: false,
      webSearch: false,
      extra: { codex: { web_search: "disabled", custom_legacy_flag: true } },
    };

    const prepared = await resolveHubExecutionCreatePreflight(input, codexProvider);

    expect(prepared.config.resolvedProviderOptions).toMatchObject({
      approval_policy: "never",
      sandbox_mode: "read-only",
      sandbox_workspace_write: { network_access: false },
      web_search: "disabled",
      custom_legacy_flag: true,
    });
    expect(prepared.request.prompt).toBe("keep the read-only policy");
    expect(prepared.hubExecutionContract.applicationState).toBe("prepared");
    expect(prepared.executionFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(prepared.policyFingerprint).toMatch(/^[a-f0-9]{64}$/u);
  });

  test("finalization consumes only the prepared request and rejects policy expansion", async () => {
    const input = {
      executionId: "execution-finalize",
      provider: "codex",
      cwd: resolve("fixtures", "source"),
      prompt: "original prompt",
      approvalPolicy: "never",
      sandboxMode: "read-only",
      networkAccess: false,
    };
    const prepared = await resolveHubExecutionCreatePreflight(input, codexProvider);
    input.prompt = "mutated after preflight";
    input.sandboxMode = "danger-full-access";

    const finalized = await finalizeHubExecutionCreate(prepared, {
      cwd: resolve("fixtures", "resolved"),
      workspaceId: "workspace-finalized",
      resolveCreateConfig: async () => ({
        modeId: "read-only",
        featureValues: { fast_mode: false },
      }),
    });

    expect(finalized.config.cwd).toBe(resolve("fixtures", "resolved"));
    expect(finalized.config.resolvedProviderOptions?.sandbox_mode).toBe("read-only");
    expect(finalized.prompt).toBe("original prompt");

    await expect(
      finalizeHubExecutionCreate(prepared, {
        cwd: resolve("fixtures", "resolved"),
        workspaceId: "workspace-finalized",
        resolveCreateConfig: async () => ({
          providerOptions: { sandbox_mode: "danger-full-access" },
        }),
      }),
    ).rejects.toThrow("policy expansion");
  });

  test("fails closed for conflicting or ambiguous legacy settings", async () => {
    await expect(
      resolveCompatibleAgentConfig(
        {
          provider: "codex",
          cwd: "/workspace",
          providerOptions: { sandbox_mode: "workspace-write" },
          sandboxMode: "read-only",
        },
        codexProvider,
      ),
    ).rejects.toThrow("legacy_agent_config_conflict");

    await expect(
      resolveCompatibleAgentConfig(
        { provider: "codex", cwd: "/workspace", webSearch: true },
        codexProvider,
      ),
    ).rejects.toThrow("legacy_agent_config_ambiguous");

    await expect(
      resolveCompatibleAgentConfig(
        { provider: "pi", cwd: "/workspace", approvalPolicy: "never" },
        unsupportedProvider,
      ),
    ).rejects.toThrow("legacy_agent_config_unsupported");
  });
});
