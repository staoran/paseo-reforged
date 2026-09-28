import type { Agent } from "@/stores/session-store";

/** Agent state required to decide whether a runtime close can be requested */
type AgentRuntimeCloseCandidate = Pick<
  Agent,
  "archivedAt" | "status" | "turn" | "pendingPermissions"
>;

/** Identifies an unarchived Agent that can currently accept an idle-runtime close request */
export function canCloseIdleAgentRuntime(
  agent: AgentRuntimeCloseCandidate | null | undefined,
): boolean {
  return Boolean(
    agent &&
    !agent.archivedAt &&
    agent.status === "idle" &&
    agent.turn.phase !== "open" &&
    agent.pendingPermissions.length === 0,
  );
}

/** Allows tab cleanup to retry after the runtime has already closed */
export function canRequestAgentRuntimeClose(
  agent: AgentRuntimeCloseCandidate | null | undefined,
  keepRecord: boolean,
): boolean {
  return (
    canCloseIdleAgentRuntime(agent) ||
    Boolean(keepRecord && agent && !agent.archivedAt && agent.status === "closed")
  );
}
