import { createNameId } from "mnemonic-id";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AgentAttachment, FirstAgentContext } from "@getpaseo/protocol/messages";

export type WorkspaceSetupCreationMethod = "create_worktree" | "open_project";

type WorkspaceSetupCreationClient = Pick<DaemonClient, "createPaseoWorktree" | "createWorkspace">;

/** Builds first-agent metadata shared by Workspace Setup creation requests */
export function buildWorkspaceSetupFirstAgentContext(input: {
  text: string;
  attachments: readonly AgentAttachment[];
  titleLanguage: NonNullable<FirstAgentContext["titleLanguage"]>;
}): FirstAgentContext | undefined {
  const prompt = input.text.trim();
  if (!prompt && input.attachments.length === 0) {
    return undefined;
  }

  return {
    ...(prompt ? { prompt } : {}),
    ...(input.attachments.length > 0 ? { attachments: [...input.attachments] } : {}),
    titleLanguage: input.titleLanguage,
  };
}

/** Creates a Workspace Setup workspace while preserving first-agent metadata */
export async function createWorkspaceForSetup(input: {
  creationMethod: WorkspaceSetupCreationMethod;
  client: WorkspaceSetupCreationClient;
  cwd: string;
  firstAgentContext?: FirstAgentContext;
}) {
  if (input.creationMethod === "create_worktree") {
    return input.client.createPaseoWorktree({
      cwd: input.cwd,
      worktreeSlug: createNameId(),
      ...(input.firstAgentContext ? { firstAgentContext: input.firstAgentContext } : {}),
    });
  }

  return input.client.createWorkspace({
    source: { kind: "directory", path: input.cwd },
    ...(input.firstAgentContext ? { firstAgentContext: input.firstAgentContext } : {}),
  });
}
