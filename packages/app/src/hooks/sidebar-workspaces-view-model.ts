import { getWorkspaceStateBucketPriority } from "@getpaseo/protocol/agent-state-bucket";
import type { PrHint } from "@/git/pr-hint";
import { selectPrHintFromStatus } from "@/git/pr-hint";
import { type HostProjectListItem } from "@/projects/host-project-model";
import type { PendingCreateAttempt } from "@/stores/create-flow-store";
import type {
  Agent,
  DaemonServerInfo,
  SessionState,
  WorkspaceDescriptor,
} from "@/stores/session-store";
import type { HostRuntimeSnapshot } from "@/runtime/host-runtime";
import type {
  WorkspaceStructureHostPlacement,
  WorkspaceStructureProject,
} from "@/projects/workspace-structure";
import { projectDisplayNameFromProjectId } from "@/utils/project-display-name";
import { aggregateSidebarStateBuckets } from "@/utils/sidebar-agent-state";
import { isCurrentAgentDirectory } from "@/utils/agent-directory-readiness";
import { shortenPath } from "@/utils/shorten-path";
import {
  buildWorkspaceManagedAgentIndex,
  type WorkspaceAgentActivity,
  type WorkspaceManagedAgentIndex,
} from "@/utils/workspace-agent-activity";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";

const EMPTY_PROJECTS: SidebarProjectEntry[] = [];
/** Stable empty value for Workspaces without managed Agents */
const EMPTY_AGENTS: readonly Agent[] = [];

export type SidebarStateBucket = WorkspaceDescriptor["status"];
export type AgentRuntimeCloseDisabledReason = "offline" | "syncing" | "sync_failed" | "update_host";

export interface SidebarWorkspacePlacement {
  workspaceKey: string;
  serverId: string;
  workspaceId: string;
  projectViewKey: string;
  projectName: string;
  projectRootPath?: string;
  workspaceDirectory?: string;
  projectKind: WorkspaceStructureProject["projectKind"];
  workspaceKind: WorkspaceDescriptor["workspaceKind"];
  name: string;
}

export interface SidebarStatusWorkspacePlacement extends SidebarWorkspacePlacement {
  statusBucket: SidebarStateBucket;
  statusEnteredAt: Date | null;
}

export interface SidebarWorkspaceEntry extends SidebarStatusWorkspacePlacement {
  workspaceDirectory: string;
  workspaceDirectoryLabel: string;
  // Raw user-set title (null when the name is derived from branch/directory).
  // Prefills the rename input and signals whether a reset is available.
  title: string | null;
  pinnedAt?: string | null;
  labels?: string[];
  // Checkout branch (null when not a git checkout or detached HEAD).
  currentBranch: string | null;
  archivingAt: string | null;
  diffStat: { additions: number; deletions: number } | null;
  prHint: PrHint | null;
  archiveHasUncommittedChanges: boolean | null;
  archiveUnpushedCommitCount: number | null;
  scripts: WorkspaceDescriptor["scripts"];
  hasRunningScripts: boolean;
  hasUnreadAttention: boolean;
  hasClearableAttention: boolean;
  hasMarkUnreadCandidate: boolean;
  supportsMarkUnread: boolean;
  residentAgentCount?: number | null;
  /** Historical Agents whose provider session has not resumed */
  detachedAgentCount?: number | null;
  managedAgents?: readonly Agent[] | null;
  agentDirectoryCurrent?: boolean;
  supportsAgentRuntimeClose?: boolean;
  agentRuntimeCloseDisabledReason?: AgentRuntimeCloseDisabledReason;
}

export interface SidebarProjectEntry {
  viewKey: string;
  projectName: string;
  projectKind: WorkspaceStructureProject["projectKind"];
  iconWorkingDir: string;
  hosts: WorkspaceStructureHostPlacement[];
  workspaces: SidebarWorkspacePlacement[];
}

export interface SidebarWorkspacePlacementModel {
  workspaces: SidebarWorkspacePlacement[];
  projects: SidebarProjectEntry[];
  projectNamesByViewKey: Map<string, string>;
}

export interface SidebarWorkspaceSession {
  serverId: string;
  workspaces: Map<string, WorkspaceDescriptor>;
  workspaceAgentActivity: Map<string, WorkspaceAgentActivity>;
  agents?: ReadonlyMap<string, Agent>;
  agentDirectoryCurrent?: boolean;
  supportsAgentRuntimeClose?: boolean;
  agentRuntimeCloseDisabledReason?: AgentRuntimeCloseDisabledReason;
  supportsMarkUnread: boolean;
}

interface SidebarWorkspaceSessionSource {
  agents?: Map<string, Agent>;
  client?: SessionState["client"];
  clientGeneration?: number;
  workspaces: Map<string, WorkspaceDescriptor>;
  workspaceAgentActivity: Map<string, WorkspaceAgentActivity>;
  serverInfo: Pick<DaemonServerInfo, "features"> | null;
}

/** Empty until the sidebar receives the current Host snapshots */
const EMPTY_RUNTIME_SNAPSHOTS: ReadonlyMap<string, HostRuntimeSnapshot | null> = new Map();

/** Selects Host sessions and current Agent directory readiness for the sidebar hosts */
export function selectSidebarWorkspaceSessions(
  sessions: Record<string, SidebarWorkspaceSessionSource | undefined>,
  serverIds: readonly string[],
  runtimeSnapshots: ReadonlyMap<string, HostRuntimeSnapshot | null> = EMPTY_RUNTIME_SNAPSHOTS,
): SidebarWorkspaceSession[] {
  const selected: SidebarWorkspaceSession[] = [];
  for (const serverId of serverIds) {
    const session = sessions[serverId];
    if (!session) {
      continue;
    }
    const runtimeSnapshot = runtimeSnapshots.get(serverId) ?? null;
    const agentDirectorySession =
      session.client && session.clientGeneration !== undefined
        ? { client: session.client, clientGeneration: session.clientGeneration }
        : null;
    const agentDirectoryCurrent = runtimeSnapshots.has(serverId)
      ? isCurrentAgentDirectory({ snapshot: runtimeSnapshot, session: agentDirectorySession })
      : undefined;
    const supportsAgentRuntimeClose = Boolean(
      agentDirectoryCurrent &&
      runtimeSnapshot?.client?.supportsAgentRuntimeClose() === true &&
      session.serverInfo?.features?.agentRuntimeClose === true,
    );
    selected.push({
      serverId,
      workspaces: session.workspaces,
      workspaceAgentActivity: session.workspaceAgentActivity,
      ...(agentDirectoryCurrent !== undefined
        ? {
            agents: session.agents,
            agentDirectoryCurrent,
            supportsAgentRuntimeClose,
            agentRuntimeCloseDisabledReason: resolveAgentRuntimeCloseDisabledReason({
              snapshot: runtimeSnapshot,
              agentDirectoryCurrent,
              supportsAgentRuntimeClose,
            }),
          }
        : {}),
      supportsMarkUnread: session.serverInfo?.features?.workspaceMarkUnread === true,
    });
  }
  return selected;
}

export function areSidebarWorkspaceSessionsEqual(
  left: readonly SidebarWorkspaceSession[],
  right: readonly SidebarWorkspaceSession[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftSession = left[index];
    const rightSession = right[index];
    if (
      !leftSession ||
      !rightSession ||
      leftSession.serverId !== rightSession.serverId ||
      leftSession.workspaces !== rightSession.workspaces ||
      leftSession.workspaceAgentActivity !== rightSession.workspaceAgentActivity ||
      leftSession.agents !== rightSession.agents ||
      leftSession.agentDirectoryCurrent !== rightSession.agentDirectoryCurrent ||
      leftSession.supportsAgentRuntimeClose !== rightSession.supportsAgentRuntimeClose ||
      leftSession.agentRuntimeCloseDisabledReason !==
        rightSession.agentRuntimeCloseDisabledReason ||
      leftSession.supportsMarkUnread !== rightSession.supportsMarkUnread
    ) {
      return false;
    }
  }
  return true;
}

/** Explains why the close command is unavailable for the selected Host */
function resolveAgentRuntimeCloseDisabledReason(input: {
  snapshot: HostRuntimeSnapshot | null;
  agentDirectoryCurrent: boolean | undefined;
  supportsAgentRuntimeClose: boolean;
}): AgentRuntimeCloseDisabledReason | undefined {
  if (input.snapshot?.connectionStatus !== "online") return "offline";
  if (
    input.snapshot.agentDirectoryStatus === "error_before_first_success" ||
    input.snapshot.agentDirectoryStatus === "error_after_ready"
  ) {
    return "sync_failed";
  }
  if (!input.agentDirectoryCurrent) return "syncing";
  return input.supportsAgentRuntimeClose ? undefined : "update_host";
}

interface EffectiveWorkspaceStatus {
  status: WorkspaceDescriptor["status"];
  enteredAt: Date | null;
}

function projectNameForWorkspace(workspace: WorkspaceDescriptor): string {
  return (
    workspace.projectCustomName ??
    workspace.projectDisplayName ??
    projectDisplayNameFromProjectId(workspace.projectId)
  );
}

function normalizeCurrentBranch(currentBranch: string | null | undefined): string | null {
  if (!currentBranch) {
    return null;
  }
  const trimmed = currentBranch.trim();
  return trimmed.length === 0 || trimmed === "HEAD" ? null : trimmed;
}

/** Projects optional Agent runtime fields into a stable sidebar shape */
function createAgentRuntimeSidebarFields(input: {
  residentAgentCount?: number | null;
  detachedAgentCount?: number | null;
  managedAgents?: readonly Agent[] | null;
  agentDirectoryCurrent?: boolean;
  supportsAgentRuntimeClose?: boolean;
  agentRuntimeCloseDisabledReason?: AgentRuntimeCloseDisabledReason;
}): Pick<
  SidebarWorkspaceEntry,
  | "residentAgentCount"
  | "detachedAgentCount"
  | "managedAgents"
  | "agentDirectoryCurrent"
  | "supportsAgentRuntimeClose"
  | "agentRuntimeCloseDisabledReason"
> {
  return {
    residentAgentCount: input.residentAgentCount ?? null,
    detachedAgentCount: input.detachedAgentCount ?? null,
    managedAgents: input.managedAgents ?? null,
    agentDirectoryCurrent: input.agentDirectoryCurrent ?? false,
    supportsAgentRuntimeClose: input.supportsAgentRuntimeClose ?? false,
    agentRuntimeCloseDisabledReason: input.agentRuntimeCloseDisabledReason,
  };
}

/** Combines daemon Workspace state with client Agent facts for sidebar presentation */
export function createSidebarWorkspaceEntry(input: {
  serverId: string;
  workspace: WorkspaceDescriptor;
  projectViewKey?: string;
  pendingCreateAttempts?: Record<string, PendingCreateAttempt>;
  workspaceAgentActivity?: ReadonlyMap<string, WorkspaceAgentActivity>;
  residentAgentCount?: number | null;
  detachedAgentCount?: number | null;
  managedAgents?: readonly Agent[] | null;
  agentDirectoryCurrent?: boolean;
  supportsAgentRuntimeClose?: boolean;
  agentRuntimeCloseDisabledReason?: AgentRuntimeCloseDisabledReason;
  supportsMarkUnread?: boolean;
}): SidebarWorkspaceEntry {
  const projectViewKey = input.projectViewKey ?? input.workspace.projectId;
  const effectiveStatus = deriveEffectiveWorkspaceStatus(input);
  const activity = input.workspaceAgentActivity?.get(input.workspace.id);
  return {
    workspaceKey: `${input.serverId}:${input.workspace.id}`,
    serverId: input.serverId,
    workspaceId: input.workspace.id,
    projectViewKey,
    projectName: projectNameForWorkspace(input.workspace),
    projectRootPath: input.workspace.projectRootPath,
    workspaceDirectory: input.workspace.workspaceDirectory,
    workspaceDirectoryLabel:
      input.workspace.worktreeSlug ?? shortenPath(input.workspace.workspaceDirectory),
    projectKind: input.workspace.projectKind,
    workspaceKind: input.workspace.workspaceKind,
    name: input.workspace.name,
    title: input.workspace.title ?? null,
    pinnedAt: input.workspace.pinnedAt,
    labels: input.workspace.labels ?? EMPTY_WORKSPACE_LABELS,
    currentBranch: normalizeCurrentBranch(input.workspace.gitRuntime?.currentBranch),
    statusBucket: effectiveStatus.status,
    statusEnteredAt: effectiveStatus.enteredAt,
    hasUnreadAttention: activity?.hasUnreadAttention ?? false,
    hasClearableAttention: activity?.hasClearableAttention ?? false,
    hasMarkUnreadCandidate: activity?.hasMarkUnreadCandidate ?? false,
    supportsMarkUnread: input.supportsMarkUnread ?? false,
    ...createAgentRuntimeSidebarFields(input),
    archivingAt: input.workspace.archivingAt,
    diffStat: input.workspace.diffStat,
    prHint: selectPrHintFromStatus(
      input.workspace.githubRuntime?.pullRequest,
      input.workspace.forge,
    ),
    archiveHasUncommittedChanges: input.workspace.gitRuntime?.isDirty ?? null,
    archiveUnpushedCommitCount: input.workspace.gitRuntime?.aheadOfOrigin ?? null,
    scripts: input.workspace.scripts,
    hasRunningScripts: input.workspace.scripts.some((script) => script.lifecycle === "running"),
  };
}

const EMPTY_WORKSPACE_LABELS: string[] = [];

function deriveEffectiveWorkspaceStatus(input: {
  serverId: string;
  workspace: WorkspaceDescriptor;
  pendingCreateAttempts?: Record<string, PendingCreateAttempt>;
  workspaceAgentActivity?: ReadonlyMap<string, WorkspaceAgentActivity>;
}): EffectiveWorkspaceStatus {
  const workspaceStatus = input.workspace.status;
  if (workspaceStatus === "done") {
    const pendingStartedAt = getPendingInitialAgentCreateStartedAt({
      serverId: input.serverId,
      workspaceId: input.workspace.id,
      pendingCreateAttempts: input.pendingCreateAttempts,
    });
    if (pendingStartedAt) {
      return { status: "running", enteredAt: pendingStartedAt };
    }
  }

  const rootAgentActivity = input.workspaceAgentActivity?.get(input.workspace.id);
  if (
    rootAgentActivity &&
    getWorkspaceStateBucketPriority(rootAgentActivity.status) <
      getWorkspaceStateBucketPriority(workspaceStatus)
  ) {
    return rootAgentActivity;
  }

  return { status: workspaceStatus, enteredAt: input.workspace.statusEnteredAt };
}

function getPendingInitialAgentCreateStartedAt(input: {
  serverId: string;
  workspaceId: string;
  pendingCreateAttempts: Record<string, PendingCreateAttempt> | undefined;
}): Date | null {
  let latestStartedAt: Date | null = null;
  for (const pending of Object.values(input.pendingCreateAttempts ?? {})) {
    if (pending.serverId !== input.serverId) continue;
    if (pending.workspaceId !== input.workspaceId) continue;
    if (pending.lifecycle === "abandoned") continue;
    const startedAt = new Date(pending.timestamp);
    if (!latestStartedAt || startedAt > latestStartedAt) {
      latestStartedAt = startedAt;
    }
  }
  return latestStartedAt;
}

export interface ProjectStatusSession {
  workspaces: Map<string, WorkspaceDescriptor>;
  workspaceAgentActivity: Map<string, WorkspaceAgentActivity>;
}

/**
 * Most urgent status among a project's workspaces. Backs the status dot on a collapsed
 * project row, which otherwise hides every workspace-level signal it contains.
 *
 * Workspaces the session hasn't hydrated yet are skipped rather than counted as done —
 * an unknown workspace shouldn't drag the aggregate anywhere. Reuses the same
 * activity-index + effective-status pipeline as per-workspace rows (one pass over the
 * session's agents per server, not per workspace) rather than re-deriving it.
 */
export function deriveProjectStatusBucket(input: {
  workspaces: readonly SidebarWorkspacePlacement[];
  sessions: Record<string, ProjectStatusSession | undefined>;
  pendingCreateAttempts?: Record<string, PendingCreateAttempt>;
}): SidebarStateBucket {
  const workspaceIdsByServer = new Map<string, string[]>();
  for (const placement of input.workspaces) {
    const existing = workspaceIdsByServer.get(placement.serverId);
    if (existing) {
      existing.push(placement.workspaceId);
    } else {
      workspaceIdsByServer.set(placement.serverId, [placement.workspaceId]);
    }
  }

  const buckets: SidebarStateBucket[] = [];
  for (const [serverId, workspaceIds] of workspaceIdsByServer) {
    const session = input.sessions[serverId];
    if (!session) continue;
    for (const workspaceId of workspaceIds) {
      const workspaceKey = resolveWorkspaceMapKeyByIdentity({
        workspaces: session.workspaces,
        workspaceId,
      });
      const workspace = workspaceKey ? session.workspaces.get(workspaceKey) : undefined;
      if (!workspace) continue;
      buckets.push(
        deriveEffectiveWorkspaceStatus({
          serverId,
          workspace,
          pendingCreateAttempts: input.pendingCreateAttempts,
          workspaceAgentActivity: session.workspaceAgentActivity,
        }).status,
      );
    }
  }

  return aggregateSidebarStateBuckets(buckets);
}

export function buildSidebarWorkspacePlacementModel(input: {
  projects: readonly HostProjectListItem[];
}): SidebarWorkspacePlacementModel {
  const projects = buildSidebarProjectsFromHostProjects({ projects: input.projects });
  return {
    projects,
    workspaces: projects.flatMap((project) => project.workspaces),
    projectNamesByViewKey: new Map(
      projects.map((project) => [project.viewKey, project.projectName]),
    ),
  };
}

function createStructuralWorkspaceEntry(input: {
  project: HostProjectListItem;
  workspaceKey: string;
}): SidebarWorkspacePlacement {
  const identity = resolveStructuralWorkspaceIdentity({
    project: input.project,
    workspaceKey: input.workspaceKey,
  });

  return {
    workspaceKey: identity.workspaceKey,
    serverId: identity.serverId,
    workspaceId: identity.workspaceId,
    projectViewKey: input.project.viewKey,
    projectName: input.project.projectName,
    projectRootPath: input.project.iconWorkingDir,
    workspaceDirectory: undefined,
    projectKind: input.project.projectKind,
    workspaceKind: "checkout",
    name: identity.workspaceId,
  };
}

function resolveStructuralWorkspaceIdentity(input: {
  project: HostProjectListItem;
  workspaceKey: string;
}): {
  workspaceKey: string;
  serverId: string;
  workspaceId: string;
} {
  const hostsByLongestPrefix = [...input.project.hosts].sort(
    (left, right) => right.serverId.length - left.serverId.length,
  );

  for (const host of hostsByLongestPrefix) {
    const prefix = `${host.serverId}:`;
    if (!input.workspaceKey.startsWith(prefix)) continue;
    const workspaceId = input.workspaceKey.slice(prefix.length);
    if (!workspaceId) continue;
    return {
      workspaceKey: input.workspaceKey,
      serverId: host.serverId,
      workspaceId,
    };
  }

  const separatorIndex = input.workspaceKey.indexOf(":");
  if (separatorIndex > 0) {
    return {
      workspaceKey: input.workspaceKey,
      serverId: input.workspaceKey.slice(0, separatorIndex),
      workspaceId: input.workspaceKey.slice(separatorIndex + 1),
    };
  }

  const serverId = input.project.hosts[0]?.serverId ?? input.workspaceKey;
  return {
    workspaceKey: `${serverId}:${input.workspaceKey}`,
    serverId,
    workspaceId: input.workspaceKey,
  };
}

/** Indexes managed Agents once per Host before projecting Workspace entries */
function buildManagedAgentIndexesByServer(
  sessions: readonly SidebarWorkspaceSession[],
): Map<string, WorkspaceManagedAgentIndex | null> {
  const indexes = new Map<string, WorkspaceManagedAgentIndex | null>();
  for (const session of sessions) {
    indexes.set(
      session.serverId,
      session.agentDirectoryCurrent && session.agents
        ? buildWorkspaceManagedAgentIndex(session.agents)
        : null,
    );
  }
  return indexes;
}

/** Selects resident Agents for one Workspace from a Host index */
function getWorkspaceManagedAgentFields(
  index: WorkspaceManagedAgentIndex | null | undefined,
  workspaceId: string,
  previousEntry: SidebarWorkspaceEntry | undefined,
): Pick<SidebarWorkspaceEntry, "residentAgentCount" | "detachedAgentCount" | "managedAgents"> {
  if (!index) {
    return { residentAgentCount: null, detachedAgentCount: null, managedAgents: null };
  }
  const agents = index.agentsByWorkspace.get(workspaceId) ?? EMPTY_AGENTS;
  const previousAgents = previousEntry?.managedAgents;
  const managedAgents =
    previousAgents &&
    previousAgents.length === agents.length &&
    previousAgents.every((agent, agentIndex) => agent === agents[agentIndex])
      ? previousAgents
      : agents;
  return {
    residentAgentCount: index.residentCountsByWorkspace.get(workspaceId) ?? 0,
    detachedAgentCount: index.detachedCountsByWorkspace.get(workspaceId) ?? 0,
    managedAgents,
  };
}

export function buildSidebarWorkspaceEntries(input: {
  placements: readonly SidebarWorkspacePlacement[];
  sessions: SidebarWorkspaceSession[];
  pendingCreateAttempts?: Record<string, PendingCreateAttempt>;
  previousEntries?: ReadonlyMap<string, SidebarWorkspaceEntry>;
}): Map<string, SidebarWorkspaceEntry> {
  if (input.placements.length === 0 || input.sessions.length === 0) {
    return new Map();
  }

  const sessionByServerId = new Map(input.sessions.map((session) => [session.serverId, session]));
  const managedAgentsByServer = buildManagedAgentIndexesByServer(input.sessions);
  const entries = new Map<string, SidebarWorkspaceEntry>();

  for (const placement of input.placements) {
    const session = sessionByServerId.get(placement.serverId);
    if (!session) continue;
    const workspaceKey = resolveWorkspaceMapKeyByIdentity({
      workspaces: session.workspaces,
      workspaceId: placement.workspaceId,
    });
    const workspace = workspaceKey ? session.workspaces.get(workspaceKey) : null;
    if (!workspace) continue;
    const previousEntry = input.previousEntries?.get(placement.workspaceKey);
    const agentRuntimeFields = getWorkspaceManagedAgentFields(
      managedAgentsByServer.get(placement.serverId),
      workspace.id,
      previousEntry,
    );

    const entry = createSidebarWorkspaceEntry({
      serverId: placement.serverId,
      workspace,
      projectViewKey: placement.projectViewKey,
      pendingCreateAttempts: input.pendingCreateAttempts,
      workspaceAgentActivity: session.workspaceAgentActivity,
      ...agentRuntimeFields,
      agentDirectoryCurrent: session.agentDirectoryCurrent ?? false,
      supportsAgentRuntimeClose: session.supportsAgentRuntimeClose ?? false,
      agentRuntimeCloseDisabledReason: session.agentRuntimeCloseDisabledReason,
      supportsMarkUnread: session.supportsMarkUnread,
    });
    entries.set(
      placement.workspaceKey,
      previousEntry && areSidebarWorkspaceEntriesEqual(previousEntry, entry)
        ? previousEntry
        : entry,
    );
  }

  return entries;
}

function areSidebarWorkspaceEntriesEqual(
  left: SidebarWorkspaceEntry,
  right: SidebarWorkspaceEntry,
): boolean {
  const keys = Object.keys(left) as Array<keyof SidebarWorkspaceEntry>;
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => {
    if (key !== "prHint") return Object.is(left[key], right[key]);
    const leftHint = left.prHint;
    const rightHint = right.prHint;
    return (
      leftHint === rightHint ||
      (leftHint !== null &&
        rightHint !== null &&
        leftHint.url === rightHint.url &&
        leftHint.number === rightHint.number &&
        leftHint.state === rightHint.state &&
        leftHint.checks === rightHint.checks &&
        leftHint.checksStatus === rightHint.checksStatus &&
        leftHint.reviewDecision === rightHint.reviewDecision)
    );
  });
}

export function buildSidebarProjectsFromStructure(input: {
  projects: WorkspaceStructureProject[];
}): SidebarProjectEntry[] {
  return buildSidebarProjectsFromHostProjects({
    projects: input.projects.map((project) => ({
      viewKey: project.viewKey,
      projectKey: project.projectKey,
      projectName: project.projectName,
      projectKind: project.projectKind,
      iconWorkingDir: project.iconWorkingDir,
      hosts: project.hosts,
      workspaceKeys: project.workspaceKeys,
    })),
  });
}

export function buildSidebarProjectsFromHostProjects(input: {
  projects: readonly HostProjectListItem[];
}): SidebarProjectEntry[] {
  if (input.projects.length === 0) {
    return EMPTY_PROJECTS;
  }

  return input.projects.map((project) => ({
    viewKey: project.viewKey,
    projectName: project.projectName,
    projectKind: project.projectKind,
    iconWorkingDir: project.iconWorkingDir,
    hosts: project.hosts,
    workspaces: project.workspaceKeys.map((workspaceKey) =>
      createStructuralWorkspaceEntry({
        project,
        workspaceKey,
      }),
    ),
  }));
}

// Host labels disambiguate which machine a workspace lives on; they only earn their
// space once the visible sidebar spans more than one host. Counting distinct hosts
// across the visible projects (not all connected hosts) keeps labels off when a host
// filter pins the view to a single host.
export function shouldShowSidebarHostLabels(projects: SidebarProjectEntry[]): boolean {
  const serverIds = new Set<string>();
  for (const project of projects) {
    for (const host of project.hosts) {
      serverIds.add(host.serverId);
    }
  }
  return serverIds.size >= 2;
}

export function applyStoredOrdering<T>(input: {
  items: T[];
  storedOrder: string[];
  getKey: (item: T) => string;
}): T[] {
  if (input.items.length <= 1 || input.storedOrder.length === 0) {
    return input.items;
  }

  const itemByKey = new Map<string, T>();
  for (const item of input.items) {
    itemByKey.set(input.getKey(item), item);
  }

  const prunedOrder: string[] = [];
  const seen = new Set<string>();
  for (const key of input.storedOrder) {
    if (!itemByKey.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    prunedOrder.push(key);
  }

  if (prunedOrder.length === 0) {
    return input.items;
  }

  const orderedSet = new Set(prunedOrder);
  const ordered: T[] = [];
  let orderedIndex = 0;

  for (const item of input.items) {
    const key = input.getKey(item);
    if (!orderedSet.has(key)) {
      ordered.push(item);
      continue;
    }

    const targetKey = prunedOrder[orderedIndex] ?? key;
    orderedIndex += 1;
    ordered.push(itemByKey.get(targetKey) ?? item);
  }

  return ordered;
}

export function appendMissingOrderKeys(input: {
  currentOrder: string[];
  visibleKeys: string[];
}): string[] {
  if (input.visibleKeys.length === 0) {
    return input.currentOrder;
  }

  const existingKeys = new Set(input.currentOrder);
  const missingKeys = input.visibleKeys.filter((key) => !existingKeys.has(key));
  if (missingKeys.length === 0) {
    return input.currentOrder;
  }

  return [...input.currentOrder, ...missingKeys];
}

export function prependMissingOrderKeys(input: {
  currentOrder: string[];
  visibleKeys: string[];
}): string[] {
  if (input.visibleKeys.length === 0) {
    return input.currentOrder;
  }

  const existingKeys = new Set(input.currentOrder);
  const missingKeys = input.visibleKeys.filter((key) => !existingKeys.has(key));
  if (missingKeys.length === 0) {
    return input.currentOrder;
  }

  return [...missingKeys, ...input.currentOrder];
}

export interface SidebarOrderUpdates {
  projectOrder: string[] | null;
  workspaceOrders: Array<{ projectViewKey: string; order: string[] }>;
}

export function computeSidebarOrderUpdates(input: {
  projects: SidebarProjectEntry[];
  persistedProjectOrder: string[];
  getWorkspaceOrder: (projectViewKey: string) => string[];
}): SidebarOrderUpdates {
  if (input.projects.length === 0) {
    return { projectOrder: null, workspaceOrders: [] };
  }

  const nextProjectOrder = appendMissingOrderKeys({
    currentOrder: input.persistedProjectOrder,
    visibleKeys: input.projects.map((project) => project.viewKey),
  });
  const projectOrder = nextProjectOrder === input.persistedProjectOrder ? null : nextProjectOrder;

  const workspaceOrders: Array<{ projectViewKey: string; order: string[] }> = [];
  for (const project of input.projects) {
    const persistedWorkspaceOrder = input.getWorkspaceOrder(project.viewKey);
    const nextWorkspaceOrder = prependMissingOrderKeys({
      currentOrder: persistedWorkspaceOrder,
      visibleKeys: project.workspaces.map((workspace) => workspace.workspaceKey),
    });
    if (nextWorkspaceOrder !== persistedWorkspaceOrder) {
      workspaceOrders.push({ projectViewKey: project.viewKey, order: nextWorkspaceOrder });
    }
  }

  return { projectOrder, workspaceOrders };
}

export interface SidebarLoadingState {
  isLoading: boolean;
  isInitialLoad: boolean;
  isRevalidating: boolean;
}

export function deriveSidebarLoadingState(input: {
  isActive: boolean;
  serverIds: string[];
  hydratedServerIds: string[];
  hasProjects: boolean;
}): SidebarLoadingState {
  const hasRegisteredHosts = input.serverIds.length > 0;
  const allHydrated =
    input.serverIds.length > 0 && input.serverIds.length === input.hydratedServerIds.length;
  const isLoading = input.isActive && hasRegisteredHosts && !allHydrated;
  const isInitialLoad = isLoading && !input.hasProjects;
  return { isLoading, isInitialLoad, isRevalidating: false };
}
