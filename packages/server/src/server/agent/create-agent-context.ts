import type { AgentAttachment, FirstAgentContext } from "../messages.js";

interface BuildCreateAgentFirstAgentContextInput {
  requestContext?: FirstAgentContext;
  initialPrompt?: string;
  attachments?: AgentAttachment[];
}

/** Merges legacy create-agent fields over the optional first-agent context */
export function buildCreateAgentFirstAgentContext(
  input: BuildCreateAgentFirstAgentContextInput,
): FirstAgentContext {
  const trimmedPrompt = input.initialPrompt?.trim();

  return {
    ...input.requestContext,
    ...(trimmedPrompt ? { prompt: trimmedPrompt } : {}),
    ...(input.attachments !== undefined ? { attachments: input.attachments } : {}),
  };
}
