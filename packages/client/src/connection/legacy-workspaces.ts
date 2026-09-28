import { AgentSnapshotPayloadSchema } from "@getpaseo/protocol/messages";
import type { AgentSnapshotPayload, SessionOutboundMessage } from "@getpaseo/protocol/messages";
import {
  deriveAgentStateBucket,
  getWorkspaceStateBucketPriority,
} from "@getpaseo/protocol/agent-state-bucket";
import { getParentAgentIdFromLabels } from "@getpaseo/protocol/agent-labels";

type AgentEntry = Extract<
  SessionOutboundMessage,
  { type: "fetch_agents_response" }
>["payload"]["entries"][number];
type Workspace = Extract<
  SessionOutboundMessage,
  { type: "fetch_workspaces_response" }
>["payload"]["entries"][number];
type WorkspaceUpdate = Extract<SessionOutboundMessage, { type: "workspace_update" }>;
type AgentUpdate = Extract<SessionOutboundMessage, { type: "agent_update" }>["payload"];

interface LegacyWorkspaceSnapshot {
  agents: Map<string, AgentEntry>;
  agentUpdates: AgentUpdate[];
  sentWorkspaces: Map<string, Workspace>;
  sentDeltas: WorkspaceUpdate[];
  startedAt: string;
}

interface LegacyWorkspaceRead {
  entries: AgentEntry[];
  reset: boolean;
  complete?: boolean;
}

interface LegacyWorkspaceProjection {
  agents: ReadonlyMap<string, AgentEntry>;
  statusChangedAt?: string;
  persistHistory?: boolean;
}

// Preserve the pre-registry app's identity format. This is an opaque ID, never
// a filesystem path: converting C:\ to C: changes a drive root into a relative path.
function legacyWorkspaceId(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/\/+$/, "") || "/";
}

// COMPAT(legacyWorkspaceDaemon): restored in v0.8.0; remove after 2027-03-11 once daemon floor >= v0.1.97.
// The pre-registry app grouped agents by checkout path. Keep that representation
// at the client edge, including live updates, so app workflows need no version branch.
export class LegacyWorkspaces {
  private readonly agents = new Map<string, AgentEntry>();
  /** Retains the Workspace entry time across legacy updates within one bucket */
  private readonly statusEntryByWorkspaceId = new Map<
    string,
    Pick<Workspace, "status" | "statusEnteredAt">
  >();
  /** Separates incomplete pages from the last complete Agent directory */
  private snapshot: LegacyWorkspaceSnapshot | null = null;
  /** Identifies when live updates can use a complete Agent directory */
  private hasCompleteSnapshot = false;
  /** Repairs page entries after all snapshot pages and live deltas are known */
  private pendingCorrections: WorkspaceUpdate[] = [];

  /** Supplies the transition time for remove updates that carry no timestamp */
  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  normalize(message: SessionOutboundMessage): SessionOutboundMessage {
    const stamp = (agent: AgentSnapshotPayload): AgentSnapshotPayload => ({
      ...agent,
      workspaceId: agent.workspaceId ?? legacyWorkspaceId(agent.cwd),
    });
    if (message.type === "fetch_agents_response")
      return {
        ...message,
        payload: {
          ...message.payload,
          entries: message.payload.entries.map((entry) => ({
            ...entry,
            agent: stamp(entry.agent),
          })),
        },
      };
    if (message.type === "agent_update" && message.payload.kind === "upsert")
      return { ...message, payload: { ...message.payload, agent: stamp(message.payload.agent) } };
    if (
      (message.type === "fetch_agent_response" ||
        message.type === "fetch_agent_timeline_response" ||
        message.type === "cancel_agent_response") &&
      message.payload.agent
    ) {
      return {
        ...message,
        payload: { ...message.payload, agent: stamp(message.payload.agent) },
      } as SessionOutboundMessage;
    }
    if (
      message.type === "status" &&
      (message.payload.status === "agent_created" || message.payload.status === "agent_resumed")
    ) {
      return {
        ...message,
        payload: {
          ...message.payload,
          agent: stamp(AgentSnapshotPayloadSchema.parse(message.payload.agent)),
        },
      };
    }
    return message;
  }

  /** Applies one legacy Agent directory page and reconciles live updates at the final page */
  read(input: LegacyWorkspaceRead): Workspace[] {
    const { entries, reset, complete = true } = input;
    if (reset) {
      this.snapshot = {
        agents: new Map(),
        agentUpdates: [],
        sentWorkspaces: new Map(),
        sentDeltas: [],
        startedAt: this.now(),
      };
      this.pendingCorrections = [];
    }
    const pageIds = new Set(entries.map(workspaceId));
    const snapshot = this.snapshot;
    if (!snapshot) {
      for (const entry of entries) this.agents.set(entry.agent.id, entry);
      return [...this.workspaces({ agents: this.agents }).values()].filter((workspace) =>
        pageIds.has(workspace.id),
      );
    }

    for (const entry of entries) snapshot.agents.set(entry.agent.id, entry);
    if (!complete) {
      const partial = this.workspaces({
        agents: snapshot.agents,
        statusChangedAt: snapshot.startedAt,
        persistHistory: false,
      });
      const page = [...partial.values()].filter((workspace) => pageIds.has(workspace.id));
      for (const workspace of page) snapshot.sentWorkspaces.set(workspace.id, workspace);
      return page;
    }

    for (const update of snapshot.agentUpdates) this.applyAgentUpdate(snapshot.agents, update);
    this.agents.clear();
    for (const [id, entry] of snapshot.agents) this.agents.set(id, entry);
    const workspaces = this.workspaces({
      agents: this.agents,
      statusChangedAt: snapshot.startedAt,
    });
    for (const id of this.statusEntryByWorkspaceId.keys()) {
      if (!workspaces.has(id)) this.statusEntryByWorkspaceId.delete(id);
    }
    const page = [...workspaces.values()].filter((workspace) => pageIds.has(workspace.id));
    // Live deltas replay after the paged snapshot in the app, regardless of their arrival page
    const delivered = new Map(snapshot.sentWorkspaces);
    for (const workspace of page) delivered.set(workspace.id, workspace);
    for (const delta of snapshot.sentDeltas) {
      if (delta.payload.kind === "remove") delivered.delete(delta.payload.id);
      else delivered.set(delta.payload.workspace.id, delta.payload.workspace);
    }
    for (const [id, workspace] of workspaces) {
      if (JSON.stringify(delivered.get(id)) !== JSON.stringify(workspace)) {
        this.pendingCorrections.push({
          type: "workspace_update",
          payload: { kind: "upsert", workspace },
        });
      }
    }
    for (const id of delivered.keys()) {
      if (!workspaces.has(id)) {
        this.pendingCorrections.push({ type: "workspace_update", payload: { kind: "remove", id } });
      }
    }
    this.snapshot = null;
    this.hasCompleteSnapshot = true;
    return page;
  }

  /** Projects live Agent changes from the last complete directory and drains page corrections */
  update(message: SessionOutboundMessage): WorkspaceUpdate[] {
    if (message.type === "fetch_agents_response") {
      const corrections = this.pendingCorrections;
      this.pendingCorrections = [];
      return corrections;
    }
    if (message.type !== "agent_update") return [];
    const update = message.payload;
    this.snapshot?.agentUpdates.push(update);
    if (!this.hasCompleteSnapshot) {
      this.applyAgentUpdate(this.agents, update);
      return [];
    }
    const before = this.workspaces({ agents: this.agents });
    const statusChangedAt = update.kind === "upsert" ? update.agent.updatedAt : this.now();
    this.applyAgentUpdate(this.agents, update);
    const after = this.workspaces({ agents: this.agents, statusChangedAt });
    const changes: WorkspaceUpdate[] = [];
    for (const [id, workspace] of after) {
      if (JSON.stringify(before.get(id)) !== JSON.stringify(workspace))
        changes.push({ type: "workspace_update", payload: { kind: "upsert", workspace } });
    }
    for (const id of before.keys())
      if (!after.has(id)) {
        this.statusEntryByWorkspaceId.delete(id);
        changes.push({ type: "workspace_update", payload: { kind: "remove", id } });
      }
    this.snapshot?.sentDeltas.push(...changes);
    return changes;
  }

  /** Applies a live Agent update with the placement from either directory generation */
  private applyAgentUpdate(agents: Map<string, AgentEntry>, update: AgentUpdate): void {
    if (update.kind === "remove") {
      agents.delete(update.agentId);
      return;
    }
    const project =
      update.project ??
      agents.get(update.agent.id)?.project ??
      this.agents.get(update.agent.id)?.project;
    if (update.agent.archivedAt) agents.delete(update.agent.id);
    else if (project) agents.set(update.agent.id, { agent: update.agent, project });
  }

  /** Rebuilds legacy workspace projections and preserves bucket entry times */
  private workspaces(input: LegacyWorkspaceProjection): Map<string, Workspace> {
    const { agents, statusChangedAt, persistHistory = true } = input;
    const workspaces = new Map<string, Workspace>();
    for (const entry of agents.values()) {
      const { agent, project } = entry;
      const { checkout } = project;
      const id = workspaceId(entry);
      const status = workspaceStatus(entry, agents);
      if (!status) continue;
      const existing = workspaces.get(id);
      if (
        existing &&
        getWorkspaceStateBucketPriority(existing.status) <= getWorkspaceStateBucketPriority(status)
      )
        continue;
      workspaces.set(id, {
        id,
        projectId: project.projectKey,
        projectDisplayName: project.projectName,
        projectCustomName: null,
        projectRootPath: checkout.mainRepoRoot ?? checkout.worktreeRoot ?? checkout.cwd,
        workspaceDirectory: checkout.cwd,
        projectKind: checkout.isGit ? "git" : "non_git",
        workspaceKind: workspaceKind(checkout),
        name: workspaceName(entry, id),
        title: null,
        status,
        statusEnteredAt: agent.attentionTimestamp ?? agent.updatedAt,
        activityAt: agent.updatedAt,
        archivingAt: null,
        diffStat: null,
        scripts: [],
        gitRuntime: gitRuntime(checkout),
        githubRuntime: null,
        project,
      });
    }
    for (const [id, workspace] of workspaces) {
      const previous = this.statusEntryByWorkspaceId.get(id);
      if (previous?.status === workspace.status) {
        workspace.statusEnteredAt = previous.statusEnteredAt;
      } else if (previous && statusChangedAt) {
        workspace.statusEnteredAt = statusChangedAt;
      }
      if (persistHistory) {
        this.statusEntryByWorkspaceId.set(id, {
          status: workspace.status,
          statusEnteredAt: workspace.statusEnteredAt,
        });
      }
    }
    return workspaces;
  }
}

/** Limits same-workspace child Agents to active work in the Workspace bucket */
function workspaceStatus(
  entry: AgentEntry,
  agents: ReadonlyMap<string, AgentEntry>,
): Workspace["status"] | null {
  const { agent } = entry;
  const parentId = getParentAgentIdFromLabels(agent.labels);
  const parent = parentId ? agents.get(parentId) : undefined;
  const isRoot = !parentId || (parent !== undefined && workspaceId(parent) !== workspaceId(entry));
  if (!isRoot) return agent.status === "running" || agent.activeTurn ? "running" : null;
  return deriveAgentStateBucket({
    status: agent.activeTurn ? "running" : agent.status,
    pendingPermissionCount: agent.pendingPermissions.length,
    requiresAttention: agent.requiresAttention,
    attentionReason: agent.attentionReason,
  });
}

function workspaceId(entry: AgentEntry): string {
  return entry.agent.workspaceId ?? legacyWorkspaceId(entry.project.checkout.cwd);
}

function workspaceKind(checkout: AgentEntry["project"]["checkout"]): Workspace["workspaceKind"] {
  if (!checkout.isGit) return "directory";
  if (checkout.isPaseoOwnedWorktree) return "worktree";
  return "checkout";
}

function workspaceName(entry: AgentEntry, id: string): string {
  const name = entry.project.workspaceName?.trim();
  if (name) return name;
  const branch = entry.project.checkout.currentBranch?.trim();
  if (branch && branch !== "HEAD") return branch;
  return id.slice(id.lastIndexOf("/") + 1);
}

function gitRuntime(checkout: AgentEntry["project"]["checkout"]): Workspace["gitRuntime"] {
  if (!checkout.isGit) return null;
  return {
    currentBranch: checkout.currentBranch,
    remoteUrl: checkout.remoteUrl,
    isPaseoOwnedWorktree: checkout.isPaseoOwnedWorktree,
    isDirty: null,
    aheadBehind: null,
    aheadOfOrigin: null,
    behindOfOrigin: null,
  };
}
