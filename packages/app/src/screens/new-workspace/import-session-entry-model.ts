export class ImportedSessionWorkspaceMissingError extends Error {
  readonly agentId: string;

  constructor(agentId: string) {
    super("Imported agent is missing a workspace ID");
    this.name = "ImportedSessionWorkspaceMissingError";
    this.agentId = agentId;
  }
}

export function buildImportedSessionWorkspaceNavigation(input: {
  serverId: string;
  agent: { id: string; workspaceId?: string };
}) {
  if (!input.agent.workspaceId) {
    throw new ImportedSessionWorkspaceMissingError(input.agent.id);
  }
  return {
    serverId: input.serverId,
    workspaceId: input.agent.workspaceId,
    target: { kind: "agent" as const, agentId: input.agent.id },
  };
}

export function isNewWorkspaceImportSessionDisabled(input: {
  blocked: boolean;
  hasClient: boolean;
  cwd: string | null;
}): boolean {
  return input.blocked || !input.hasClient || !input.cwd;
}
