import type { HostRuntimeSnapshot } from "@/runtime/host-runtime";
import type { SessionState } from "@/stores/session-store";

interface IsCurrentAgentDirectoryInput {
  /** Snapshot published by the Host runtime */
  snapshot: HostRuntimeSnapshot | null;
  /** Session bound to the current daemon client */
  session: Pick<SessionState, "client" | "clientGeneration"> | null | undefined;
}

/** Requires a complete directory from the online connection and its matching Session */
export function isCurrentAgentDirectory(input: IsCurrentAgentDirectoryInput): boolean {
  const { snapshot, session } = input;
  const source = snapshot?.agentDirectorySource;
  return Boolean(
    snapshot &&
    session &&
    snapshot.connectionStatus === "online" &&
    snapshot.client !== null &&
    snapshot.agentDirectoryStatus === "ready" &&
    source &&
    source.clientGeneration === snapshot.clientGeneration &&
    source.connectionEpoch === snapshot.connectionEpoch &&
    session.client !== null &&
    session.client === snapshot.client &&
    session.clientGeneration === snapshot.clientGeneration,
  );
}
