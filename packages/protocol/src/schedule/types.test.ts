import { describe, expect, test } from "vitest";

import { ScheduleCadenceSchema, ScheduleTargetSchema } from "./types.js";

describe("ScheduleCadenceSchema", () => {
  test("accepts existing UTC cron cadence without a time zone", () => {
    expect(ScheduleCadenceSchema.parse({ type: "cron", expression: "0 9 * * *" })).toEqual({
      type: "cron",
      expression: "0 9 * * *",
    });
  });

  test("accepts timezone-aware cron cadence", () => {
    expect(
      ScheduleCadenceSchema.parse({
        type: "cron",
        expression: "0 9 * * *",
        timezone: "America/New_York",
      }),
    ).toEqual({
      type: "cron",
      expression: "0 9 * * *",
      timezone: "America/New_York",
    });
  });
});

describe("ScheduleTargetSchema", () => {
  test("keeps beta.5 agent config fields beside canonical provider policy", () => {
    const target = {
      type: "new-agent" as const,
      config: {
        provider: "claude",
        cwd: "/workspace",
        approvalPolicy: "never",
        sandboxMode: "workspace-write",
        networkAccess: false,
        webSearch: false,
        extra: {
          claude: {
            additionalDirectories: ["/shared/docs"],
            env: { CLAUDE_LEGACY_TOKEN: "legacy" },
          },
        },
        providerOptions: { allowedTools: ["Read"] },
        toolPolicy: {
          preapproved: [{ kind: "mcp" as const, server: "docs", tool: "lookup" }],
        },
        mcpServers: {
          docs: { command: "node", args: ["docs-server.js"] },
        },
      },
    };

    expect(ScheduleTargetSchema.parse(target)).toEqual(target);
  });
});
