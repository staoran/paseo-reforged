import type { AgentRuntimeClosePayload } from "@getpaseo/protocol/messages";
import { toErrorMessage } from "@/utils/error-messages";

export interface AgentRuntimeCloseClient {
  closeAgentRuntime(agentId: string): Promise<AgentRuntimeClosePayload>;
}

export type AgentRuntimeCloseOutcome =
  | { kind: "closed"; warning: string | null }
  | { kind: "unsupported" }
  | { kind: "client-unavailable" }
  | { kind: "failed"; error: string };

export interface CloseAgentRuntimeAndCommitInput {
  client: AgentRuntimeCloseClient | null;
  supported: boolean;
  agentId: string;
  commitClose: () => void | Promise<void>;
}

/** Closes the provider runtime before committing the local tab removal. */
export async function closeAgentRuntimeAndCommit(
  input: CloseAgentRuntimeAndCommitInput,
): Promise<AgentRuntimeCloseOutcome> {
  if (!input.supported) {
    return { kind: "unsupported" };
  }
  if (!input.client) {
    return { kind: "client-unavailable" };
  }

  let result: AgentRuntimeClosePayload;
  try {
    result = await input.client.closeAgentRuntime(input.agentId);
  } catch (error) {
    return { kind: "failed", error: toErrorMessage(error) };
  }
  if (!result.closed) {
    return { kind: "failed", error: result.error };
  }

  await input.commitClose();
  return { kind: "closed", warning: result.warning };
}
