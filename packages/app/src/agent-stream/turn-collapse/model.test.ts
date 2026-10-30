import { describe, expect, it } from "vitest";
import type { StreamItem, ToolCallItem } from "@/types/stream";
import { createActivityProjection } from "../activity";
import { collapseTurns, type CollapseTurnsInput } from "./model";

/** Deterministic source time for process duration assertions */
const at = new Date("2026-01-01T00:00:00.000Z");
/** Builds a source prompt boundary */
function user(id: string): StreamItem {
  return { kind: "user_message", id, text: id, timestamp: at };
}
/** Builds a reliable final boundary */
function reply(id: string): StreamItem {
  return {
    kind: "assistant_message",
    id,
    text: id,
    timestamp: new Date(at.getTime() + 2000),
    phase: "final_answer",
  };
}
/** Builds commentary that must not be mistaken for a final */
function commentary(id: string): StreamItem {
  return { kind: "assistant_message", id, text: id, timestamp: at, phase: "commentary" };
}
/** Builds a completed tool with real presentation metadata */
function shell(id: string): ToolCallItem {
  return {
    kind: "tool_call",
    id,
    timestamp: at,
    payload: {
      source: "agent",
      data: {
        provider: "codex",
        callId: id,
        name: "Bash",
        status: "completed",
        error: null,
        detail: { type: "shell", command: "ls" },
      },
    },
  };
}
/** Applies the same phase detector and row contract as presentation */
function collapse(tail: StreamItem[], options: Partial<CollapseTurnsInput> = {}, active = false) {
  const head = options.head ?? [];
  const grouped = options.getGroupedCalls ?? (() => undefined);
  const raw = (items: StreamItem[]) => items.flatMap((item) => [...(grouped(item.id) ?? [item])]);
  const folds = createActivityProjection()({
    agentId: "test",
    tail: raw(tail),
    head: raw(head),
    isTurnActive: active,
    activeTurnId: null,
  });
  return collapseTurns({
    tail,
    head,
    activityFolds: folds,
    expandedHostIds: new Set(),
    getGroupedCalls: grouped,
    ...options,
  });
}
/** Stable synthetic header used by both closed and opened processes */
const host = "activity:test:user:u1";
/** Returns mounted row identities */
function ids(items: StreamItem[]) {
  return items.map((item) => item.id);
}

describe("phase process rows", () => {
  it("keeps the explicit final outside a closed process and maps every hidden row", () => {
    const result = collapse([user("u1"), commentary("progress"), shell("work"), reply("final")]);
    expect(ids(result.tail)).toEqual(["u1", host, "final"]);
    expect(result.hostIdByHiddenRowId.get("work")).toBe(host);
    expect(result.hostIdByFoldedMessageId.get("progress")).toBe(host);
    expect(result.turnsByHostId.get(host)).toMatchObject({
      completed: true,
      expanded: false,
      durationMs: 2000,
      summary: { tools: { commandCount: 1 } },
    });
  });

  it("preserves tool groups as real nested rows with no closed-row replacements", () => {
    const calls = [shell("one"), shell("two")];
    const result = collapse([user("u1"), calls[0]!, reply("final")], {
      expandedHostIds: new Set([host]),
      getGroupedCalls: (id) => (id === "one" ? calls : undefined),
    });
    expect(ids(result.tail)).toEqual(["u1", host, "one", "final"]);
    expect([...result.nestedItemIds]).toEqual(["one"]);
    expect(result.ungroupedHostIds.size).toBe(0);
    expect(result.hostIdByHiddenRowId.size).toBe(0);
  });

  it("keeps errors, plugins, running tools, questions and compaction visible", () => {
    const running = shell("running");
    const question = shell("question");
    const asyncQuestion = shell("async-question");
    if (
      running.payload.source !== "agent" ||
      question.payload.source !== "agent" ||
      asyncQuestion.payload.source !== "agent"
    )
      throw new Error("Expected agent tools");
    running.payload.data.status = "running";
    question.payload.data.name = "request_user_input";
    asyncQuestion.payload.data.name = "request_user_input_async";
    const items: StreamItem[] = [
      user("u1"),
      shell("hidden"),
      {
        kind: "notification",
        sourceType: "error",
        id: "error",
        timestamp: at,
        level: "error",
        message: "Failed",
      },
      {
        kind: "plugin",
        id: "plugin",
        timestamp: at,
        pluginId: "test",
        pluginItemId: "card",
        itemKind: "card",
        version: 1,
        data: {},
      },
      running,
      question,
      asyncQuestion,
      { kind: "compaction", id: "compaction", timestamp: at, status: "completed" },
      reply("final"),
    ];
    const result = collapse(items);
    expect(ids(result.tail)).toEqual([
      "u1",
      host,
      "error",
      "plugin",
      "running",
      "question",
      "async-question",
      "compaction",
      "final",
    ]);
    expect([...result.hostIdByHiddenRowId.keys()]).toEqual(["hidden"]);
  });

  it("allows a manual close to override default expansion without losing raw rows", () => {
    const tail = [user("u1"), shell("work"), reply("final")];
    const opened = collapse(tail, { defaultExpanded: true });
    expect(ids(opened.tail)).toContain("work");
    const closed = collapse(tail, {
      defaultExpanded: true,
      expansionOverrides: new Map([[host, false]]),
    });
    expect(ids(closed.tail)).toEqual(["u1", host, "final"]);
  });

  it("forces active final output open despite a manual close", () => {
    const result = collapse(
      [user("u1"), commentary("working")],
      { expansionOverrides: new Map([[host, false]]) },
      true,
    );
    expect(ids(result.tail)).toEqual(["u1", host, "working"]);
    expect(result.turnsByHostId.get(host)).toMatchObject({
      expanded: true,
      completed: false,
      durationMs: null,
    });
  });

  it("does not fold legacy history or failed work without an explicit final", () => {
    const legacy = [user("u1"), shell("work"), { ...reply("legacy"), phase: undefined }];
    expect(collapse(legacy).tail).toBe(legacy);
    const failed = [user("u1"), commentary("working"), shell("work")];
    expect(collapse(failed).tail).toBe(failed);
  });

  it("keeps multiple explicit finals visible and spans canonical run IDs", () => {
    const tail = [
      user("u1"),
      { ...shell("first"), turnId: "a" },
      { ...commentary("more"), turnId: "b" },
      reply("final-one"),
      shell("second"),
      reply("final-two"),
    ];
    const result = collapse(tail);
    expect(ids(result.tail)).toEqual([
      "u1",
      host,
      "final-one",
      "activity:test:final:final-one",
      "final-two",
    ]);
    expect(result.turnsByHostId.size).toBe(2);
  });

  it("keeps real rows in their original history and live lanes", () => {
    const result = collapse([user("u1"), commentary("history")], {
      head: [shell("live"), reply("final")],
      defaultExpanded: true,
    });
    expect(ids(result.tail)).toEqual(["u1", host, "history"]);
    expect(ids(result.head)).toEqual(["live", "final"]);
  });

  it("folds thought-only work and preserves an unknown paginated start", () => {
    const thought: StreamItem = {
      kind: "thought",
      id: "thought",
      text: "Thinking",
      status: "ready",
      timestamp: at,
    };
    const result = collapse([thought, reply("final")]);
    expect(ids(result.tail)).toEqual(["activity:test:initial-final:final", "final"]);
    expect([...result.turnsByHostId.values()][0]).toMatchObject({
      durationMs: null,
      completed: true,
    });
  });
});
