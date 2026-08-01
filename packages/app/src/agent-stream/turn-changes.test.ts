import { describe, expect, it } from "vitest";
import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import type { ParsedDiffFile } from "@/git/use-diff-query";
import type { StreamItem, ToolCallItem } from "@/types/stream";
import { createWebStreamStrategy } from "./strategy-web";
import { projectTurnChanges } from "./turn-changes";

function userMessage(id: string): Extract<StreamItem, { kind: "user_message" }> {
  return {
    kind: "user_message",
    id,
    text: id,
    timestamp: new Date("2026-07-31T00:00:00.000Z"),
  };
}

function assistantMessage(id: string): Extract<StreamItem, { kind: "assistant_message" }> {
  return {
    kind: "assistant_message",
    id,
    text: id,
    timestamp: new Date("2026-07-31T00:01:00.000Z"),
  };
}

function toolCall(
  id: string,
  detail: ToolCallDetail,
  status: "running" | "completed" | "failed" | "canceled" = "completed",
): ToolCallItem {
  return {
    kind: "tool_call",
    id,
    timestamp: new Date("2026-07-31T00:00:30.000Z"),
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: id,
        name: detail.type,
        status,
        error: status === "failed" ? "failed" : null,
        detail,
      },
    },
  };
}

function diffFile(path: string, additions: number, deletions: number): ParsedDiffFile {
  return {
    path,
    isNew: false,
    isDeleted: false,
    additions,
    deletions,
    hunks: [],
  };
}

describe("projectTurnChanges", () => {
  it("keeps only the latest turn's successful edits that still have a working diff", () => {
    const items: StreamItem[] = [
      userMessage("old-user"),
      toolCall("old-edit", { type: "edit", filePath: "src/stale.ts" }),
      assistantMessage("old-assistant"),
      userMessage("latest-user"),
      toolCall("current-absolute", {
        type: "edit",
        filePath: "e:\\code\\paseo\\src\\current.ts",
      }),
      toolCall("current-duplicate", { type: "write", filePath: "src/current.ts" }),
      toolCall("second", { type: "write", filePath: ".\\src\\second.ts" }),
      toolCall("rolled-back", { type: "edit", filePath: "src/rolled-back.ts" }),
      toolCall("failed", { type: "edit", filePath: "src/failed.ts" }, "failed"),
      assistantMessage("latest-assistant"),
    ];

    expect(
      projectTurnChanges({
        items,
        startIndex: items.length - 1,
        strategy: createWebStreamStrategy({ isMobileBreakpoint: false }),
        workspaceRoot: "E:\\Code\\paseo",
        diffFiles: [
          diffFile("src/current.ts", 4, 2),
          diffFile("src/second.ts", 7, 1),
          diffFile("src/stale.ts", 20, 10),
          diffFile("src/failed.ts", 3, 3),
        ],
      }),
    ).toEqual({
      turnId: "latest-assistant",
      fileCount: 2,
      additions: 11,
      deletions: 3,
      files: [
        { path: "src/current.ts", additions: 4, deletions: 2 },
        { path: "src/second.ts", additions: 7, deletions: 1 },
      ],
    });
  });
});
