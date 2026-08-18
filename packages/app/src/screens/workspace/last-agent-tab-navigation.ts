import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";
import { createSidebarWorkspaceEntry } from "@/hooks/sidebar-workspaces-view-model";
import type { WorkspaceAgentActivity } from "@/utils/workspace-agent-activity";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";

/** Lower tiers are selected first after an Agent workspace becomes empty. */
const LAST_AGENT_TAB_STATUS_TIER = {
  needs_input: 0,
  failed: 0,
  attention: 0,
  done: 1,
  running: 2,
} as const satisfies Record<WorkspaceDescriptor["status"], number>;

/** Comparable candidate with deterministic ordering metadata. */
interface RankedLastAgentTabNavigationTarget {
  /** Public navigation target returned to the caller. */
  target: LastAgentTabNavigationTarget;
  /** User-approved status tier. */
  statusTier: number;
  /** Status transition timestamp, with unknown timestamps sorted last. */
  statusEnteredAtMs: number;
  /** Stable final tie-breaker across hosts and workspaces. */
  workspaceKey: string;
}

/** Session data required to select the workspace opened after the last Agent tab closes. */
export interface LastAgentTabNavigationSession {
  /** Unarchived Agent records indexed by Agent ID. */
  agents: ReadonlyMap<string, Pick<Agent, "workspaceId" | "archivedAt">>;
  /** Active workspace descriptors indexed by host-local workspace ID. */
  workspaces: ReadonlyMap<string, WorkspaceDescriptor>;
  /** Client-side root Agent activity used by the sidebar's effective status projection. */
  workspaceAgentActivity: ReadonlyMap<string, WorkspaceAgentActivity>;
  /** Resident Agent counts used to exclude workspaces without active runtimes. */
  workspaceResidentAgentCounts: ReadonlyMap<string, number>;
}

/** Stable destination for the workspace navigation action. */
export interface LastAgentTabNavigationTarget {
  /** Host that owns the selected workspace. */
  serverId: string;
  /** Host-local workspace identity. */
  workspaceId: string;
  /** Persisted default Agent opened with the selected workspace. */
  agentId: string;
}

/** Inputs captured immediately after the current workspace layout becomes empty. */
export interface SelectLastAgentTabNavigationTargetInput {
  /** Available host sessions at close commit time. */
  sessions: Readonly<Record<string, LastAgentTabNavigationSession | undefined>>;
  /** Host whose workspace was just emptied. */
  currentServerId: string;
  /** Workspace that must not be selected again. */
  currentWorkspaceId: string;
}

/** Normalizes path-backed and opaque workspace identities for equality checks. */
function normalizeComparableWorkspaceId(workspaceId: string): string {
  return normalizeWorkspaceOpaqueId(workspaceId) ?? workspaceId;
}

/** Converts a possibly missing or invalid status timestamp into a sortable value. */
function getStatusEnteredAtMs(statusEnteredAt: Date | null): number {
  const timestamp = statusEnteredAt?.getTime();
  return timestamp !== undefined && Number.isFinite(timestamp)
    ? timestamp
    : Number.NEGATIVE_INFINITY;
}

/** Reports whether a candidate should replace the current best target. */
function isPreferredCandidate(
  candidate: RankedLastAgentTabNavigationTarget,
  current: RankedLastAgentTabNavigationTarget | null,
): boolean {
  if (!current) return true;
  if (candidate.statusTier !== current.statusTier) {
    return candidate.statusTier < current.statusTier;
  }
  if (candidate.statusEnteredAtMs !== current.statusEnteredAtMs) {
    return candidate.statusEnteredAtMs > current.statusEnteredAtMs;
  }
  return candidate.workspaceKey.localeCompare(current.workspaceKey) < 0;
}

/** Selects the next Agent workspace after the current workspace loses its last tab. */
export function selectLastAgentTabNavigationTarget(
  input: SelectLastAgentTabNavigationTargetInput,
): LastAgentTabNavigationTarget | null {
  const currentWorkspaceId = normalizeComparableWorkspaceId(input.currentWorkspaceId);
  let selected: RankedLastAgentTabNavigationTarget | null = null;

  for (const [serverId, session] of Object.entries(input.sessions)) {
    if (!session) continue;

    for (const workspace of session.workspaces.values()) {
      if (
        serverId === input.currentServerId &&
        normalizeComparableWorkspaceId(workspace.id) === currentWorkspaceId
      ) {
        continue;
      }

      const entry = createSidebarWorkspaceEntry({
        serverId,
        workspace,
        workspaceAgents: session.agents,
        workspaceAgentActivity: session.workspaceAgentActivity,
        workspaceResidentAgentCounts: session.workspaceResidentAgentCounts,
      });
      if (entry.archivingAt !== null || !entry.defaultAgentId || entry.residentAgentCount <= 0) {
        continue;
      }

      const candidate: RankedLastAgentTabNavigationTarget = {
        target: {
          serverId,
          workspaceId: entry.workspaceId,
          agentId: entry.defaultAgentId,
        },
        statusTier: LAST_AGENT_TAB_STATUS_TIER[entry.statusBucket],
        statusEnteredAtMs: getStatusEnteredAtMs(entry.statusEnteredAt),
        workspaceKey: entry.workspaceKey,
      };
      if (isPreferredCandidate(candidate, selected)) {
        selected = candidate;
      }
    }
  }

  return selected?.target ?? null;
}
