import type { ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import type { Logger } from "pino";
import { z } from "zod";

import { terminateWithTreeKill } from "../../../../utils/tree-kill.js";

const DEFAULT_TIMEOUT_MS = 14 * 24 * 60 * 60 * 1000;
const APP_SERVER_GRACEFUL_SHUTDOWN_TIMEOUT_MS = 2_000;
const APP_SERVER_FORCE_SHUTDOWN_TIMEOUT_MS = 1_000;

interface JsonRpcRequest {
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  id: number;
  result?: unknown;
  error?: { message?: string };
}

interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/** Native Goal statuses safe to retain in diagnostics. */
const CODEX_GOAL_LOG_STATUSES = new Set([
  "active",
  "paused",
  "blocked",
  "usageLimited",
  "budgetLimited",
  "complete",
]);

type RequestHandler = (params: unknown, requestId: number) => unknown;
type NotificationHandler = (method: string, params: unknown) => void;
type UnexpectedTerminationHandler = (error: Error) => void;

/** Stable non-sensitive code for an unexpected Codex app-server termination. */
export type CodexAppServerTerminationCode = "provider_process_error" | "provider_process_exited";

/** Bounded process diagnostics that never retain Codex stderr content. */
export class CodexAppServerTerminationError extends Error {
  /** Stable provider-neutral process failure code. */
  readonly code: CodexAppServerTerminationCode;
  /** Native process exit code, when the child reached exit. */
  readonly exitCode: number | null;
  /** Native termination signal, when reported by the child. */
  readonly signal: NodeJS.Signals | null;
  /** Total stderr bytes observed before termination. */
  readonly stderrBytes: number;
  /** Bounded operating-system error code for child process errors. */
  readonly childErrorCode: string | null;

  /** Constructs one non-sensitive termination error from bounded process metadata. */
  constructor(input: {
    code: CodexAppServerTerminationCode;
    exitCode?: number | null;
    signal?: NodeJS.Signals | null;
    stderrBytes: number;
    childErrorCode?: string | null;
  }) {
    const exitCode = input.exitCode ?? null;
    const signal = input.signal ?? null;
    super(
      input.code === "provider_process_exited"
        ? `Codex app-server exited unexpectedly (code ${exitCode ?? "none"}, signal ${signal ?? "none"})`
        : "Codex app-server process failed unexpectedly",
    );
    this.name = "CodexAppServerTerminationError";
    this.code = input.code;
    this.exitCode = exitCode;
    this.signal = signal;
    this.stderrBytes = input.stderrBytes;
    this.childErrorCode = input.childErrorCode ?? null;
  }
}

type CodexStdoutErrorCode = "handler_failed" | "invalid_json" | "not_object";

interface CodexStdoutErrorLogFields {
  /** Stable category for a rejected stdout line. */
  stdoutErrorCode: CodexStdoutErrorCode;
  /** Unicode character count of the rejected line. */
  stdoutLength: number;
}

/** Non-sensitive fields retained for a native Goal notification. */
interface CodexGoalNotificationLogFields {
  /** Valid native status, or null for missing and invalid payloads. */
  goalStatus: string | null;
  /** Normalized native Goal generation. */
  goalGeneration: string | null;
  /** Unicode character count without the user-authored objective. */
  objectiveLength: number;
}

export interface CodexThreadForkParams {
  threadId: string;
  path?: string | null;
  model?: string | null;
  modelProvider?: string | null;
  serviceTier?: string | null;
  cwd?: string | null;
  runtimeWorkspaceRoots?: string[] | null;
  approvalPolicy?: unknown;
  approvalsReviewer?: unknown;
  sandbox?: unknown;
  permissions?: string | null;
  config?: Record<string, unknown> | null;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
  ephemeral?: boolean;
  threadSource?: unknown;
  excludeTurns?: boolean;
  persistExtendedHistory?: boolean;
}

const CodexThreadForkResponseSchema = z
  .object({
    thread: z
      .object({
        id: z.string(),
        sessionId: z.string().optional(),
        forkedFromId: z.string().nullable().optional(),
        turns: z.array(z.unknown()).optional(),
      })
      .passthrough(),
    model: z.string(),
    modelProvider: z.string(),
    serviceTier: z.string().nullable(),
    cwd: z.string(),
    runtimeWorkspaceRoots: z.array(z.string()).optional().default([]),
    instructionSources: z.array(z.string()).optional().default([]),
    approvalPolicy: z.unknown(),
    approvalsReviewer: z.unknown(),
    sandbox: z.unknown(),
    activePermissionProfile: z.unknown().optional(),
    reasoningEffort: z.string().nullable().optional(),
  })
  .passthrough();

export type CodexThreadForkResponse = z.infer<typeof CodexThreadForkResponseSchema>;

export function parseCodexThreadForkResponse(response: unknown): CodexThreadForkResponse {
  return CodexThreadForkResponseSchema.parse(response);
}

export interface CodexThreadRollbackParams {
  threadId: string;
  numTurns: number;
}

const CodexThreadRollbackResponseSchema = z
  .object({
    thread: z
      .object({
        id: z.string(),
        sessionId: z.string().optional(),
        forkedFromId: z.string().nullable().optional(),
        turns: z.array(z.unknown()).optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type CodexThreadRollbackResponse = z.infer<typeof CodexThreadRollbackResponseSchema>;

export function parseCodexThreadRollbackResponse(response: unknown): CodexThreadRollbackResponse {
  return CodexThreadRollbackResponseSchema.parse(response);
}

export interface CodexAppServerTraceContext {
  agentId?: string;
  sessionId?: string;
  turnId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isJsonRpcResponse(msg: unknown): msg is JsonRpcResponse {
  if (!isRecord(msg)) return false;
  return typeof msg.id === "number";
}

function isJsonRpcRequest(msg: unknown): msg is JsonRpcRequest {
  if (!isRecord(msg)) return false;
  return typeof msg.id === "number" && typeof msg.method === "string";
}

function isJsonRpcNotification(msg: unknown): msg is JsonRpcNotification {
  if (!isRecord(msg)) return false;
  return typeof msg.method === "string" && msg.id === undefined;
}

function readProviderSessionId(params: unknown): string | undefined {
  if (!isRecord(params)) {
    return undefined;
  }
  return typeof params.threadId === "string" ? params.threadId : undefined;
}

function readProviderTurnId(params: unknown): string | undefined {
  if (!isRecord(params)) {
    return undefined;
  }
  if (typeof params.turnId === "string") {
    return params.turnId;
  }
  const turn = params.turn;
  return isRecord(turn) && typeof turn.id === "string" ? turn.id : undefined;
}

/** Normalizes a native Goal generation for non-sensitive trace metadata. */
function readGoalGeneration(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const timestamp = new Date(value * 1_000);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

/** Extracts bounded Goal metadata without retaining the native payload. */
function readGoalNotificationLogFields(params: unknown): CodexGoalNotificationLogFields {
  const payload = isRecord(params) ? params : null;
  const goal = payload && isRecord(payload.goal) ? payload.goal : null;
  const status = goal?.status;
  return {
    goalStatus: typeof status === "string" && CODEX_GOAL_LOG_STATUSES.has(status) ? status : null,
    goalGeneration: readGoalGeneration(goal?.createdAt),
    objectiveLength: typeof goal?.objective === "string" ? Array.from(goal.objective).length : 0,
  };
}

/** Produces bounded diagnostics for a rejected stdout line without retaining its content. */
function codexStdoutErrorLogFields(
  line: string,
  stdoutErrorCode: CodexStdoutErrorCode,
): CodexStdoutErrorLogFields {
  return {
    stdoutErrorCode,
    stdoutLength: Array.from(line).length,
  };
}

/** Reads a bounded operating-system code without retaining the child error message. */
function readChildErrorCode(error: Error): string | null {
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === "string" && /^[A-Z0-9_]{1,64}$/.test(code) ? code : null;
}

export class CodexAppServerClient {
  private readonly rl: readline.Interface;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly requestHandlers = new Map<string, RequestHandler>();
  private notificationHandler: NotificationHandler | null = null;
  private unexpectedTerminationHandler: UnexpectedTerminationHandler | null = null;
  private nextId = 1;
  private disposed = false;
  private stderrBytes = 0;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly logger: Logger,
    private readonly getTraceContext: () => CodexAppServerTraceContext = () => ({}),
  ) {
    this.rl = readline.createInterface({ input: child.stdout });
    this.rl.on("line", (line) => {
      void this.handleLine(line).catch(() => {
        this.logger.warn(
          codexStdoutErrorLogFields(line, "handler_failed"),
          "Failed to handle Codex app-server stdout line",
        );
      });
    });

    child.stderr.on("data", (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(String(chunk));
      this.stderrBytes = Math.min(Number.MAX_SAFE_INTEGER, this.stderrBytes + bytes);
    });

    child.on("error", (err) => {
      this.handleUnexpectedTermination(
        new CodexAppServerTerminationError({
          code: "provider_process_error",
          stderrBytes: this.stderrBytes,
          childErrorCode: readChildErrorCode(err),
        }),
      );
    });

    child.on("exit", (code, signal) => {
      this.handleUnexpectedTermination(
        new CodexAppServerTerminationError({
          code: "provider_process_exited",
          exitCode: code,
          signal,
          stderrBytes: this.stderrBytes,
        }),
      );
    });
  }

  setUnexpectedTerminationHandler(handler: UnexpectedTerminationHandler): void {
    this.unexpectedTerminationHandler = handler;
  }

  setNotificationHandler(handler: NotificationHandler): void {
    this.notificationHandler = handler;
  }

  setRequestHandler(method: string, handler: RequestHandler): void {
    this.requestHandlers.set(method, handler);
  }

  request(method: string, params?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
    if (this.disposed) {
      return Promise.reject(new Error("Codex app-server client is closed"));
    }
    const id = this.nextId++;
    const payload: JsonRpcRequest = { id, method, params };
    const serialized = JSON.stringify(payload);
    this.child.stdin.write(`${serialized}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out for ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  async forkThread(params: CodexThreadForkParams): Promise<CodexThreadForkResponse> {
    return parseCodexThreadForkResponse(await this.request("thread/fork", params));
  }

  async rollbackThread(params: CodexThreadRollbackParams): Promise<CodexThreadRollbackResponse> {
    return parseCodexThreadRollbackResponse(await this.request("thread/rollback", params));
  }

  notify(method: string, params?: unknown): void {
    if (this.disposed) {
      return;
    }
    const payload: JsonRpcNotification = { method, params };
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.unexpectedTerminationHandler = null;
    this.rl.close();
    try {
      this.child.stdin.end();
    } catch {
      // ignore
    }
    const result = await terminateWithTreeKill(this.child, {
      gracefulTimeoutMs: APP_SERVER_GRACEFUL_SHUTDOWN_TIMEOUT_MS,
      forceTimeoutMs: APP_SERVER_FORCE_SHUTDOWN_TIMEOUT_MS,
      onForceSignal: () => {
        this.logger.warn(
          { timeoutMs: APP_SERVER_GRACEFUL_SHUTDOWN_TIMEOUT_MS },
          "Codex app-server did not exit after SIGTERM; sending SIGKILL",
        );
      },
    });
    if (result === "kill-timeout") {
      this.logger.warn(
        { timeoutMs: APP_SERVER_FORCE_SHUTDOWN_TIMEOUT_MS },
        "Codex app-server did not report exit after SIGKILL",
      );
    }
  }

  private handleUnexpectedTermination(error: CodexAppServerTerminationError): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.logger.error(
      {
        appServerErrorCode: error.code,
        exitCode: error.exitCode,
        signal: error.signal,
        stderrBytes: error.stderrBytes,
        childErrorCode: error.childErrorCode,
      },
      "Codex app-server terminated unexpectedly",
    );
    this.rl.close();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    const handler = this.unexpectedTerminationHandler;
    this.unexpectedTerminationHandler = null;
    if (!handler) {
      return;
    }
    try {
      handler(error);
    } catch (handlerError) {
      this.logger.warn({ err: handlerError }, "Codex app-server termination handler threw");
    }
  }

  private writeJsonRpcResponse(response: JsonRpcResponse): void {
    if (this.disposed || this.child.stdin.destroyed || !this.child.stdin.writable) {
      return;
    }
    try {
      this.child.stdin.write(`${JSON.stringify(response)}\n`);
    } catch (error) {
      this.logger.debug({ error }, "Failed to write Codex app-server JSON-RPC response");
    }
  }

  private async handleLine(line: string): Promise<void> {
    if (!line.trim()) return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      this.logger.warn(
        codexStdoutErrorLogFields(line, "invalid_json"),
        "Ignoring non-JSON Codex app-server stdout line",
      );
      return;
    }

    if (!isRecord(raw)) {
      this.logger.warn(
        codexStdoutErrorLogFields(line, "not_object"),
        "Parsed JSON is not an object",
      );
      return;
    }

    if (isJsonRpcResponse(raw)) {
      const id = raw.id;
      if (raw.result !== undefined || raw.error) {
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        if (raw.error) {
          pending.reject(new Error(raw.error.message ?? "Unknown error"));
        } else {
          pending.resolve(raw.result);
        }
        return;
      }

      if (isJsonRpcRequest(raw)) {
        const request = raw;
        this.traceRawEvent(request);
        const handler = this.requestHandlers.get(request.method);
        try {
          const result = handler ? await handler(request.params, request.id) : {};
          this.writeJsonRpcResponse({ id: request.id, result });
        } catch (error) {
          this.writeJsonRpcResponse({
            id: request.id,
            error: { message: error instanceof Error ? error.message : String(error) },
          });
        }
        return;
      }
    }

    if (isJsonRpcNotification(raw)) {
      this.traceRawEvent(raw);
      this.notificationHandler?.(raw.method, raw.params);
    }
  }

  private traceRawEvent(raw: JsonRpcRequest | JsonRpcNotification): void {
    const traceContext = this.getTraceContext();
    const payloadFields = raw.method.startsWith("thread/goal/")
      ? readGoalNotificationLogFields(raw.params)
      : { params: raw.params, rawEvent: raw };
    this.logger.trace(
      {
        provider: "codex",
        agentId: traceContext.agentId,
        sessionId: traceContext.sessionId ?? readProviderSessionId(raw.params),
        turnId: traceContext.turnId ?? readProviderTurnId(raw.params),
        method: raw.method,
        ...payloadFields,
      },
      "provider.codex.raw_event",
    );
  }
}
