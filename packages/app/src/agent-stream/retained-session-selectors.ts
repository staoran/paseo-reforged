import {
  getActiveMessageSubmissions,
  type PendingMessageSubmission,
} from "@/composer/submission/model";
import { selectAgentTurnPresentation, type useSessionStore } from "@/stores/session-store";
import type { ViewedTimelineUiBridge } from "@/timeline/viewed-timeline-sync";
import type { AgentTimelineProjectionLane } from "@/timeline/projection-lane";
import type { TurnPresentation } from "@/timeline/turn-liveness";
import type { PendingPermission } from "@/types/shared";
import type { StreamItem } from "@/types/stream";

type SessionStoreSnapshot = ReturnType<typeof useSessionStore.getState>;

export type RetainedAgentPresentationFeature =
  | "agentForkContextCursor"
  | "agentTimelinePromptIndex"
  | "inPlaceEditLastUserMessage";

export const INACTIVE_AGENT_STREAM_ITEMS: StreamItem[] = [];
export const INACTIVE_AGENT_MESSAGE_SUBMISSIONS: readonly PendingMessageSubmission[] = [];
export const INACTIVE_AGENT_PENDING_PERMISSION_LIST: PendingPermission[] = [];
export const INACTIVE_AGENT_TURN_PRESENTATION: TurnPresentation = {
  isActive: false,
  isCancelling: false,
  startedAt: null,
  turnId: null,
};

export function selectRetainedAgentStreamTail(
  state: SessionStoreSnapshot,
  active: boolean,
  serverId: string,
  agentId: string | undefined,
): StreamItem[] {
  if (!active || !agentId) return INACTIVE_AGENT_STREAM_ITEMS;
  return state.sessions[serverId]?.agentStreamTail.get(agentId) ?? INACTIVE_AGENT_STREAM_ITEMS;
}

export function selectRetainedAgentStreamHead(
  state: SessionStoreSnapshot,
  active: boolean,
  readSessionHead: boolean,
  serverId: string,
  agentId: string,
): StreamItem[] {
  if (!active || !readSessionHead) return INACTIVE_AGENT_STREAM_ITEMS;
  return state.sessions[serverId]?.agentStreamHead.get(agentId) ?? INACTIVE_AGENT_STREAM_ITEMS;
}

export function selectRetainedAgentProjectionLane(
  state: SessionStoreSnapshot,
  active: boolean,
  serverId: string,
  agentId: string | undefined,
): AgentTimelineProjectionLane | null {
  if (!active || !agentId) return null;
  return state.sessions[serverId]?.agentTimelineProjectionLanes.get(agentId) ?? null;
}

export function selectRetainedAgentMessageSubmissions(
  state: SessionStoreSnapshot,
  active: boolean,
  serverId: string,
  agentId: string | undefined,
): readonly PendingMessageSubmission[] {
  if (!active || !agentId) return INACTIVE_AGENT_MESSAGE_SUBMISSIONS;
  return getActiveMessageSubmissions(state.sessions[serverId]?.messageSubmissions.get(agentId));
}

export function selectRetainedAgentTurnPresentation(
  state: SessionStoreSnapshot,
  active: boolean,
  serverId: string,
  agentId: string | undefined,
): TurnPresentation {
  if (!active || !agentId) return INACTIVE_AGENT_TURN_PRESENTATION;
  return selectAgentTurnPresentation(state.sessions[serverId], agentId);
}

export function selectRetainedAgentPendingPermissions(
  state: SessionStoreSnapshot,
  active: boolean,
  serverId: string,
  agentId: string | undefined,
): PendingPermission[] {
  if (!active || !agentId) return INACTIVE_AGENT_PENDING_PERMISSION_LIST;
  const allPendingPermissions = state.sessions[serverId]?.pendingPermissions;
  if (!allPendingPermissions) return INACTIVE_AGENT_PENDING_PERMISSION_LIST;

  const filtered: PendingPermission[] = [];
  for (const permission of allPendingPermissions.values()) {
    if (permission.agentId === agentId) filtered.push(permission);
  }
  return filtered.length > 0 ? filtered : INACTIVE_AGENT_PENDING_PERMISSION_LIST;
}

export function selectRetainedViewedTimelineSync(
  state: SessionStoreSnapshot,
  active: boolean,
  serverId: string,
): ViewedTimelineUiBridge | null {
  return active ? (state.sessions[serverId]?.viewedTimelineSync ?? null) : null;
}

export function selectRetainedAgentPresentationFeature(
  state: SessionStoreSnapshot,
  active: boolean,
  serverId: string,
  feature: RetainedAgentPresentationFeature,
): boolean {
  return active && state.sessions[serverId]?.serverInfo?.features?.[feature] === true;
}

export function selectRetainedAgentTimelineEpoch(
  state: SessionStoreSnapshot,
  active: boolean,
  serverId: string,
  agentId: string,
): string | null {
  return active
    ? (state.sessions[serverId]?.agentTimelineCursor.get(agentId)?.epoch ?? null)
    : null;
}

export function selectRetainedAgentTimelineDetached(
  state: SessionStoreSnapshot,
  active: boolean,
  serverId: string,
  agentId: string,
): boolean {
  return active && state.sessions[serverId]?.agentTimelineHasNewer.get(agentId) === true;
}
