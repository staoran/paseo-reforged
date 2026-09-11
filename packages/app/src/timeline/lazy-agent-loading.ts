import type { Agent } from "@/stores/session-store";

export type LazyAgentTimelineState = Pick<Agent, "status" | "archivedAt">;

/** Decides whether an agent must remain on its locally cached timeline */
export function shouldDeferAgentTimelineSync(input: {
  lazyLoadAgents: boolean;
  hasAuthoritativeAgentDirectory: boolean;
  agent: LazyAgentTimelineState | null | undefined;
  hasLocalStartIntent: boolean;
  hasPassiveDeferral?: boolean;
}): boolean {
  if (!input.lazyLoadAgents || input.hasLocalStartIntent) {
    return false;
  }

  // Cached agent metadata is not authoritative until the directory has completed hydration
  if (!input.hasAuthoritativeAgentDirectory || !input.agent) {
    return true;
  }

  if (input.agent.archivedAt) {
    return false;
  }

  return input.hasPassiveDeferral === true || input.agent.status === "closed";
}

/** Keeps only visible agents that may request a remote timeline */
export function selectRemoteTimelineAgentIds(input: {
  visibleAgentIds: readonly string[];
  lazyLoadAgents: boolean;
  hasAuthoritativeAgentDirectory: boolean;
  agentsById: ReadonlyMap<string, LazyAgentTimelineState>;
  startIntentAgentIds: ReadonlySet<string>;
  deferredAgentIds: ReadonlySet<string>;
}): string[] {
  return input.visibleAgentIds.filter(
    (agentId) =>
      !shouldDeferAgentTimelineSync({
        lazyLoadAgents: input.lazyLoadAgents,
        hasAuthoritativeAgentDirectory: input.hasAuthoritativeAgentDirectory,
        agent: input.agentsById.get(agentId),
        hasLocalStartIntent: input.startIntentAgentIds.has(agentId),
        hasPassiveDeferral: input.deferredAgentIds.has(agentId),
      }),
  );
}
