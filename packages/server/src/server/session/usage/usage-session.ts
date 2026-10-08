import type { ListUsageReportsOptions } from "../../plugins/usage-sources/index.js";
import { legacyError } from "../../plugins/usage-sources/index.js";
import type pino from "pino";
import type {
  ProviderUsage,
  UsageReportEntry,
  LegacyUsageReportEntry,
} from "@getpaseo/protocol/messages";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";

export interface UsageSessionOptions {
  emit(message: SessionOutboundMessage): void;
  /** Enumerate managed sessions for released global account discovery */
  listAgentIds(): string[];
  /** Preserve the released unknown-agent error */
  hasAgent(agentId: string): boolean;
  runtime?: {
    listUsageReports(options: ListUsageReportsOptions): Promise<UsageReportEntry[]>;
    /** Released per-agent account lookup */
    resolveAgentUsageReport(agentId: string): Promise<string | null>;
    listLegacyUsage(): Promise<{ fetchedAt: string; providers: ProviderUsage[] }>;
  };
  logger: pino.Logger;
}

export class UsageSession {
  constructor(private readonly options: UsageSessionOptions) {}

  async handleListReports(
    msg: Extract<SessionInboundMessage, { type: "usage.reports.list.request" }>,
  ): Promise<void> {
    try {
      if (!this.options.runtime) throw new Error("Plugin runtime is unavailable");
      await this.options.runtime.listUsageReports({
        forceRefresh: msg.forceRefresh,
        reportIds: msg.reportIds,
        agentId: msg.agentId,
        onReport: (report) =>
          this.options.emit({
            type: "usage.reports.list.update",
            payload: { requestId: msg.requestId, report },
          }),
      });
      this.options.emit({
        type: "usage.reports.list.response",
        payload: { requestId: msg.requestId, error: null },
      });
    } catch (error) {
      this.options.emit({
        type: "usage.reports.list.response",
        payload: {
          requestId: msg.requestId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  // COMPAT(reforgedUsageBatch): added in v0.11.1-beta.1, remove after 2027-04-08 once beta client floor >= v0.11.1
  /** Return complete batch reports without sending unrecognized streaming updates */
  async handleBatchList(
    msg: Extract<SessionInboundMessage, { type: "usage.list_reports.request" }>,
  ): Promise<void> {
    try {
      const runtime = this.options.runtime;
      if (!runtime) throw new Error("Plugin runtime is unavailable");
      if (msg.reportIds === undefined && msg.agentId === undefined) {
        await Promise.all(
          this.options.listAgentIds().map((id) => runtime.resolveAgentUsageReport(id)),
        );
      }
      const reports = await runtime.listUsageReports({
        forceRefresh: msg.forceRefresh,
        reportIds: msg.reportIds,
        agentId: msg.agentId,
      });
      this.options.emit({
        type: "usage.list_reports.response",
        payload: {
          requestId: msg.requestId,
          reports: reports.map(toLegacyReport),
          error: null,
        },
      });
    } catch (error) {
      this.emitLegacyError(msg, error, "usage_list_reports_failed");
    }
  }

  // COMPAT(reforgedUsageResolver): added in v0.11.1-beta.1, remove after 2027-04-08 once beta client floor >= v0.11.1
  /** Resolve the active session account for released clients */
  async handleResolveAgentReport(
    msg: Extract<SessionInboundMessage, { type: "agent.resolve_usage_report.request" }>,
  ): Promise<void> {
    try {
      if (!this.options.runtime) throw new Error("Plugin runtime is unavailable");
      if (!this.options.hasAgent(msg.agentId)) {
        this.emitLegacyError(msg, new Error(`Agent not found: ${msg.agentId}`), "agent_not_found");
        return;
      }
      const reportId = await this.options.runtime.resolveAgentUsageReport(msg.agentId);
      this.options.emit({
        type: "agent.resolve_usage_report.response",
        payload: { requestId: msg.requestId, reportId },
      });
    } catch (error) {
      this.emitLegacyError(msg, error, "agent_resolve_usage_report_failed");
    }
  }

  /** Finish a legacy request with its existing correlated error envelope */
  private emitLegacyError(
    msg: Extract<
      SessionInboundMessage,
      { type: "usage.list_reports.request" | "agent.resolve_usage_report.request" }
    >,
    error: unknown,
    code: string,
  ): void {
    const detail = error instanceof Error ? error.message : String(error);
    this.options.emit({
      type: "rpc_error",
      payload: {
        requestId: msg.requestId,
        requestType: msg.type,
        error: detail,
        code,
      },
    });
  }

  // COMPAT(providerUsageList): added in v0.9.3, remove after 2027-03-26.
  async handleLegacyList(
    msg: Extract<SessionInboundMessage, { type: "provider.usage.list.request" }>,
  ): Promise<void> {
    try {
      if (!this.options.runtime) throw new Error("Plugin runtime is unavailable");
      const usage = await this.options.runtime.listLegacyUsage();
      this.options.emit({
        type: "provider.usage.list.response",
        payload: {
          requestId: msg.requestId,
          fetchedAt: usage.fetchedAt,
          providers: usage.providers,
        },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.options.logger.error({ err }, "Failed to list provider usage");
      this.options.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: `Failed to list provider usage: ${err.message}`,
          code: "provider_usage_list_failed",
        },
      });
    }
  }
}

// COMPAT(reforgedUsageBatch): added in v0.11.1-beta.1, remove after 2027-04-08 once beta client floor >= v0.11.1
/** Preserve failed account diagnostics while satisfying the released window requirement */
function toLegacyReport(entry: UsageReportEntry): LegacyUsageReportEntry {
  const report = entry.report;
  if (report.status === "available") return { ...entry, report };
  const error = legacyError(report, Date.now());
  return { ...entry, report: { status: report.status, windows: [], error: error ?? undefined } };
}
