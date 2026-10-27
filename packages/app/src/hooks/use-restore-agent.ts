import { useMutation, useMutationState, type MutationState } from "@tanstack/react-query";
import { createSetAgentInitializing, refreshAgent } from "./use-agent-initialization";
import { useSessionStore } from "@/stores/session-store";
import { getHostRuntimeStore } from "@/runtime/host-runtime";

/** Restore actions from History and the archived footer share one observable lifetime */
const RESTORE_AGENT_MUTATION_KEY = ["restore-agent"] as const;

interface RestoreAgentInput {
  /** Registered host owning the agent */
  serverId: string;
  /** Durable agent identity retained by the restored tab */
  agentId: string;
}

/** The footer observes the latest user action independently of the initiating component */
export type AgentRestoreState = Pick<MutationState, "status" | "error">;

/** Keep the action pending until both runtime restoration and authoritative catch-up settle */
export function useRestoreAgent() {
  return useMutation({
    mutationKey: RESTORE_AGENT_MUTATION_KEY,
    mutationFn: (input: RestoreAgentInput) => {
      /** Connection ownership remains with the host session */
      const state = useSessionStore.getState();
      /** The runtime supplies the existing atomic timeline application path */
      const runtime = getHostRuntimeStore();
      return refreshAgent({
        ...input,
        client: state.sessions[input.serverId]?.client ?? null,
        runtime,
        setAgentInitializing: createSetAgentInitializing(
          input.serverId,
          state.setInitializingAgents,
        ),
      });
    },
  });
}

/** Read restoration progress and retryable failure for exactly one host and agent */
export function useAgentRestoreState(
  serverId: string,
  agentId: string,
): AgentRestoreState | undefined {
  /** The mutation key owns the input type used by this predicate */
  const states = useMutationState({
    filters: {
      mutationKey: RESTORE_AGENT_MUTATION_KEY,
      predicate: (mutation) => {
        /** Restore inputs are written only by useRestoreAgent */
        const input = mutation.state.variables as RestoreAgentInput | undefined;
        return input?.serverId === serverId && input.agentId === agentId;
      },
    },
    select: (mutation): AgentRestoreState => ({
      status: mutation.state.status,
      error: mutation.state.error,
    }),
  });
  return states.at(-1);
}
