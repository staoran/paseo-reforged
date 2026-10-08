import pino from "pino";
import { expect, test } from "vitest";
import type { SessionOutboundMessage } from "../../messages.js";
import { UsageSession } from "./usage-session.js";
import { UsageSourceRegistry } from "../../plugins/usage-sources/index.js";

test("lists reports from usage sources", async () => {
  const emitted: SessionOutboundMessage[] = [];
  const requested: Array<{ forceRefresh?: boolean; reportIds?: string[] }> = [];
  const entry = {
    id: "fixture:one",
    account: {},
    fetchedAt: "2026-01-01T00:00:00.000Z",
    sourceId: "fixture",
    sourceLabel: "Fixture",
    report: { status: "available" as const, windows: [] },
  };
  const usage = new UsageSession({
    emit: (message) => emitted.push(message),
    listAgentIds: () => [],
    hasAgent: () => true,
    runtime: {
      async resolveAgentUsageReport() {
        return "fixture:one";
      },
      async listUsageReports(options) {
        requested.push({ forceRefresh: options.forceRefresh, reportIds: options.reportIds });
        options.onReport?.(entry);
        return [entry];
      },
      async listLegacyUsage() {
        return { fetchedAt: "2026-01-01T00:00:00.000Z", providers: [] };
      },
    },
    logger: pino({ level: "silent" }),
  });

  await usage.handleListReports({ type: "usage.reports.list.request", requestId: "list" });
  expect(requested).toEqual([{ forceRefresh: undefined, reportIds: undefined }]);
  expect(emitted).toEqual([
    { type: "usage.reports.list.update", payload: { requestId: "list", report: entry } },
    { type: "usage.reports.list.response", payload: { requestId: "list", error: null } },
  ]);
});

test("surfaces a legacy usage-list failure as an rpc_error envelope", async () => {
  const emitted: SessionOutboundMessage[] = [];
  const usage = new UsageSession({
    emit: (message) => emitted.push(message),
    listAgentIds: () => [],
    hasAgent: () => true,
    runtime: {
      async resolveAgentUsageReport() {
        return null;
      },
      async listUsageReports() {
        return [];
      },
      async listLegacyUsage(): Promise<never> {
        throw new Error("quota service down");
      },
    },
    logger: pino({ level: "silent" }),
  });
  await usage.handleLegacyList({ type: "provider.usage.list.request", requestId: "u1" });
  expect(emitted[0]).toMatchObject({
    type: "rpc_error",
    payload: { requestId: "u1", code: "provider_usage_list_failed" },
  });
});

test("request failures terminate with an error response and no updates", async () => {
  const emitted: SessionOutboundMessage[] = [];
  const usage = new UsageSession({
    emit: (message) => emitted.push(message),
    listAgentIds: () => [],
    hasAgent: () => true,
    logger: pino({ level: "silent" }),
  });
  await usage.handleListReports({ type: "usage.reports.list.request", requestId: "failed" });
  expect(emitted).toEqual([
    {
      type: "usage.reports.list.response",
      payload: { requestId: "failed", error: "Plugin runtime is unavailable" },
    },
  ]);
});

test("released batch requests retain complete reports and never receive stream updates", async () => {
  const emitted: SessionOutboundMessage[] = [];
  const entries = [
    { status: "available" as const, windows: [{ id: "quota", label: "Quota", usedPercent: 42 }] },
    { status: "error" as const, error: "quota offline" },
    {
      status: "unavailable" as const,
      problem: { kind: "no_quota" as const, detail: "No quota for this account" },
    },
  ].map((report) => ({
    id: `fixture:${report.status}`,
    account: { label: "Work" },
    fetchedAt: "2026-10-08T00:00:00.000Z",
    sourceId: "fixture",
    sourceLabel: "Fixture",
    report,
  }));
  const requested: unknown[] = [];
  const usage = new UsageSession({
    emit: (message) => emitted.push(message),
    listAgentIds: () => [],
    hasAgent: () => true,
    runtime: {
      async resolveAgentUsageReport() {
        return "fixture:available";
      },
      async listUsageReports(options) {
        requested.push(options);
        return entries;
      },
      async listLegacyUsage() {
        return { fetchedAt: "2026-10-08T00:00:00.000Z", providers: [] };
      },
    },
    logger: pino({ level: "silent" }),
  });
  await usage.handleBatchList({
    type: "usage.list_reports.request",
    requestId: "batch",
    forceRefresh: true,
    reportIds: ["fixture:available"],
  });
  expect(requested).toEqual([
    { forceRefresh: true, reportIds: ["fixture:available"], agentId: undefined },
  ]);
  expect(emitted).toEqual([
    {
      type: "usage.list_reports.response",
      payload: {
        requestId: "batch",
        error: null,
        reports: [
          entries[0],
          { ...entries[1], report: { status: "error", windows: [], error: "quota offline" } },
          {
            ...entries[2],
            report: { status: "unavailable", windows: [], error: "No quota for this account" },
          },
        ],
      },
    },
  ]);
  await usage.handleResolveAgentReport({
    type: "agent.resolve_usage_report.request",
    requestId: "account",
    agentId: "agent",
  });
  expect(emitted[1]).toEqual({
    type: "agent.resolve_usage_report.response",
    payload: { requestId: "account", reportId: "fixture:available" },
  });
});

test("legacy batch and resolver failures complete with a correlated rpc_error", async () => {
  const emitted: SessionOutboundMessage[] = [];
  const usage = new UsageSession({
    emit: (message) => emitted.push(message),
    listAgentIds: () => [],
    hasAgent: () => true,
    logger: pino({ level: "silent" }),
  });
  await usage.handleBatchList({ type: "usage.list_reports.request", requestId: "batch" });
  await usage.handleResolveAgentReport({
    type: "agent.resolve_usage_report.request",
    requestId: "account",
    agentId: "agent",
  });
  expect(emitted).toEqual([
    {
      type: "rpc_error",
      payload: {
        requestId: "batch",
        requestType: "usage.list_reports.request",
        error: "Plugin runtime is unavailable",
        code: "usage_list_reports_failed",
      },
    },
    {
      type: "rpc_error",
      payload: {
        requestId: "account",
        requestType: "agent.resolve_usage_report.request",
        error: "Plugin runtime is unavailable",
        code: "agent_resolve_usage_report_failed",
      },
    },
  ]);
});

test("the first released global batch discovers active session accounts and fetches each once", async () => {
  const emitted: SessionOutboundMessage[] = [];
  const fetches: unknown[] = [];
  const registry = new UsageSourceRegistry(Date.now, 300_000, undefined, {
    hasAgent: (id) => id === "agent",
    usageSession: () => ({ provider: "codex", env: { CODEX_HOME: "/work" }, sessionKey: "launch" }),
  });
  registry.register({
    id: "codex",
    label: "Codex",
    discover: async (scope) => [
      { key: scope.kind === "global" ? "default" : "work", input: scope.kind },
    ],
    fetch: async (input) => {
      fetches.push(input);
      return { status: "available", windows: [] };
    },
  });
  const usage = new UsageSession({
    emit: (message) => emitted.push(message),
    listAgentIds: () => ["agent"],
    hasAgent: (id) => id === "agent",
    runtime: {
      listUsageReports: (options) => registry.listReports(options),
      resolveAgentUsageReport: (id) => registry.resolveAgentReportId(id),
      listLegacyUsage: () => registry.listLegacyUsage(),
    },
    logger: pino({ level: "silent" }),
  });
  await usage.handleBatchList({ type: "usage.list_reports.request", requestId: "global" });
  expect(fetches).toEqual(["global", "session"]);
  expect(emitted).toEqual([
    {
      type: "usage.list_reports.response",
      payload: {
        requestId: "global",
        error: null,
        reports: [
          expect.objectContaining({ id: "codex:default" }),
          expect.objectContaining({ id: "codex:work" }),
        ],
      },
    },
  ]);
  fetches.length = 0;
  await usage.handleBatchList({
    type: "usage.list_reports.request",
    requestId: "scoped",
    agentId: "agent",
    forceRefresh: true,
  });
  expect(fetches).toEqual(["session"]);
  expect(emitted[1]).toEqual({
    type: "usage.list_reports.response",
    payload: {
      requestId: "scoped",
      error: null,
      reports: [expect.objectContaining({ id: "codex:work" })],
    },
  });
  await usage.handleResolveAgentReport({
    type: "agent.resolve_usage_report.request",
    requestId: "missing",
    agentId: "missing",
  });
  expect(emitted[2]).toEqual({
    type: "rpc_error",
    payload: {
      requestId: "missing",
      requestType: "agent.resolve_usage_report.request",
      code: "agent_not_found",
      error: "Agent not found: missing",
    },
  });
});
