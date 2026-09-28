interface LegacyAgentInput {
  id: string;
  cwd: string;
  status?: "idle" | "running" | "closed";
  updatedAt?: string;
  projectRoot?: string;
  parentAgentId?: string;
}

/** Builds a legacy Agent directory entry with an optional parent relationship */
export function legacyAgent(input: LegacyAgentInput) {
  const updatedAt = input.updatedAt ?? "2026-06-18T10:00:00.000Z";
  return {
    agent: {
      id: input.id,
      provider: "mock",
      cwd: input.cwd,
      model: null,
      createdAt: updatedAt,
      updatedAt,
      lastUserMessageAt: null,
      status: input.status ?? "idle",
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
      },
      currentModeId: null,
      availableModes: [],
      pendingPermissions: [],
      persistence: null,
      title: null,
      labels: input.parentAgentId ? { "paseo.parent-agent-id": input.parentAgentId } : {},
    },
    project: {
      projectKey: "/repo",
      projectName: "repo",
      workspaceName: "app",
      checkout: {
        cwd: input.cwd,
        isGit: true,
        currentBranch: "main",
        remoteUrl: "git@example.com:repo/app.git",
        worktreeRoot: input.cwd,
        isPaseoOwnedWorktree: false,
        mainRepoRoot: input.projectRoot ?? "/repo",
      },
    },
  };
}
