// COMPAT(workspaceDefaultAgentBackfill): added in v0.2.5, remove after 2027-02-03.
import type { Logger } from "pino";

import type { AgentStorage } from "../agent/agent-storage.js";
import { selectWorkspaceDefaultAgentId } from "../workspace-default-agent.js";
import type { WorkspaceRegistry } from "../workspace-registry.js";

export async function backfillWorkspaceDefaultAgentIds(options: {
  agentStorage: AgentStorage;
  workspaceRegistry: WorkspaceRegistry;
  logger: Logger;
}): Promise<number> {
  const agents = await options.agentStorage.list();
  const workspaces = await options.workspaceRegistry.list();
  let migrated = 0;

  for (const workspace of workspaces) {
    const currentAgentId = workspace.defaultAgentId;
    const currentIsValid =
      currentAgentId !== null &&
      selectWorkspaceDefaultAgentId(
        workspace.workspaceId,
        agents.filter((agent) => agent.id === currentAgentId),
      ) === currentAgentId;
    if (currentIsValid) {
      continue;
    }

    const selectedAgentId = selectWorkspaceDefaultAgentId(workspace.workspaceId, agents);
    if (selectedAgentId === currentAgentId) {
      continue;
    }

    await options.workspaceRegistry.update(workspace.workspaceId, (current) => ({
      ...current,
      defaultAgentId: selectedAgentId,
    }));
    migrated += 1;
  }

  if (migrated > 0) {
    options.logger.info({ migrated }, "Backfilled workspace default agent IDs");
  }
  return migrated;
}
