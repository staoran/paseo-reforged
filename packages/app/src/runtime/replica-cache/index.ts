import { Buffer } from "buffer";
import equal from "fast-deep-equal/es6";
import { z } from "zod";
import { AgentStatusSchema } from "@getpaseo/protocol/messages";
import { AgentProviderSchema } from "@getpaseo/protocol/provider-manifest";
import {
  normalizeProjectDescriptor,
  normalizeWorkspaceDescriptor,
  selectAgentTimelineState,
  useSessionStore,
  type Agent,
  type SessionReplica,
  type SessionState,
  type ProjectDescriptor,
  type WorkspaceDescriptor,
} from "@/stores/session-store";
import { isUnreconciledLocalUserMessage, type StreamItem } from "@/types/stream";
import { normalizeAgentSnapshot } from "@/utils/agent-snapshots";

const STORAGE_KEY = "@paseo:replica-cache";
const CACHE_VERSION = 6;
const PERSIST_DELAY_MS = 750;
const MAX_TIMELINE_ITEMS = 50;
const MAX_CACHE_BYTES = 1024 * 1024;
const REPLICA_DIRTY_DOMAINS = ["agent", "workspace", "timeline"] as const;
type ReplicaDirtyDomain = (typeof REPLICA_DIRTY_DOMAINS)[number];
export type ReplicaCacheFinalSource = "status" | "stream";

const IsoDateSchema = z.iso.datetime();
const TimelinePositionSchema = z.strictObject({
  epoch: z.string(),
  seq: z.number().int().nonnegative(),
});

const TimelineItemBaseShape = {
  id: z.string(),
  timelineCursor: TimelinePositionSchema.optional(),
  timestamp: IsoDateSchema,
};

const TodoEntrySchema = z.strictObject({
  text: z.string(),
  completed: z.boolean(),
  id: z.string().optional(),
  status: z.enum(["pending", "in_progress", "completed"]).optional(),
  activeForm: z.string().optional(),
});

const TaskActivitySchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("created"), count: z.number().int().nonnegative() }),
  z.strictObject({
    type: z.enum(["added", "started", "completed", "reopened"]),
    task: z.string(),
  }),
]);

const StoredTimelineItemSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...TimelineItemBaseShape,
    kind: z.literal("user_message"),
    clientMessageId: z.string().optional(),
    messageId: z.string().optional(),
    text: z.string(),
  }),
  z.strictObject({
    ...TimelineItemBaseShape,
    kind: z.literal("assistant_message"),
    messageId: z.string().optional(),
    text: z.string(),
    blockGroupId: z.string().optional(),
    blockIndex: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    ...TimelineItemBaseShape,
    kind: z.literal("thought"),
    text: z.string(),
    status: z.enum(["loading", "ready"]),
  }),
  z.strictObject({
    ...TimelineItemBaseShape,
    kind: z.literal("todo_list"),
    provider: AgentProviderSchema,
    items: z.array(TodoEntrySchema),
    activity: TaskActivitySchema,
  }),
  z.strictObject({
    ...TimelineItemBaseShape,
    kind: z.literal("activity_log"),
    activityType: z.enum(["system", "info", "success", "error"]),
    message: z.string(),
  }),
  z.strictObject({
    ...TimelineItemBaseShape,
    kind: z.literal("compaction"),
    status: z.enum(["loading", "completed"]),
    trigger: z.enum(["auto", "manual"]).optional(),
    preTokens: z.number().nonnegative().optional(),
  }),
]);

const AgentCapabilitiesSchema = z.strictObject({
  supportsStreaming: z.boolean(),
  supportsSessionPersistence: z.boolean(),
  supportsSessionListing: z.boolean().optional(),
  supportsDynamicModes: z.boolean(),
  supportsMcpServers: z.boolean(),
  supportsReasoningStream: z.boolean(),
  supportsToolInvocations: z.boolean(),
  supportsRewindConversation: z.boolean().optional(),
  supportsRewindFiles: z.boolean().optional(),
  supportsRewindBoth: z.boolean().optional(),
});

const StoredAgentSnapshotSchema = z.strictObject({
  id: z.string(),
  provider: AgentProviderSchema,
  cwd: z.string(),
  workspaceId: z.string().optional(),
  model: z.string().nullable(),
  thinkingOptionId: z.string().nullable().optional(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  lastUserMessageAt: IsoDateSchema.nullable(),
  lastMessageAt: IsoDateSchema.nullable().optional(),
  status: AgentStatusSchema,
  activeTurn: z
    .strictObject({
      turnId: z.string(),
      startedAt: IsoDateSchema.nullable(),
    })
    .nullable()
    .optional(),
  capabilities: AgentCapabilitiesSchema,
  currentModeId: z.string().nullable(),
  availableModes: z.array(z.never()).max(0),
  pendingPermissions: z.array(z.never()).max(0),
  persistence: z.null(),
  lastError: z.string().optional(),
  title: z.string().nullable(),
  labels: z.record(z.string(), z.string()),
  requiresAttention: z.boolean().optional(),
  attentionReason: z.enum(["finished", "error", "permission"]).nullable().optional(),
  attentionTimestamp: IsoDateSchema.nullable().optional(),
  archivedAt: IsoDateSchema.nullable().optional(),
});

const StoredAgentSchema = z.strictObject({
  snapshot: StoredAgentSnapshotSchema,
  projectPlacement: z.null(),
  lastActivityAt: IsoDateSchema,
});

const WorkspaceScriptSchema = z.strictObject({
  scriptName: z.string(),
  type: z.enum(["script", "service"]),
  hostname: z.string(),
  port: z.number().int().positive().nullable(),
  localProxyUrl: z.string().nullable().optional(),
  publicProxyUrl: z.string().nullable().optional(),
  proxyUrl: z.string().nullable(),
  lifecycle: z.enum(["running", "stopped"]),
  health: z.enum(["healthy", "unhealthy"]).nullable(),
  exitCode: z.number().nullable(),
  terminalId: z.string().nullable(),
});

const WorkspaceGitRuntimeSchema = z
  .strictObject({
    currentBranch: z.string().nullable().optional(),
    remoteUrl: z.string().nullable().optional(),
    isPaseoOwnedWorktree: z.boolean().optional(),
    isDirty: z.boolean().nullable().optional(),
    aheadBehind: z.strictObject({ ahead: z.number(), behind: z.number() }).nullable().optional(),
    aheadOfOrigin: z.number().nullable().optional(),
    behindOfOrigin: z.number().nullable().optional(),
  })
  .nullable()
  .optional();

const StoredWorkspaceSchema = z.strictObject({
  id: z.string(),
  projectId: z.string(),
  projectDisplayName: z.string(),
  projectCustomName: z.string().nullable(),
  projectCustomIconRevision: z.string().nullable(),
  projectRootPath: z.string(),
  workspaceDirectory: z.string(),
  worktreeSlug: z.string().optional(),
  projectKind: z.enum(["git", "non_git", "directory"]),
  workspaceKind: z.enum(["directory", "local_checkout", "checkout", "worktree"]),
  name: z.string(),
  title: z.string().nullable(),
  pinnedAt: z.string().nullable(),
  status: z.enum(["needs_input", "failed", "running", "attention", "done"]),
  statusEnteredAt: IsoDateSchema.nullable(),
  activityAt: z.null(),
  archivingAt: z.string().nullable(),
  diffStat: z.strictObject({ additions: z.number(), deletions: z.number() }).nullable(),
  scripts: z.array(WorkspaceScriptSchema),
  gitRuntime: WorkspaceGitRuntimeSchema,
  forge: z.string().optional(),
});

const StoredProjectSchema = z.strictObject({
  projectId: z.string(),
  projectKey: z.string().optional(),
  projectDisplayName: z.string(),
  projectCustomName: z.string().nullable(),
  projectRootPath: z.string(),
  projectKind: z.enum(["git", "non_git", "directory"]),
});

const StoredTimelineSchema = z.strictObject({
  agentId: z.string(),
  items: z.array(StoredTimelineItemSchema),
});

const StoredHostSchema = z.strictObject({
  serverId: z.string(),
  agents: z.array(StoredAgentSchema),
  workspaces: z.array(StoredWorkspaceSchema),
  projects: z.array(StoredProjectSchema),
  emptyProjects: z.array(StoredProjectSchema),
  timeline: StoredTimelineSchema.nullable(),
});

const StoredCacheSchema = z.strictObject({
  version: z.literal(CACHE_VERSION),
  hosts: z.array(StoredHostSchema),
});

type StoredAgent = z.infer<typeof StoredAgentSchema>;
type StoredHost = z.infer<typeof StoredHostSchema>;
type StoredTimelineItem = z.infer<typeof StoredTimelineItemSchema>;
type StoredWorkspace = z.infer<typeof StoredWorkspaceSchema>;
type StoredProject = z.infer<typeof StoredProjectSchema>;

interface HostReplicaProjection {
  session: SessionState | undefined;
  targetAgentId: string | null;
  agentRef: Agent | undefined;
  agent: StoredAgent | null;
  workspacesRef: SessionState["workspaces"] | undefined;
  workspaceRef: WorkspaceDescriptor | undefined;
  workspace: StoredWorkspace | null;
  projectsRef: SessionState["projects"] | undefined;
  projectRef: ProjectDescriptor | undefined;
  project: StoredProject | null;
  timelineRef: StreamItem[] | undefined;
  timeline: StoredHost["timeline"];
}

interface HostDirtyState {
  revision: number;
  domains: Map<ReplicaDirtyDomain, number>;
}

interface CapturedDirtyState {
  registryRevision: number | null;
  hostDomains: Map<string, Map<ReplicaDirtyDomain, number>>;
}

interface PendingFinalState {
  source: ReplicaCacheFinalSource;
  timer: ReturnType<typeof setTimeout>;
}

export interface ReplicaCacheStorage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

interface ReplicaCacheOptions {
  maxBytes?: number;
}

function deserializeTimeline(stored: StoredHost["timeline"]): SessionReplica["timeline"] {
  if (!stored) {
    return null;
  }
  return {
    agentId: stored.agentId,
    items: stored.items.map(deserializeTimelineItem),
  };
}

function timelineBase(item: StreamItem) {
  return {
    id: item.id,
    ...(item.timelineCursor ? { timelineCursor: item.timelineCursor } : {}),
    timestamp: item.timestamp.toISOString(),
  };
}

function serializeTimelineItem(item: StreamItem): StoredTimelineItem | null {
  const base = timelineBase(item);
  switch (item.kind) {
    case "user_message":
      return {
        ...base,
        kind: item.kind,
        ...(item.clientMessageId ? { clientMessageId: item.clientMessageId } : {}),
        ...(item.messageId ? { messageId: item.messageId } : {}),
        text: item.text,
      };
    case "assistant_message":
      return {
        ...base,
        kind: item.kind,
        ...(item.messageId ? { messageId: item.messageId } : {}),
        text: item.text,
        ...(item.blockGroupId ? { blockGroupId: item.blockGroupId } : {}),
        ...(item.blockIndex !== undefined ? { blockIndex: item.blockIndex } : {}),
      };
    case "thought":
      return { ...base, kind: item.kind, text: item.text, status: item.status };
    case "todo_list":
      return {
        ...base,
        kind: item.kind,
        provider: item.provider,
        items: item.items,
        activity: item.activity,
      };
    case "activity_log":
      return {
        ...base,
        kind: item.kind,
        activityType: item.activityType,
        message: item.message,
      };
    case "compaction":
      return {
        ...base,
        kind: item.kind,
        status: item.status,
        ...(item.trigger ? { trigger: item.trigger } : {}),
        ...(item.preTokens !== undefined ? { preTokens: item.preTokens } : {}),
      };
    case "tool_call":
      return null;
  }
}

function deserializeTimelineItem(item: StoredTimelineItem): StreamItem {
  const base = {
    id: item.id,
    ...(item.timelineCursor ? { timelineCursor: item.timelineCursor } : {}),
    timestamp: new Date(item.timestamp),
  };
  switch (item.kind) {
    case "user_message":
      return {
        ...base,
        kind: item.kind,
        ...(item.clientMessageId ? { clientMessageId: item.clientMessageId } : {}),
        ...(item.messageId ? { messageId: item.messageId } : {}),
        text: item.text,
      };
    case "assistant_message":
      return {
        ...base,
        kind: item.kind,
        ...(item.messageId ? { messageId: item.messageId } : {}),
        text: item.text,
        ...(item.blockGroupId ? { blockGroupId: item.blockGroupId } : {}),
        ...(item.blockIndex !== undefined ? { blockIndex: item.blockIndex } : {}),
      };
    case "thought":
      return { ...base, kind: item.kind, text: item.text, status: item.status };
    case "todo_list":
      return {
        ...base,
        kind: item.kind,
        provider: item.provider,
        items: item.items,
        activity: item.activity,
      };
    case "activity_log":
      return {
        ...base,
        kind: item.kind,
        activityType: item.activityType,
        message: item.message,
      };
    case "compaction":
      return {
        ...base,
        kind: item.kind,
        status: item.status,
        ...(item.trigger ? { trigger: item.trigger } : {}),
        ...(item.preTokens !== undefined ? { preTokens: item.preTokens } : {}),
      };
  }
}

// eslint-disable-next-line complexity -- Persisted fields are selected explicitly for strict DTO validation
function serializeAgent(agent: Agent): StoredAgent {
  const snapshot = {
    id: agent.id,
    provider: agent.provider,
    cwd: agent.cwd,
    ...(agent.workspaceId ? { workspaceId: agent.workspaceId } : {}),
    model: agent.model,
    thinkingOptionId: agent.thinkingOptionId ?? null,
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
    lastUserMessageAt: agent.lastUserMessageAt?.toISOString() ?? null,
    lastMessageAt: agent.lastMessageAt?.toISOString() ?? null,
    status: agent.status,
    ...(agent.activeTurn?.turnId
      ? {
          activeTurn: {
            turnId: agent.activeTurn.turnId,
            startedAt: agent.activeTurn.startedAt?.toISOString() ?? null,
          },
        }
      : {}),
    capabilities: {
      supportsStreaming: agent.capabilities.supportsStreaming,
      supportsSessionPersistence: agent.capabilities.supportsSessionPersistence,
      ...(agent.capabilities.supportsSessionListing !== undefined
        ? { supportsSessionListing: agent.capabilities.supportsSessionListing }
        : {}),
      supportsDynamicModes: agent.capabilities.supportsDynamicModes,
      supportsMcpServers: agent.capabilities.supportsMcpServers,
      supportsReasoningStream: agent.capabilities.supportsReasoningStream,
      supportsToolInvocations: agent.capabilities.supportsToolInvocations,
      ...(agent.capabilities.supportsRewindConversation !== undefined
        ? { supportsRewindConversation: agent.capabilities.supportsRewindConversation }
        : {}),
      ...(agent.capabilities.supportsRewindFiles !== undefined
        ? { supportsRewindFiles: agent.capabilities.supportsRewindFiles }
        : {}),
      ...(agent.capabilities.supportsRewindBoth !== undefined
        ? { supportsRewindBoth: agent.capabilities.supportsRewindBoth }
        : {}),
    },
    currentModeId: agent.currentModeId,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    ...(agent.lastError ? { lastError: agent.lastError } : {}),
    title: agent.title,
    labels: agent.labels,
    requiresAttention: agent.requiresAttention ?? false,
    attentionReason: agent.attentionReason ?? null,
    attentionTimestamp: agent.attentionTimestamp?.toISOString() ?? null,
    archivedAt: agent.archivedAt?.toISOString() ?? null,
  };
  return {
    snapshot,
    projectPlacement: null,
    lastActivityAt: agent.lastActivityAt.toISOString(),
  };
}

function deserializeAgent(serverId: string, stored: StoredAgent): Agent {
  return {
    ...normalizeAgentSnapshot(stored.snapshot, serverId),
    lastActivityAt: new Date(stored.lastActivityAt),
    projectPlacement: stored.projectPlacement,
  };
}

function serializeWorkspace(workspace: WorkspaceDescriptor): StoredWorkspace {
  return {
    id: workspace.id,
    projectId: workspace.projectId,
    projectDisplayName: workspace.projectDisplayName,
    projectCustomName: workspace.projectCustomName ?? null,
    projectCustomIconRevision: workspace.projectCustomIconRevision ?? null,
    projectRootPath: workspace.projectRootPath,
    workspaceDirectory: workspace.workspaceDirectory,
    worktreeSlug: workspace.worktreeSlug,
    projectKind: workspace.projectKind,
    workspaceKind: workspace.workspaceKind,
    name: workspace.name,
    title: workspace.title ?? null,
    pinnedAt: workspace.pinnedAt ?? null,
    status: workspace.status,
    statusEnteredAt: workspace.statusEnteredAt?.toISOString() ?? null,
    activityAt: null,
    archivingAt: workspace.archivingAt,
    diffStat: workspace.diffStat,
    scripts: workspace.scripts.map((script) => ({
      scriptName: script.scriptName,
      type: script.type,
      hostname: script.hostname,
      port: script.port,
      ...(script.localProxyUrl !== undefined ? { localProxyUrl: script.localProxyUrl } : {}),
      ...(script.publicProxyUrl !== undefined ? { publicProxyUrl: script.publicProxyUrl } : {}),
      proxyUrl: script.proxyUrl,
      lifecycle: script.lifecycle,
      health: script.health,
      exitCode: script.exitCode,
      terminalId: script.terminalId,
    })),
    gitRuntime: workspace.gitRuntime,
    forge: workspace.forge,
  };
}

function serializeProject(project: ProjectDescriptor): StoredProject {
  return {
    projectId: project.projectId,
    ...(project.projectKey ? { projectKey: project.projectKey } : {}),
    projectDisplayName: project.projectDisplayName,
    projectCustomName: project.projectCustomName,
    projectRootPath: project.projectRootPath,
    projectKind: project.projectKind,
  };
}

function preserveEqualProjection<Value>(previous: Value | null, next: Value | null): Value | null {
  return equal(previous, next) ? previous : next;
}

function deserializeHost(stored: StoredHost): SessionReplica {
  const agents = stored.agents.map((entry) => deserializeAgent(stored.serverId, entry));
  const workspaces = stored.workspaces.map(normalizeWorkspaceDescriptor);
  const listedProjects = stored.projects.map(normalizeProjectDescriptor);
  const legacyProjects = [
    ...stored.emptyProjects.map(normalizeProjectDescriptor),
    ...workspaces.map(legacyProjectDescriptorFromWorkspace),
  ];
  const projects = new Map(
    [...legacyProjects, ...listedProjects].map((project) => [project.projectId, project]),
  );
  return {
    agents: new Map(agents.map((agent) => [agent.id, agent])),
    workspaces: new Map(workspaces.map((workspace) => [workspace.id, workspace])),
    projects,
    timeline: deserializeTimeline(stored.timeline),
  };
}

function legacyProjectDescriptorFromWorkspace(workspace: WorkspaceDescriptor): ProjectDescriptor {
  return {
    projectId: workspace.projectId,
    projectKey: null,
    projectDisplayName: workspace.projectDisplayName,
    projectCustomName: workspace.projectCustomName ?? null,
    projectRootPath: workspace.projectRootPath,
    projectKind: workspace.projectKind,
  };
}

export class ReplicaCache {
  private readonly activeServerIds = new Set<string>();
  private readonly storedHosts = new Map<string, StoredHost>();
  private readonly lastFocusedAgentIds = new Map<string, string>();
  private readonly projections = new Map<string, HostReplicaProjection>();
  private readonly dirtyByHost = new Map<string, HostDirtyState>();
  private readonly hostPersistTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingFinals = new Map<string, PendingFinalState>();
  private readonly maxBytes: number;
  private registryRevision = 0;
  private dirtyRegistryRevision: number | null = null;
  private unsubscribe: (() => void) | null = null;
  private registryPersistTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingFlushAllHosts = false;
  private pendingFlushRegistry = false;
  private pendingForceFlush = false;
  private readonly pendingFlushHostIds = new Set<string>();
  private flushLoopPromise: Promise<void> | null = null;

  constructor(
    private readonly storage: ReplicaCacheStorage,
    options: ReplicaCacheOptions = {},
  ) {
    const emptyPayloadBytes = Buffer.byteLength(
      JSON.stringify({ version: CACHE_VERSION, hosts: [] }),
      "utf8",
    );
    this.maxBytes = Math.max(options.maxBytes ?? MAX_CACHE_BYTES, emptyPayloadBytes);
  }

  setHosts(serverIds: Iterable<string>): void {
    const next = new Set(serverIds);
    const membershipChanged =
      next.size !== this.activeServerIds.size ||
      Array.from(next).some((serverId) => !this.activeServerIds.has(serverId));
    const removedServerIds = Array.from(this.activeServerIds).filter(
      (serverId) => !next.has(serverId),
    );
    this.activeServerIds.clear();
    for (const serverId of next) this.activeServerIds.add(serverId);
    for (const serverId of removedServerIds) this.removeHostState(serverId);
    for (const serverId of Array.from(this.storedHosts.keys())) {
      if (!next.has(serverId)) this.storedHosts.delete(serverId);
    }
    if (membershipChanged) this.markRegistryDirty();

    if (this.unsubscribe) {
      const state = useSessionStore.getState();
      for (const serverId of next) {
        if (this.projections.has(serverId)) continue;
        const projection = this.buildHostProjection(serverId, state.sessions[serverId]);
        this.projections.set(serverId, projection);
        if (projection.session && !this.storedHosts.has(serverId)) {
          this.markHostDirty(serverId, REPLICA_DIRTY_DOMAINS);
        }
      }
    }
  }

  async restore(): Promise<void> {
    let raw: string | null;
    try {
      raw = await this.storage.getItem(STORAGE_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await this.clearInvalidCache();
      return;
    }
    const cache = StoredCacheSchema.safeParse(parsed);
    if (!cache.success) {
      await this.clearInvalidCache();
      return;
    }
    let needsRewrite = false;
    for (const host of cache.data.hosts) {
      if (!this.activeServerIds.has(host.serverId)) {
        needsRewrite = true;
        continue;
      }
      this.storedHosts.set(host.serverId, host);
      if (host.timeline) this.lastFocusedAgentIds.set(host.serverId, host.timeline.agentId);
    }
    const bounded = this.buildBoundedPayload();
    if (!bounded) {
      await this.clearInvalidCache();
      this.storedHosts.clear();
      return;
    }
    if (bounded.evicted) needsRewrite = true;
    for (const host of this.storedHosts.values()) {
      useSessionStore.getState().restoreSessionReplica(host.serverId, deserializeHost(host));
    }
    if (needsRewrite) this.markRegistryDirty();
  }

  start(): void {
    if (this.unsubscribe) return;
    const state = useSessionStore.getState();
    for (const serverId of this.activeServerIds) {
      const projection = this.buildHostProjection(serverId, state.sessions[serverId]);
      this.projections.set(serverId, projection);
      if (projection.session && !this.storedHosts.has(serverId)) {
        this.markHostDirty(serverId, REPLICA_DIRTY_DOMAINS);
      }
    }
    this.unsubscribe = useSessionStore.subscribe((nextState) => this.handleStoreChange(nextState));
    for (const [serverId, dirty] of this.dirtyByHost) {
      if (dirty.domains.size > 0) this.scheduleHostPersist(serverId);
    }
    if (this.dirtyRegistryRevision !== null) this.scheduleRegistryPersist();
  }

  /** Stops store observation and scheduled work without discarding dirty state */
  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const timer of this.hostPersistTimers.values()) clearTimeout(timer);
    this.hostPersistTimers.clear();
    if (this.registryPersistTimer) clearTimeout(this.registryPersistTimer);
    this.registryPersistTimer = null;
    for (const pending of this.pendingFinals.values()) clearTimeout(pending.timer);
    this.pendingFinals.clear();
  }

  reconcileServerId(oldServerId: string, newServerId: string): void {
    const stored = this.storedHosts.get(oldServerId);
    if (stored) {
      this.storedHosts.delete(oldServerId);
      this.storedHosts.set(newServerId, { ...stored, serverId: newServerId });
    }
    const focusedAgentId = this.lastFocusedAgentIds.get(oldServerId);
    if (focusedAgentId) {
      this.lastFocusedAgentIds.delete(oldServerId);
      this.lastFocusedAgentIds.set(newServerId, focusedAgentId);
    }
    const projection = this.projections.get(oldServerId);
    if (projection) {
      this.projections.delete(oldServerId);
      this.projections.set(newServerId, projection);
    }
    const dirty = this.dirtyByHost.get(oldServerId);
    if (dirty) {
      this.dirtyByHost.delete(oldServerId);
      this.dirtyByHost.set(newServerId, dirty);
    }
    this.clearHostPersistTimer(oldServerId);
    this.clearFinalsForHost(oldServerId);
    if (this.activeServerIds.delete(oldServerId)) this.activeServerIds.add(newServerId);
    this.markRegistryDirty();
    this.markHostDirty(newServerId, REPLICA_DIRTY_DOMAINS);
  }

  /** Writes the current active-host projection even when no domain is dirty */
  async flush(): Promise<void> {
    this.clearAllPersistTimers();
    this.pendingForceFlush = true;
    this.pendingFlushAllHosts = true;
    this.pendingFlushRegistry = true;
    return this.requestFlush();
  }

  /** Flushes all currently dirty host and registry revisions */
  async flushDirty(): Promise<void> {
    this.clearAllPersistTimers();
    this.pendingFlushAllHosts = true;
    this.pendingFlushRegistry = true;
    return this.requestFlush();
  }

  /** Flushes only the named host while preserving other hosts' dirty windows */
  async flushDirtyHost(serverId: string): Promise<void> {
    this.clearHostPersistTimer(serverId);
    this.pendingFlushHostIds.add(serverId);
    return this.requestFlush();
  }

  /** Flushes dirty state and waits until all coalesced requests are idle */
  async drain(): Promise<void> {
    await this.flushDirty();
  }

  /** Coalesces status and stream completion signals for the current cache target */
  notifyFinal(serverId: string, agentId: string, source: ReplicaCacheFinalSource): void {
    if (!this.activeServerIds.has(serverId) || this.getTargetAgentId(serverId) !== agentId) return;
    const key = this.finalKey(serverId, agentId);
    const current = this.pendingFinals.get(key);
    if (current?.source === source) return;
    if (current) {
      clearTimeout(current.timer);
      this.pendingFinals.delete(key);
      void this.flushDirtyHost(serverId);
      return;
    }
    const timer = setTimeout(() => {
      this.pendingFinals.delete(key);
      if (this.getTargetAgentId(serverId) === agentId) void this.flushDirtyHost(serverId);
    }, PERSIST_DELAY_MS);
    this.pendingFinals.set(key, { source, timer });
  }

  private handleStoreChange(state: ReturnType<typeof useSessionStore.getState>): void {
    for (const serverId of this.activeServerIds) {
      const previous = this.projections.get(serverId);
      const next = this.buildHostProjection(serverId, state.sessions[serverId], previous);
      this.projections.set(serverId, next);
      if (!previous) continue;

      const domains: ReplicaDirtyDomain[] = [];
      const targetChanged = previous.targetAgentId !== next.targetAgentId;
      if (targetChanged || previous.agent !== next.agent) domains.push("agent");
      if (
        targetChanged ||
        previous.workspace !== next.workspace ||
        previous.project !== next.project
      ) {
        domains.push("workspace");
      }
      if (targetChanged || previous.timeline !== next.timeline) domains.push("timeline");
      if (domains.length === 0) continue;

      this.markHostDirty(serverId, domains);
      if (targetChanged) {
        this.clearFinalsForHost(serverId);
        void this.flushDirtyHost(serverId);
      }
    }
  }

  // Projection reuse decisions stay centralized so all four dirty domains share one target snapshot.
  // eslint-disable-next-line complexity
  private buildHostProjection(
    serverId: string,
    session: SessionState | undefined,
    previous?: HostReplicaProjection,
  ): HostReplicaProjection {
    if (session?.focusedAgentId) this.lastFocusedAgentIds.set(serverId, session.focusedAgentId);
    const focusedAgentId = session?.focusedAgentId ?? null;
    const targetAgentId = focusedAgentId ?? this.lastFocusedAgentIds.get(serverId) ?? null;
    if (previous && previous.session === session && previous.targetAgentId === targetAgentId) {
      return previous;
    }

    const sameTarget = previous?.targetAgentId === targetAgentId;
    const agentRef = targetAgentId ? session?.agents.get(targetAgentId) : undefined;
    const agent =
      sameTarget && previous?.agentRef === agentRef
        ? (previous?.agent ?? null)
        : preserveEqualProjection(
            previous?.agent ?? null,
            agentRef ? serializeAgent(agentRef) : null,
          );

    const canReuseWorkspaceRef =
      sameTarget &&
      previous?.agentRef === agentRef &&
      previous?.workspacesRef === session?.workspaces;
    let workspaceRef = previous?.workspaceRef;
    if (!canReuseWorkspaceRef) {
      workspaceRef = undefined;
      if (agentRef) {
        if (agentRef.workspaceId) {
          workspaceRef = session?.workspaces.get(agentRef.workspaceId);
        }
        workspaceRef ??= Array.from(session?.workspaces.values() ?? []).find(
          (workspace) => workspace.workspaceDirectory === agentRef.cwd,
        );
      }
    }
    const workspace =
      canReuseWorkspaceRef && previous?.workspaceRef === workspaceRef
        ? (previous?.workspace ?? null)
        : preserveEqualProjection(
            previous?.workspace ?? null,
            workspaceRef ? serializeWorkspace(workspaceRef) : null,
          );

    const canReuseProjectRef =
      sameTarget &&
      previous?.workspaceRef === workspaceRef &&
      previous?.projectsRef === session?.projects;
    let projectRef = previous?.projectRef;
    if (!canReuseProjectRef) {
      projectRef = workspaceRef ? session?.projects.get(workspaceRef.projectId) : undefined;
    }
    const project =
      canReuseProjectRef && previous?.projectRef === projectRef
        ? (previous?.project ?? null)
        : preserveEqualProjection(
            previous?.project ?? null,
            projectRef ? serializeProject(projectRef) : null,
          );

    const timelineRef = targetAgentId ? session?.agentStreamTail.get(targetAgentId) : undefined;
    const timeline =
      sameTarget && previous?.agentRef === agentRef && previous?.timelineRef === timelineRef
        ? (previous?.timeline ?? null)
        : preserveEqualProjection(
            previous?.timeline ?? null,
            this.buildTimelineProjection(session, targetAgentId, agentRef),
          );

    return {
      session,
      targetAgentId,
      agentRef,
      agent,
      workspacesRef: session?.workspaces,
      workspaceRef,
      workspace,
      projectsRef: session?.projects,
      projectRef,
      project,
      timelineRef,
      timeline,
    };
  }

  private buildTimelineProjection(
    session: SessionState | undefined,
    targetAgentId: string | null,
    agent: Agent | undefined,
  ): StoredHost["timeline"] {
    if (!session || !targetAgentId || !agent) return null;
    const timelineState = selectAgentTimelineState(session, targetAgentId);
    if (timelineState.status === "cold") return null;
    const items = timelineState.items.filter(
      (item) => item.kind !== "user_message" || !isUnreconciledLocalUserMessage(item),
    );
    return {
      agentId: targetAgentId,
      items: items
        .slice(-MAX_TIMELINE_ITEMS)
        .map(serializeTimelineItem)
        .filter((item): item is StoredTimelineItem => item !== null),
    };
  }

  private markHostDirty(serverId: string, domains: readonly ReplicaDirtyDomain[]): void {
    if (!this.activeServerIds.has(serverId) || domains.length === 0) return;
    const dirty = this.dirtyByHost.get(serverId) ?? { revision: 0, domains: new Map() };
    dirty.revision += 1;
    for (const domain of domains) dirty.domains.set(domain, dirty.revision);
    this.dirtyByHost.set(serverId, dirty);
    this.scheduleHostPersist(serverId);
  }

  private markRegistryDirty(): void {
    this.registryRevision += 1;
    this.dirtyRegistryRevision = this.registryRevision;
    this.scheduleRegistryPersist();
  }

  private scheduleHostPersist(serverId: string): void {
    if (!this.unsubscribe) return;
    this.clearHostPersistTimer(serverId);
    const timer = setTimeout(() => {
      this.hostPersistTimers.delete(serverId);
      void this.flushDirtyHost(serverId);
    }, PERSIST_DELAY_MS);
    this.hostPersistTimers.set(serverId, timer);
  }

  private scheduleRegistryPersist(): void {
    if (!this.unsubscribe) return;
    if (this.registryPersistTimer) clearTimeout(this.registryPersistTimer);
    this.registryPersistTimer = setTimeout(() => {
      this.registryPersistTimer = null;
      this.pendingFlushRegistry = true;
      void this.requestFlush();
    }, PERSIST_DELAY_MS);
  }

  private clearHostPersistTimer(serverId: string): void {
    const timer = this.hostPersistTimers.get(serverId);
    if (timer) clearTimeout(timer);
    this.hostPersistTimers.delete(serverId);
  }

  private clearAllPersistTimers(): void {
    for (const timer of this.hostPersistTimers.values()) clearTimeout(timer);
    this.hostPersistTimers.clear();
    if (this.registryPersistTimer) clearTimeout(this.registryPersistTimer);
    this.registryPersistTimer = null;
  }

  private async requestFlush(): Promise<void> {
    do {
      if (!this.flushLoopPromise) {
        const loop = this.runFlushLoop().finally(() => {
          if (this.flushLoopPromise === loop) this.flushLoopPromise = null;
        });
        this.flushLoopPromise = loop;
      }
      await this.flushLoopPromise;
    } while (this.flushLoopPromise !== null || this.hasPendingFlushRequest());
  }

  private async runFlushLoop(): Promise<void> {
    while (this.hasPendingFlushRequest()) {
      const force = this.pendingForceFlush;
      const allHosts = this.pendingFlushAllHosts || force;
      const includeRegistry = this.pendingFlushRegistry || force;
      const hostIds = new Set(this.pendingFlushHostIds);
      this.pendingForceFlush = false;
      this.pendingFlushAllHosts = false;
      this.pendingFlushRegistry = false;
      this.pendingFlushHostIds.clear();

      const captured = this.captureDirtyState({ force, allHosts, includeRegistry, hostIds });
      if (!force && captured.registryRevision === null && captured.hostDomains.size === 0) continue;
      const bounded = this.buildBoundedPayload();
      if (!bounded) {
        await this.clearInvalidCache();
        continue;
      }
      let succeeded = false;
      try {
        await this.storage.setItem(STORAGE_KEY, bounded.payload);
        succeeded = true;
      } catch {
        // Replica persistence is best-effort; the captured revisions remain dirty
      }
      if (succeeded) {
        this.clearCapturedDirty(captured);
      }
    }
  }

  private captureDirtyState(input: {
    force: boolean;
    allHosts: boolean;
    includeRegistry: boolean;
    hostIds: Set<string>;
  }): CapturedDirtyState {
    const hostDomains = new Map<string, Map<ReplicaDirtyDomain, number>>();
    const targetHostIds = input.allHosts
      ? new Set(input.force ? this.activeServerIds : this.dirtyByHost.keys())
      : input.hostIds;
    const sessions = useSessionStore.getState().sessions;
    for (const serverId of targetHostIds) {
      if (!this.activeServerIds.has(serverId)) continue;
      const dirty = this.dirtyByHost.get(serverId);
      if (!input.force && (!dirty || dirty.domains.size === 0)) continue;
      if (dirty?.domains.size) hostDomains.set(serverId, new Map(dirty.domains));
      this.captureHost(serverId, sessions[serverId]);
    }
    return {
      registryRevision: input.includeRegistry ? this.dirtyRegistryRevision : null,
      hostDomains,
    };
  }

  private captureHost(serverId: string, session: SessionState | undefined): void {
    if (!session) return;
    const projection = this.buildHostProjection(serverId, session, this.projections.get(serverId));
    this.projections.set(serverId, projection);
    const stored: StoredHost = {
      serverId,
      agents: projection.agent ? [projection.agent] : [],
      workspaces: projection.workspace ? [projection.workspace] : [],
      projects: projection.project ? [projection.project] : [],
      emptyProjects: [],
      timeline: projection.timeline,
    };
    if (equal(this.storedHosts.get(serverId), stored)) return;
    this.storedHosts.delete(serverId);
    this.storedHosts.set(serverId, stored);
  }

  private clearCapturedDirty(captured: CapturedDirtyState): void {
    if (
      captured.registryRevision !== null &&
      this.dirtyRegistryRevision !== null &&
      this.dirtyRegistryRevision <= captured.registryRevision
    ) {
      this.dirtyRegistryRevision = null;
    }
    for (const [serverId, domains] of captured.hostDomains) {
      const dirty = this.dirtyByHost.get(serverId);
      if (!dirty) continue;
      for (const [domain, revision] of domains) {
        const current = dirty.domains.get(domain);
        if (current !== undefined && current <= revision) dirty.domains.delete(domain);
      }
    }
  }

  private hasPendingFlushRequest(): boolean {
    return (
      this.pendingForceFlush ||
      this.pendingFlushAllHosts ||
      this.pendingFlushRegistry ||
      this.pendingFlushHostIds.size > 0
    );
  }

  private getTargetAgentId(serverId: string): string | null {
    const focusedAgentId = useSessionStore.getState().sessions[serverId]?.focusedAgentId;
    return focusedAgentId ?? this.lastFocusedAgentIds.get(serverId) ?? null;
  }

  private finalKey(serverId: string, agentId: string): string {
    return `${serverId}\u0000${agentId}`;
  }

  private clearFinalsForHost(serverId: string): void {
    const prefix = `${serverId}\u0000`;
    for (const [key, pending] of this.pendingFinals) {
      if (!key.startsWith(prefix)) continue;
      clearTimeout(pending.timer);
      this.pendingFinals.delete(key);
    }
  }

  private removeHostState(serverId: string): void {
    this.lastFocusedAgentIds.delete(serverId);
    this.projections.delete(serverId);
    this.dirtyByHost.delete(serverId);
    this.pendingFlushHostIds.delete(serverId);
    this.clearHostPersistTimer(serverId);
    this.clearFinalsForHost(serverId);
  }

  private buildBoundedPayload(): { payload: string; evicted: boolean } | null {
    let evicted = false;
    let payload = this.serialize();
    if (payload === null) return null;
    while (Buffer.byteLength(payload, "utf8") > this.maxBytes && this.storedHosts.size > 0) {
      const oldestServerId = this.storedHosts.keys().next().value;
      if (oldestServerId === undefined) break;
      this.storedHosts.delete(oldestServerId);
      evicted = true;
      payload = this.serialize();
      if (payload === null) return null;
    }
    return { payload, evicted };
  }

  private serialize(): string | null {
    const cache = StoredCacheSchema.safeParse({
      version: CACHE_VERSION,
      hosts: Array.from(this.storedHosts.values()),
    });
    return cache.success ? JSON.stringify(cache.data) : null;
  }

  private async clearInvalidCache(): Promise<void> {
    try {
      await this.storage.removeItem(STORAGE_KEY);
    } catch {
      // A storage failure must not turn invalid cached data into application state.
    }
  }
}
