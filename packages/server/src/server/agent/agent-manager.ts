import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { stat } from "node:fs/promises";
import {
  AGENT_LIFECYCLE_STATUSES,
  type AgentLifecycleStatus,
} from "@getpaseo/protocol/agent-lifecycle";
import {
  getParentAgentIdFromLabels,
  isDelegatedAgent,
  PARENT_AGENT_ID_LABEL,
} from "@getpaseo/protocol/agent-labels";
import type { Logger } from "pino";
import type { ProviderOptions, ToolPolicy } from "@getpaseo/protocol/agent-types";
import { z } from "zod";
import type { TerminalManager } from "../../terminal/terminal-manager.js";

import {
  getAgentStreamEventTurnId,
  type AgentCapabilityFlags,
  type AgentClient,
  type AgentCreateSessionOptions,
  type AgentResumeSessionOptions,
  type AgentFeature,
  type AgentLaunchContext,
  type AgentSlashCommand,
  type AgentMode,
  type AgentPermissionRequest,
  type AgentPermissionResponse,
  type AgentPermissionResult,
  type AgentPersistenceHandle,
  type AgentProviderNotice,
  type AgentPromptInput,
  type AgentProvider,
  type AgentRunOptions,
  type AgentRunResult,
  type AgentSession,
  type AgentSessionConfig,
  type AgentStreamEvent,
  type AgentTimelineItem,
  type AgentUsage,
  type AgentRuntimeInfo,
  type ImportedTimelineEntry,
  type ImportableProviderSession,
  type ListImportableSessionsOptions,
} from "./agent-sdk-types.js";
import { buildArchivedAgentRecord, type ArchivedStoredAgentRecord } from "./agent-archive.js";
import type { StoredAgentRecord, AgentStorage, PreparedAgentRecord } from "./agent-storage.js";
import { toStoredAgentRecord } from "./agent-projections.js";
import type { AgentOwner } from "./agent-owner.js";
import {
  resolveCompatibleAgentConfig,
  type AgentConfigCompatibilityProvider,
  type HubExecutionContract,
  type LegacyProviderFamily,
  type ResolvedAgentSessionConfig,
} from "./agent-config-compat.js";
import {
  InMemoryAgentTimelineStore,
  type SeedAgentTimelineOptions,
} from "./agent-timeline-store.js";
import type {
  AgentTimelineCommittedFetchOptions,
  AgentTimelineCoverage,
  AgentTimelineFetchOptions,
  AgentTimelineFetchResult,
  AgentTimelineRow,
  AgentTimelineStore,
  CommittedAgentTimelineGeneration,
} from "./agent-timeline-store-types.js";
import {
  AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS,
  AgentStreamCoalescer,
} from "./agent-stream-coalescer.js";
import { limitAgentTimelineItemContent } from "./agent-timeline-content.js";
import {
  AgentRunState,
  type ForegroundTurnWaiter,
  type PendingForegroundRun,
} from "./agent-run-state.js";
import { invokeRewindCapability, type RewindMode } from "./rewind/rewind.js";
import { isSystemInjectedEnvelope } from "./agent-prompt.js";
import { stripInternalPaseoMcpServer, withRuntimePaseoMcpServer } from "./runtime-mcp-config.js";
import { resolveCreateAgentTitles } from "./create-agent-title.js";
import type { PaseoToolCatalogFactory } from "./tools/types.js";
import {
  ProviderSubagentStore,
  type ProviderSubagentDescriptor,
  type ProviderSubagentStoreEvent,
} from "./provider-subagents/store.js";

const RELOAD_SESSION_CLOSE_TIMEOUT_MS = 3_000;
const MAX_DURABLE_LAST_MESSAGE_PAGES = 256;
const INTERRUPT_SESSION_TIMEOUT_MS = 2_000;
const STORED_AGENT_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: false,
  supportsSessionPersistence: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: true,
  supportsRewindConversation: false,
  supportsRewindFiles: false,
  supportsRewindBoth: false,
};

type TimeoutResult = "completed" | "timed_out";

function submittedPromptText(prompt: AgentPromptInput): string {
  if (typeof prompt === "string") {
    return prompt;
  }
  return prompt
    .flatMap((block) => (block.type === "text" && !("mimeType" in block) ? [block.text] : []))
    .join("\n")
    .trim();
}

export class AgentManagerShuttingDownError extends Error {
  constructor() {
    super("Agent manager is shutting down");
    this.name = "AgentManagerShuttingDownError";
  }
}

export class AgentRunCancellationError extends Error {
  constructor(agentId: string, action: "reload" | "replace" | "rewind" | "stop") {
    super(
      `Cannot ${action} agent ${agentId} because its active run cancellation was not acknowledged`,
    );
    this.name = "AgentRunCancellationError";
  }
}

export type AgentRunCancellationResult =
  | { status: "not_running" }
  | { status: "settled" }
  | { status: "refused" };

export type EditLastUserMessageFailureStage = "validation" | "rewind" | "hydrate" | "start_turn";

export interface PreparedProviderSessionImportMetadata extends PreparedAgentRecord {
  timelineRevision: string;
}

export interface EditLastUserMessageResult {
  ok: boolean;
  historyState: "unchanged" | "rewound" | "unknown";
  replacementStarted: boolean;
  failureStage: EditLastUserMessageFailureStage | null;
  error: string | null;
}

export interface EditLastUserMessageInput {
  messageId: string;
  replacementText: string;
  replacementMessageId: string;
}

interface PreparedSessionConfig {
  storedConfig: ResolvedAgentSessionConfig;
  launchConfig: ResolvedAgentSessionConfig;
}

interface RegisterSessionOptions {
  createdAt?: Date;
  updatedAt?: Date;
  lastUserMessageAt?: Date | null;
  lastMessageAt?: Date | null;
  lastReplayableUserMessageId?: string;
  labels?: Record<string, string>;
  timeline?: AgentTimelineItem[];
  timelineRows?: AgentTimelineRow[];
  timelineNextSeq?: number;
  persistence?: AgentPersistenceHandle;
  historyPrimed?: boolean;
  lastUsage?: AgentUsage;
  lastError?: string;
  attention?: AttentionState;
  initialTitle?: string | null;
  initialTitleOverridesConfig?: boolean;
  publishWhenReady?: boolean;
  workspaceId?: string;
  owner?: AgentOwner;
  hubExecutionContract?: HubExecutionContract;
}

interface NormalizeConfigOptions {
  resolveDefaultModel?: boolean;
  env?: Record<string, string>;
}

interface TimeoutOptions {
  operation: Promise<void>;
  timeoutMs: number;
  onLateError?: (error: unknown) => void;
}

function formatProviderList(providers: readonly string[]): string {
  return providers.length > 0 ? providers.join(", ") : "none";
}

function buildStoredAgentConfig(record: StoredAgentRecord): AgentSessionConfig {
  const config: AgentSessionConfig = {
    provider: record.provider,
    cwd: record.cwd,
  };
  if (!record.config) {
    return config;
  }
  if (record.config.modeId != null) config.modeId = record.config.modeId;
  if (record.config.model != null) config.model = record.config.model;
  if (record.config.thinkingOptionId != null) {
    config.thinkingOptionId = record.config.thinkingOptionId;
  }
  if (record.config.featureValues != null) {
    config.featureValues = record.config.featureValues;
  }
  if (record.config.providerOptions != null) {
    config.providerOptions = record.config.providerOptions;
  }
  if (record.config.toolPolicy != null) config.toolPolicy = record.config.toolPolicy;
  if (record.config.systemPrompt != null) {
    config.systemPrompt = record.config.systemPrompt;
  }
  if (record.config.mcpServers != null) config.mcpServers = record.config.mcpServers;
  return stripInternalPaseoMcpServer(config);
}

export { AGENT_LIFECYCLE_STATUSES, type AgentLifecycleStatus };
export type {
  AgentTimelineCursor,
  AgentTimelineFetchDirection,
  AgentTimelineFetchOptions,
  AgentTimelineFetchResult,
  AgentTimelineRow,
  AgentTimelineWindow,
} from "./agent-timeline-store-types.js";

export type AgentManagerEvent =
  | { type: "agent_state"; agent: ManagedAgent }
  | { type: "provider_subagent"; event: ProviderSubagentStoreEvent }
  | {
      type: "agent_stream";
      agentId: string;
      event: AgentStreamEvent;
      seq?: number;
      epoch?: string;
      timestamp?: string;
    };

export type AgentSubscriber = (event: AgentManagerEvent) => void;

export interface SubscribeOptions {
  agentId?: string;
  replayState?: boolean;
}

interface HydrateTimelineOptions {
  force?: boolean;
  broadcast?: boolean | (() => boolean);
}

export type ImportablePersistedAgentQueryOptions = ListImportableSessionsOptions & {
  /**
   * When set, only providers in this set are scanned, in addition to the
   * built-in importable allowlist + enabled + non-derived rules.
   */
  providerFilter?: Set<string>;
};

export interface ManagedImportableProviderSession extends ImportableProviderSession {
  provider: AgentProvider;
}

export type AgentAttentionCallback = (params: {
  agentId: string;
  provider: AgentProvider;
  reason: "finished" | "error" | "permission";
}) => void;

export type AgentArchivedCallback = (agentId: string) => Promise<void> | void;

export interface ProviderAvailability {
  provider: AgentProvider;
  available: boolean;
  error: string | null;
}

interface AgentManagerRescueTimeouts {
  reloadSessionCloseMs?: number;
  interruptSessionMs?: number;
}

interface ProviderEnabledFlag {
  enabled: boolean;
  derivedFromProviderId?: string | null;
  legacyFamily?: LegacyProviderFamily;
  validateOptions?: (options: ProviderOptions | undefined) => ProviderOptions | undefined;
  applyOptions?: (
    config: AgentSessionConfig,
    options: ProviderOptions | undefined,
  ) => AgentSessionConfig;
  applyToolPolicy?: (
    config: AgentSessionConfig,
    toolPolicy: ToolPolicy | undefined,
  ) => AgentSessionConfig;
}
type ProviderEnabledMap = Partial<Record<AgentProvider, ProviderEnabledFlag>>;
type ProviderClientMap = Partial<Record<AgentProvider, AgentClient>>;

export interface CreateAgentOptions {
  labels?: Record<string, string>;
  initialPrompt?: string;
  env?: Record<string, string>;
  persistSession?: boolean;
  initialTitle?: string | null;
  // undefined is an explicit decision: the agent never appears in the sidebar.
  workspaceId: string | undefined;
  owner?: AgentOwner;
  hubExecutionContract?: HubExecutionContract;
}

export interface AgentManagerOptions {
  clients?: ProviderClientMap;
  providerDefinitions?: ProviderEnabledMap;
  idFactory?: () => string;
  registry?: AgentStorage;
  onAgentAttention?: AgentAttentionCallback;
  onWorkspaceStateMayHaveChanged?: (params: { cwd: string }) => void;
  durableTimelineStore?: AgentTimelineStore;
  terminalManager?: TerminalManager | null;
  mcpBaseUrl?: string;
  mcpAuthToken?: string;
  paseoToolsEnabled?: boolean;
  paseoToolCatalogFactory?: PaseoToolCatalogFactory;
  appendSystemPrompt?: string;
  agentStreamCoalesceWindowMs?: number;
  rescueTimeouts?: AgentManagerRescueTimeouts;
  logger: Logger;
}

export interface WaitForAgentOptions {
  signal?: AbortSignal;
  waitForActive?: boolean;
}

export interface WaitForAgentResult {
  status: AgentLifecycleStatus;
  permission: AgentPermissionRequest | null;
  lastMessage: string | null;
}

export interface WaitForAgentStartOptions {
  signal?: AbortSignal;
}

type AttentionState =
  | { requiresAttention: false }
  | {
      requiresAttention: true;
      attentionReason: "finished" | "error" | "permission";
      attentionTimestamp: Date;
    };

function resolveInitialAttention(input: AttentionState | undefined): AttentionState {
  if (input == null || !input.requiresAttention) {
    return { requiresAttention: false };
  }
  return {
    requiresAttention: true,
    attentionReason: input.attentionReason,
    attentionTimestamp: new Date(input.attentionTimestamp),
  };
}

interface StreamEventFlags {
  shouldDispatchEvent: boolean;
  shouldNotifyWaiters: boolean;
}

type ActiveTurnTerminalDisposition = "closed_current" | "stale" | "untracked";

interface HandleStreamEventOptions {
  fromHistory?: boolean;
}

interface ManagedAgentBase {
  id: string;
  provider: AgentProvider;
  cwd: string;
  /**
   * Workspace this agent belongs to, stamped at creation. Independent of cwd:
   * cwd answers "where does it run", workspaceId answers "which workspace owns it".
   * Null/undefined for legacy agents created before ownership stamping.
   */
  workspaceId?: string;
  owner?: AgentOwner;
  hubExecutionContract?: HubExecutionContract;
  capabilities: AgentCapabilityFlags;
  config: AgentSessionConfig;
  runtimeInfo?: AgentRuntimeInfo;
  createdAt: Date;
  updatedAt: Date;
  availableModes: AgentMode[];
  features?: AgentFeature[];
  currentModeId: string | null;
  pendingPermissions: Map<string, AgentPermissionRequest>;
  bufferedPermissionResolutions: Map<
    string,
    Extract<AgentStreamEvent, { type: "permission_resolved" }>
  >;
  inFlightPermissionResponses: Set<string>;
  pendingReplacement: boolean;
  persistence: AgentPersistenceHandle | null;
  historyPrimed: boolean;
  lastReplayableUserMessageId?: string | null;
  providerRetryMessage: string | null;
  lastUserMessageAt: Date | null;
  lastMessageAt: Date | null;
  activeTurnId: string | null;
  activeTurnStartedAt: Date | null;
  lastUsage?: AgentUsage;
  lastError?: string;
  attention: AttentionState;
  foregroundTurnWaiters: Set<ForegroundTurnWaiter>;
  finalizedForegroundTurnIds: Set<string>;
  unsubscribeSession: (() => void) | null;
  /**
   * Internal agents are hidden from listings and don't trigger notifications.
   */
  internal?: boolean;
  /**
   * User-defined labels for categorizing agents (e.g., { surface: "workspace" }).
   */
  labels: Record<string, string>;
}

type ManagedAgentWithSession = ManagedAgentBase & {
  session: AgentSession;
};

type ManagedAgentInitializing = ManagedAgentWithSession & {
  lifecycle: "initializing";
  activeForegroundTurnId: null;
};

type ManagedAgentIdle = ManagedAgentWithSession & {
  lifecycle: "idle";
  activeForegroundTurnId: null;
};

type ManagedAgentRunning = ManagedAgentWithSession & {
  lifecycle: "running";
  activeForegroundTurnId: string | null;
};

type ManagedAgentError = ManagedAgentWithSession & {
  lifecycle: "error";
  activeForegroundTurnId: null;
  lastError: string;
};

type ManagedAgentClosed = ManagedAgentBase & {
  lifecycle: "closed";
  session: null;
  activeForegroundTurnId: null;
};

export type ManagedAgent =
  | ManagedAgentInitializing
  | ManagedAgentIdle
  | ManagedAgentRunning
  | ManagedAgentError
  | ManagedAgentClosed;

export interface AgentMetricsSnapshot {
  total: number;
  subscriptionCount: number;
  byLifecycle: Record<string, number>;
  withActiveForegroundTurn: number;
  timelineStats: {
    totalItems: number;
    maxItemsPerAgent: number;
  };
}

type ActiveManagedAgent =
  | ManagedAgentInitializing
  | ManagedAgentIdle
  | ManagedAgentRunning
  | ManagedAgentError;

type LiveManagedAgent = ActiveManagedAgent;
type AgentLabelPatch = Record<string, string | null>;

function attachManagedTurnIdentity(
  agent: ActiveManagedAgent,
  event: AgentStreamEvent,
  fromHistory: boolean,
): { event: AgentStreamEvent; turnId: string | undefined } {
  const existingTurnId = getAgentStreamEventTurnId(event);
  if (fromHistory || existingTurnId !== undefined) {
    return { event, turnId: existingTurnId };
  }
  switch (event.type) {
    case "turn_started": {
      const turnId =
        agent.activeForegroundTurnId ?? agent.activeTurnId ?? `autonomous-${randomUUID()}`;
      return { event: { ...event, turnId }, turnId };
    }
    case "turn_completed":
    case "turn_failed":
    case "turn_canceled": {
      const turnId = agent.activeForegroundTurnId ?? agent.activeTurnId ?? undefined;
      return turnId ? { event: { ...event, turnId }, turnId } : { event, turnId };
    }
    default:
      return { event, turnId: undefined };
  }
}

function limitAgentStreamEventContent(event: AgentStreamEvent): AgentStreamEvent {
  return event.type === "timeline"
    ? { ...event, item: limitAgentTimelineItemContent(event.item) }
    : event;
}

interface WriteLabelsResult {
  record: StoredAgentRecord | null;
  live: boolean;
}

interface AgentMetadataPatch {
  title?: string;
  labels?: AgentLabelPatch;
}

const SYSTEM_ERROR_PREFIX = "[System Error]";

function attachPersistenceCwd(
  handle: AgentPersistenceHandle | null,
  cwd: string,
): AgentPersistenceHandle | null {
  if (!handle) {
    return null;
  }
  return {
    ...handle,
    metadata: {
      ...handle.metadata,
      cwd,
    },
  };
}

function hasSamePersistenceIdentity(
  before: AgentPersistenceHandle,
  after: AgentPersistenceHandle | null,
): boolean {
  return (
    after !== null &&
    after.provider === before.provider &&
    after.sessionId === before.sessionId &&
    after.nativeHandle === before.nativeHandle
  );
}

function editLastUserMessageError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function normalizeReplayableTimelineEvent(
  event: AgentStreamEvent,
  pendingRun: PendingForegroundRun | null | undefined,
  fromHistory: boolean | undefined,
): AgentStreamEvent {
  if (event.type !== "timeline") {
    return event;
  }
  const shouldMarkReplayableUserMessage =
    !fromHistory &&
    event.item.type === "user_message" &&
    pendingRun?.replayKind === "text_only" &&
    (pendingRun.turnId === null || pendingRun.turnId === event.turnId);
  const item =
    shouldMarkReplayableUserMessage && event.item.type === "user_message"
      ? { ...event.item, replayKind: "text_only" as const }
      : event.item;
  return {
    ...event,
    item: limitAgentTimelineItemContent(item),
  };
}

type LegacyProviderHistoryEvent =
  | Extract<AgentStreamEvent, { type: "timeline" }>
  | Extract<AgentStreamEvent, { type: "provider_subagent" }>;

type LegacyProviderHistoryRead =
  | {
      complete: true;
      events: LegacyProviderHistoryEvent[];
      latestUserMessageId: string | null;
    }
  | {
      complete: false;
      events: LegacyProviderHistoryEvent[];
      latestUserMessageId: string | null;
      error: unknown;
    };

async function readLegacyProviderHistory(
  session: AgentSession,
): Promise<LegacyProviderHistoryRead> {
  const events: LegacyProviderHistoryEvent[] = [];
  let latestUserMessageId: string | null = null;
  try {
    for await (const event of session.streamHistory()) {
      if (event.type === "provider_subagent") {
        events.push(event);
        continue;
      }
      if (event.type !== "timeline") {
        continue;
      }
      if (event.item.type === "user_message" && isSystemInjectedEnvelope(event.item.text)) {
        continue;
      }
      events.push(event);
      if (event.item.type === "user_message") {
        latestUserMessageId = event.item.messageId ?? null;
      }
    }
  } catch (error) {
    return { complete: false, events, latestUserMessageId, error };
  }
  return { complete: true, events, latestUserMessageId };
}

function restoreReplayableHistoryTimelineEvent(
  event: Extract<AgentStreamEvent, { type: "timeline" }>,
  lastReplayableUserMessageId: string | null | undefined,
): Extract<AgentStreamEvent, { type: "timeline" }> {
  if (event.item.type !== "user_message") {
    return event;
  }
  const { replayKind: _historyReplayKind, ...itemWithoutReplayKind } = event.item;
  const item =
    lastReplayableUserMessageId && event.item.messageId === lastReplayableUserMessageId
      ? { ...itemWithoutReplayKind, replayKind: "text_only" as const }
      : itemWithoutReplayKind;
  return { ...event, item };
}

interface SubscriptionRecord {
  callback: AgentSubscriber;
  agentId: string | null;
}

const BUSY_STATUSES: Set<AgentLifecycleStatus> = new Set(["initializing", "running"]);
const AgentIdSchema = z.guid();

function isAgentBusy(status: AgentLifecycleStatus): boolean {
  return BUSY_STATUSES.has(status);
}

function isTurnTerminalEvent(event: AgentStreamEvent): boolean {
  return (
    event.type === "turn_completed" ||
    event.type === "turn_failed" ||
    event.type === "turn_canceled"
  );
}

function abortMessage(reason: unknown, fallbackMessage: string): string {
  if (typeof reason === "string") return reason;
  if (reason instanceof Error) return reason.message;
  return fallbackMessage;
}

function createAbortError(signal: AbortSignal | undefined, fallbackMessage: string): Error {
  const message = abortMessage(signal?.reason, fallbackMessage);
  return Object.assign(new Error(message), { name: "AbortError" });
}

function validateAgentId(agentId: string, source: string): string {
  const result = AgentIdSchema.safeParse(agentId);
  if (!result.success) {
    throw new Error(`${source}: agentId must be a UUID`);
  }
  return result.data;
}

function applyLabelPatch(
  labels: Record<string, string>,
  patch: AgentLabelPatch,
): Record<string, string> {
  const nextLabels = { ...labels };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete nextLabels[key];
    } else {
      nextLabels[key] = value;
    }
  }
  return nextLabels;
}

function buildExplicitTimelineSeedForRegister(
  now: Date,
  options:
    | {
        timeline?: AgentTimelineItem[];
        timelineRows?: AgentTimelineRow[];
        timelineNextSeq?: number;
        createdAt?: Date;
        updatedAt?: Date;
      }
    | undefined,
): SeedAgentTimelineOptions | null {
  const hasTimeline = Boolean(options?.timeline?.length);
  const hasTimelineRows = Boolean(options?.timelineRows?.length);
  const hasTimelineNextSeq = options?.timelineNextSeq !== undefined;
  if (!hasTimeline && !hasTimelineRows && !hasTimelineNextSeq) {
    return null;
  }
  return {
    items: options?.timeline,
    rows: options?.timelineRows,
    nextSeq: options?.timelineNextSeq,
    timestamp: (options?.updatedAt ?? options?.createdAt ?? now).toISOString(),
  };
}

function buildImportedTimelineRows(entries: readonly ImportedTimelineEntry[]): AgentTimelineRow[] {
  const rows: AgentTimelineRow[] = [];
  for (const entry of entries) {
    if (entry.item.type === "user_message" && isSystemInjectedEnvelope(entry.item.text)) {
      continue;
    }
    rows.push({
      seq: rows.length + 1,
      timestamp: entry.timestamp ?? new Date().toISOString(),
      item: limitAgentTimelineItemContent(entry.item),
    });
  }
  return rows;
}

function deriveLastMessageAt(rows: readonly AgentTimelineRow[]): Date | null {
  let latestTimestampMs: number | null = null;
  for (const row of rows) {
    if (row.item.type !== "user_message" && row.item.type !== "assistant_message") {
      continue;
    }
    const timestampMs = Date.parse(row.timestamp);
    if (Number.isNaN(timestampMs)) {
      continue;
    }
    latestTimestampMs = Math.max(latestTimestampMs ?? timestampMs, timestampMs);
  }
  return latestTimestampMs === null ? null : new Date(latestTimestampMs);
}

function resolveImportedAgentTitle(
  config: AgentSessionConfig,
  timelineRows: readonly AgentTimelineRow[],
): string | null {
  const initialPrompt = getFirstUserMessageTextFromRows(timelineRows);
  if (!initialPrompt) {
    return null;
  }
  const { explicitTitle, provisionalTitle } = resolveCreateAgentTitles({
    configTitle: config.title,
    initialPrompt,
  });
  return explicitTitle ?? provisionalTitle ?? null;
}

function getFirstUserMessageTextFromRows(rows: readonly AgentTimelineRow[]): string | null {
  for (const row of rows) {
    const item = row.item;
    if (item.type !== "user_message") {
      continue;
    }
    const text = item.text.trim();
    if (text) {
      return text;
    }
  }
  return null;
}

export class AgentManager {
  private readonly clients = new Map<AgentProvider, AgentClient>();
  private readonly providerEnabled = new Map<AgentProvider, boolean>();
  private readonly providerDefinitions = new Map<AgentProvider, ProviderEnabledFlag>();
  private readonly agents = new Map<string, LiveManagedAgent>();
  private readonly unpublishedAgentIds = new Set<string>();
  private readonly timelineStore = new InMemoryAgentTimelineStore();
  private readonly providerSubagents = new ProviderSubagentStore();
  private readonly agentsAwaitingInitialSnapshotPersist = new Set<string>();
  private readonly sessionEventTails = new Map<string, Promise<void>>();
  private readonly runs = new AgentRunState();
  private readonly subscribers = new Set<SubscriptionRecord>();
  private readonly idFactory: () => string;
  private readonly registry?: AgentStorage;
  private readonly durableTimelineStore?: AgentTimelineStore;
  private readonly previousStatuses = new Map<string, AgentLifecycleStatus>();
  private readonly backgroundTasks = new Set<Promise<void>>();
  private readonly durableTimelineTasks = new Map<string, Set<Promise<void>>>();
  private readonly durableTimelineReplacements = new Set<string>();
  private readonly agentRegistrationTasks = new Set<Promise<void>>();
  private readonly inFlightAgentCloses = new Map<string, Promise<void>>();
  private readonly agentStreamCoalescer: AgentStreamCoalescer;
  private mcpBaseUrl: string | null;
  private readonly mcpAuthToken: string | null;
  private paseoToolsEnabled = true;
  private paseoToolCatalogFactory: PaseoToolCatalogFactory | null = null;
  private appendSystemPrompt: string;
  private onAgentAttention?: AgentAttentionCallback;
  private onAgentArchived?: AgentArchivedCallback;
  private onWorkspaceStateMayHaveChanged?: (params: { cwd: string }) => void;
  private logger: Logger;
  private readonly rescueTimeouts: Required<AgentManagerRescueTimeouts>;
  private acceptingAgentRegistrations = true;

  constructor(options: AgentManagerOptions) {
    this.idFactory = options?.idFactory ?? (() => randomUUID());
    this.registry = options?.registry;
    this.durableTimelineStore = options?.durableTimelineStore;
    this.onAgentAttention = options?.onAgentAttention;
    this.onWorkspaceStateMayHaveChanged = options?.onWorkspaceStateMayHaveChanged;
    this.mcpBaseUrl = options?.mcpBaseUrl ?? null;
    this.mcpAuthToken = options?.mcpAuthToken ?? null;
    this.configurePaseoTools(options);
    this.appendSystemPrompt = options.appendSystemPrompt ?? "";
    this.logger = options.logger.child({ module: "agent", component: "agent-manager" });
    this.rescueTimeouts = {
      reloadSessionCloseMs:
        options.rescueTimeouts?.reloadSessionCloseMs ?? RELOAD_SESSION_CLOSE_TIMEOUT_MS,
      interruptSessionMs:
        options.rescueTimeouts?.interruptSessionMs ?? INTERRUPT_SESSION_TIMEOUT_MS,
    };
    this.agentStreamCoalescer = new AgentStreamCoalescer({
      windowMs: options.agentStreamCoalesceWindowMs ?? AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS,
      timers: { setTimeout, clearTimeout },
      onFlush: ({ agentId, item, provider, turnId }) => {
        const event = this.recordAndDispatchTimelineItem(agentId, item, provider, turnId);
        this.notifyForegroundTurnWaiters(agentId, event);
      },
    });
    this.updateProviderRegistry({
      providerDefinitions: options.providerDefinitions ?? {},
      clients: options.clients ?? {},
    });
  }

  private configurePaseoTools(options: AgentManagerOptions): void {
    this.paseoToolsEnabled = options.paseoToolsEnabled ?? true;
    this.paseoToolCatalogFactory = options.paseoToolCatalogFactory ?? null;
  }

  registerClient(provider: AgentProvider, client: AgentClient): void {
    this.clients.set(provider, client);
  }

  updateProviderRegistry(input: {
    providerDefinitions: ProviderEnabledMap;
    clients: ProviderClientMap;
  }): void {
    this.providerEnabled.clear();
    this.providerDefinitions.clear();
    for (const [provider, definition] of Object.entries(input.providerDefinitions)) {
      if (definition) {
        this.providerEnabled.set(provider, definition.enabled);
        this.providerDefinitions.set(provider, definition);
      }
    }

    this.clients.clear();
    for (const [provider, client] of Object.entries(input.clients)) {
      if (client) {
        this.clients.set(provider, client);
      }
    }
  }

  getAgentConfigCompatibilityProvider(provider: AgentProvider): AgentConfigCompatibilityProvider {
    const definition = this.providerDefinitions.get(provider);
    return {
      provider,
      ...(definition?.legacyFamily ? { legacyFamily: definition.legacyFamily } : {}),
      validateOptions:
        definition?.validateOptions ??
        ((options) => {
          if (options !== undefined) {
            throw new Error(`Provider '${provider}' does not accept providerOptions`);
          }
          return undefined;
        }),
      ...(definition?.applyToolPolicy ? { applyToolPolicy: definition.applyToolPolicy } : {}),
    };
  }

  getRegisteredProviderIds(): AgentProvider[] {
    return Array.from(this.clients.keys());
  }

  setAgentAttentionCallback(callback: AgentAttentionCallback): void {
    this.onAgentAttention = callback;
  }

  setAgentArchivedCallback(callback: AgentArchivedCallback): void {
    this.onAgentArchived = callback;
  }

  setMcpBaseUrl(url: string | null): void {
    this.mcpBaseUrl = url;
  }

  prepareForShutdown(): void {
    this.acceptingAgentRegistrations = false;
  }

  setPaseoToolsEnabled(enabled: boolean): void {
    this.paseoToolsEnabled = enabled;
  }

  setPaseoToolCatalogFactory(factory: PaseoToolCatalogFactory | null): void {
    this.paseoToolCatalogFactory = factory;
  }

  /**
   * Capability token the daemon's own MCP clients must present to the Agent MCP
   * endpoint when a daemon password is configured. Read by the per-client
   * session to authenticate its own MCP connection. Stays in the daemon — never
   * sent to remote clients.
   */
  getMcpAuthToken(): string | null {
    return this.mcpAuthToken;
  }

  setAppendSystemPrompt(prompt: string | null | undefined): void {
    this.appendSystemPrompt = prompt ?? "";
  }

  public getMetricsSnapshot(): AgentMetricsSnapshot {
    const byLifecycle: Record<string, number> = {};
    let withActiveForegroundTurn = 0;
    let totalItems = 0;
    let maxItemsPerAgent = 0;

    for (const agent of this.agents.values()) {
      byLifecycle[agent.lifecycle] = (byLifecycle[agent.lifecycle] ?? 0) + 1;

      if (agent.activeForegroundTurnId !== null) {
        withActiveForegroundTurn++;
      }

      if (!this.timelineStore.has(agent.id)) {
        continue;
      }

      const len = this.timelineStore.getItems(agent.id).length;
      totalItems += len;
      if (len > maxItemsPerAgent) {
        maxItemsPerAgent = len;
      }
    }

    return {
      total: this.agents.size,
      subscriptionCount: this.subscribers.size,
      byLifecycle,
      withActiveForegroundTurn,
      timelineStats: {
        totalItems,
        maxItemsPerAgent,
      },
    };
  }

  private touchUpdatedAt(agent: ManagedAgent): Date {
    const nowMs = Date.now();
    const previousMs = agent.updatedAt.getTime();
    const nextMs = nowMs > previousMs ? nowMs : previousMs + 1;
    const next = new Date(nextMs);
    agent.updatedAt = next;
    return next;
  }

  private nextStoredUpdatedAt(record: StoredAgentRecord): string {
    const previousMs = Date.parse(record.updatedAt);
    const nowMs = Date.now();
    const nextMs = nowMs > previousMs ? nowMs : previousMs + 1;
    return new Date(nextMs).toISOString();
  }

  hasInFlightRun(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return false;
    }

    return (
      agent.lifecycle === "running" ||
      Boolean(agent.activeForegroundTurnId) ||
      this.runs.hasRun(agentId)
    );
  }

  subscribe(callback: AgentSubscriber, options?: SubscribeOptions): () => void {
    const targetAgentId =
      options?.agentId == null ? null : validateAgentId(options.agentId, "subscribe");
    const record: SubscriptionRecord = {
      callback,
      agentId: targetAgentId,
    };
    this.subscribers.add(record);

    if (options?.replayState !== false) {
      if (record.agentId) {
        const agent = this.agents.get(record.agentId);
        if (agent && !this.unpublishedAgentIds.has(agent.id)) {
          callback({
            type: "agent_state",
            agent: { ...agent },
          });
        }
      } else {
        // For global subscribers, skip internal agents during replay
        for (const agent of this.agents.values()) {
          if (agent.internal || this.unpublishedAgentIds.has(agent.id)) {
            continue;
          }
          callback({
            type: "agent_state",
            agent: { ...agent },
          });
        }
      }
    }

    return () => {
      this.subscribers.delete(record);
    };
  }

  subscriptionCount(): number {
    return this.subscribers.size;
  }

  listAgents(): ManagedAgent[] {
    return Array.from(this.agents.values())
      .filter((agent) => !agent.internal && !this.unpublishedAgentIds.has(agent.id))
      .map((agent) => Object.assign({}, agent));
  }

  async listImportableSessions(
    options?: ImportablePersistedAgentQueryOptions,
  ): Promise<ManagedImportableProviderSession[]> {
    const providerEntries = Array.from(this.clients.entries()).filter(
      ([provider, client]) =>
        client.capabilities.supportsSessionListing &&
        !!client.listImportableSessions &&
        this.isProviderImportable(provider, options?.providerFilter),
    );
    const sessionLists = await Promise.all(
      providerEntries.map(async ([provider, client]) => {
        try {
          return (
            await client.listImportableSessions!({
              limit: options?.limit,
              cwd: options?.cwd,
            })
          ).map((session) => Object.assign(session, { provider }));
        } catch (error) {
          this.logger.warn(
            { err: error, provider },
            "Failed to list importable sessions for provider",
          );
          return [];
        }
      }),
    );
    const sessions: ManagedImportableProviderSession[] = sessionLists.flat();

    const limit = options?.limit ?? 20;
    return sessions
      .sort(
        (a, b) =>
          b.lastActivityAt.getTime() - a.lastActivityAt.getTime() ||
          a.provider.localeCompare(b.provider) ||
          a.providerHandleId.localeCompare(b.providerHandleId),
      )
      .slice(0, limit);
  }

  private isProviderImportable(
    provider: AgentProvider,
    providerFilter: Set<string> | undefined,
  ): boolean {
    if (this.providerEnabled.get(provider) === false) {
      return false;
    }
    if (providerFilter && !providerFilter.has(provider)) {
      return false;
    }
    return true;
  }

  async listProviderAvailability(): Promise<ProviderAvailability[]> {
    return Promise.all(
      Array.from(this.clients.keys()).map((provider) => this.getProviderAvailability(provider)),
    );
  }

  async getProviderAvailability(provider: AgentProvider): Promise<ProviderAvailability> {
    const client = this.clients.get(provider);
    if (!client) {
      return {
        provider,
        available: false,
        error: `No client registered for provider '${provider}'`,
      };
    }

    try {
      const available = await client.isAvailable();
      return {
        provider,
        available,
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn({ err: error, provider }, "Failed to check provider availability");
      return {
        provider,
        available: false,
        error: message,
      };
    }
  }

  async listDraftCommands(config: AgentSessionConfig): Promise<AgentSlashCommand[]> {
    const normalizedConfig = await this.normalizeConfig(config, { resolveDefaultModel: false });
    const client = this.requireClient(normalizedConfig.provider);
    if (!normalizedConfig.model) {
      return [];
    }
    const available = await client.isAvailable();
    if (!available) {
      throw new Error(
        `Provider '${normalizedConfig.provider}' is not available. Please ensure the CLI is installed.`,
      );
    }

    if (client.listCommands) {
      return await client.listCommands(normalizedConfig);
    }

    const session = await client.createSession(normalizedConfig);
    try {
      if (!session.listCommands) {
        throw new Error(
          `Provider '${normalizedConfig.provider}' does not support listing commands`,
        );
      }
      return await session.listCommands();
    } finally {
      try {
        await session.close();
      } catch (error) {
        this.logger.warn(
          { err: error, provider: normalizedConfig.provider },
          "Failed to close draft command listing session",
        );
      }
    }
  }

  async listDraftFeatures(config: AgentSessionConfig): Promise<AgentFeature[]> {
    const normalizedConfig = await this.normalizeConfig(config, { resolveDefaultModel: false });
    const client = this.requireClient(normalizedConfig.provider);
    if (!normalizedConfig.model && !client.listFeatures) {
      return [];
    }
    const available = await client.isAvailable();
    if (!available) {
      throw new Error(
        `Provider '${normalizedConfig.provider}' is not available. Please ensure the CLI is installed.`,
      );
    }

    if (client.listFeatures) {
      return await client.listFeatures(normalizedConfig);
    }

    const session = await client.createSession(normalizedConfig);
    try {
      return session.features ?? [];
    } finally {
      try {
        await session.close();
      } catch (error) {
        this.logger.warn(
          { err: error, provider: normalizedConfig.provider },
          "Failed to close draft feature listing session",
        );
      }
    }
  }

  getAgent(id: string): ManagedAgent | null {
    const agent = this.agents.get(id);
    return agent ? { ...agent } : null;
  }

  async waitForAgentClose(agentId: string): Promise<void> {
    await this.inFlightAgentCloses?.get(agentId)?.catch(() => undefined);
  }

  getTimeline(id: string): AgentTimelineItem[] {
    this.requireAgent(id);
    return this.timelineStore.getItems(id);
  }

  async getTimelineRows(id: string): Promise<AgentTimelineRow[]> {
    this.requireAgent(id);
    return this.timelineStore.getRows(id);
  }

  async getDurableTimelineCoverage(
    id: string,
    options?: { expectedRevision?: string },
  ): Promise<AgentTimelineCoverage> {
    if (!this.durableTimelineStore) {
      return { active: null, working: null, eligible: false };
    }
    return await this.durableTimelineStore.getCoverage(id, options);
  }

  async fetchDurableTimelinePage(
    id: string,
    options: AgentTimelineCommittedFetchOptions,
  ): Promise<AgentTimelineFetchResult | null> {
    if (!this.durableTimelineStore) return null;
    return await this.durableTimelineStore.fetchCommittedPage(id, options);
  }

  fetchTimeline(id: string, options?: AgentTimelineFetchOptions): AgentTimelineFetchResult {
    this.requireAgent(id);
    return this.timelineStore.fetch(id, options);
  }

  listProviderSubagents(parentAgentId: string): ProviderSubagentDescriptor[] {
    this.requirePublicAgent(parentAgentId);
    return this.providerSubagents.list(parentAgentId);
  }

  listProviderSubagentActivity(): ProviderSubagentDescriptor[] {
    const publicParentIds = new Set(
      Array.from(this.agents.values())
        .filter((agent) => !agent.internal)
        .map((agent) => agent.id),
    );
    return this.providerSubagents
      .listAll()
      .filter((subagent) => publicParentIds.has(subagent.parentAgentId));
  }

  getProviderSubagent(
    parentAgentId: string,
    subagentId: string,
  ): ProviderSubagentDescriptor | null {
    this.requirePublicAgent(parentAgentId);
    return this.providerSubagents.get(parentAgentId, subagentId);
  }

  fetchProviderSubagentTimeline(
    parentAgentId: string,
    subagentId: string,
    options?: AgentTimelineFetchOptions,
  ): AgentTimelineFetchResult {
    this.requirePublicAgent(parentAgentId);
    return this.providerSubagents.fetchTimeline(parentAgentId, subagentId, options);
  }

  createAgent(
    config: AgentSessionConfig,
    agentId: string | undefined,
    options: CreateAgentOptions,
  ): Promise<ManagedAgent> {
    return this.trackAgentRegistrationOperation(this.createAgentInternal(config, agentId, options));
  }

  private async createAgentInternal(
    config: AgentSessionConfig,
    agentId: string | undefined,
    options: CreateAgentOptions,
  ): Promise<ManagedAgent> {
    this.assertAcceptingAgentRegistrations();
    const resolvedAgentId = validateAgentId(agentId ?? this.idFactory(), "createAgent");
    await this.deleteAgentState(resolvedAgentId);
    const { storedConfig, launchConfig } = await this.prepareSessionConfig(
      config,
      resolvedAgentId,
      options?.env,
    );
    this.requireEnabledProvider(storedConfig.provider);
    const client = await this.requireAvailableClient({
      provider: storedConfig.provider,
    });
    const launchContext = await this.buildLaunchContext(
      resolvedAgentId,
      client,
      storedConfig.cwd,
      options?.env,
    );
    const providerLaunchConfig = this.resolveProviderLaunchConfig(launchConfig, launchContext);
    const createOptions = this.buildCreateSessionOptions(options);
    const session = await client.createSession(providerLaunchConfig, launchContext, createOptions);
    await this.requireExternalMcpSupport(session, storedConfig);
    return this.registerSession(session, storedConfig, resolvedAgentId, {
      labels: options.labels,
      initialTitle: options.initialTitle,
      workspaceId: options.workspaceId,
      owner: options.owner,
      hubExecutionContract: options.hubExecutionContract,
    });
  }

  private buildCreateSessionOptions(options?: {
    persistSession?: boolean;
  }): AgentCreateSessionOptions | undefined {
    return options?.persistSession === undefined
      ? undefined
      : { persistSession: options.persistSession };
  }

  // Reconstruct an agent from provider persistence. Callers should explicitly
  // hydrate timeline history after resume.
  resumeAgentFromPersistence(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    agentId?: string,
    options?: {
      createdAt?: Date;
      updatedAt?: Date;
      lastUserMessageAt?: Date | null;
      lastMessageAt?: Date | null;
      lastReplayableUserMessageId?: string;
      labels?: Record<string, string>;
      workspaceId?: string;
      owner?: AgentOwner;
      hubExecutionContract?: HubExecutionContract;
    },
    resumeOptions?: AgentResumeSessionOptions,
  ): Promise<ManagedAgent> {
    return this.trackAgentRegistrationOperation(
      this.resumeAgentFromPersistenceInternal(handle, overrides, agentId, options, resumeOptions),
    );
  }

  private async resumeAgentFromPersistenceInternal(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    agentId?: string,
    options?: {
      createdAt?: Date;
      updatedAt?: Date;
      lastUserMessageAt?: Date | null;
      lastMessageAt?: Date | null;
      lastReplayableUserMessageId?: string;
      labels?: Record<string, string>;
      workspaceId?: string;
      owner?: AgentOwner;
      hubExecutionContract?: HubExecutionContract;
    },
    resumeOptions?: AgentResumeSessionOptions,
  ): Promise<ManagedAgent> {
    this.assertAcceptingAgentRegistrations();
    const resolvedAgentId = validateAgentId(
      agentId ?? this.idFactory(),
      "resumeAgentFromPersistence",
    );
    const metadata = (handle.metadata ?? {}) as Partial<AgentSessionConfig>;
    const mergedConfig = {
      ...metadata,
      ...overrides,
      provider: handle.provider,
    } as AgentSessionConfig;
    const { storedConfig, launchConfig } = await this.prepareSessionConfig(
      mergedConfig,
      resolvedAgentId,
    );

    const client = this.requireClient(handle.provider);
    const available = await client.isAvailable();
    if (!available) {
      throw new Error(
        `Provider '${handle.provider}' is not available. Please ensure the CLI is installed.`,
      );
    }
    const launchContext = await this.buildLaunchContext(resolvedAgentId, client, storedConfig.cwd);
    const providerLaunchConfig = this.resolveProviderLaunchConfig(launchConfig, launchContext);
    const session = await client.resumeSession(
      handle,
      providerLaunchConfig,
      launchContext,
      resumeOptions,
    );
    await this.requireExternalMcpSupport(session, storedConfig);
    const lastReplayableUserMessageId = hasSamePersistenceIdentity(
      handle,
      session.describePersistence(),
    )
      ? options?.lastReplayableUserMessageId
      : undefined;
    return this.registerSession(session, storedConfig, resolvedAgentId, {
      ...options,
      lastReplayableUserMessageId,
      persistence: handle,
    });
  }

  importProviderSession(input: {
    provider: AgentProvider;
    providerHandleId: string;
    cwd: string;
    workspaceId: string;
    title?: string | null;
    labels?: Record<string, string>;
    agentId?: string;
    onPreparedRecord?: (metadata: PreparedProviderSessionImportMetadata) => Promise<void>;
  }): Promise<ManagedAgent> {
    return this.trackAgentRegistrationOperation(this.importProviderSessionInternal(input));
  }

  private async importProviderSessionInternal(input: {
    provider: AgentProvider;
    providerHandleId: string;
    cwd: string;
    workspaceId: string;
    title?: string | null;
    labels?: Record<string, string>;
    agentId?: string;
    onPreparedRecord?: (metadata: PreparedProviderSessionImportMetadata) => Promise<void>;
  }): Promise<ManagedAgent> {
    this.assertAcceptingAgentRegistrations();
    const resolvedAgentId = validateAgentId(
      input.agentId ?? this.idFactory(),
      "importProviderSession",
    );
    this.requireEnabledProvider(input.provider);

    const client = await this.requireAvailableClient({ provider: input.provider });
    if (!client.importSession) {
      throw new Error(`Provider '${input.provider}' does not support importing sessions`);
    }

    const { storedConfig, launchConfig } = await this.prepareSessionConfig(
      {
        provider: input.provider,
        cwd: input.cwd,
      },
      resolvedAgentId,
    );
    const launchContext = await this.buildLaunchContext(resolvedAgentId, client, storedConfig.cwd);
    const providerLaunchConfig = this.resolveProviderLaunchConfig(launchConfig, launchContext);
    const imported = await client.importSession(
      {
        providerHandleId: input.providerHandleId,
        cwd: input.cwd,
      },
      { config: providerLaunchConfig, storedConfig, launchContext },
    );
    let handedToRegistration = false;
    try {
      if (
        imported.persistence.provider !== input.provider ||
        (imported.persistence.sessionId !== input.providerHandleId &&
          imported.persistence.nativeHandle !== input.providerHandleId)
      ) {
        throw new Error(
          `Imported provider session identity does not match request: ${input.providerHandleId}`,
        );
      }
      const importedConfig = await this.normalizeConfig(
        stripInternalPaseoMcpServer(imported.config),
      );
      const timelineRows = buildImportedTimelineRows(imported.timeline);
      const initialTitle =
        input.title !== undefined
          ? input.title
          : resolveImportedAgentTitle(importedConfig, timelineRows);

      handedToRegistration = true;
      const registrationOptions = {
        labels: input.labels,
        workspaceId: input.workspaceId,
        timelineRows,
        timelineNextSeq: timelineRows.length + 1,
        lastMessageAt: deriveLastMessageAt(timelineRows),
        persistence: imported.persistence,
        historyPrimed: true,
        initialTitle,
        initialTitleOverridesConfig: input.title !== undefined,
        publishWhenReady: true,
      };
      const agent = input.onPreparedRecord
        ? await this.registerPreparedImportedSession(
            imported.session,
            importedConfig,
            resolvedAgentId,
            registrationOptions,
            input.onPreparedRecord,
          )
        : await this.registerSession(
            imported.session,
            importedConfig,
            resolvedAgentId,
            registrationOptions,
          );
      if (this.agents.has(agent.id)) {
        for (const event of imported.providerSubagentEvents ?? []) {
          try {
            const update = this.providerSubagents.apply(agent.id, event.provider, event.event);
            this.dispatch({ type: "provider_subagent", event: update });
          } catch (error) {
            this.logger.warn(
              { err: error, agentId: agent.id },
              "Failed to publish imported provider subagent event",
            );
          }
        }
      }
      return agent;
    } finally {
      if (!handedToRegistration) {
        await this.closeUnregisteredSession(imported.session);
      }
    }
  }

  // Hot-reload an active agent session with config overrides. By default the
  // in-memory timeline is preserved (used for voice-mode toggles and similar
  // config swaps). When `rehydrateFromDisk` is set, the timeline is wiped so a
  // new epoch is minted and provider history is re-streamed — this is what the
  // user-facing "Reload agent" action wants when the on-disk session was
  // mutated outside Paseo.
  reloadAgentSession(
    agentId: string,
    overrides?: Partial<AgentSessionConfig>,
    options?: { rehydrateFromDisk?: boolean },
  ): Promise<ManagedAgent> {
    return this.trackAgentRegistrationOperation(
      this.reloadAgentSessionInternal(agentId, overrides, options),
    );
  }

  private async reloadAgentSessionInternal(
    agentId: string,
    overrides?: Partial<AgentSessionConfig>,
    options?: { rehydrateFromDisk?: boolean },
  ): Promise<ManagedAgent> {
    this.assertAcceptingAgentRegistrations();
    let existing = this.requireSessionAgent(agentId);
    if (this.hasInFlightRun(agentId)) {
      await this.cancelAgentRunBefore(agentId, "reload");
      existing = this.requireSessionAgent(agentId);
    }
    const rehydrateFromDisk = options?.rehydrateFromDisk ?? false;
    const preservedHistoryPrimed = existing.historyPrimed;
    const preservedLastUsage = existing.lastUsage;
    const preservedLastError = existing.lastError;
    const preservedAttention = existing.attention;
    const preservedLastReplayableUserMessageId = existing.lastReplayableUserMessageId;
    const handle = existing.persistence;
    const provider = handle?.provider ?? existing.provider;
    const client = this.requireClient(provider);
    const refreshConfig = {
      ...existing.config,
      ...overrides,
      provider,
    } as AgentSessionConfig;
    const { storedConfig, launchConfig } = await this.prepareSessionConfig(refreshConfig, agentId);
    const launchContext = await this.buildLaunchContext(agentId, client, storedConfig.cwd);
    const providerLaunchConfig = this.resolveProviderLaunchConfig(launchConfig, launchContext);

    const session = handle
      ? await client.resumeSession(handle, providerLaunchConfig, launchContext)
      : await client.createSession(providerLaunchConfig, launchContext);
    await this.requireExternalMcpSupport(session, storedConfig);

    let handedToRegistration = false;
    try {
      this.assertAcceptingAgentRegistrations();

      this.cancelRunningProviderSubagents(agentId);
      const closedExisting = this.prepareAgentForClosure(existing, "agent reloaded");
      try {
        await this.persistSnapshot(closedExisting);
      } finally {
        await this.closeReloadedSession(existing.session, agentId);
      }

      if (rehydrateFromDisk) {
        // Wipe both durable and in-memory timeline so registerSession mints a
        // new epoch and hydrateTimelineFromProvider re-streams the freshly read
        // provider history into an empty timeline.
        await this.deleteCommittedTimeline(agentId);
        this.timelineStore.delete(agentId);
        for (const event of this.providerSubagents.deleteParent(agentId)) {
          this.dispatch({ type: "provider_subagent", event });
        }
      }

      // Preserve existing labels and timeline during reload.
      handedToRegistration = true;
      return this.registerSession(session, storedConfig, agentId, {
        labels: existing.labels,
        workspaceId: existing.workspaceId,
        owner: existing.owner,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
        lastUserMessageAt: existing.lastUserMessageAt,
        lastMessageAt: existing.lastMessageAt,
        lastReplayableUserMessageId:
          handle && hasSamePersistenceIdentity(handle, session.describePersistence())
            ? (preservedLastReplayableUserMessageId ?? undefined)
            : undefined,
        historyPrimed: rehydrateFromDisk ? false : preservedHistoryPrimed,
        lastUsage: preservedLastUsage,
        lastError: preservedLastError,
        attention: preservedAttention,
      });
    } finally {
      if (!handedToRegistration) {
        await this.closeUnregisteredSession(session);
      }
    }
  }

  private async closeReloadedSession(session: AgentSession, agentId: string): Promise<void> {
    try {
      const result = await this.waitWithTimeout({
        operation: session.close(),
        timeoutMs: this.rescueTimeouts.reloadSessionCloseMs,
        onLateError: (error) => {
          this.logger.warn(
            { err: error, agentId },
            "Previous session close failed after refresh timeout",
          );
        },
      });

      if (result === "timed_out") {
        this.logger.warn(
          { agentId, timeoutMs: this.rescueTimeouts.reloadSessionCloseMs },
          "Timed out closing previous session during refresh",
        );
      }
    } catch (error) {
      this.logger.warn({ err: error, agentId }, "Failed to close previous session during refresh");
    }
  }

  private async waitWithTimeout(options: TimeoutOptions): Promise<TimeoutResult> {
    let didTimeOut = false;
    let timer: NodeJS.Timeout | null = null;
    const operation = options.operation
      .then((): TimeoutResult => "completed")
      .catch((error) => {
        if (didTimeOut) {
          options.onLateError?.(error);
          return "timed_out" as const;
        }
        throw error;
      });

    try {
      return await Promise.race([
        operation,
        new Promise<TimeoutResult>((resolvePromise) => {
          timer = setTimeout(() => {
            didTimeOut = true;
            resolvePromise("timed_out");
          }, options.timeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  closeAgent(agentId: string): Promise<void> {
    const existing = this.inFlightAgentCloses.get(agentId);
    if (existing) {
      return existing;
    }

    const close = this.closeAgentRuntime(agentId);
    this.inFlightAgentCloses.set(agentId, close);
    const clearClose = () => {
      if (this.inFlightAgentCloses.get(agentId) === close) {
        this.inFlightAgentCloses.delete(agentId);
      }
    };
    void close.then(clearClose, clearClose);
    return close;
  }

  private async closeAgentRuntime(agentId: string): Promise<void> {
    const agent = this.requireAgent(agentId);
    this.logger.trace(
      {
        agentId,
        provider: agent.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId: agent.activeForegroundTurnId ?? undefined,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
        pendingPermissions: agent.pendingPermissions.size,
      },
      "agent.manager.close.start",
    );
    await this.drainSessionEvents(agentId);
    const canCommitTimeline =
      agent.lifecycle !== "running" &&
      agent.activeForegroundTurnId === null &&
      !agent.pendingReplacement &&
      !this.runs.hasRun(agentId);
    let durableTimelineReady = false;
    if (canCommitTimeline) {
      durableTimelineReady = await this.beginDurableTimelineMutation(agentId, "append")
        .then(() => true)
        .catch(async (error) => {
          await this.markDurableTimelineIncomplete(agentId);
          this.logger.error(
            { err: error, agentId },
            "Failed to prepare durable timeline for agent close",
          );
          return false;
        });
    }
    this.cancelRunningProviderSubagents(agentId);
    const closedAgent = this.prepareAgentForClosure(agent, "agent closed");
    if (canCommitTimeline && durableTimelineReady) {
      await this.commitDurableTimeline(agentId).catch(async (error) => {
        await this.markDurableTimelineIncomplete(agentId);
        this.logger.error(
          { err: error, agentId },
          "Failed to commit durable timeline during agent close",
        );
      });
    } else {
      await this.markDurableTimelineIncomplete(agentId);
    }
    let closeError: unknown;
    try {
      await agent.session.close();
    } catch (error) {
      closeError = error;
    }

    let persistError: unknown;
    try {
      await this.persistSnapshot(closedAgent);
    } catch (error) {
      persistError = error;
    }
    this.emitClosedAgent(closedAgent, { persist: false });
    this.logger.trace(
      {
        agentId,
        provider: closedAgent.provider,
        sessionId: closedAgent.persistence?.sessionId ?? undefined,
      },
      "agent.manager.close.complete",
    );

    if (closeError !== undefined) {
      throw closeError;
    }
    if (persistError !== undefined) {
      throw persistError;
    }
  }

  private cancelRunningProviderSubagents(parentAgentId: string): void {
    for (const subagent of this.providerSubagents.list(parentAgentId)) {
      if (subagent.status !== "running") {
        continue;
      }
      const event = this.providerSubagents.apply(parentAgentId, subagent.provider, {
        type: "upsert",
        id: subagent.id,
        status: "canceled",
      });
      this.dispatch({ type: "provider_subagent", event });
    }
  }

  async archiveAgent(agentId: string): Promise<{ archivedAt: string }> {
    const agent = this.requireAgent(agentId);
    if (!this.registry) {
      throw new Error("Agent storage is not configured");
    }

    await this.registry.applySnapshot(agent, {
      internal: agent.internal,
    });
    const stored = await this.registry.get(agentId);
    if (!stored) {
      throw new Error(`Agent ${agentId} not found in storage after snapshot`);
    }

    const { archivedAt } = await this.markRecordArchived(stored);
    agent.updatedAt = new Date(archivedAt);
    await this.closeAgent(agentId);
    this.discardRetainedAgentState(agentId);

    await this.cascadeArchiveChildren(agentId);

    return { archivedAt };
  }

  // Children created via the MCP `create_agent` tool carry the parent-agent-id
  // label pointing back at the caller. Archiving the parent cascades to those
  // children so subagent fleets don't outlive their orchestrator. Detached
  // handoff agents omit this label, so they stand outside the cascade.
  private async cascadeArchiveChildren(parentAgentId: string): Promise<void> {
    const registry = this.registry;
    if (!registry) {
      return;
    }
    const records = await registry.listAllMetadata();
    for (const record of records) {
      if (record.archivedAt) {
        continue;
      }
      if (record.labels?.[PARENT_AGENT_ID_LABEL] !== parentAgentId) {
        continue;
      }
      if (this.agents.has(record.id)) {
        await this.archiveAgent(record.id);
      } else {
        await this.archiveSnapshot(record.id, new Date().toISOString());
      }
    }
  }

  private async markRecordArchived(record: StoredAgentRecord): Promise<ArchivedStoredAgentRecord> {
    const registry = this.requireRegistry();
    const archivedAt = new Date().toISOString();
    const archivedRecord = buildArchivedAgentRecord(record, { archivedAt, updatedAt: archivedAt });

    await registry.upsert(archivedRecord);

    await this.archiveNativeSessionBestEffort(record.provider, record.persistence);

    if (this.agents.has(record.id)) {
      this.notifyAgentState(record.id);
    } else if (!archivedRecord.internal) {
      this.dispatchArchivedStoredAgent(archivedRecord);
    }

    await this.fireAgentArchived(record.id);

    return archivedRecord;
  }

  private async fireAgentArchived(agentId: string): Promise<void> {
    const callback = this.onAgentArchived;
    if (!callback) {
      return;
    }
    try {
      await callback(agentId);
    } catch (error) {
      this.logger.warn({ err: error, agentId }, "onAgentArchived callback failed");
    }
  }

  private dispatchArchivedStoredAgent(record: StoredAgentRecord): void {
    const updatedAt = new Date(record.updatedAt);
    this.dispatch({
      type: "agent_state",
      agent: {
        id: record.id,
        provider: record.provider,
        cwd: record.cwd,
        workspaceId: record.workspaceId,
        owner: record.owner,
        session: null,
        capabilities: STORED_AGENT_CAPABILITIES,
        config: buildStoredAgentConfig(record),
        runtimeInfo: undefined,
        lifecycle: "closed",
        createdAt: new Date(record.createdAt),
        updatedAt,
        availableModes: [],
        features: record.features,
        currentModeId: record.lastModeId ?? null,
        pendingPermissions: new Map(),
        bufferedPermissionResolutions: new Map(),
        inFlightPermissionResponses: new Set(),
        pendingReplacement: false,
        activeForegroundTurnId: null,
        activeTurnId: null,
        activeTurnStartedAt: null,
        foregroundTurnWaiters: new Set(),
        finalizedForegroundTurnIds: new Set(),
        unsubscribeSession: null,
        persistence: record.persistence ?? null,
        historyPrimed: true,
        lastUserMessageAt: record.lastUserMessageAt ? new Date(record.lastUserMessageAt) : null,
        lastMessageAt: record.lastMessageAt ? new Date(record.lastMessageAt) : null,
        lastUsage: undefined,
        lastError: record.lastError ?? undefined,
        providerRetryMessage: null,
        attention: { requiresAttention: false },
        internal: record.internal,
        labels: record.labels,
      },
    });
  }

  async setAgentMode(agentId: string, modeId: string): Promise<AgentProviderNotice | null> {
    const agent = this.requireSessionAgent(agentId);
    const notice = (await agent.session.setMode(modeId)) ?? null;
    await this.drainSessionEvents(agentId);
    const currentMode = (await agent.session.getCurrentMode()) ?? modeId;
    agent.config.modeId = currentMode ?? undefined;
    agent.currentModeId = currentMode;
    // Update runtimeInfo to reflect the new mode
    if (agent.runtimeInfo) {
      agent.runtimeInfo = { ...agent.runtimeInfo, modeId: currentMode };
    }
    this.touchUpdatedAt(agent);
    this.emitState(agent);
    return notice;
  }

  async setAgentModel(agentId: string, modelId: string | null): Promise<void> {
    const agent = this.requireSessionAgent(agentId);
    const normalizedModelId =
      typeof modelId === "string" && modelId.trim().length > 0 ? modelId : null;

    if (agent.session.setModel) {
      await agent.session.setModel(normalizedModelId);
    }
    await this.drainSessionEvents(agentId);

    agent.config.model = normalizedModelId ?? undefined;
    if (agent.runtimeInfo) {
      agent.runtimeInfo = { ...agent.runtimeInfo, model: normalizedModelId };
    }
    this.touchUpdatedAt(agent);
    this.emitState(agent);
  }

  async setAgentThinkingOption(
    agentId: string,
    thinkingOptionId: string | null,
  ): Promise<AgentProviderNotice | null> {
    const agent = this.requireSessionAgent(agentId);
    const normalizedThinkingOptionId =
      typeof thinkingOptionId === "string" && thinkingOptionId.trim().length > 0
        ? thinkingOptionId
        : null;

    let notice: AgentProviderNotice | null = null;
    if (agent.session.setThinkingOption) {
      notice = (await agent.session.setThinkingOption(normalizedThinkingOptionId)) ?? null;
    }
    await this.drainSessionEvents(agentId);

    agent.config.thinkingOptionId = normalizedThinkingOptionId ?? undefined;
    if (agent.runtimeInfo) {
      agent.runtimeInfo = {
        ...agent.runtimeInfo,
        thinkingOptionId: normalizedThinkingOptionId,
      };
    }
    this.touchUpdatedAt(agent);
    this.emitState(agent);
    return notice;
  }

  async setAgentFeature(agentId: string, featureId: string, value: unknown): Promise<void> {
    const agent = this.requireAgent(agentId);

    if (!agent.session.setFeature) {
      throw new Error("Agent session does not support setting features");
    }

    await agent.session.setFeature(featureId, value);
    await this.drainSessionEvents(agentId);
    agent.config.featureValues = { ...agent.config.featureValues, [featureId]: value };
    this.touchUpdatedAt(agent);
    this.emitState(agent);
  }

  async setTitle(agentId: string, title: string): Promise<void> {
    const agent = this.requireAgent(agentId);
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      return;
    }
    if (
      this.agentsAwaitingInitialSnapshotPersist.has(agent.id) &&
      this.registry &&
      (await this.registry.get(agent.id)) === null
    ) {
      return;
    }
    this.touchUpdatedAt(agent);
    await this.persistSnapshot(agent, { title: normalizedTitle });
    this.emitState(agent, { persist: false });
  }

  async setLabels(agentId: string, labels: Record<string, string>): Promise<void> {
    const agent = this.requireAgent(agentId);
    await this.writeLabels(agent.id, labels);
  }

  private async writeLabels(agentId: string, patch: AgentLabelPatch): Promise<WriteLabelsResult> {
    const liveAgent = this.agents.get(agentId);
    if (liveAgent) {
      liveAgent.labels = applyLabelPatch(liveAgent.labels, patch);
      this.touchUpdatedAt(liveAgent);
      await this.persistSnapshot(liveAgent);
      this.emitState(liveAgent, { persist: false });
      const record = this.registry ? await this.registry.get(agentId) : null;
      return { record, live: true };
    }

    const nextRecord = await this.writeStoredMetadata(agentId, { labels: patch });
    return { record: nextRecord, live: false };
  }

  private async writeStoredMetadata(
    agentId: string,
    patch: AgentMetadataPatch,
  ): Promise<StoredAgentRecord> {
    const registry = this.requireRegistry();
    const record = await registry.get(agentId);
    if (!record) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const nextRecord = {
      ...record,
      ...(patch.title ? { title: patch.title } : {}),
      ...(patch.labels ? { labels: applyLabelPatch(record.labels, patch.labels) } : {}),
      updatedAt: this.nextStoredUpdatedAt(record),
    };
    await registry.upsert(nextRecord);
    return nextRecord;
  }

  async detachAgent(agentId: string): Promise<{
    record: StoredAgentRecord;
    live: boolean;
    previousParentAgentId: string | null;
  }> {
    const registry = this.requireRegistry();
    const liveAgent = this.agents.get(agentId);
    if (liveAgent) {
      const previousParentAgentId = getParentAgentIdFromLabels(liveAgent.labels);
      if (!previousParentAgentId) {
        await this.persistSnapshot(liveAgent);
        const record = await registry.get(agentId);
        if (!record) {
          throw new Error(`Agent not found in storage after detach: ${agentId}`);
        }
        return { record, live: true, previousParentAgentId: null };
      }

      const { record } = await this.writeLabels(agentId, { [PARENT_AGENT_ID_LABEL]: null });
      if (!record) {
        throw new Error(`Agent not found in storage after detach: ${agentId}`);
      }
      return { record, live: true, previousParentAgentId };
    }

    const record = await registry.get(agentId);
    if (!record) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    const previousParentAgentId = getParentAgentIdFromLabels(record.labels);
    if (!previousParentAgentId) {
      return { record, live: false, previousParentAgentId: null };
    }

    const result = await this.writeLabels(agentId, { [PARENT_AGENT_ID_LABEL]: null });
    if (!result.record) {
      throw new Error(`Agent not found in storage after detach: ${agentId}`);
    }
    return { record: result.record, live: false, previousParentAgentId };
  }

  notifyAgentState(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent || agent.internal) {
      return;
    }
    this.touchUpdatedAt(agent);
    this.emitState(agent);
  }

  async clearAgentAttention(agentId: string): Promise<void> {
    const agent = this.requireAgent(agentId);
    if (agent.attention.requiresAttention) {
      agent.attention = { requiresAttention: false };
      await this.persistSnapshot(agent);
      this.emitState(agent, { persist: false });
    }
  }

  async archiveSnapshot(agentId: string, archivedAt: string): Promise<StoredAgentRecord> {
    const registry = this.requireRegistry();
    const liveAgent = this.getAgent(agentId);
    if (liveAgent) {
      await this.persistSnapshot(liveAgent, {
        internal: liveAgent.internal,
      });
    }

    const record = await registry.get(agentId);
    if (!record) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const nextRecord = buildArchivedAgentRecord(record, { archivedAt });
    await registry.upsert(nextRecord);

    await this.archiveNativeSessionBestEffort(record.provider, record.persistence);

    if (this.agents.has(agentId)) {
      this.notifyAgentState(agentId);
    } else {
      this.discardRetainedAgentState(agentId);
      if (!nextRecord.internal) {
        this.dispatchArchivedStoredAgent(nextRecord);
      }
    }

    await this.fireAgentArchived(agentId);
    await this.cascadeArchiveChildren(agentId);

    return nextRecord;
  }

  async unarchiveSnapshot(
    agentId: string,
    updates?: { workspaceId?: string; labels?: AgentLabelPatch },
  ): Promise<boolean> {
    const registry = this.requireRegistry();
    const record = await registry.get(agentId);
    if (!record || !record.archivedAt) {
      return false;
    }

    await this.unarchiveNativeSession(record.provider, record.persistence);

    await registry.upsert({
      ...record,
      ...(updates?.workspaceId ? { workspaceId: updates.workspaceId } : {}),
      ...(updates?.labels ? { labels: applyLabelPatch(record.labels, updates.labels) } : {}),
      archivedAt: null,
      updatedAt: new Date().toISOString(),
    });

    if (this.getAgent(agentId)) {
      this.notifyAgentState(agentId);
    }
    return true;
  }

  async unarchiveSnapshotByHandle(handle: AgentPersistenceHandle): Promise<void> {
    const registry = this.requireRegistry();
    const [matched] = await registry.findByPersistenceHandle(handle);
    if (!matched) {
      return;
    }

    await this.unarchiveSnapshot(matched.id);
  }

  async updateAgentMetadata(
    agentId: string,
    updates: {
      title?: string;
      labels?: Record<string, string>;
    },
  ): Promise<void> {
    const liveAgent = this.getAgent(agentId);
    if (liveAgent) {
      if (updates.title) {
        await this.setTitle(agentId, updates.title);
      }
      if (updates.labels) {
        await this.writeLabels(agentId, updates.labels);
      }
      return;
    }

    await this.writeStoredMetadata(agentId, updates);
  }

  async runAgent(
    agentId: string,
    prompt: AgentPromptInput,
    options?: AgentRunOptions,
  ): Promise<AgentRunResult> {
    const events = this.streamAgent(agentId, prompt, options);
    const timeline: AgentTimelineItem[] = [];
    let finalText = "";
    let usage: AgentUsage | undefined;
    let canceled = false;

    for await (const event of events) {
      if (event.type === "timeline") {
        timeline.push(event.item);
      } else if (event.type === "turn_completed") {
        usage = event.usage;
      } else if (event.type === "turn_failed") {
        throw new Error(this.formatTurnFailedMessage(event));
      } else if (event.type === "turn_canceled") {
        canceled = true;
      }
    }

    finalText = this.getLastAssistantMessageFromTimeline(timeline) ?? "";

    const agent = this.requireAgent(agentId);
    const sessionId = agent.persistence?.sessionId;
    if (!sessionId) {
      throw new Error(`Agent ${agentId} has no persistence.sessionId after run completed`);
    }
    return {
      sessionId,
      finalText,
      usage,
      timeline,
      canceled,
    };
  }

  /**
   * Try to run a prompt out-of-band — i.e. without allocating a foreground turn
   * and without canceling any active turn. Returns true when the session
   * accepted the prompt as a side-effect command (e.g. /goal pause). Events
   * emitted by the handler flow through dispatchStream so they persist and
   * broadcast like normal timeline events.
   */
  tryRunOutOfBand(agentId: string, prompt: AgentPromptInput, options?: AgentRunOptions): boolean {
    const agent = this.requireSessionAgent(agentId);
    const handler = agent.session.tryHandleOutOfBand?.(prompt);
    if (!handler) {
      return false;
    }
    if (options?.clientMessageId) {
      this.recordSubmittedPrompt(agent, prompt, options.clientMessageId);
      this.emitState(agent);
    }
    const dispatch = (event: AgentStreamEvent): void => {
      // Persist timeline items so they show up in fetchAgentTimeline; broadcast
      // for live subscribers. Other event types are broadcast only.
      if (event.type === "timeline") {
        this.touchUpdatedAt(agent);
        const previousLastMessageAtMs = agent.lastMessageAt?.getTime() ?? null;
        const row = this.recordTimeline(agent.id, event.item);
        this.dispatchStream(agent.id, event, {
          seq: row.seq,
          epoch: this.timelineStore.getEpoch(agent.id),
          timestamp: row.timestamp,
        });
        this.emitStateIfLastMessageAtChanged(agent, previousLastMessageAtMs);
        return;
      }
      this.dispatchStream(agent.id, event, { timestamp: new Date().toISOString() });
    };
    void (async () => {
      try {
        await handler.run({ emit: dispatch });
      } catch (error) {
        const text = error instanceof Error ? error.message : "Out-of-band command failed";
        dispatch({
          type: "timeline",
          provider: agent.provider,
          item: { type: "assistant_message", text: `[Error] ${text}` },
        });
      }
    })();
    return true;
  }

  async appendTimelineItem(agentId: string, item: AgentTimelineItem): Promise<void> {
    const agent = this.requireAgent(agentId);
    item = limitAgentTimelineItemContent(item);
    this.touchUpdatedAt(agent);
    const row = this.recordTimeline(agentId, item);
    this.dispatchStream(
      agentId,
      {
        type: "timeline",
        item,
        provider: agent.provider,
      },
      {
        seq: row.seq,
        epoch: this.timelineStore.getEpoch(agentId),
        timestamp: row.timestamp,
      },
    );
    await this.persistSnapshot(agent);
  }

  async emitLiveTimelineItem(agentId: string, item: AgentTimelineItem): Promise<void> {
    const agent = this.requireAgent(agentId);
    this.touchUpdatedAt(agent);
    this.dispatchStream(agentId, {
      type: "timeline",
      item,
      provider: agent.provider,
    });
  }

  streamAgent(
    agentId: string,
    prompt: AgentPromptInput,
    options?: AgentRunOptions,
  ): AsyncGenerator<AgentStreamEvent> {
    const existingAgent = this.requireSessionAgent(agentId);
    this.logger.trace(
      {
        agentId,
        provider: existingAgent.provider,
        sessionId: existingAgent.persistence?.sessionId ?? undefined,
        turnId: existingAgent.activeForegroundTurnId ?? undefined,
        lifecycle: existingAgent.lifecycle,
        activeForegroundTurnId: existingAgent.activeForegroundTurnId,
        hasTrackedRun: this.runs.hasRun(agentId),
        promptType: typeof prompt === "string" ? "string" : "structured",
        hasRunOptions: Boolean(options),
      },
      "agent.manager.stream.request",
    );
    if (existingAgent.activeForegroundTurnId || this.runs.hasRun(agentId)) {
      this.logger.trace(
        {
          agentId,
          provider: existingAgent.provider,
          sessionId: existingAgent.persistence?.sessionId ?? undefined,
          turnId: existingAgent.activeForegroundTurnId ?? undefined,
          lifecycle: existingAgent.lifecycle,
          hasTrackedRun: this.runs.hasRun(agentId),
        },
        "agent.manager.stream.reject",
      );
      throw new Error(`Agent ${agentId} already has an active run`);
    }

    const agent = existingAgent;
    const isReplacement = agent.pendingReplacement;
    agent.lastError = undefined;

    const pendingRun = this.runs.createPendingRun(agentId, {
      purpose: "turn",
      replayKind: options?.replayKind,
    });

    const streamForwarder = async function* streamForwarder(this: AgentManager) {
      let turnId: string;
      let turnStream: ReturnType<AgentRunState["createTurnStream"]> | null = null;
      turnId = await this.startForegroundTurn({
        agent,
        prompt,
        options,
        pendingRun,
        isReplacement,
      });

      turnStream = this.runs.createTurnStream(turnId);
      this.runs.addWaiter(agent, turnStream.waiter);

      try {
        const acceptedTurnStartedEvent: AgentStreamEvent = {
          type: "turn_started",
          provider: agent.provider,
          turnId,
        };
        yield acceptedTurnStartedEvent;
        for await (const event of turnStream.events(isTurnTerminalEvent)) {
          yield event;
        }
      } finally {
        if (turnStream) {
          this.runs.deleteWaiter(agent, turnStream.waiter);
        }
        this.runs.settleForegroundRun(agentId, pendingRun.token);
        if (!agent.activeForegroundTurnId) {
          await this.refreshRuntimeInfo(agent);
        }
      }
    }.call(this);

    return streamForwarder;
  }

  private async startForegroundTurn(params: {
    agent: ActiveManagedAgent;
    prompt: AgentPromptInput;
    options?: AgentRunOptions;
    pendingRun: PendingForegroundRun;
    isReplacement: boolean;
  }): Promise<string> {
    const { agent, prompt, options, pendingRun, isReplacement } = params;
    let turnId: string;
    try {
      await this.beginDurableTimelineMutation(agent.id, "append");
      const result = await agent.session.startTurn(prompt, options);
      turnId = result.turnId;
    } catch (error) {
      agent.pendingReplacement = false;
      const errorMsg = error instanceof Error ? error.message : "Failed to start turn";
      await this.handleStreamEvent(agent, {
        type: "turn_failed",
        provider: agent.provider,
        error: errorMsg,
      });
      this.finalizeForegroundTurn(agent);
      this.runs.settleForegroundRun(agent.id, pendingRun.token);
      throw error;
    }

    pendingRun.started = true;
    pendingRun.turnId = turnId;
    pendingRun.purpose = "turn";
    if (isReplacement) {
      agent.pendingReplacement = false;
    }
    const turnStartedAt = new Date();
    agent.activeForegroundTurnId = turnId;
    this.openActiveTurn(agent, turnId, turnStartedAt);
    agent.lifecycle = "running";
    this.touchUpdatedAt(agent);
    // Publish liveness before the canonical prompt so optimistic activity retires without
    // briefly painting an idle frame. A duplicate provider start is suppressed on ingestion.
    this.dispatchStream(
      agent.id,
      { type: "turn_started", provider: agent.provider, turnId },
      { timestamp: turnStartedAt.toISOString() },
    );
    const stagedSubmittedPromptEcho = options?.clientMessageId
      ? pendingRun.stagedEvents.find(
          (event): event is Extract<AgentStreamEvent, { type: "timeline" }> =>
            event.type === "timeline" &&
            event.item.type === "user_message" &&
            event.item.clientMessageId === options.clientMessageId,
        )
      : undefined;
    if (options?.clientMessageId) {
      this.recordSubmittedPrompt(agent, prompt, options.clientMessageId, {
        messageId: options.clientMessageId,
        providerMessageId:
          stagedSubmittedPromptEcho?.item.type === "user_message"
            ? stagedSubmittedPromptEcho.item.messageId
            : undefined,
        ...(pendingRun.replayKind ? { replayKind: pendingRun.replayKind } : {}),
      });
    }
    for (const stagedEvent of pendingRun.stagedEvents.splice(0)) {
      const isAcceptedTurnStart =
        stagedEvent.type === "turn_started" && getAgentStreamEventTurnId(stagedEvent) === turnId;
      if (isAcceptedTurnStart || stagedEvent === stagedSubmittedPromptEcho) {
        continue;
      }
      this.enqueueSessionEvent(agent.id, stagedEvent);
    }
    this.emitState(agent);
    this.logger.trace(
      {
        agentId: agent.id,
        provider: agent.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
      },
      "agent.manager.stream.start",
    );
    return turnId;
  }

  private finalizeForegroundTurn(agent: ActiveManagedAgent, turnId?: string): void {
    const mutableAgent = agent;
    if (turnId) {
      this.runs.rememberFinalizedTurn(mutableAgent, turnId);
    }
    mutableAgent.activeForegroundTurnId = null;
    this.applyActiveTurnTerminal(mutableAgent, turnId);
    const terminalError = mutableAgent.lastError;
    const shouldHoldBusyForReplacement = mutableAgent.pendingReplacement && !terminalError;
    let nextLifecycle: "running" | "error" | "idle";
    if (shouldHoldBusyForReplacement) {
      nextLifecycle = "running";
    } else if (terminalError) {
      nextLifecycle = "error";
    } else {
      nextLifecycle = "idle";
    }
    mutableAgent.lifecycle = nextLifecycle;
    const persistenceHandle =
      mutableAgent.session.describePersistence() ??
      (mutableAgent.runtimeInfo?.sessionId
        ? { provider: mutableAgent.provider, sessionId: mutableAgent.runtimeInfo.sessionId }
        : null);
    if (persistenceHandle) {
      mutableAgent.persistence = attachPersistenceCwd(persistenceHandle, mutableAgent.cwd);
    }
    this.logger.trace(
      {
        agentId: agent.id,
        provider: agent.provider,
        sessionId: mutableAgent.persistence?.sessionId ?? undefined,
        turnId,
        lifecycle: mutableAgent.lifecycle,
        terminalError,
        pendingReplacement: mutableAgent.pendingReplacement,
      },
      "agent.manager.finalize",
    );
    if (!shouldHoldBusyForReplacement) {
      this.touchUpdatedAt(mutableAgent);
      this.emitState(mutableAgent);
    }
  }

  private openActiveTurn(agent: ActiveManagedAgent, turnId: string, startedAt: Date): void {
    agent.activeTurnId = turnId;
    agent.activeTurnStartedAt = startedAt;
  }

  private applyActiveTurnTerminal(
    agent: ActiveManagedAgent,
    turnId?: string,
    fromHistory = false,
  ): ActiveTurnTerminalDisposition {
    if (fromHistory) return "stale";
    if (!agent.activeTurnId) return "untracked";
    if (turnId && agent.activeTurnId !== turnId) return "stale";
    agent.activeTurnId = null;
    agent.activeTurnStartedAt = null;
    return "closed_current";
  }

  async replaceAgentRun(
    agentId: string,
    prompt: AgentPromptInput,
    options?: AgentRunOptions,
  ): Promise<AsyncGenerator<AgentStreamEvent>> {
    const pendingRun = this.runs.getPendingRun(agentId);
    if (pendingRun?.purpose === "edit_last_user_message" && !pendingRun.started) {
      throw new Error(`Agent ${agentId} is editing its latest user message`);
    }
    const snapshot = this.requireAgent(agentId);
    if (
      snapshot.lifecycle !== "running" &&
      !snapshot.activeForegroundTurnId &&
      !this.runs.hasRun(agentId)
    ) {
      return this.streamAgent(agentId, prompt, options);
    }

    const agent = this.requireSessionAgent(agentId);
    agent.pendingReplacement = true;
    agent.lifecycle = "running";
    this.touchUpdatedAt(agent);
    this.emitState(agent);

    try {
      await this.cancelAgentRunBefore(agentId, "replace");
      return this.streamAgent(agentId, prompt, options);
    } catch (error) {
      const latest = this.agents.get(agentId);
      if (latest) {
        latest.pendingReplacement = false;
      }
      throw error;
    }
  }

  async waitForAgentRunStart(agentId: string, options?: WaitForAgentStartOptions): Promise<void> {
    const snapshot = this.getAgent(agentId);
    if (!snapshot) {
      throw new Error(`Agent ${agentId} not found`);
    }

    const pendingRun = this.runs.getPendingRun(agentId);
    if ((snapshot.lifecycle === "running" || pendingRun?.started) && !snapshot.pendingReplacement) {
      return;
    }

    if (!snapshot.activeForegroundTurnId && !pendingRun && !snapshot.pendingReplacement) {
      throw new Error(`Agent ${agentId} has no pending run`);
    }

    if (options?.signal?.aborted) {
      throw createAbortError(options.signal, "wait_for_agent_start aborted");
    }

    await new Promise<void>((resolvePromise, reject) => {
      if (options?.signal?.aborted) {
        reject(createAbortError(options.signal, "wait_for_agent_start aborted"));
        return;
      }

      let unsubscribe: (() => void) | null = null;
      let abortHandler: (() => void) | null = null;

      const cleanup = () => {
        if (unsubscribe) {
          try {
            unsubscribe();
          } catch {
            // ignore cleanup errors
          }
          unsubscribe = null;
        }
        if (abortHandler && options?.signal) {
          try {
            options.signal.removeEventListener("abort", abortHandler);
          } catch {
            // ignore cleanup errors
          }
          abortHandler = null;
        }
      };

      const finishOk = () => {
        cleanup();
        resolvePromise();
      };

      const finishErr = (error: unknown) => {
        cleanup();
        reject(error);
      };

      if (options?.signal) {
        abortHandler = () =>
          finishErr(createAbortError(options.signal, "wait_for_agent_start aborted"));
        options.signal.addEventListener("abort", abortHandler, { once: true });
      }

      const checkCurrentState = () => {
        const current = this.getAgent(agentId);
        if (!current) {
          finishErr(new Error(`Agent ${agentId} not found`));
          return true;
        }

        const currentPendingRun = this.runs.getPendingRun(agentId);
        if (
          (current.lifecycle === "running" || currentPendingRun?.started) &&
          !current.pendingReplacement
        ) {
          finishOk();
          return true;
        }

        if (
          current.lifecycle === "error" &&
          current.lastError !== undefined &&
          !currentPendingRun?.started
        ) {
          finishErr(new Error(current.lastError ?? `Agent ${agentId} failed to start`));
          return true;
        }

        if (!currentPendingRun && !current.activeForegroundTurnId && !current.pendingReplacement) {
          finishErr(new Error(`Agent ${agentId} run finished before starting`));
          return true;
        }

        return false;
      };

      unsubscribe = this.subscribe(
        (event) => {
          if (event.type !== "agent_state" || event.agent.id !== agentId) {
            return;
          }
          checkCurrentState();
        },
        { agentId, replayState: false },
      );

      checkCurrentState();
    });
  }

  async respondToPermission(
    agentId: string,
    requestId: string,
    response: AgentPermissionResponse,
  ): Promise<AgentPermissionResult | void> {
    const agent = this.requireAgent(agentId);
    agent.inFlightPermissionResponses.add(requestId);

    try {
      const result = await agent.session.respondToPermission(requestId, response);
      agent.pendingPermissions.delete(requestId);

      try {
        await this.refreshSessionState(agent);
      } catch {
        // Ignore refresh errors - state sync after permission approval is best effort.
      }

      this.touchUpdatedAt(agent);
      await this.persistSnapshot(agent);
      this.emitState(agent);

      const bufferedResolution = agent.bufferedPermissionResolutions.get(requestId);
      if (bufferedResolution) {
        agent.bufferedPermissionResolutions.delete(requestId);
        this.dispatchStream(agent.id, bufferedResolution, { timestamp: new Date().toISOString() });
      }

      return result;
    } finally {
      agent.inFlightPermissionResponses.delete(requestId);
      agent.bufferedPermissionResolutions.delete(requestId);
    }
  }

  async cancelAgentRun(agentId: string): Promise<AgentRunCancellationResult> {
    const agent = this.requireSessionAgent(agentId);
    const run =
      this.runs.getRun(agentId) ??
      (agent.lifecycle === "running" ? this.runs.trackAutonomousRun(agentId, null) : null);
    if (run?.kind === "foreground" && run.purpose === "edit_last_user_message" && !run.started) {
      return { status: "not_running" };
    }
    if (!run) {
      return { status: "not_running" };
    }

    const interruptAcknowledged = await this.interruptSession(agent.session, agentId);
    const settlement = await this.waitWithTimeout({
      operation: run.settledPromise,
      timeoutMs: interruptAcknowledged
        ? INTERRUPT_SESSION_TIMEOUT_MS
        : this.rescueTimeouts.interruptSessionMs,
    });

    if (!interruptAcknowledged) {
      return { status: settlement === "completed" ? "settled" : "refused" };
    }

    if (settlement === "timed_out" && run.turnId) {
      this.logger.warn(
        { agentId, turnId: run.turnId, kind: run.kind },
        "cancelAgentRun: acknowledged turn still active after timeout, force-canceling",
      );
      await this.dispatchSessionEvent(agent, {
        type: "turn_canceled",
        provider: agent.provider,
        reason: "interrupted",
        turnId: run.turnId,
      });
      await run.settledPromise;
    } else if (settlement === "timed_out" && run.kind === "autonomous") {
      this.logger.warn(
        { agentId, kind: run.kind },
        "cancelAgentRun: acknowledged turn still active after timeout, force-canceling",
      );
      await this.dispatchSessionEvent(agent, {
        type: "turn_canceled",
        provider: agent.provider,
        reason: "interrupted",
      });
    }

    if (agent.pendingPermissions.size > 0) {
      this.resolvePendingPermissionsForAgent(agent, agent.provider, undefined, "Interrupted");
      this.touchUpdatedAt(agent);
      this.emitState(agent);
    }
    return { status: "settled" };
  }

  private async cancelAgentRunBefore(
    agentId: string,
    action: "reload" | "replace" | "rewind",
  ): Promise<void> {
    const result = await this.cancelAgentRun(agentId);
    if (result.status === "refused") {
      throw new AgentRunCancellationError(agentId, action);
    }
  }

  private async interruptSession(session: AgentSession, agentId: string): Promise<boolean> {
    try {
      const result = await this.waitWithTimeout({
        operation: session.interrupt(),
        timeoutMs: this.rescueTimeouts.interruptSessionMs,
        onLateError: (error) => {
          this.logger.warn(
            { err: error, agentId },
            "Session interrupt failed after timeout during cancel",
          );
        },
      });

      if (result === "timed_out") {
        this.logger.warn(
          { agentId, timeoutMs: this.rescueTimeouts.interruptSessionMs },
          "Timed out interrupting session during cancel",
        );
        return false;
      }
      return true;
    } catch (error) {
      this.logger.error({ err: error, agentId }, "Failed to interrupt session");
      return false;
    }
  }

  getPendingPermissions(agentId: string): AgentPermissionRequest[] {
    const agent = this.requireSessionAgent(agentId);
    return Array.from(agent.pendingPermissions.values());
  }

  private peekPendingPermission(agent: ManagedAgent): AgentPermissionRequest | null {
    const iterator = agent.pendingPermissions.values().next();
    return iterator.done ? null : iterator.value;
  }

  /**
   * Hydrates the timeline from provider history if the agent's durable
   * timeline is empty (e.g., imported agents that have provider history
   * on disk but no persisted timeline rows). No-ops if already hydrated.
   */
  async hydrateTimelineFromProvider(
    agentId: string,
    options?: HydrateTimelineOptions,
  ): Promise<void> {
    const agent = this.requireSessionAgent(agentId);
    await this.hydrateTimelineFromLegacyProviderHistory(agent, options);
  }

  /** Validates the canonical edit target and resolves its provider-native rewind ID */
  private requireLastUserMessageEditTarget(
    agentId: string,
    input: EditLastUserMessageInput,
  ): {
    agent: ActiveManagedAgent;
    persistence: AgentPersistenceHandle;
    providerMessageId: string;
  } {
    const agent = this.requireSessionAgent(agentId);
    if (
      agent.capabilities.supportsInPlaceEditLastUserMessage !== true ||
      !agent.session.rewindLastUserMessageInPlace
    ) {
      throw new Error(`Agent ${agentId} does not support in-place message editing`);
    }
    if (
      agent.lifecycle !== "idle" ||
      agent.activeForegroundTurnId !== null ||
      agent.pendingReplacement ||
      this.runs.hasRun(agentId)
    ) {
      throw new Error(`Agent ${agentId} must be idle before editing its latest message`);
    }
    if (input.replacementText.trim().length === 0) {
      throw new Error("Replacement text must not be empty");
    }
    if (input.replacementMessageId.trim().length === 0) {
      throw new Error("Replacement message id must not be empty");
    }

    const latestUserMessageRow = this.timelineStore
      .getRows(agentId)
      .findLast((row) => row.item.type === "user_message");
    if (
      !latestUserMessageRow ||
      latestUserMessageRow.item.type !== "user_message" ||
      latestUserMessageRow.item.messageId !== input.messageId ||
      latestUserMessageRow.item.replayKind !== "text_only"
    ) {
      throw new Error("The edit target is not the latest replayable text user message");
    }
    if (
      latestUserMessageRow.item.clientMessageId === input.messageId &&
      !latestUserMessageRow.providerMessageId
    ) {
      throw new Error("Cannot edit before the provider acknowledges the submitted prompt");
    }
    const persistence = agent.session.describePersistence() ?? agent.persistence;
    if (!persistence) {
      throw new Error("The provider session has no stable persistence identity");
    }
    return {
      agent,
      persistence,
      providerMessageId: latestUserMessageRow.providerMessageId ?? input.messageId,
    };
  }

  /** Replaces the latest replayable user message without changing the provider session identity. */
  async editLastUserMessage(
    agentId: string,
    input: EditLastUserMessageInput,
  ): Promise<EditLastUserMessageResult> {
    let editTarget: {
      agent: ActiveManagedAgent;
      persistence: AgentPersistenceHandle;
      providerMessageId: string;
    };
    try {
      editTarget = this.requireLastUserMessageEditTarget(agentId, input);
    } catch (error) {
      return {
        ok: false,
        historyState: "unchanged",
        replacementStarted: false,
        failureStage: "validation",
        error: editLastUserMessageError(error, "Message edit validation failed"),
      };
    }
    const { agent, persistence: beforePersistence, providerMessageId } = editTarget;

    let reservation: PendingForegroundRun;
    try {
      reservation = this.runs.createPendingRun(agentId, {
        purpose: "edit_last_user_message",
        replayKind: "text_only",
      });
    } catch (error) {
      return {
        ok: false,
        historyState: "unchanged",
        replacementStarted: false,
        failureStage: "validation",
        error: editLastUserMessageError(error, "Agent operation reservation failed"),
      };
    }

    try {
      await this.beginDurableTimelineMutation(agentId, "append");
      await agent.session.rewindLastUserMessageInPlace!({ messageId: providerMessageId });
    } catch (error) {
      await this.markDurableTimelineIncomplete(agentId);
      this.runs.settleForegroundRun(agentId, reservation.token);
      return {
        ok: false,
        historyState: "unknown",
        replacementStarted: false,
        failureStage: "rewind",
        error: editLastUserMessageError(error, "Provider message rewind failed"),
      };
    }

    if (!hasSamePersistenceIdentity(beforePersistence, agent.session.describePersistence())) {
      this.runs.settleForegroundRun(agentId, reservation.token);
      return {
        ok: false,
        historyState: "unknown",
        replacementStarted: false,
        failureStage: "rewind",
        error: "Provider session identity changed during in-place message rewind",
      };
    }

    try {
      await this.hydrateTimelineFromProvider(agentId, { force: true, broadcast: true });
    } catch (error) {
      this.runs.settleForegroundRun(agentId, reservation.token);
      return {
        ok: false,
        historyState: "rewound",
        replacementStarted: false,
        failureStage: "hydrate",
        error: editLastUserMessageError(error, "Timeline hydration failed after message rewind"),
      };
    }

    if (!hasSamePersistenceIdentity(beforePersistence, agent.session.describePersistence())) {
      this.runs.settleForegroundRun(agentId, reservation.token);
      return {
        ok: false,
        historyState: "unknown",
        replacementStarted: false,
        failureStage: "hydrate",
        error: "Provider session identity changed while hydrating the rewound conversation",
      };
    }

    try {
      await this.startForegroundTurn({
        agent,
        prompt: input.replacementText,
        options: {
          clientMessageId: input.replacementMessageId.trim(),
          replayKind: "text_only",
        },
        pendingRun: reservation,
        isReplacement: false,
      });
    } catch (error) {
      return {
        ok: false,
        historyState: "rewound",
        replacementStarted: false,
        failureStage: "start_turn",
        error: editLastUserMessageError(error, "Replacement turn failed to start"),
      };
    }

    return {
      ok: true,
      historyState: "rewound",
      replacementStarted: true,
      failureStage: null,
      error: null,
    };
  }

  async rewind(agentId: string, messageId: string, mode: RewindMode): Promise<void> {
    const agent = this.requireSessionAgent(agentId);
    const submittedRow = this.timelineStore
      .getRows(agentId)
      .find(
        (row) =>
          row.item.type === "user_message" &&
          row.item.messageId === messageId &&
          row.item.clientMessageId === messageId,
      );
    if (submittedRow && !submittedRow.providerMessageId) {
      throw new Error("Cannot rewind before the provider acknowledges the submitted prompt");
    }
    const providerMessageId = submittedRow?.providerMessageId ?? messageId;

    if (this.hasInFlightRun(agentId)) {
      await this.cancelAgentRunBefore(agentId, "rewind");
    }

    const lock = this.runs.createPendingRun(agentId);
    try {
      this.logger.info(
        { agentId, provider: agent.provider, messageId, mode },
        "agent.rewind.start",
      );
      if (mode !== "files") {
        await this.beginDurableTimelineMutation(agentId, "append");
      }
      await invokeRewindCapability(agent.session, { messageId: providerMessageId, mode });
      if (mode !== "files") {
        await this.hydrateTimelineFromProvider(agentId, { force: true, broadcast: true });
      }
      await this.refreshRuntimeInfo(agent);
      await this.persistSnapshot(agent);
      this.logger.info(
        { agentId, provider: agent.provider, messageId, mode },
        "agent.rewind.complete",
      );
    } catch (error) {
      if (mode !== "files") {
        await this.markDurableTimelineIncomplete(agentId);
      }
      this.logger.warn(
        { err: error, agentId, provider: agent.provider, messageId, mode },
        "agent.rewind.failed",
      );
      throw error;
    } finally {
      this.runs.settleForegroundRun(agentId, lock.token);
    }
  }

  async deleteCommittedTimeline(agentId: string): Promise<void> {
    if (!this.durableTimelineStore) {
      return;
    }
    await this.durableTimelineStore.deleteAgent(agentId);
    await this.clearDurableTimelineRevision(agentId).catch((error) => {
      this.logger.warn({ err: error, agentId }, "Failed to clear deleted timeline revision");
    });
  }

  async deleteAgentState(agentId: string): Promise<void> {
    this.discardRetainedAgentState(agentId);
    await this.deleteCommittedTimeline(agentId);
  }

  async getLastAssistantMessage(agentId: string): Promise<string | null> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return null;
    }

    return await this.getLastAssistantMessageFromStores(agentId);
  }

  private getLastAssistantMessageFromTimeline(
    timeline: readonly AgentTimelineItem[],
  ): string | null {
    return this.getLastAssistantMessageSegmentFromTimeline(timeline)?.text ?? null;
  }

  private getLastAssistantMessageSegmentFromTimeline(
    timeline: readonly AgentTimelineItem[],
  ): { text: string; startsAtBeginning: boolean } | null {
    // Collect the last contiguous assistant messages (Claude streams chunks)
    const chunks: string[] = [];
    let startsAtBeginning = false;
    for (let i = timeline.length - 1; i >= 0; i--) {
      const item = timeline[i];
      if (item.type !== "assistant_message") {
        if (chunks.length) {
          break;
        }
        continue;
      }
      chunks.push(item.text);
      startsAtBeginning = i === 0;
    }

    if (!chunks.length) {
      return null;
    }

    return {
      text: chunks.toReversed().join(""),
      startsAtBeginning,
    };
  }

  private async getLastAssistantMessageFromStores(agentId: string): Promise<string | null> {
    const liveTimeline = this.timelineStore.getItems(agentId);
    if (liveTimeline.length > 0 || !this.durableTimelineStore) {
      return this.getLastAssistantMessageFromTimeline(liveTimeline);
    }
    return await this.getLastAssistantMessageFromDurableTimeline(agentId);
  }

  private async getLastItemFromStores(agentId: string): Promise<AgentTimelineItem | null> {
    const lastLiveItem = this.timelineStore.getLastItem(agentId);
    if (lastLiveItem) {
      return lastLiveItem;
    }
    if (!this.durableTimelineStore) {
      return null;
    }
    const page = await this.durableTimelineStore.fetchCommittedPage(agentId, {
      direction: "tail",
      limit: 1,
    });
    return page?.rows.at(-1)?.item ?? null;
  }

  private async getLastAssistantMessageFromDurableTimeline(
    agentId: string,
  ): Promise<string | null> {
    if (!this.durableTimelineStore) return null;
    const chunks: string[] = [];
    let cursor: AgentTimelineCommittedFetchOptions["cursor"];
    let expectedEpoch: string | null = null;
    for (let pagesRead = 0; pagesRead < MAX_DURABLE_LAST_MESSAGE_PAGES; pagesRead += 1) {
      const page = await this.durableTimelineStore.fetchCommittedPage(agentId, {
        direction: cursor ? "before" : "tail",
        ...(cursor ? { cursor } : {}),
        limit: 200,
      });
      if (!page || page.rows.length === 0) break;
      if (expectedEpoch === null) {
        expectedEpoch = page.epoch;
      } else if (page.epoch !== expectedEpoch) {
        // A generation swap invalidates the cursor; stop rather than duplicating chunks.
        break;
      }
      for (let index = page.rows.length - 1; index >= 0; index -= 1) {
        const item = page.rows[index]?.item;
        if (item?.type === "assistant_message") {
          chunks.push(item.text);
        } else if (chunks.length > 0) {
          return chunks.toReversed().join("");
        }
      }
      if (!page.hasOlder) break;
      const nextSeq = page.rows[0]?.seq;
      if (nextSeq === undefined || (cursor && nextSeq >= cursor.seq)) {
        // Defensive progress guard for a malformed adapter/cursor implementation.
        break;
      }
      cursor = { epoch: page.epoch, seq: nextSeq };
    }
    return chunks.length > 0 ? chunks.toReversed().join("") : null;
  }

  async waitForAgentEvent(
    agentId: string,
    options?: WaitForAgentOptions,
  ): Promise<WaitForAgentResult> {
    const snapshot = this.getAgent(agentId);
    if (!snapshot) {
      throw new Error(`Agent ${agentId} not found`);
    }

    const pendingForegroundRun = this.runs.getPendingRun(agentId);
    const hasForegroundTurn =
      Boolean(snapshot.activeForegroundTurnId) || Boolean(pendingForegroundRun);

    const immediatePermission = this.peekPendingPermission(snapshot);
    if (immediatePermission) {
      return {
        status: snapshot.lifecycle,
        permission: immediatePermission,
        lastMessage: await this.getLastAssistantMessage(agentId),
      };
    }

    const initialStatus = snapshot.lifecycle;
    const initialBusy = isAgentBusy(initialStatus) || hasForegroundTurn;
    const waitForActive = options?.waitForActive ?? false;
    if (!waitForActive && !initialBusy) {
      return {
        status: initialStatus,
        permission: null,
        lastMessage: await this.getLastAssistantMessage(agentId),
      };
    }
    if (waitForActive && !initialBusy && !hasForegroundTurn) {
      return {
        status: initialStatus,
        permission: null,
        lastMessage: await this.getLastAssistantMessage(agentId),
      };
    }

    if (options?.signal?.aborted) {
      throw createAbortError(options.signal, "wait_for_agent aborted");
    }

    return await new Promise<WaitForAgentResult>((resolvePromise, reject) => {
      // Bug #1 Fix: Check abort signal AGAIN inside Promise constructor
      // to avoid race condition between pre-Promise check and abort listener registration
      if (options?.signal?.aborted) {
        reject(createAbortError(options.signal, "wait_for_agent aborted"));
        return;
      }

      let currentStatus: AgentLifecycleStatus = initialStatus;
      let hasStarted =
        isAgentBusy(initialStatus) ||
        Boolean(snapshot.activeForegroundTurnId) ||
        Boolean(pendingForegroundRun?.started);
      let terminalStatusOverride: AgentLifecycleStatus | null = null;
      let finished = false;

      // Bug #3 Fix: Declare unsubscribe and abortHandler upfront so cleanup can reference them
      let unsubscribe: (() => void) | null = null;
      let abortHandler: (() => void) | null = null;

      const cleanup = () => {
        // Clean up subscription
        if (unsubscribe) {
          try {
            unsubscribe();
          } catch {
            // ignore cleanup errors
          }
          unsubscribe = null;
        }

        // Clean up abort listener
        if (abortHandler && options?.signal) {
          try {
            options.signal.removeEventListener("abort", abortHandler);
          } catch {
            // ignore cleanup errors
          }
          abortHandler = null;
        }
      };

      const finish = (permission: AgentPermissionRequest | null) => {
        if (finished) {
          return;
        }
        finished = true;
        cleanup();
        void this.getLastAssistantMessage(agentId)
          .then((lastMessage) => {
            resolvePromise({
              status: currentStatus,
              permission,
              lastMessage,
            });
            return;
          })
          .catch(reject);
      };

      // Bug #3 Fix: Set up abort handler BEFORE subscription
      // to ensure cleanup handlers exist before callback can fire
      if (options?.signal) {
        abortHandler = () => {
          cleanup();
          reject(createAbortError(options.signal, "wait_for_agent aborted"));
        };
        options.signal.addEventListener("abort", abortHandler, { once: true });
      }

      // Bug #3 Fix: Now subscribe with cleanup handlers already in place
      // This prevents race condition if callback fires synchronously with replayState: true
      unsubscribe = this.subscribe(
        (event) => {
          if (event.type === "agent_state") {
            currentStatus = event.agent.lifecycle;
            const pending = this.peekPendingPermission(event.agent);
            if (pending) {
              finish(pending);
              return;
            }
            if (isAgentBusy(event.agent.lifecycle)) {
              hasStarted = true;
              return;
            }
            if (!waitForActive || hasStarted) {
              if (terminalStatusOverride) {
                currentStatus = terminalStatusOverride;
              }
              finish(null);
            }
            return;
          }

          if (event.type === "agent_stream") {
            if (event.event.type === "permission_requested") {
              finish(event.event.request);
              return;
            }
            if (event.event.type === "turn_failed") {
              hasStarted = true;
              terminalStatusOverride = "error";
              return;
            }
            if (event.event.type === "turn_completed") {
              hasStarted = true;
            }
            if (event.event.type === "turn_canceled") {
              hasStarted = true;
            }
          }
        },
        { agentId, replayState: true },
      );
    });
  }

  private async registerPreparedImportedSession(
    session: AgentSession,
    config: AgentSessionConfig,
    agentId: string,
    options: RegisterSessionOptions,
    onPreparedRecord: (metadata: PreparedProviderSessionImportMetadata) => Promise<void>,
  ): Promise<ManagedAgent> {
    let managed: ActiveManagedAgent | null = null;
    let preparedId: string | null = null;
    let catalogCommitted = false;
    try {
      const registry = this.requireRegistry();
      if (!this.durableTimelineStore) {
        throw new Error("Durable timeline storage is required for transactional imports");
      }
      this.assertAcceptingAgentRegistrations();
      const resolvedAgentId = validateAgentId(agentId, "registerPreparedImportedSession");
      if (this.agents.has(resolvedAgentId)) {
        throw new Error(`Agent with id ${resolvedAgentId} already exists`);
      }
      if (await registry.get(resolvedAgentId)) {
        throw new Error(`Agent with id ${resolvedAgentId} already exists in durable storage`);
      }
      const initialPersistedTitle = await this.resolveInitialPersistedTitle(
        resolvedAgentId,
        config,
        options.initialTitle ?? null,
        options.initialTitleOverridesConfig === true,
      );
      const now = new Date();
      const { recoveredLastMessageAt } = await this.initializeAgentTimelineForRegister({
        agentId: resolvedAgentId,
        now,
        options,
      });
      const registrationOptions = Object.prototype.hasOwnProperty.call(options, "lastMessageAt")
        ? options
        : { ...options, lastMessageAt: recoveredLastMessageAt };
      managed = this.buildManagedAgentForRegister({
        resolvedAgentId,
        session,
        config,
        now,
        options: registrationOptions,
      });

      this.agents.set(resolvedAgentId, managed);
      this.unpublishedAgentIds.add(resolvedAgentId);
      this.previousStatuses.set(resolvedAgentId, managed.lifecycle);
      await this.refreshRuntimeInfo(managed, { emit: false });
      this.assertAgentRegistrationActive(managed);
      await this.refreshSessionState(managed, { emit: false });
      this.assertAgentRegistrationActive(managed);
      managed.lifecycle = "idle";
      this.touchUpdatedAt(managed);

      const committedTimeline = await this.persistExplicitTimelineSeed(managed.id, {
        strict: true,
        persistRevision: false,
      });
      if (!committedTimeline) {
        throw new Error("Transactional import did not commit a durable timeline");
      }
      const record = toStoredAgentRecord(managed, { title: initialPersistedTitle });
      record.timelineRevision = committedTimeline.timelineRevision;
      const prepared = await registry.prepareRecord(record, { kind: "absent" });
      preparedId = prepared.preparedId;
      await onPreparedRecord({
        ...prepared,
        timelineRevision: committedTimeline.timelineRevision,
      });
      await registry.commitPreparedRecord(prepared.preparedId);
      catalogCommitted = true;

      try {
        this.subscribeToSession(managed);
      } catch (error) {
        this.logger.error(
          { err: error, agentId: managed.id },
          "Failed to subscribe committed provider import; falling back to durable state",
        );
        this.unpublishedAgentIds.delete(managed.id);
        const closed = this.prepareAgentForClosure(
          managed,
          "provider import live subscription failed",
        );
        await this.closeUnregisteredSession(managed.session);
        return closed;
      }

      this.unpublishedAgentIds.delete(managed.id);
      try {
        this.emitState(managed, { persist: false });
      } catch (error) {
        this.logger.warn(
          { err: error, agentId: managed.id },
          "Failed to publish committed provider import state",
        );
      }
      return { ...managed };
    } catch (error) {
      if (!catalogCommitted && managed) {
        try {
          await this.rollbackUnpublishedImportedSession(managed, preparedId);
        } catch (cleanupError) {
          // AggregateError preserves both failures and also records the original as cause.
          // eslint-disable-next-line preserve-caught-error
          throw new AggregateError(
            [error, cleanupError],
            `Failed to roll back provider import for ${managed.id}`,
            { cause: error },
          );
        }
      } else if (!managed) {
        await this.closeUnregisteredSession(session);
      }
      throw error;
    }
  }

  private async rollbackUnpublishedImportedSession(
    agent: ActiveManagedAgent,
    preparedId: string | null,
  ): Promise<void> {
    this.unpublishedAgentIds.delete(agent.id);
    if (this.agents.get(agent.id) === agent) this.agents.delete(agent.id);
    this.previousStatuses.delete(agent.id);
    this.sessionEventTails.delete(agent.id);
    this.timelineStore.delete(agent.id);
    this.providerSubagents.deleteParent(agent.id);
    await this.drainDurableTimelineTasks(agent.id);
    await this.durableTimelineStore?.deleteAgent(agent.id);
    if (preparedId) await this.registry?.discardPreparedRecord(preparedId);
    await this.closeUnregisteredSession(agent.session);
  }

  private async registerSession(
    session: AgentSession,
    config: AgentSessionConfig,
    agentId: string,
    options?: RegisterSessionOptions,
  ): Promise<ManagedAgent> {
    let registered = false;
    try {
      this.assertAcceptingAgentRegistrations();
      const resolvedAgentId = validateAgentId(agentId, "registerSession");
      if (this.agents.has(resolvedAgentId)) {
        throw new Error(`Agent with id ${resolvedAgentId} already exists`);
      }
      const initialPersistedTitle = await this.resolveInitialPersistedTitle(
        resolvedAgentId,
        config,
        options?.initialTitle ?? null,
        options?.initialTitleOverridesConfig === true,
      );

      const now = new Date();
      const { recoveredLastMessageAt } = await this.initializeAgentTimelineForRegister({
        agentId: resolvedAgentId,
        now,
        options,
      });

      const registrationOptions =
        options && Object.prototype.hasOwnProperty.call(options, "lastMessageAt")
          ? options
          : { ...options, lastMessageAt: recoveredLastMessageAt };

      const managed = this.buildManagedAgentForRegister({
        resolvedAgentId,
        session,
        config,
        now,
        options: registrationOptions,
      });

      this.assertAcceptingAgentRegistrations();
      this.agents.set(resolvedAgentId, managed);
      registered = true;
      // Initialize previousStatus to track transitions
      this.previousStatuses.set(resolvedAgentId, managed.lifecycle);
      await this.refreshRuntimeInfo(managed, { emit: false });
      this.assertAgentRegistrationActive(managed);
      await this.persistSnapshot(managed, {
        title: initialPersistedTitle,
      });
      this.assertAgentRegistrationActive(managed);
      if (options?.timelineRows) {
        await this.persistExplicitTimelineSeed(managed.id);
      }
      if (!options?.publishWhenReady) {
        this.emitState(managed, { persist: false });
      }

      await this.refreshSessionState(managed, { emit: false });
      this.assertAgentRegistrationActive(managed);
      managed.lifecycle = "idle";
      this.touchUpdatedAt(managed);
      await this.persistSnapshot(managed);
      this.assertAgentRegistrationActive(managed);
      this.emitState(managed, { persist: false });
      this.subscribeToSession(managed);
      return { ...managed };
    } catch (error) {
      if (!registered) {
        await this.closeUnregisteredSession(session);
      }
      throw error;
    }
  }

  private assertAcceptingAgentRegistrations(): void {
    if (!this.acceptingAgentRegistrations) {
      throw new AgentManagerShuttingDownError();
    }
  }

  private assertAgentRegistrationActive(agent: ActiveManagedAgent): void {
    if (!this.acceptingAgentRegistrations || this.agents.get(agent.id) !== agent) {
      throw new AgentManagerShuttingDownError();
    }
  }

  private async closeUnregisteredSession(session: AgentSession): Promise<void> {
    try {
      await session.close();
    } catch (error) {
      this.logger.warn({ err: error }, "Failed to close unregistered agent session");
    }
  }

  private async requireExternalMcpSupport(
    session: AgentSession,
    storedConfig: AgentSessionConfig,
  ): Promise<void> {
    if (
      Object.keys(storedConfig.mcpServers ?? {}).length === 0 ||
      session.capabilities.supportsMcpServers === true
    ) {
      return;
    }
    await this.closeUnregisteredSession(session);
    throw new Error(`Provider '${storedConfig.provider}' does not support MCP servers`);
  }

  private async initializeAgentTimelineForRegister(params: {
    agentId: string;
    now: Date;
    options:
      | {
          timeline?: AgentTimelineItem[];
          timelineRows?: AgentTimelineRow[];
          timelineNextSeq?: number;
          persistence?: AgentPersistenceHandle;
          createdAt?: Date;
          updatedAt?: Date;
          lastMessageAt?: Date | null;
        }
      | undefined;
  }): Promise<{ recoveredLastMessageAt: Date | null }> {
    const { agentId, now, options } = params;
    const timelineAlreadyPrimed = this.timelineStore.has(agentId);
    const explicitTimelineSeed = buildExplicitTimelineSeedForRegister(now, options);
    const recoveryRows = await this.loadLastMessageAtRecoveryRows({
      agentId,
      options,
      timelineAlreadyPrimed,
    });
    const timelineSeed = explicitTimelineSeed;
    if (timelineSeed || !this.timelineStore.has(agentId)) {
      this.timelineStore.initialize(agentId, timelineSeed ?? { timestamp: now.toISOString() });
    }
    return {
      recoveredLastMessageAt: deriveLastMessageAt(recoveryRows),
    };
  }

  private async loadLastMessageAtRecoveryRows(params: {
    agentId: string;
    options:
      | {
          timelineRows?: AgentTimelineRow[];
          lastMessageAt?: Date | null;
        }
      | undefined;
    timelineAlreadyPrimed: boolean;
  }): Promise<readonly AgentTimelineRow[]> {
    const { agentId, options, timelineAlreadyPrimed } = params;
    if (options && Object.prototype.hasOwnProperty.call(options, "lastMessageAt")) {
      return [];
    }
    if (options?.timelineRows) {
      return options.timelineRows;
    }
    if (this.durableTimelineStore) {
      try {
        const page = await this.durableTimelineStore.fetchCommittedPage(agentId, {
          direction: "tail",
          limit: 200,
        });
        return page?.rows ?? [];
      } catch (error) {
        this.logger.warn(
          { err: error, agentId },
          "Failed to recover last message timestamp from durable timeline",
        );
      }
    }
    return timelineAlreadyPrimed ? this.timelineStore.getRows(agentId) : [];
  }

  private buildManagedAgentForRegister(params: {
    resolvedAgentId: string;
    session: AgentSession;
    config: AgentSessionConfig;
    now: Date;
    options:
      | {
          createdAt?: Date;
          updatedAt?: Date;
          lastUserMessageAt?: Date | null;
          lastMessageAt?: Date | null;
          lastReplayableUserMessageId?: string;
          labels?: Record<string, string>;
          historyPrimed?: boolean;
          lastUsage?: AgentUsage;
          lastError?: string;
          attention?: AttentionState;
          persistence?: AgentPersistenceHandle;
          workspaceId?: string;
          owner?: AgentOwner;
          hubExecutionContract?: HubExecutionContract;
        }
      | undefined;
  }): ActiveManagedAgent {
    const { resolvedAgentId, session, config, now, options = {} } = params;
    return {
      id: resolvedAgentId,
      provider: config.provider,
      cwd: config.cwd,
      workspaceId: options.workspaceId,
      owner: options.owner,
      hubExecutionContract: options.hubExecutionContract,
      session,
      capabilities: session.capabilities,
      config,
      runtimeInfo: undefined,
      lifecycle: "initializing",
      createdAt: options.createdAt ?? now,
      updatedAt: options.updatedAt ?? now,
      availableModes: [],
      currentModeId: null,
      pendingPermissions: new Map<string, AgentPermissionRequest>(),
      bufferedPermissionResolutions: new Map(),
      inFlightPermissionResponses: new Set(),
      pendingReplacement: false,
      activeForegroundTurnId: null,
      activeTurnId: null,
      activeTurnStartedAt: null,
      foregroundTurnWaiters: new Set<ForegroundTurnWaiter>(),
      finalizedForegroundTurnIds: new Set<string>(),
      unsubscribeSession: null,
      persistence: attachPersistenceCwd(
        options.persistence ?? session.describePersistence(),
        config.cwd,
      ),
      historyPrimed: options.historyPrimed ?? false,
      lastReplayableUserMessageId: options.lastReplayableUserMessageId ?? null,
      providerRetryMessage: null,
      lastUserMessageAt: options.lastUserMessageAt ?? null,
      lastMessageAt: options.lastMessageAt ?? null,
      lastUsage: options.lastUsage,
      lastError: options.lastError,
      attention: resolveInitialAttention(options.attention),
      internal: config.internal ?? false,
      labels: options.labels ?? {},
    } as ActiveManagedAgent;
  }

  private prepareAgentForClosure(
    agent: LiveManagedAgent,
    cancelReason: string,
  ): ManagedAgentClosed {
    this.agentStreamCoalescer.flushAndDiscard(agent.id);
    this.agents.delete(agent.id);
    this.previousStatuses.delete(agent.id);
    if (agent.unsubscribeSession) {
      agent.unsubscribeSession();
      agent.unsubscribeSession = null;
    }
    this.runs.cancelWaiters(agent, (turnId) => ({
      type: "turn_canceled",
      provider: agent.provider,
      reason: cancelReason,
      turnId,
    }));
    this.runs.clearAgentRun(agent.id);
    this.touchUpdatedAt(agent);
    return {
      ...agent,
      lifecycle: "closed",
      session: null,
      activeForegroundTurnId: null,
      activeTurnId: null,
      activeTurnStartedAt: null,
      pendingPermissions: new Map(),
      bufferedPermissionResolutions: new Map(),
      inFlightPermissionResponses: new Set(),
      pendingReplacement: false,
      providerRetryMessage: null,
      foregroundTurnWaiters: new Set(),
      finalizedForegroundTurnIds: new Set(),
      unsubscribeSession: null,
    };
  }

  private discardRetainedAgentState(agentId: string): void {
    this.unpublishedAgentIds.delete(agentId);
    this.timelineStore.delete(agentId);
    for (const event of this.providerSubagents.deleteParent(agentId)) {
      this.dispatch({ type: "provider_subagent", event });
    }
  }

  private emitClosedAgent(agent: ManagedAgentClosed, options?: { persist?: boolean }): void {
    this.emitState(agent, options);
  }
  private subscribeToSession(agent: ActiveManagedAgent): void {
    if (agent.unsubscribeSession) {
      return;
    }
    const agentId = agent.id;
    const unsubscribe = agent.session.subscribe((event: AgentStreamEvent) => {
      this.enqueueSessionEvent(agentId, event);
    });
    agent.unsubscribeSession = unsubscribe;
  }

  private enqueueSessionEvent(agentId: string, event: AgentStreamEvent): void {
    this.logger.trace(
      {
        agentId,
        provider: event.provider,
        sessionId: this.agents.get(agentId)?.persistence?.sessionId ?? undefined,
        turnId: getAgentStreamEventTurnId(event),
        event,
      },
      "agent.manager.enqueue",
    );
    const pendingRun = this.runs.getPendingRun(agentId);
    if (pendingRun && !pendingRun.started) {
      pendingRun.stagedEvents.push(event);
      return;
    }
    const previous = this.sessionEventTails.get(agentId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const current = this.agents.get(agentId);
        if (!current) {
          return;
        }
        if (current.session == null) {
          return;
        }
        this.logger.trace(
          {
            agentId,
            provider: event.provider,
            sessionId: current.persistence?.sessionId ?? undefined,
            turnId: getAgentStreamEventTurnId(event),
            event,
          },
          "agent.manager.dequeue",
        );
        await this.dispatchSessionEvent(current, event);
        return;
      })
      .catch((err) => {
        this.logger.error(
          { err, agentId, eventType: event.type },
          "Failed to process session event",
        );
      });

    this.sessionEventTails.set(agentId, next);
    this.trackBackgroundTask(next);
    void next.finally(() => {
      if (this.sessionEventTails.get(agentId) === next) {
        this.sessionEventTails.delete(agentId);
      }
    });
  }

  /**
   * Provider mutations may synchronously emit config events that are processed through the
   * asynchronous session queue. Apply those events before committing the mutation's explicit
   * manager state so call order remains authoritative.
   */
  private async drainSessionEvents(agentId: string): Promise<void> {
    while (true) {
      const tail = this.sessionEventTails.get(agentId);
      if (!tail) {
        return;
      }
      await tail;
      if (this.sessionEventTails.get(agentId) === tail) {
        return;
      }
    }
  }

  private async dispatchSessionEvent(
    agent: ActiveManagedAgent,
    event: AgentStreamEvent,
  ): Promise<void> {
    if (event.type === "provider_subagent") {
      const update = this.providerSubagents.apply(agent.id, event.provider, event.event);
      this.dispatch({ type: "provider_subagent", event: update });
      return;
    }
    const turnId = getAgentStreamEventTurnId(event);
    const matchingWaiters = this.runs.getMatchingWaiters(agent, turnId);
    this.logger.trace(
      {
        agentId: agent.id,
        provider: event.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId,
        matchingWaiterCount: matchingWaiters.length,
        event,
      },
      "agent.manager.dispatch_session_event",
    );

    const shouldNotifyWaiters = await this.handleStreamEvent(agent, event);

    if (!shouldNotifyWaiters) {
      return;
    }

    this.runs.notifyWaiters(matchingWaiters, event, {
      terminal: isTurnTerminalEvent(event),
    });
    this.logger.trace(
      {
        agentId: agent.id,
        provider: event.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId,
        notifiedWaiterCount: matchingWaiters.length,
        terminal: isTurnTerminalEvent(event),
        event,
      },
      "agent.manager.notify_waiters",
    );
  }

  private async resolveInitialPersistedTitle(
    agentId: string,
    config: AgentSessionConfig,
    fallbackTitle: string | null,
    initialTitleOverridesConfig: boolean,
  ): Promise<string | null> {
    const existing = await this.registry?.get(agentId);
    if (existing) {
      return existing.title ?? null;
    }
    if (initialTitleOverridesConfig) {
      return fallbackTitle;
    }
    const explicitTitle =
      typeof config.title === "string" && config.title.trim().length > 0
        ? config.title.trim()
        : null;
    return explicitTitle ?? fallbackTitle;
  }

  private async persistSnapshot(
    agent: ManagedAgent,
    options?: { title?: string | null; internal?: boolean },
  ): Promise<void> {
    if (!this.registry) {
      return;
    }
    // Don't persist internal agents - they're ephemeral system tasks
    if (agent.internal) {
      return;
    }
    await this.registry.applySnapshot(agent, options);
  }

  private requireRegistry(): AgentStorage {
    if (!this.registry) {
      throw new Error("Agent storage unavailable");
    }
    return this.registry;
  }

  private async refreshSessionState(
    agent: ActiveManagedAgent,
    options?: { emit?: boolean },
  ): Promise<void> {
    try {
      const modes = await agent.session.getAvailableModes();
      agent.availableModes = modes;
    } catch {
      agent.availableModes = [];
    }

    try {
      agent.currentModeId = await agent.session.getCurrentMode();
    } catch {
      agent.currentModeId = null;
    }

    try {
      const pending = agent.session.getPendingPermissions();
      agent.pendingPermissions = new Map(pending.map((request) => [request.id, request]));
    } catch {
      agent.pendingPermissions.clear();
    }

    this.syncFeaturesFromSession(agent);
    await this.refreshRuntimeInfo(agent, options);
  }

  private async refreshRuntimeInfo(
    agent: ActiveManagedAgent,
    options?: { emit?: boolean },
  ): Promise<void> {
    try {
      const newInfo = await agent.session.getRuntimeInfo();
      const changed =
        newInfo.model !== agent.runtimeInfo?.model ||
        newInfo.thinkingOptionId !== agent.runtimeInfo?.thinkingOptionId ||
        newInfo.sessionId !== agent.runtimeInfo?.sessionId ||
        newInfo.modeId !== agent.runtimeInfo?.modeId;
      agent.runtimeInfo = newInfo;
      if (!agent.persistence && newInfo.sessionId) {
        agent.persistence = attachPersistenceCwd(
          { provider: agent.provider, sessionId: newInfo.sessionId },
          agent.cwd,
        );
      }
      // Emit state if runtimeInfo changed so clients get the updated model
      if (changed && options?.emit !== false) {
        this.emitState(agent);
      }
    } catch {
      // Keep existing runtimeInfo if refresh fails.
    }
  }

  private async hydrateTimelineFromLegacyProviderHistory(
    agent: ActiveManagedAgent,
    options?: HydrateTimelineOptions,
  ): Promise<void> {
    if (agent.historyPrimed && !options?.force) {
      return;
    }

    const broadcast = options?.broadcast ?? false;

    if (options?.force) {
      await this.forceHydrateTimelineFromLegacyProviderHistory(
        agent,
        typeof broadcast === "function" ? broadcast() : broadcast,
      );
      return;
    }

    await this.primeTimelineFromLegacyProviderHistory(agent, broadcast);
  }

  private async forceHydrateTimelineFromLegacyProviderHistory(
    agent: ActiveManagedAgent,
    broadcast: boolean,
  ): Promise<void> {
    const replacementEpoch = randomUUID();
    await this.beginDurableTimelineMutation(agent.id, "replace", replacementEpoch);
    const history = await readLegacyProviderHistory(agent.session);
    if (!history.complete) {
      await this.markDurableTimelineIncomplete(agent.id);
      if (this.clearReplayableProofUnlessLatest(agent, null)) {
        this.emitState(agent);
      }
      throw history.error;
    }
    const historyEvents = history.events.filter(
      (event): event is Extract<AgentStreamEvent, { type: "timeline" }> =>
        event.type === "timeline",
    );
    const providerSubagentEvents = history.events.filter(
      (event): event is Extract<AgentStreamEvent, { type: "provider_subagent" }> =>
        event.type === "provider_subagent",
    );

    this.clearReplayableProofUnlessLatest(agent, history.latestUserMessageId);

    this.agentStreamCoalescer.flushAndDiscard(agent.id);
    this.timelineStore.delete(agent.id);
    this.timelineStore.initialize(agent.id, {
      epoch: replacementEpoch,
      timestamp: new Date().toISOString(),
    });
    // Recompute the message timestamp from the replacement history, including the empty case.
    agent.lastMessageAt = null;
    agent.historyPrimed = true;

    for (const event of this.providerSubagents.deleteParent(agent.id)) {
      if (broadcast) {
        this.dispatch({ type: "provider_subagent", event });
      }
    }
    for (const event of providerSubagentEvents) {
      const update = this.providerSubagents.apply(agent.id, event.provider, event.event);
      if (broadcast) {
        this.dispatch({ type: "provider_subagent", event: update });
      }
    }
    this.durableTimelineReplacements.add(agent.id);
    try {
      for (const historyEvent of historyEvents) {
        const event = restoreReplayableHistoryTimelineEvent(
          historyEvent,
          agent.lastReplayableUserMessageId,
        );
        const row = this.recordTimeline(
          agent.id,
          event.item,
          event.timestamp ? { timestamp: event.timestamp } : undefined,
        );
        if (broadcast) {
          this.dispatchStream(agent.id, event, {
            seq: row.seq,
            epoch: this.timelineStore.getEpoch(agent.id),
            timestamp: row.timestamp,
          });
        }
      }
    } finally {
      this.durableTimelineReplacements.delete(agent.id);
    }
    await this.finishDurableTimelineReplacement(agent.id, replacementEpoch, true);
    this.touchUpdatedAt(agent);
    this.emitState(agent);
  }

  private clearReplayableProofUnlessLatest(
    agent: ActiveManagedAgent,
    latestHistoryUserMessageId: string | null,
  ): boolean {
    if (
      !agent.lastReplayableUserMessageId ||
      agent.lastReplayableUserMessageId === latestHistoryUserMessageId
    ) {
      return false;
    }
    agent.lastReplayableUserMessageId = null;
    return true;
  }

  private async primeTimelineFromLegacyProviderHistory(
    agent: ActiveManagedAgent,
    broadcast: boolean | (() => boolean),
  ): Promise<void> {
    const previousLastMessageAtMs = agent.lastMessageAt?.getTime() ?? null;
    const deferredBroadcast = typeof broadcast === "function";
    const timelineEvents: Array<{
      event: Extract<AgentStreamEvent, { type: "timeline" }>;
      row: AgentTimelineRow;
    }> = [];
    const providerSubagentEvents: AgentManagerEvent[] = [];
    const replacementEpoch = this.timelineStore.getEpoch(agent.id);
    await this.beginDurableTimelineMutation(agent.id, "replace", replacementEpoch);
    agent.historyPrimed = true;
    let history: Awaited<ReturnType<typeof readLegacyProviderHistory>>;
    try {
      history = await readLegacyProviderHistory(agent.session);
    } catch (error) {
      agent.historyPrimed = false;
      await this.markDurableTimelineIncomplete(agent.id);
      throw error;
    }
    agent.historyPrimed = history.complete;

    const replayableProofChanged = this.clearReplayableProofUnlessLatest(
      agent,
      history.complete ? history.latestUserMessageId : null,
    );
    this.durableTimelineReplacements.add(agent.id);
    try {
      for (const event of history.events) {
        if (event.type === "provider_subagent") {
          const update = this.providerSubagents.apply(agent.id, event.provider, event.event);
          const managerEvent: AgentManagerEvent = { type: "provider_subagent", event: update };
          if (deferredBroadcast) {
            providerSubagentEvents.push(managerEvent);
          } else if (broadcast) {
            this.dispatch(managerEvent);
          }
          continue;
        }
        const restoredEvent = restoreReplayableHistoryTimelineEvent(
          event,
          agent.lastReplayableUserMessageId,
        );
        const row = this.recordTimeline(
          agent.id,
          restoredEvent.item,
          restoredEvent.timestamp ? { timestamp: restoredEvent.timestamp } : undefined,
        );
        if (deferredBroadcast) {
          timelineEvents.push({ event: restoredEvent, row });
        } else if (broadcast) {
          this.dispatchStream(agent.id, restoredEvent, {
            seq: row.seq,
            epoch: this.timelineStore.getEpoch(agent.id),
            timestamp: row.timestamp,
          });
        }
      }
    } finally {
      this.durableTimelineReplacements.delete(agent.id);
    }

    await this.finishDurableTimelineReplacement(agent.id, replacementEpoch, history.complete).catch(
      (error) => {
        this.logger.error(
          { err: error, agentId: agent.id },
          "Failed to persist provider timeline hydration",
        );
      },
    );

    if (replayableProofChanged) {
      this.emitState(agent);
    } else {
      this.emitStateIfLastMessageAtChanged(agent, previousLastMessageAtMs);
    }

    if (typeof broadcast !== "function" || !broadcast()) {
      return;
    }
    for (const event of providerSubagentEvents) {
      this.dispatch(event);
    }
    for (const { event, row } of timelineEvents) {
      this.dispatchStream(agent.id, event, {
        seq: row.seq,
        epoch: this.timelineStore.getEpoch(agent.id),
        timestamp: row.timestamp,
      });
    }
  }

  private emitStateIfLastMessageAtChanged(
    agent: ActiveManagedAgent,
    previousLastMessageAtMs: number | null,
  ): void {
    if ((agent.lastMessageAt?.getTime() ?? null) !== previousLastMessageAtMs) {
      this.emitState(agent);
    }
  }

  private notifyForegroundTurnWaiters(agentId: string, event: AgentStreamEvent): void {
    const turnId = getAgentStreamEventTurnId(event);
    if (turnId == null) {
      return;
    }

    const agent = this.agents.get(agentId);
    if (!agent) {
      return;
    }

    this.runs.notifyAgentWaiters(agent, event);
    this.logger.trace(
      {
        agentId,
        provider: event.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId,
        event,
      },
      "agent.manager.notify_waiters.coalesced",
    );
  }

  private async handleStreamEvent(
    agent: ActiveManagedAgent,
    event: AgentStreamEvent,
    options?: HandleStreamEventOptions,
  ): Promise<boolean> {
    if (this.handleProviderRetryEvent(agent, event, options)) {
      return false;
    }
    event = limitAgentStreamEventContent(event);
    event = normalizeReplayableTimelineEvent(
      event,
      this.runs.getPendingRun(agent.id),
      options?.fromHistory,
    );
    const identified = attachManagedTurnIdentity(agent, event, options?.fromHistory === true);
    event = identified.event;
    const eventTurnId = identified.turnId;
    const isForegroundEvent = agent.activeForegroundTurnId === eventTurnId;
    this.traceHandleStreamEventStart(agent, event, eventTurnId, isForegroundEvent);
    if (
      eventTurnId &&
      isTurnTerminalEvent(event) &&
      this.runs.hasFinalizedTurn(agent, eventTurnId)
    ) {
      return false;
    }

    // Only update timestamp for live events, not history replay
    if (!options?.fromHistory) {
      this.touchUpdatedAt(agent);
      if (this.agentStreamCoalescer.handle(agent.id, event)) {
        this.traceCoalescerBuffered(agent, event, eventTurnId);
        return false;
      }
      this.agentStreamCoalescer.flushFor(agent.id);
    }

    this.clearProviderRetryOnTurnBoundary(agent, event, options);
    let terminalDisposition: ActiveTurnTerminalDisposition = "untracked";
    if (isTurnTerminalEvent(event)) {
      terminalDisposition = this.applyActiveTurnTerminal(
        agent,
        eventTurnId,
        options?.fromHistory === true,
      );
    }

    const flags: StreamEventFlags = { shouldDispatchEvent: true, shouldNotifyWaiters: true };

    const dispatchPromise = this.dispatchStreamEventByType({
      agent,
      event,
      options,
      isForegroundEvent,
      eventTurnId,
      terminalDisposition,
      flags,
    });
    if (dispatchPromise) {
      await dispatchPromise;
    }

    if (!options?.fromHistory) {
      if (isTurnTerminalEvent(event)) {
        this.runs.settleTerminalRun(agent.id, eventTurnId);
        if (isForegroundEvent) {
          this.finalizeForegroundTurn(agent, eventTurnId);
        }
      }

      if (flags.shouldDispatchEvent) {
        this.dispatchStream(agent.id, event, { timestamp: new Date().toISOString() });
      }
    }

    this.traceHandleStreamEventEnd(agent, event, eventTurnId, flags);

    return flags.shouldNotifyWaiters;
  }

  private handleProviderRetryEvent(
    agent: ActiveManagedAgent,
    event: AgentStreamEvent,
    options?: HandleStreamEventOptions,
  ): boolean {
    if (event.type !== "provider_retry") {
      return false;
    }
    if (!options?.fromHistory && event.message !== agent.providerRetryMessage) {
      agent.providerRetryMessage = event.message;
      this.touchUpdatedAt(agent);
      this.emitState(agent, { persist: false });
    }
    return true;
  }

  private clearProviderRetryOnTurnBoundary(
    agent: ActiveManagedAgent,
    event: AgentStreamEvent,
    options?: HandleStreamEventOptions,
  ): void {
    if (
      !options?.fromHistory &&
      agent.providerRetryMessage !== null &&
      (event.type === "turn_started" || isTurnTerminalEvent(event))
    ) {
      agent.providerRetryMessage = null;
      this.emitState(agent, { persist: false });
    }
  }

  private traceHandleStreamEventStart(
    agent: ActiveManagedAgent,
    event: AgentStreamEvent,
    turnId: string | undefined,
    isForegroundEvent: boolean,
  ): void {
    this.logger.trace(
      {
        agentId: agent.id,
        provider: event.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
        isForegroundEvent,
        event,
      },
      "agent.manager.handle_stream_event.start",
    );
  }

  private traceCoalescerBuffered(
    agent: ActiveManagedAgent,
    event: AgentStreamEvent,
    turnId: string | undefined,
  ): void {
    this.logger.trace(
      {
        agentId: agent.id,
        provider: event.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId,
        event,
      },
      "agent.manager.coalescer.buffer",
    );
  }

  private traceHandleStreamEventEnd(
    agent: ActiveManagedAgent,
    event: AgentStreamEvent,
    turnId: string | undefined,
    flags: StreamEventFlags,
  ): void {
    this.logger.trace(
      {
        agentId: agent.id,
        provider: event.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
        shouldDispatchEvent: flags.shouldDispatchEvent,
        shouldNotifyWaiters: flags.shouldNotifyWaiters,
        event,
      },
      "agent.manager.handle_stream_event.end",
    );
  }

  private dispatchStreamEventByType(params: {
    agent: ActiveManagedAgent;
    event: AgentStreamEvent;
    options: HandleStreamEventOptions | undefined;
    isForegroundEvent: boolean;
    eventTurnId: string | undefined;
    terminalDisposition: ActiveTurnTerminalDisposition;
    flags: StreamEventFlags;
  }): Promise<void> | undefined {
    const { agent, event, options, isForegroundEvent, eventTurnId, terminalDisposition, flags } =
      params;
    switch (event.type) {
      case "thread_started":
        this.onStreamThreadStarted(agent);
        return undefined;
      case "usage_updated":
        agent.lastUsage = event.usage;
        this.emitState(agent);
        return undefined;
      case "mode_changed":
        agent.currentModeId = event.currentModeId;
        agent.availableModes = event.availableModes;
        if (agent.runtimeInfo) {
          agent.runtimeInfo = { ...agent.runtimeInfo, modeId: event.currentModeId };
        }
        flags.shouldDispatchEvent = false;
        this.emitState(agent);
        return undefined;
      case "model_changed":
        agent.runtimeInfo = event.runtimeInfo;
        if (!agent.persistence && event.runtimeInfo.sessionId) {
          agent.persistence = attachPersistenceCwd(
            { provider: agent.provider, sessionId: event.runtimeInfo.sessionId },
            agent.cwd,
          );
        }
        agent.currentModeId = event.runtimeInfo.modeId ?? agent.currentModeId;
        flags.shouldDispatchEvent = false;
        this.emitState(agent);
        return undefined;
      case "thinking_option_changed":
        agent.config.thinkingOptionId = event.thinkingOptionId ?? undefined;
        if (agent.runtimeInfo) {
          agent.runtimeInfo = {
            ...agent.runtimeInfo,
            thinkingOptionId: event.thinkingOptionId,
          };
        }
        flags.shouldDispatchEvent = false;
        this.emitState(agent);
        return undefined;
      case "timeline":
        return this.onStreamTimelineEvent({ agent, event, options, flags });
      case "turn_completed":
        return this.onStreamTurnCompleted({
          agent,
          event,
          eventTurnId,
          isForegroundEvent,
          terminalDisposition,
          options,
        });
      case "turn_failed":
        return this.onStreamTurnFailed({
          agent,
          event,
          eventTurnId,
          isForegroundEvent,
          terminalDisposition,
          options,
        });
      case "turn_canceled":
        return this.onStreamTurnCanceled({
          agent,
          event,
          eventTurnId,
          isForegroundEvent,
          terminalDisposition,
          options,
        });
      case "turn_started":
        return this.onStreamTurnStarted({
          agent,
          eventTurnId,
          isForegroundEvent,
          flags,
          options,
        });
      case "permission_requested":
        this.onStreamPermissionRequested(agent, event);
        return undefined;
      case "permission_resolved":
        this.onStreamPermissionResolved({ agent, event, options, flags });
        return undefined;
      default:
        return undefined;
    }
  }

  private onStreamThreadStarted(agent: ActiveManagedAgent): void {
    const previousSessionId = agent.persistence?.sessionId ?? null;
    const handle = agent.session.describePersistence();
    if (handle) {
      agent.persistence = attachPersistenceCwd(handle, agent.cwd);
      if (agent.persistence?.sessionId !== previousSessionId) {
        this.emitState(agent);
      }
    }
    void this.refreshRuntimeInfo(agent);
  }

  private async onStreamTimelineEvent(params: {
    agent: ActiveManagedAgent;
    event: Extract<AgentStreamEvent, { type: "timeline" }>;
    options: { fromHistory?: boolean } | undefined;
    flags: StreamEventFlags;
  }): Promise<void> {
    const { agent, event, options, flags } = params;

    if (event.item.type === "user_message" && isSystemInjectedEnvelope(event.item.text)) {
      flags.shouldDispatchEvent = false;
      flags.shouldNotifyWaiters = false;
      return;
    }

    if (
      event.item.type === "user_message" &&
      event.item.clientMessageId &&
      this.reconcileSubmittedPromptEcho(agent, event.item)
    ) {
      agent.lastReplayableUserMessageId =
        event.item.replayKind === "text_only" && event.item.messageId ? event.item.messageId : null;
      agent.lastUserMessageAt = new Date();
      this.emitState(agent);
      flags.shouldDispatchEvent = false;
      flags.shouldNotifyWaiters = false;
      return;
    }

    if (options?.fromHistory) {
      this.recordTimeline(
        agent.id,
        event.item,
        event.timestamp ? { timestamp: event.timestamp } : undefined,
      );
      flags.shouldDispatchEvent = false;
      flags.shouldNotifyWaiters = false;
      return;
    }

    this.recordAndDispatchTimelineItem(agent.id, event.item, event.provider, event.turnId);
    if (event.item.type === "user_message") {
      agent.lastReplayableUserMessageId =
        event.item.replayKind === "text_only" && event.item.messageId ? event.item.messageId : null;
      agent.lastUserMessageAt = new Date();
      this.emitState(agent);
    }
    flags.shouldDispatchEvent = false;
    flags.shouldNotifyWaiters = true;
  }

  private async onStreamTurnCompleted(params: {
    agent: ActiveManagedAgent;
    event: Extract<AgentStreamEvent, { type: "turn_completed" }>;
    eventTurnId: string | undefined;
    isForegroundEvent: boolean;
    terminalDisposition: ActiveTurnTerminalDisposition;
    options: HandleStreamEventOptions | undefined;
  }): Promise<void> {
    const { agent, event, eventTurnId, isForegroundEvent, terminalDisposition, options } = params;
    this.logger.trace(
      {
        agentId: agent.id,
        provider: agent.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId: eventTurnId,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
      },
      "agent.manager.turn.completed",
    );
    if (terminalDisposition === "stale") return;
    if (event.usage) {
      agent.lastUsage = { ...agent.lastUsage, ...event.usage };
    }
    // If no usage on turn_completed, keep lastUsage as-is so context window
    // data accumulated during streaming isn't lost when the provider omits
    // it from the completion event.
    agent.lastError = undefined;
    if (
      !isForegroundEvent &&
      !agent.activeForegroundTurnId &&
      agent.lifecycle !== "idle" &&
      !agent.pendingReplacement
    ) {
      (agent as ActiveManagedAgent).lifecycle = "idle";
      this.emitState(agent);
    }
    void this.refreshRuntimeInfo(agent);
    if (options?.fromHistory) return;
    try {
      await this.commitDurableTimeline(agent.id);
    } catch (error) {
      await this.markDurableTimelineIncomplete(agent.id);
      this.logger.error({ err: error, agentId: agent.id }, "Failed to commit completed timeline");
    }
  }

  private async onStreamTurnFailed(params: {
    agent: ActiveManagedAgent;
    event: Extract<AgentStreamEvent, { type: "turn_failed" }>;
    eventTurnId: string | undefined;
    isForegroundEvent: boolean;
    terminalDisposition: ActiveTurnTerminalDisposition;
    options: { fromHistory?: boolean } | undefined;
  }): Promise<void> {
    const { agent, event, eventTurnId, isForegroundEvent, terminalDisposition, options } = params;
    this.logger.warn(
      {
        agentId: agent.id,
        provider: agent.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId: eventTurnId,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
        eventTurnId,
        error: event.error,
        code: event.code,
        diagnostic: event.diagnostic,
      },
      "handleStreamEvent: turn_failed",
    );
    if (terminalDisposition === "stale") return;
    if (!isForegroundEvent && !agent.activeForegroundTurnId) {
      agent.lifecycle = "error";
    }
    agent.lastError = event.error;
    await this.appendSystemErrorTimelineMessage(
      agent,
      event.provider,
      this.formatTurnFailedMessage(event),
      options,
    );
    this.resolvePendingPermissionsForAgent(agent, event.provider, options, "Turn failed");
    if (!isForegroundEvent && !agent.activeForegroundTurnId) {
      this.emitState(agent);
    }
    if (!options?.fromHistory) {
      await this.markDurableTimelineIncomplete(agent.id);
    }
  }

  private async onStreamTurnCanceled(params: {
    agent: ActiveManagedAgent;
    event: Extract<AgentStreamEvent, { type: "turn_canceled" }>;
    eventTurnId: string | undefined;
    isForegroundEvent: boolean;
    terminalDisposition: ActiveTurnTerminalDisposition;
    options:
      | {
          fromHistory?: boolean;
        }
      | undefined;
  }): Promise<void> {
    const { agent, event, eventTurnId, isForegroundEvent, terminalDisposition, options } = params;
    this.logger.trace(
      {
        agentId: agent.id,
        provider: agent.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId: eventTurnId,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
        eventTurnId,
      },
      "agent.manager.turn.canceled",
    );
    if (terminalDisposition === "stale") return;
    if (!isForegroundEvent && !agent.activeForegroundTurnId && !agent.pendingReplacement) {
      agent.lifecycle = "idle";
    }
    agent.lastError = undefined;
    this.resolvePendingPermissionsForAgent(agent, event.provider, options, "Interrupted");
    if (!isForegroundEvent && !agent.activeForegroundTurnId) {
      this.emitState(agent);
    }
    if (!options?.fromHistory) {
      await this.markDurableTimelineIncomplete(agent.id);
    }
  }

  private async onStreamTurnStarted(params: {
    agent: ActiveManagedAgent;
    eventTurnId: string | undefined;
    isForegroundEvent: boolean;
    flags: StreamEventFlags;
    options: HandleStreamEventOptions | undefined;
  }): Promise<void> {
    const { agent, eventTurnId, isForegroundEvent, flags, options } = params;
    this.logger.trace(
      {
        agentId: agent.id,
        provider: agent.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId: eventTurnId,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
      },
      "agent.manager.turn.started",
    );
    if (isForegroundEvent) {
      flags.shouldDispatchEvent = false;
      flags.shouldNotifyWaiters = false;
      return;
    }
    if (agent.activeForegroundTurnId) {
      flags.shouldDispatchEvent = false;
      flags.shouldNotifyWaiters = false;
      return;
    }
    if (!options?.fromHistory) {
      await this.beginDurableTimelineMutation(agent.id, "append");
    }
    this.runs.trackAutonomousRun(agent.id, eventTurnId ?? null);
    if (eventTurnId) {
      this.openActiveTurn(agent, eventTurnId, new Date());
    }
    agent.lifecycle = "running";
    this.emitState(agent);
  }

  private onStreamPermissionRequested(
    agent: ActiveManagedAgent,
    event: Extract<AgentStreamEvent, { type: "permission_requested" }>,
  ): void {
    const hadPendingPermissions = agent.pendingPermissions.size > 0;
    agent.pendingPermissions.set(event.request.id, event.request);
    if (!hadPendingPermissions && !agent.internal) {
      this.broadcastAgentAttention(agent, "permission");
    }
    this.emitState(agent);
  }

  private onStreamPermissionResolved(params: {
    agent: ActiveManagedAgent;
    event: Extract<AgentStreamEvent, { type: "permission_resolved" }>;
    options: { fromHistory?: boolean } | undefined;
    flags: StreamEventFlags;
  }): void {
    const { agent, event, options, flags } = params;
    agent.pendingPermissions.delete(event.requestId);
    if (!options?.fromHistory && agent.inFlightPermissionResponses.has(event.requestId)) {
      agent.bufferedPermissionResolutions.set(event.requestId, event);
      flags.shouldDispatchEvent = false;
      return;
    }
    this.emitState(agent);
  }

  private resolvePendingPermissionsForAgent(
    agent: ActiveManagedAgent,
    provider: AgentProvider,
    options: { fromHistory?: boolean } | undefined,
    message: string,
  ): void {
    for (const [requestId] of agent.pendingPermissions) {
      agent.pendingPermissions.delete(requestId);
      if (!options?.fromHistory) {
        this.dispatchStream(agent.id, {
          type: "permission_resolved",
          provider,
          requestId,
          resolution: { behavior: "deny", message },
        });
      }
    }
  }

  private recordAndDispatchTimelineItem(
    agentId: string,
    item: AgentTimelineItem,
    provider: AgentProvider,
    turnId?: string,
    options?: { providerMessageId?: string },
  ): AgentStreamEvent {
    const row = this.recordTimeline(agentId, item, options);
    const event: AgentStreamEvent = {
      type: "timeline",
      item,
      provider,
      ...(turnId !== undefined ? { turnId } : {}),
    };
    this.dispatchStream(agentId, event, {
      seq: row.seq,
      epoch: this.timelineStore.getEpoch(agentId),
      timestamp: row.timestamp,
    });

    if (
      item.type === "tool_call" &&
      item.status === "completed" &&
      item.detail?.type === "shell" &&
      commandMayHaveChangedExternalState(item.detail.command)
    ) {
      const agent = this.agents.get(agentId);
      if (agent) {
        this.onWorkspaceStateMayHaveChanged?.({ cwd: agent.cwd });
      }
    }

    return event;
  }

  private recordSubmittedPrompt(
    agent: ActiveManagedAgent,
    prompt: AgentPromptInput,
    clientMessageId: string,
    options?: {
      messageId?: string;
      providerMessageId?: string;
      replayKind?: "text_only";
    },
  ): void {
    if (this.timelineStore.getSubmittedUserMessage(agent.id, clientMessageId)) {
      return;
    }
    this.touchUpdatedAt(agent);
    agent.lastUserMessageAt = new Date();
    agent.lastReplayableUserMessageId =
      options?.replayKind === "text_only" && options.providerMessageId
        ? options.providerMessageId
        : null;
    const item: AgentTimelineItem = {
      type: "user_message",
      text: submittedPromptText(prompt),
      clientMessageId,
      ...(options?.messageId ? { messageId: options.messageId } : {}),
      ...(options?.replayKind ? { replayKind: options.replayKind } : {}),
    };
    this.recordAndDispatchTimelineItem(agent.id, item, agent.provider, undefined, options);
  }

  private reconcileSubmittedPromptEcho(
    agent: ActiveManagedAgent,
    item: Extract<AgentTimelineItem, { type: "user_message" }>,
  ): AgentTimelineRow | null {
    const { clientMessageId, messageId } = item;
    if (!clientMessageId) return null;
    const existing = this.timelineStore.getSubmittedUserMessage(agent.id, clientMessageId);
    if (!existing || existing.item.type !== "user_message") return null;
    if (messageId) {
      const enriched = this.timelineStore.enrichSubmittedUserMessage(
        agent.id,
        clientMessageId,
        messageId,
      );
      if (enriched) this.enqueueDurableTimelineUpdate(agent.id, enriched);
    }
    return existing;
  }

  private async appendSystemErrorTimelineMessage(
    agent: ActiveManagedAgent,
    provider: AgentProvider,
    message: string,
    options?: { fromHistory?: boolean },
  ): Promise<void> {
    if (options?.fromHistory) {
      return;
    }

    const normalized = message.trim();
    if (!normalized) {
      return;
    }

    const text = `${SYSTEM_ERROR_PREFIX} ${normalized}`;
    const lastItem = await this.getLastItemFromStores(agent.id);
    if (lastItem?.type === "assistant_message" && lastItem.text === text) {
      return;
    }

    const item: AgentTimelineItem = { type: "assistant_message", text };
    const row = this.recordTimeline(agent.id, item);
    this.dispatchStream(
      agent.id,
      {
        type: "timeline",
        item,
        provider,
      },
      {
        seq: row.seq,
        epoch: this.timelineStore.getEpoch(agent.id),
        timestamp: row.timestamp,
      },
    );
  }

  private formatTurnFailedMessage(
    event: Extract<AgentStreamEvent, { type: "turn_failed" }>,
  ): string {
    const base = event.error.trim();
    const parts = [base.length > 0 ? base : "Provider run failed"];
    const code = event.code?.trim();
    if (code) {
      parts.push(`code: ${code}`);
    }
    const diagnostic = event.diagnostic?.trim();
    if (diagnostic && diagnostic !== base) {
      parts.push(diagnostic);
    }
    return parts.join("\n\n");
  }

  private recordTimeline(
    agentId: string,
    item: AgentTimelineItem,
    options?: { timestamp?: string; providerMessageId?: string },
  ): AgentTimelineRow {
    item = limitAgentTimelineItemContent(item);
    const row = this.timelineStore.append(agentId, item, options);
    this.updateLastMessageAt(agentId, row);
    if (!this.durableTimelineReplacements.has(agentId)) {
      this.enqueueDurableTimelineAppend(agentId, row);
    }
    return row;
  }

  private updateLastMessageAt(agentId: string, row: AgentTimelineRow): void {
    if (row.item.type !== "user_message" && row.item.type !== "assistant_message") {
      return;
    }
    const agent = this.agents.get(agentId);
    const timestampMs = Date.parse(row.timestamp);
    if (!agent || Number.isNaN(timestampMs)) {
      return;
    }
    if (agent.lastMessageAt && agent.lastMessageAt.getTime() >= timestampMs) {
      return;
    }
    agent.lastMessageAt = new Date(timestampMs);
  }

  private emitState(agent: ManagedAgent, options?: { persist?: boolean }): void {
    if (this.unpublishedAgentIds.has(agent.id)) return;
    // Keep attention as an edge-triggered unread signal, not a level signal.
    this.checkAndSetAttention(agent);
    if (options?.persist !== false) {
      this.enqueueBackgroundPersist(agent);
    }

    this.syncFeaturesFromSession(agent);

    this.logger.trace(
      {
        agentId: agent.id,
        provider: agent.provider,
        sessionId: agent.persistence?.sessionId ?? undefined,
        turnId: agent.activeForegroundTurnId ?? undefined,
        lifecycle: agent.lifecycle,
        activeForegroundTurnId: agent.activeForegroundTurnId,
        pendingPermissions: agent.pendingPermissions.size,
        persist: options?.persist !== false,
      },
      "agent.manager.emit_state",
    );

    this.dispatch({
      type: "agent_state",
      agent: { ...agent },
    });
  }

  private syncFeaturesFromSession(agent: ManagedAgent): void {
    if ("session" in agent && agent.session?.features) {
      agent.features = agent.session.features;
    }
  }

  private checkAndSetAttention(agent: ManagedAgent): void {
    const previousStatus = this.previousStatuses.get(agent.id);
    const currentStatus = agent.lifecycle;

    // Track the new status
    this.previousStatuses.set(agent.id, currentStatus);

    // Skip attention tracking for internal agents
    if (agent.internal) {
      return;
    }

    // Skip if already requires attention
    if (agent.attention.requiresAttention) {
      return;
    }

    // Check if agent transitioned from running to idle (finished)
    if (previousStatus === "running" && currentStatus === "idle") {
      agent.attention = {
        requiresAttention: true,
        attentionReason: "finished",
        attentionTimestamp: new Date(),
      };
      this.broadcastAgentAttention(agent, "finished");
      return;
    }

    // Check if agent entered error state
    if (previousStatus !== "error" && currentStatus === "error") {
      agent.attention = {
        requiresAttention: true,
        attentionReason: "error",
        attentionTimestamp: new Date(),
      };
      this.broadcastAgentAttention(agent, "error");
      return;
    }
  }

  private enqueueBackgroundPersist(agent: ManagedAgent): void {
    const task = this.persistSnapshot(agent).catch((err) => {
      this.logger.error({ err, agentId: agent.id }, "Failed to persist agent snapshot");
    });
    this.trackBackgroundTask(task);
  }

  private enqueueDurableTimelineAppend(agentId: string, row: AgentTimelineRow): void {
    if (!this.durableTimelineStore) {
      return;
    }
    const task = this.durableTimelineStore
      .stageRows(agentId, {
        epoch: this.timelineStore.getEpoch(agentId),
        mode: "append",
        rows: [row],
      })
      .then(() => undefined)
      .catch(async (err) => {
        await this.markDurableTimelineIncomplete(agentId);
        this.logger.error(
          { err, agentId, seq: row.seq, itemType: row.item.type },
          "Failed to append timeline row to durable store",
        );
      });
    this.trackDurableTimelineTask(agentId, task);
  }

  private enqueueDurableTimelineUpdate(agentId: string, row: AgentTimelineRow): void {
    if (!this.durableTimelineStore) return;
    const task = this.durableTimelineStore
      .updateStagedRow(agentId, {
        epoch: this.timelineStore.getEpoch(agentId),
        row,
      })
      .catch(async (err) => {
        await this.markDurableTimelineIncomplete(agentId);
        this.logger.error(
          { err, agentId, seq: row.seq, itemType: row.item.type },
          "Failed to enrich durable timeline row",
        );
      });
    this.trackDurableTimelineTask(agentId, task);
  }

  private async beginDurableTimelineMutation(
    agentId: string,
    mode: "append" | "replace",
    epoch = this.timelineStore.getEpoch(agentId),
  ): Promise<void> {
    if (!this.durableTimelineStore) return;
    try {
      if (mode === "replace") {
        await this.durableTimelineStore.stageRows(agentId, { epoch, mode, rows: [] });
        return;
      }

      const coverage = await this.durableTimelineStore.getCoverage(agentId);
      const liveWindow = this.timelineStore.fetch(agentId, { direction: "tail", limit: 1 }).window;
      const shouldReplace =
        coverage.working?.status === "incomplete" ||
        coverage.active?.valid === false ||
        (coverage.working === null &&
          (coverage.active === null ||
            (coverage.active !== null &&
              (coverage.active.epoch !== epoch ||
                coverage.active.window.nextSeq !== liveWindow.nextSeq))));
      await this.durableTimelineStore.stageRows(agentId, {
        epoch,
        mode: shouldReplace ? "replace" : "append",
        rows: shouldReplace ? this.timelineStore.getRows(agentId) : [],
      });
    } catch (error) {
      await this.clearDurableTimelineRevision(agentId).catch((clearError) => {
        this.logger.warn(
          { err: clearError, agentId },
          "Failed to clear timeline revision after mutation setup failure",
        );
      });
      throw error;
    }
  }

  private async persistExplicitTimelineSeed(
    agentId: string,
    options?: { strict?: boolean; persistRevision?: boolean },
  ): Promise<CommittedAgentTimelineGeneration | null> {
    const epoch = this.timelineStore.getEpoch(agentId);
    try {
      await this.beginDurableTimelineMutation(agentId, "replace", epoch);
      return await this.finishDurableTimelineReplacement(agentId, epoch, true, {
        persistRevision: options?.persistRevision,
      });
    } catch (error) {
      await this.markDurableTimelineIncomplete(agentId);
      this.logger.error({ err: error, agentId }, "Failed to persist explicit timeline seed");
      if (options?.strict) throw error;
      return null;
    }
  }

  private async finishDurableTimelineReplacement(
    agentId: string,
    epoch: string,
    complete: boolean,
    options?: { persistRevision?: boolean },
  ): Promise<CommittedAgentTimelineGeneration | null> {
    if (!this.durableTimelineStore) return null;
    try {
      await this.durableTimelineStore.stageRows(agentId, {
        epoch,
        mode: "append",
        rows: this.timelineStore.getRows(agentId),
      });
      if (complete) {
        return await this.commitDurableTimeline(agentId, options);
      } else {
        await this.markDurableTimelineIncomplete(agentId);
      }
      return null;
    } catch (error) {
      await this.markDurableTimelineIncomplete(agentId);
      throw error;
    }
  }

  private async commitDurableTimeline(
    agentId: string,
    options?: { persistRevision?: boolean },
  ): Promise<CommittedAgentTimelineGeneration | null> {
    if (!this.durableTimelineStore) return null;
    await this.drainDurableTimelineTasks(agentId);
    await this.durableTimelineStore.flush(agentId);
    const committed = await this.durableTimelineStore.commit(agentId);
    if (options?.persistRevision !== false) {
      const stored = await this.registry?.get(agentId);
      if (stored) {
        await this.registry?.setTimelineRevision(agentId, committed.timelineRevision);
      }
    }
    await this.durableTimelineStore.cleanup(agentId).catch((error) => {
      this.logger.warn({ err: error, agentId }, "Failed to clean up old timeline generations");
    });
    return committed;
  }

  private async markDurableTimelineIncomplete(agentId: string): Promise<void> {
    if (!this.durableTimelineStore) return;
    await this.durableTimelineStore.markIncomplete(agentId).catch((error) => {
      this.logger.warn({ err: error, agentId }, "Failed to mark durable timeline incomplete");
    });
    await this.clearDurableTimelineRevision(agentId).catch((error) => {
      this.logger.warn({ err: error, agentId }, "Failed to clear incomplete timeline revision");
    });
  }

  private async clearDurableTimelineRevision(agentId: string): Promise<void> {
    if (!this.registry) return;
    const stored = await this.registry.get(agentId);
    if (!stored?.timelineRevision) return;
    await this.registry.setTimelineRevision(agentId, null);
  }

  private trackDurableTimelineTask(agentId: string, task: Promise<void>): void {
    const tasks = this.durableTimelineTasks.get(agentId) ?? new Set<Promise<void>>();
    tasks.add(task);
    this.durableTimelineTasks.set(agentId, tasks);
    this.trackBackgroundTask(task);
    void task.finally(() => {
      tasks.delete(task);
      if (tasks.size === 0 && this.durableTimelineTasks.get(agentId) === tasks) {
        this.durableTimelineTasks.delete(agentId);
      }
    });
  }

  private async drainDurableTimelineTasks(agentId: string): Promise<void> {
    while (true) {
      const tasks = this.durableTimelineTasks.get(agentId);
      if (!tasks || tasks.size === 0) return;
      await Promise.allSettled(tasks);
      if (this.durableTimelineTasks.get(agentId) === tasks && tasks.size === 0) return;
    }
  }

  private trackBackgroundTask(task: Promise<void>): void {
    this.backgroundTasks.add(task);
    void task.finally(() => {
      this.backgroundTasks.delete(task);
    });
  }

  private trackAgentRegistrationOperation<T>(result: Promise<T>): Promise<T> {
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.agentRegistrationTasks.add(settled);
    void settled.then(() => {
      this.agentRegistrationTasks.delete(settled);
      return undefined;
    });
    return result;
  }

  /**
   * Flush any background persistence work (best-effort).
   */
  async flush(): Promise<void> {
    await this.flushTasks({ includeAgentRegistrations: false });
  }

  /**
   * Flush persistence and agent registrations that crossed the synchronous
   * shutdown barrier. Those registrations own provider sessions until they
   * either install them or close them.
   */
  async flushForShutdown(): Promise<void> {
    await this.flushTasks({ includeAgentRegistrations: true });
  }

  private async flushTasks(options: { includeAgentRegistrations: boolean }): Promise<void> {
    this.agentStreamCoalescer.flushAll();
    // Drain tasks, including tasks spawned while awaiting.
    while (
      this.backgroundTasks.size > 0 ||
      (options.includeAgentRegistrations && this.agentRegistrationTasks.size > 0)
    ) {
      const pending = options.includeAgentRegistrations
        ? [...this.backgroundTasks, ...this.agentRegistrationTasks]
        : [...this.backgroundTasks];
      await Promise.allSettled(pending);
    }
    await this.durableTimelineStore?.flush();
  }

  private broadcastAgentAttention(
    agent: ManagedAgent,
    reason: "finished" | "error" | "permission",
  ): void {
    if (isDelegatedAgent(agent)) {
      return;
    }

    this.onAgentAttention?.({
      agentId: agent.id,
      provider: agent.provider,
      reason,
    });
  }

  private dispatchStream(
    agentId: string,
    event: AgentStreamEvent,
    metadata?: {
      seq?: number;
      epoch?: string;
      timestamp?: string;
    },
  ): void {
    if (event.type === "timeline") {
      event = {
        ...event,
        item: limitAgentTimelineItemContent(event.item),
      };
    }
    const agent = this.agents.get(agentId);
    this.logger.trace(
      {
        agentId,
        provider: event.provider,
        sessionId: agent?.persistence?.sessionId ?? undefined,
        turnId: getAgentStreamEventTurnId(event),
        metadata,
        event,
      },
      "agent.manager.dispatch_stream",
    );
    this.dispatch({ type: "agent_stream", agentId, event, ...metadata });
  }

  private dispatch(event: AgentManagerEvent): void {
    for (const subscriber of this.subscribers) {
      if (
        subscriber.agentId &&
        event.type === "agent_stream" &&
        subscriber.agentId !== event.agentId
      ) {
        continue;
      }
      if (
        subscriber.agentId &&
        event.type === "agent_state" &&
        subscriber.agentId !== event.agent.id
      ) {
        continue;
      }
      if (
        subscriber.agentId &&
        event.type === "provider_subagent" &&
        subscriber.agentId !==
          (event.event.type === "upsert"
            ? event.event.subagent.parentAgentId
            : event.event.parentAgentId)
      ) {
        continue;
      }
      // Skip internal agents for global subscribers (those without a specific agentId)
      if (!subscriber.agentId && this.eventBelongsToInternalAgent(event)) {
        continue;
      }
      subscriber.callback(event);
    }
  }

  private eventBelongsToInternalAgent(event: AgentManagerEvent): boolean {
    if (event.type === "agent_state") return event.agent.internal === true;
    if (event.type === "agent_stream") return this.agents.get(event.agentId)?.internal === true;
    if (event.type !== "provider_subagent") return false;
    const parentAgentId =
      event.event.type === "upsert"
        ? event.event.subagent.parentAgentId
        : event.event.parentAgentId;
    return this.agents.get(parentAgentId)?.internal === true;
  }

  private async normalizeConfig(
    config: AgentSessionConfig,
    options: NormalizeConfigOptions = {},
  ): Promise<ResolvedAgentSessionConfig> {
    const normalized: AgentSessionConfig = { ...config };

    // Always resolve cwd to absolute path for consistent history file lookup
    if (normalized.cwd) {
      normalized.cwd = resolve(normalized.cwd);
      try {
        const cwdStats = await stat(normalized.cwd);
        if (!cwdStats.isDirectory()) {
          throw new Error(`Working directory is not a directory: ${normalized.cwd}`);
        }
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          (error as NodeJS.ErrnoException).code === "ENOENT"
        ) {
          throw new Error(`Working directory does not exist: ${normalized.cwd}`, { cause: error });
        }
        if (error instanceof Error) {
          throw error;
        }
        throw new Error(`Failed to access working directory: ${normalized.cwd}`, { cause: error });
      }
    }

    if (typeof normalized.model === "string") {
      const trimmed = normalized.model.trim();
      normalized.model = trimmed.length > 0 && trimmed !== "default" ? trimmed : undefined;
    }

    const shouldResolveDefaultModel = options.resolveDefaultModel ?? true;
    if (shouldResolveDefaultModel && !normalized.model) {
      const defaultModelId = await this.resolveDefaultModelId(normalized);
      if (defaultModelId) {
        normalized.model = defaultModelId;
      }
    }

    return this.applyProviderConfiguration(normalized);
  }

  private applyProviderConfiguration(
    config: AgentSessionConfig,
  ): Promise<ResolvedAgentSessionConfig> {
    return resolveCompatibleAgentConfig(
      config,
      this.getAgentConfigCompatibilityProvider(config.provider),
    );
  }

  private async resolveDefaultModelId(config: AgentSessionConfig): Promise<string | undefined> {
    const client = this.clients.get(config.provider);
    if (!client) {
      return undefined;
    }
    try {
      const catalog = await client.fetchCatalog({
        scope: "workspace",
        cwd: config.cwd,
        force: false,
      });
      return (catalog.models.find((model) => model.isDefault) ?? catalog.models[0])?.id;
    } catch {
      // Provider may not support model listing — leave model undefined.
      return undefined;
    }
  }

  private async prepareSessionConfig(
    config: AgentSessionConfig,
    agentId: string,
    env?: Record<string, string>,
  ): Promise<PreparedSessionConfig> {
    const storedConfig = await this.normalizeConfig(stripInternalPaseoMcpServer(config), { env });
    const launchConfig = this.applyDaemonAppendSystemPrompt(
      withRuntimePaseoMcpServer({
        config: {
          ...storedConfig,
          providerOptions: storedConfig.resolvedProviderOptions,
        },
        agentId,
        mcpBaseUrl: this.mcpBaseUrl,
        mcpAuthToken: this.mcpAuthToken,
      }),
    );
    return { storedConfig, launchConfig };
  }

  private applyDaemonAppendSystemPrompt(config: AgentSessionConfig): AgentSessionConfig {
    const daemonAppendSystemPrompt = this.appendSystemPrompt.trim();
    const next = { ...config };
    delete next.daemonAppendSystemPrompt;

    return daemonAppendSystemPrompt
      ? {
          ...next,
          daemonAppendSystemPrompt,
        }
      : next;
  }

  private async buildLaunchContext(
    agentId: string,
    client: AgentClient,
    cwd: string,
    env?: Record<string, string>,
  ): Promise<AgentLaunchContext> {
    const context: AgentLaunchContext = {
      agentId,
      env: {
        ...env,
        PASEO_AGENT_ID: agentId,
        PASEO_AGENT_CWD: cwd,
      },
    };
    if (
      this.paseoToolsEnabled &&
      client.capabilities.supportsNativePaseoTools &&
      this.paseoToolCatalogFactory
    ) {
      context.paseoTools = await this.paseoToolCatalogFactory({ callerAgentId: agentId });
    }
    return context;
  }

  private resolveProviderLaunchConfig(
    launchConfig: AgentSessionConfig,
    launchContext: AgentLaunchContext,
  ): AgentSessionConfig {
    return launchContext.paseoTools ? stripInternalPaseoMcpServer(launchConfig) : launchConfig;
  }

  private async requireAvailableClient(options: { provider: AgentProvider }): Promise<AgentClient> {
    const client = this.clients.get(options.provider);
    if (!client) {
      const configuredProviders = this.getConfiguredProviderIds();
      throw new Error(
        `Unknown provider '${options.provider}'. Configured providers: ${formatProviderList(
          configuredProviders,
        )}.`,
      );
    }

    let unavailableReason: string | null = null;
    try {
      const available = await client.isAvailable();
      if (available) {
        return client;
      }
    } catch (error) {
      unavailableReason = error instanceof Error ? error.message : String(error);
    }

    const availableProviders = (await this.listProviderAvailability())
      .filter((entry) => entry.available)
      .map((entry) => entry.provider);
    const providerList = formatProviderList(availableProviders);
    const reason = unavailableReason ? ` Reason: ${unavailableReason}.` : "";
    throw new Error(
      `Provider '${options.provider}' is not available.${reason} Available providers: ${providerList}. Use one of those providers, or install/configure '${options.provider}'.`,
    );
  }

  private requireEnabledProvider(provider: AgentProvider): void {
    if (this.providerEnabled.get(provider) === false) {
      throw new Error(`Provider '${provider}' is disabled`);
    }
  }

  private getConfiguredProviderIds(): AgentProvider[] {
    return Array.from(new Set([...this.providerEnabled.keys(), ...this.clients.keys()]));
  }

  private requireClient(provider: AgentProvider): AgentClient {
    const client = this.clients.get(provider);
    if (!client) {
      throw new Error(`No client registered for provider '${provider}'`);
    }
    return client;
  }

  async archiveNativeSessionBestEffort(
    provider: AgentProvider,
    persistence: AgentPersistenceHandle | null | undefined,
  ): Promise<void> {
    if (!persistence) return;
    const client = this.clients.get(provider);
    if (!client?.archiveNativeSession) return;
    try {
      await client.archiveNativeSession(persistence);
    } catch (error) {
      this.logger.warn(
        { error, provider, sessionId: persistence.sessionId },
        "Failed to archive native session (best-effort)",
      );
    }
  }

  private async unarchiveNativeSession(
    provider: AgentProvider,
    persistence: AgentPersistenceHandle | null | undefined,
  ): Promise<void> {
    if (!persistence) return;
    const client = this.clients.get(provider);
    if (!client?.unarchiveNativeSession) return;
    await client.unarchiveNativeSession(persistence);
  }

  private requireAgent(id: string): LiveManagedAgent {
    const normalizedId = validateAgentId(id, "requireAgent");
    const agent = this.agents.get(normalizedId);
    if (!agent) {
      throw new Error(`Unknown agent '${normalizedId}'`);
    }
    return agent;
  }

  private requireSessionAgent(id: string): ActiveManagedAgent {
    const agent = this.requireAgent(id);
    if (agent.session === null) {
      throw new Error(`Agent '${agent.id}' has no managed session`);
    }
    return agent;
  }

  private requirePublicAgent(id: string): LiveManagedAgent {
    const agent = this.requireAgent(id);
    if (agent.internal) {
      throw new Error(`Unknown agent '${agent.id}'`);
    }
    return agent;
  }
}

export function commandMayHaveChangedExternalState(command: string): boolean {
  const normalized = command.toLowerCase();
  // Commands that operate on remote state and do NOT trigger local file
  // watchers. Local git mutations (commit, checkout, merge, rebase, reset,
  // pull) are already caught by watchers on .git/HEAD and refs/heads/.
  return (
    // GitHub PR operations (merge, close, create, edit, comment, review)
    /\bgh\s+pr\s+(merge|close|create|edit|comment|review)\b/.test(normalized) ||
    // Pushes to remote — local refs unchanged, but remote state (PR checks,
    // mergeable status) may shift immediately after.
    /\bgit\s+push\b/.test(normalized) ||
    // Fetches update refs/remotes/ which our watchers do not watch, so
    // ahead/behind counts can drift stale until the next refresh.
    /\bgit\s+fetch\b/.test(normalized)
  );
}
