// Node and emitted ESM run without a TypeScript path-alias resolver.
import type { SessionOutboundMessage, WSOutboundMessage } from "../messages.js";
import type { RelayTrafficHint } from "../relay-frame-compression.js";

/** Session response types whose payload represents authoritative catch-up state. */
const STATE_SYNC_MESSAGE_TYPES = new Set<SessionOutboundMessage["type"]>([
  "fetch_agent_timeline_response",
  "fetch_agents_response",
  "fetch_agent_history_response",
  "fetch_workspaces_response",
  "get_providers_snapshot_response",
  "providers_snapshot_update",
]);

/** Immutable fallback for latency-sensitive, control, and unknown traffic. */
const REALTIME_TRAFFIC_HINT = Object.freeze({
  trafficClass: "realtime",
} satisfies RelayTrafficHint);

/** Immutable hint for authoritative state catch-up responses. */
const STATE_SYNC_TRAFFIC_HINT = Object.freeze({
  trafficClass: "state-sync",
} satisfies RelayTrafficHint);

/** Immutable candidate hint reserved for completed live tool-call payloads. */
const BULK_LIVE_TRAFFIC_HINT = Object.freeze({
  trafficClass: "bulk-live",
  compressible: true,
} satisfies RelayTrafficHint);

/** Classifies one structured daemon outbound message before JSON serialization loses semantics. */
export function classifyOutboundMessage(message: WSOutboundMessage): RelayTrafficHint {
  if (message.type !== "session") return REALTIME_TRAFFIC_HINT;
  /** Typed session payload carried by the outer WebSocket envelope. */
  const sessionMessage = message.message;
  if (STATE_SYNC_MESSAGE_TYPES.has(sessionMessage.type)) return STATE_SYNC_TRAFFIC_HINT;
  /** Whether this event is a completed timeline tool call eligible for the bulk-live gate. */
  const isCompletedToolCallTimelineEvent =
    sessionMessage.type === "agent_stream" &&
    sessionMessage.payload.event.type === "timeline" &&
    sessionMessage.payload.event.item.type === "tool_call" &&
    sessionMessage.payload.event.item.status === "completed";
  if (isCompletedToolCallTimelineEvent) {
    return BULK_LIVE_TRAFFIC_HINT;
  }
  return REALTIME_TRAFFIC_HINT;
}
