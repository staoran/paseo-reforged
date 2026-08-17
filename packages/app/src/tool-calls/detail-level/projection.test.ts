import { describe, expect, it } from "vitest";
import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import type { ActivityFold } from "@/agent-stream/model";
import type { StreamItem, ToolCallItem } from "@/types/stream";
import {
  prepareToolCallHistory,
  projectToolCallDetailLevel,
  type PreparedToolCallHistory,
  type ToolCallDetailLevel,
} from "./projection";

type AssistantMessageItem = Extract<StreamItem, { kind: "assistant_message" }>;

function toolCall(
  id: string,
  detail: ToolCallDetail,
  options: {
    name?: string;
    status?: "running" | "completed" | "failed" | "canceled";
  } = {},
): ToolCallItem {
  return {
    kind: "tool_call",
    id,
    timestamp: new Date(`2026-01-01T00:00:${id.padStart(2, "0")}.000Z`),
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: id,
        name: options.name ?? detail.type,
        status: options.status ?? "completed",
        error: options.status === "failed" ? "boom" : null,
        detail,
      },
    },
  };
}

function assistant(id: string): AssistantMessageItem {
  return {
    kind: "assistant_message",
    id,
    text: id,
    timestamp: new Date("2026-01-01T00:01:00.000Z"),
  };
}

function project(input: {
  level: ToolCallDetailLevel;
  tail?: StreamItem[];
  head?: StreamItem[];
  activityFolds?: ActivityFold[];
  isTurnActive?: boolean;
  preparedHistory?: PreparedToolCallHistory;
}) {
  const tail = input.tail ?? [];
  return projectToolCallDetailLevel({
    level: input.level,
    tail,
    head: input.head ?? [],
    preparedHistory:
      input.preparedHistory ?? prepareToolCallHistory(input.level, tail, input.activityFolds ?? []),
    isTurnActive: input.isTurnActive ?? false,
  });
}

describe("tool call detail-level projection", () => {
  it.each(["overview", "detailed"] as const)(
    "groups loaded Activity members once in %s mode",
    (level) => {
      const calls = ["1", "2", "3", "4", "5"].map((id) =>
        toolCall(id, { type: "shell", command: `command-${id}` }),
      );
      const activityFold: ActivityFold = {
        id: "activity-1",
        completed: true,
        hostItemId: "activity-1",
        memberIds: calls.map((call) => call.id),
        members: calls,
        detailStatus: "ready",
      };

      const result = project({ level, activityFolds: [activityFold] });

      expect(result.activityFolds[0]?.members).toEqual([
        expect.objectContaining({ id: calls[0]?.id, timestamp: calls[4]?.timestamp }),
      ]);
      expect(result.activityFolds[0]?.memberIds).toEqual(calls.map((call) => call.id));
      expect(result.groupsByHostId.get(calls[0]?.id ?? "")?.run.calls).toEqual(calls);
    },
  );

  it("uses the shared grouping outer structure in detailed timelines", () => {
    const tail = [toolCall("1", { type: "shell", command: "one" })];
    const head = [toolCall("2", { type: "shell", command: "two" })];

    const prepared = prepareToolCallHistory("detailed", tail);
    const result = project({ level: "detailed", tail, head, preparedHistory: prepared });

    expect(prepared.mode).toBe("detailed");
    expect(result.tail).toEqual([tail[0]]);
    expect(result.head).toEqual([]);
    expect(result.groupsByHostId.get("1")).toMatchObject({
      mode: "detailed",
      run: { calls: [...tail, ...head] },
    });
  });

  it.each(["overview", "detailed"] as const)(
    "splits adjacent %s groups by tool type without reordering them",
    (level) => {
      const calls = [
        toolCall("1", { type: "shell", command: "one" }),
        toolCall("2", { type: "shell", command: "two" }),
        toolCall("3", { type: "read", filePath: "/repo/a.ts" }),
        toolCall("4", { type: "edit", filePath: "/repo/a.ts" }),
        toolCall("5", { type: "write", filePath: "/repo/b.ts" }),
        toolCall("6", { type: "shell", command: "three" }),
      ];

      const result = project({ level, tail: calls });

      expect(result.tail.map((item) => item.id)).toEqual(["1", "3", "4", "6"]);
      expect(["1", "3", "4", "6"].map((id) => result.groupsByHostId.get(id)?.kind)).toEqual([
        "command",
        "read",
        "edit",
        "command",
      ]);
      expect(["1", "3", "4", "6"].map((id) => result.groupsByHostId.get(id)?.run.calls)).toEqual([
        calls.slice(0, 2),
        calls.slice(2, 3),
        calls.slice(3, 5),
        calls.slice(5),
      ]);
    },
  );

  it("classifies shell commands after removing only the leading RTK wrapper", () => {
    const calls = [
      toolCall("1", { type: "shell", command: "rtk read 'src/a.ts'" }),
      toolCall("2", { type: "shell", command: "rtk.exe rg -n paseo src" }),
      toolCall("3", { type: "shell", command: "rtk find src -name '*.ts'" }),
      toolCall("4", { type: "shell", command: "rtk proxy git status" }),
      toolCall("5", { type: "shell", command: "rtk run npm test" }),
      toolCall("6", {
        type: "shell",
        command: 'powershell -NoProfile -Command "rtk read hidden.txt"',
      }),
      toolCall("7", {
        type: "shell",
        command: 'rtk proxy powershell -NoProfile -Command "Get-Content src/a.ts"',
      }),
    ];

    const result = project({ level: "overview", tail: calls });

    expect(result.tail.map((item) => item.id)).toEqual(["1", "2", "4"]);
    expect(["1", "2", "4"].map((id) => result.groupsByHostId.get(id)?.kind)).toEqual([
      "read",
      "search",
      "command",
    ]);
    expect(result.groupsByHostId.get("2")?.run.calls).toEqual(calls.slice(1, 3));
    expect(result.groupsByHostId.get("4")?.run.calls).toEqual(calls.slice(3));
  });

  it("uses the same top-level command classification without an RTK wrapper", () => {
    const calls = [
      toolCall("1", { type: "shell", command: "cat src/a.ts" }),
      toolCall("2", { type: "shell", command: "rg -n paseo src" }),
      toolCall("3", { type: "shell", command: 'powershell -Command "rg hidden.txt"' }),
      toolCall("4", { type: "shell", command: "rtk proxy cat src/b.ts" }),
    ];

    const result = project({ level: "overview", tail: calls });

    expect(result.tail.map((item) => item.id)).toEqual(["1", "2", "3", "4"]);
    expect(["1", "2", "3", "4"].map((id) => result.groupsByHostId.get(id)?.kind)).toEqual([
      "read",
      "search",
      "command",
      "read",
    ]);
  });

  it("keeps one stable overview host as a run grows", () => {
    const firstCall = toolCall("1", { type: "shell", command: "one" });
    const secondCall = toolCall("2", { type: "shell", command: "two" });
    const prepared = prepareToolCallHistory("overview", []);

    const single = project({
      level: "overview",
      head: [firstCall],
      isTurnActive: true,
      preparedHistory: prepared,
    });
    expect(single.head).toEqual([firstCall]);
    expect(single.groupsByHostId.get(firstCall.id)?.run).toMatchObject({
      calls: [firstCall],
      latest: firstCall,
      isSealed: false,
    });

    const grouped = project({
      level: "overview",
      head: [firstCall, secondCall],
      isTurnActive: true,
      preparedHistory: prepared,
    });
    expect(grouped.head).toEqual([
      expect.objectContaining({ id: firstCall.id, timestamp: secondCall.timestamp }),
    ]);
    expect(grouped.groupsByHostId.get(firstCall.id)?.run).toMatchObject({
      calls: [firstCall, secondCall],
      latest: secondCall,
      isSealed: false,
    });
  });

  it("keeps a parallel group loading while any call is still running", () => {
    const calls = [
      toolCall("1", { type: "shell", command: "slow" }, { status: "running" }),
      toolCall("2", { type: "shell", command: "done" }),
    ];
    const result = project({ level: "overview", head: calls, isTurnActive: true });

    expect(result.groupsByHostId.get("1")?.isLoading).toBe(true);
  });

  it("builds a loading aggregate for a one-call run", () => {
    const call = toolCall("1", { type: "shell", command: "one" }, { status: "running" });
    const result = project({ level: "overview", head: [call], isTurnActive: true });
    const group = result.groupsByHostId.get(call.id);
    if (!group) {
      throw new Error("Expected an overview group");
    }

    expect(group).toMatchObject({
      isLoading: true,
      summary: { commandCount: 1 },
    });
  });

  it("keeps an active overview group on its latest call until a visible boundary arrives", () => {
    const calls = ["1", "2", "3", "4"].map((id) => toolCall(id, { type: "shell", command: id }));
    const prepared = prepareToolCallHistory("overview", []);
    const active = project({
      level: "overview",
      head: calls,
      isTurnActive: true,
      preparedHistory: prepared,
    });
    const activeGroup = active.groupsByHostId.get("1");

    expect(activeGroup).toMatchObject({
      mode: "overview",
      run: { id: "1", latest: calls[3], isSealed: false },
    });
    const boundary = assistant("answer");
    const sealed = project({
      level: "overview",
      head: [...calls, boundary],
      isTurnActive: true,
      preparedHistory: prepared,
    });
    expect(sealed.groupsByHostId.get("1")).toMatchObject({
      mode: "overview",
      run: { latest: calls[3], isSealed: true },
      summary: { editedFileCount: 0, readFileCount: 0, commandCount: 4 },
    });
  });

  it("keeps a running overview group live before the agent lifecycle catches up", () => {
    const calls = ["1", "2", "3", "4"].map((id) =>
      toolCall(id, { type: "shell", command: id }, { status: "running" }),
    );

    const result = project({
      level: "overview",
      tail: calls,
      isTurnActive: false,
    });

    expect(result.groupsByHostId.get("1")).toMatchObject({
      run: { latest: calls[3], isSealed: false },
      isLoading: true,
      summary: { commandCount: 4 },
    });
  });

  it("seals the trailing overview group only when the turn ends", () => {
    const calls = ["1", "2", "3", "4"].map((id) => toolCall(id, { type: "shell", command: id }));
    const prepared = prepareToolCallHistory("overview", []);

    const betweenCalls = project({
      level: "overview",
      head: calls,
      isTurnActive: true,
      preparedHistory: prepared,
    });
    const nextCall = toolCall("5", { type: "shell", command: "5" });
    const continued = project({
      level: "overview",
      head: [...calls, nextCall],
      isTurnActive: true,
      preparedHistory: prepared,
    });
    const ended = project({
      level: "overview",
      head: [...calls, nextCall],
      isTurnActive: false,
      preparedHistory: prepared,
    });

    expect(betweenCalls.groupsByHostId.get("1")?.run.isSealed).toBe(false);
    expect(continued.groupsByHostId.get("1")?.run).toMatchObject({
      latest: nextCall,
      isSealed: false,
    });
    expect(ended.groupsByHostId.get("1")?.run.isSealed).toBe(true);
  });

  it("builds one overview summary per adjacent category group", () => {
    const calls = [
      toolCall("1", { type: "read", filePath: "/repo/src/a.ts" }),
      toolCall("2", { type: "read", filePath: "/repo/src/b.ts" }),
      toolCall("3", { type: "shell", command: "npm test" }),
      toolCall("4", { type: "edit", filePath: "/repo/src/a.ts" }, { status: "failed" }),
    ];

    const overview = project({ level: "overview", head: calls });

    expect(overview.groupsByHostId.get("1")).toEqual({
      mode: "overview",
      kind: "read",
      run: expect.any(Object),
      isLoading: false,
      summary: {
        editedFileCount: 0,
        commandCount: 0,
        readFileCount: 2,
        searchCount: 0,
        otherToolCount: 0,
        paseoCallCount: 0,
      },
    });
    expect(overview.groupsByHostId.get("3")).toMatchObject({
      kind: "command",
      summary: { commandCount: 1 },
    });
    expect(overview.groupsByHostId.get("4")).toMatchObject({
      kind: "edit",
      summary: { editedFileCount: 1 },
    });
  });

  it("distinguishes reads, searches, and other tools in overview", () => {
    const calls = [
      toolCall("1", { type: "read", filePath: "/repo/src/a.ts" }),
      toolCall("2", { type: "read", filePath: "C:\\repo\\src\\beta.ts" }),
      toolCall("3", { type: "fetch", url: "https://github.com/org/repo" }),
      toolCall(
        "4",
        { type: "search", query: "paseo", toolName: "web_search" },
        { status: "failed" },
      ),
      toolCall("5", { type: "fetch", url: "not a url" }),
    ];

    const result = project({ level: "overview", head: calls });

    expect(result.groupsByHostId.get("1")).toMatchObject({
      kind: "read",
      summary: {
        editedFileCount: 0,
        commandCount: 0,
        readFileCount: 2,
        searchCount: 0,
        otherToolCount: 0,
      },
    });
    expect(result.groupsByHostId.get("3")).toMatchObject({
      kind: "other",
      summary: { otherToolCount: 1 },
    });
    expect(result.groupsByHostId.get("4")).toMatchObject({
      kind: "search",
      summary: { searchCount: 1 },
    });
    expect(result.groupsByHostId.get("5")).toMatchObject({
      kind: "other",
      summary: { otherToolCount: 1 },
    });
  });

  it("counts unique edited files and every shell command in overview", () => {
    const calls = [
      toolCall("1", { type: "edit", filePath: "/repo/a.ts" }),
      toolCall("2", { type: "edit", filePath: "/repo/a.ts" }),
      toolCall("3", { type: "write", filePath: "/repo/b.ts" }),
      toolCall("4", { type: "shell", command: "npm test" }),
      toolCall("5", { type: "shell", command: "npm run lint" }),
      toolCall("6", { type: "read", filePath: "/repo/c.ts" }),
    ];

    const result = project({ level: "overview", head: calls });

    expect(result.groupsByHostId.get("1")).toMatchObject({
      kind: "edit",
      summary: { editedFileCount: 2, commandCount: 0, readFileCount: 0 },
    });
    expect(result.groupsByHostId.get("4")).toMatchObject({
      kind: "command",
      summary: { commandCount: 2 },
    });
    expect(result.groupsByHostId.get("6")).toMatchObject({
      kind: "read",
      summary: { readFileCount: 1 },
    });
  });

  it("counts Paseo calls separately from other tools", () => {
    const calls = [
      toolCall("1", { type: "unknown", input: null, output: null }, { name: "paseo.list_agents" }),
      toolCall(
        "2",
        { type: "unknown", input: null, output: null },
        { name: "mcp__paseo__list_worktrees" },
      ),
      toolCall("3", { type: "fetch", url: "https://paseo.sh" }),
      toolCall("4", { type: "fetch", url: "https://github.com/getpaseo" }),
    ];

    const result = project({ level: "overview", head: calls });

    expect(result.groupsByHostId.get("1")).toMatchObject({
      kind: "paseo",
      summary: { otherToolCount: 0, paseoCallCount: 2 },
    });
    expect(result.groupsByHostId.get("3")).toMatchObject({
      kind: "other",
      summary: { otherToolCount: 2, paseoCallCount: 0 },
    });
  });

  it("classifies direct Brave search and Paseo runtime tool names", () => {
    const unknownDetail = { type: "unknown" as const, input: null, output: null };
    const calls = [
      toolCall("1", unknownDetail, { name: "brave-search_brave_web_search" }),
      toolCall("2", unknownDetail, { name: "brave-search_brave_llm_context" }),
      toolCall("3", unknownDetail, { name: "paseo_list_providers" }),
      toolCall("4", unknownDetail, { name: "paseo_list_worktrees" }),
      toolCall("5", unknownDetail, { name: "paseo_list_worktrees" }),
      toolCall("6", unknownDetail, { name: "mcp__exa__web_search" }),
    ];

    const result = project({ level: "overview", head: calls });

    expect(result.groupsByHostId.get("1")).toMatchObject({
      kind: "search",
      summary: { searchCount: 2, otherToolCount: 0, paseoCallCount: 0 },
    });
    expect(result.groupsByHostId.get("3")).toMatchObject({
      kind: "paseo",
      summary: { searchCount: 0, paseoCallCount: 3 },
    });
    expect(result.groupsByHostId.get("6")).toMatchObject({
      kind: "search",
      summary: { searchCount: 1, paseoCallCount: 0 },
    });
  });

  it("reuses prepared history and sealed group models across live-head updates", () => {
    const historicalCalls = ["1", "2", "3", "4"].map((id) =>
      toolCall(id, { type: "shell", command: id }),
    );
    const tail = [...historicalCalls, assistant("boundary")];
    const prepared = prepareToolCallHistory("overview", tail);
    if (!prepared) {
      throw new Error("Overview history must be prepared");
    }
    expect(prepared.grouped.tail).toEqual([
      expect.objectContaining({ id: "1", timestamp: historicalCalls[3]?.timestamp }),
      tail[4],
    ]);
    const first = project({
      level: "overview",
      tail,
      head: [toolCall("5", { type: "read", filePath: "/repo/a.ts" })],
      isTurnActive: true,
      preparedHistory: prepared,
    });
    const second = project({
      level: "overview",
      tail,
      head: [
        toolCall("5", { type: "read", filePath: "/repo/a.ts" }),
        toolCall("6", { type: "read", filePath: "/repo/b.ts" }),
      ],
      isTurnActive: true,
      preparedHistory: prepared,
    });

    expect(first.tail).toBe(prepared.grouped.tail);
    expect(second.tail).toBe(prepared.grouped.tail);
    expect(first.groupsByHostId.get("1")).toBe(prepared.grouped.groupsByHostId.get("1"));
    expect(second.groupsByHostId.get("1")).toBe(prepared.grouped.groupsByHostId.get("1"));
    expect(first.historyGroupUpdatesByHostId.size).toBe(0);
    expect(second.historyGroupUpdatesByHostId).toBe(first.historyGroupUpdatesByHostId);
    expect(second.groupsByHostId.get("5")?.run.calls).toHaveLength(2);
  });

  it("preserves projected history identity during assistant-only head updates", () => {
    const trailingCalls = [
      toolCall("1", { type: "shell", command: "one" }),
      toolCall("2", { type: "shell", command: "two" }),
    ];
    const tail = [assistant("before"), ...trailingCalls];
    const prepared = prepareToolCallHistory("overview", tail);
    if (!prepared) {
      throw new Error("Overview history must be prepared");
    }

    const firstHead = [assistant("answer")];
    const secondHead = [{ ...firstHead[0], text: "answer grows" }];
    const first = project({
      level: "overview",
      tail,
      head: firstHead,
      isTurnActive: true,
      preparedHistory: prepared,
    });
    const second = project({
      level: "overview",
      tail,
      head: secondHead,
      isTurnActive: true,
      preparedHistory: prepared,
    });

    expect(first.tail).toBe(prepared.grouped.tail);
    expect(second.tail).toBe(prepared.grouped.tail);
    expect(first.groupsByHostId).toBe(prepared.grouped.groupsByHostId);
    expect(second.groupsByHostId).toBe(prepared.grouped.groupsByHostId);
    expect(first.historyGroupUpdatesByHostId.size).toBe(0);
    expect(second.historyGroupUpdatesByHostId).toBe(first.historyGroupUpdatesByHostId);
  });

  it("forms one group across the retained-history and live-head boundary", () => {
    const tail = [
      assistant("before"),
      toolCall("1", { type: "shell", command: "one" }),
      toolCall("2", { type: "shell", command: "two" }),
    ];
    const head = [
      toolCall("3", { type: "shell", command: "three" }),
      toolCall("4", { type: "shell", command: "four" }, { status: "running" }),
    ];

    const result = project({ level: "overview", tail, head, isTurnActive: true });

    expect(result.tail).toEqual([
      tail[0],
      expect.objectContaining({ id: "1", timestamp: tail[2]?.timestamp }),
    ]);
    expect(result.head).toEqual([]);
    expect(result.groupsByHostId.get("1")?.run).toMatchObject({
      calls: [...tail.slice(1), ...head],
      latest: head[1],
      isSealed: false,
    });
    expect(result.historyGroupUpdatesByHostId.get("1")).toBe(result.groupsByHostId.get("1"));
  });

  it("keeps a trailing history-only group in the retained segment", () => {
    const tail = ["1", "2", "3", "4"].map((id) => toolCall(id, { type: "shell", command: id }));

    const result = project({ level: "overview", tail, isTurnActive: false });

    expect(result.tail).toEqual([
      expect.objectContaining({ id: "1", timestamp: tail[3]?.timestamp }),
    ]);
    expect(result.head).toEqual([]);
    expect(result.groupsByHostId.get("1")?.run.isSealed).toBe(true);
  });

  it("hosts single calls while leaving plans and spoken messages ungrouped", () => {
    const singleCall = toolCall("1", { type: "shell", command: "one" });
    const plan = toolCall("2", { type: "plan", text: "Plan" });
    const speak = toolCall(
      "3",
      { type: "unknown", input: "Hello", output: null },
      { name: "speak" },
    );

    const result = project({ level: "overview", head: [singleCall, plan, speak] });

    expect(result.head).toEqual([singleCall, plan, speak]);
    expect(result.groupsByHostId.get(singleCall.id)?.run.calls).toEqual([singleCall]);
    expect(result.groupsByHostId.size).toBe(1);
  });
});
