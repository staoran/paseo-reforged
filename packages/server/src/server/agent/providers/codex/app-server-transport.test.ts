import { describe, expect, test } from "vitest";
import { PassThrough } from "node:stream";
import pino from "pino";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import {
  createCodexAppServerChildProcess,
  createFakeCodexAppServer,
} from "./test-utils/fake-app-server.js";
import { CodexAppServerClient } from "./app-server-transport.js";

describe("Codex app-server transport", () => {
  test("does not write Goal objectives into raw JSON-RPC trace logs", async () => {
    const sentinel = "RAW_GOAL_OBJECTIVE_MUST_NOT_REACH_LOGS";
    const chunks: string[] = [];
    const stream = new PassThrough();
    stream.on("data", (chunk) => chunks.push(String(chunk)));
    const child = createCodexAppServerChildProcess();
    const client = new CodexAppServerClient(child, pino({ level: "trace" }, stream));

    child.stdout.write(
      `${JSON.stringify({
        method: "thread/goal/updated",
        params: {
          threadId: "thread-1",
          goal: {
            objective: sentinel,
            status: "active",
            createdAt: 0,
          },
        },
      })}\n`,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    const output = chunks.join("");
    expect(output).not.toContain(sentinel);
    expect(output).toContain(`"objectiveLength":${sentinel.length}`);
    expect(output).toContain('"goalStatus":"active"');
    child.stdout.end();
    child.stderr.end();
    child.stdin.end();
    await client.dispose();
  });

  test("ignores non-JSON stdout lines without dropping pending requests", async () => {
    const child = createCodexAppServerChildProcess();
    const client = new CodexAppServerClient(child, createTestLogger());

    const request = client.request("model/list", {});
    child.stdout.write("Codex ha iniciado en modo localizado\n");
    child.stdout.write('{"id":1,"result":{"data":[]}}\n');

    await expect(request).resolves.toEqual({ data: [] });
    child.stdout.end();
    child.stderr.end();
    child.stdin.end();
  });

  test("does not write rejected stdout content into warning logs", async () => {
    const invalidJsonSentinel = "INVALID_JSON_GOAL_OBJECTIVE_MUST_NOT_REACH_LOGS";
    const nonObjectSentinel = "NON_OBJECT_GOAL_OBJECTIVE_MUST_NOT_REACH_LOGS";
    const handlerSentinel = "HANDLER_GOAL_OBJECTIVE_MUST_NOT_REACH_LOGS";
    const chunks: string[] = [];
    const stream = new PassThrough();
    stream.on("data", (chunk) => chunks.push(String(chunk)));
    const child = createCodexAppServerChildProcess();
    const client = new CodexAppServerClient(child, pino({ level: "trace" }, stream));
    client.setNotificationHandler(() => {
      throw new Error(handlerSentinel);
    });

    child.stdout.write(`not-json ${invalidJsonSentinel}\n`);
    child.stdout.write(`${JSON.stringify(nonObjectSentinel)}\n`);
    child.stdout.write(`${JSON.stringify({ method: "notification/test", params: {} })}\n`);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    const output = chunks.join("");
    expect(output).not.toContain(invalidJsonSentinel);
    expect(output).not.toContain(nonObjectSentinel);
    expect(output).not.toContain(handlerSentinel);
    expect(output).toContain('"stdoutErrorCode":"invalid_json"');
    expect(output).toContain('"stdoutErrorCode":"not_object"');
    expect(output).toContain('"stdoutErrorCode":"handler_failed"');
    await client.dispose();
  });

  test.each([
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "item/tool/requestUserInput",
    "tool/requestUserInput",
  ])("answers server-initiated %s requests through registered handlers", async (method) => {
    const codex = createFakeCodexAppServer();
    const client = new CodexAppServerClient(codex.child, createTestLogger());
    const handlerCalls: unknown[] = [];
    client.setRequestHandler(method, async (params) => {
      handlerCalls.push(params);
      return { ok: true };
    });

    const response = codex.nextResponse();
    codex.child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: 7, method, params: {} })}\n`);

    await expect(response).resolves.toBe('{"id":7,"result":{"ok":true}}\n');
    expect(handlerCalls).toEqual([{}]);
    codex.child.stdout.end();
    codex.child.stderr.end();
    codex.child.stdin.end();
  });

  test("forks a Codex thread through thread/fork", async () => {
    const codex = createFakeCodexAppServer({
      "thread/fork": (params) => ({
        thread: {
          id: "forked-thread",
          sessionId: "forked-session",
          forkedFromId: (params as { threadId?: string }).threadId,
          turns: [],
        },
        model: "gpt-5.4",
        modelProvider: "openai",
        serviceTier: null,
        cwd: "/workspace/project",
        runtimeWorkspaceRoots: [],
        instructionSources: [],
        approvalPolicy: "on-request",
        approvalsReviewer: null,
        sandbox: { type: "workspaceWrite", networkAccess: false },
        activePermissionProfile: null,
        reasoningEffort: null,
      }),
    });
    const client = new CodexAppServerClient(codex.child, createTestLogger());

    const forked = await client.forkThread({
      threadId: "source-thread",
      cwd: "/workspace/project",
      excludeTurns: true,
    });

    expect(forked.thread.id).toBe("forked-thread");
    expect(forked.thread.forkedFromId).toBe("source-thread");
    codex.assertNoErrors();
    codex.child.stdout.end();
    codex.child.stderr.end();
    codex.child.stdin.end();
  });

  test("rolls back a Codex thread by N turns", async () => {
    const codex = createFakeCodexAppServer({
      "thread/rollback": (params) => {
        expect(params).toEqual({ threadId: "forked-thread", numTurns: 2 });
        return {
          thread: {
            id: "forked-thread",
            sessionId: "forked-session",
            turns: [{ id: "remaining-turn" }],
          },
        };
      },
    });
    const client = new CodexAppServerClient(codex.child, createTestLogger());

    const rolledBack = await client.rollbackThread({
      threadId: "forked-thread",
      numTurns: 2,
    });

    expect(rolledBack.thread.id).toBe("forked-thread");
    expect(rolledBack.thread.turns).toEqual([{ id: "remaining-turn" }]);
    codex.assertNoErrors();
    codex.child.stdout.end();
    codex.child.stderr.end();
    codex.child.stdin.end();
  });
});
