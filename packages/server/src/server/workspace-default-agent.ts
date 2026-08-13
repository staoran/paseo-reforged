import { getParentAgentIdFromLabels } from "@getpaseo/protocol/agent-labels";

import type { StoredAgentRecord } from "./agent/agent-storage.js";
import type { WorkspaceRegistry } from "./workspace-registry.js";

export type WorkspaceDefaultAgentCandidate = Pick<
  StoredAgentRecord,
  "id" | "workspaceId" | "archivedAt" | "internal" | "labels" | "createdAt"
>;

function isEligibleWorkspaceDefaultAgent(
  workspaceId: string,
  agent: WorkspaceDefaultAgentCandidate,
): boolean {
  return (
    agent.workspaceId === workspaceId &&
    !agent.archivedAt &&
    !agent.internal &&
    getParentAgentIdFromLabels(agent.labels) === null
  );
}

export function selectWorkspaceDefaultAgentId(
  workspaceId: string,
  agents: Iterable<WorkspaceDefaultAgentCandidate>,
): string | null {
  const eligible = Array.from(agents).filter((agent) =>
    isEligibleWorkspaceDefaultAgent(workspaceId, agent),
  );
  eligible.sort(
    (left, right) =>
      Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id),
  );
  return eligible[0]?.id ?? null;
}

export async function setWorkspaceDefaultAgentIfAbsent(options: {
  workspaceRegistry: WorkspaceRegistry;
  workspaceId: string;
  agent: WorkspaceDefaultAgentCandidate;
}): Promise<string | null> {
  if (!isEligibleWorkspaceDefaultAgent(options.workspaceId, options.agent)) {
    return null;
  }

  const workspace = await options.workspaceRegistry.update(options.workspaceId, (current) =>
    current.defaultAgentId === null ? { ...current, defaultAgentId: options.agent.id } : current,
  );
  return workspace?.defaultAgentId ?? null;
}
