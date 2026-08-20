import { describe, expect, test } from "vitest";
import type { WSOutboundMessage } from "../messages.js";
import { classifyOutboundMessage } from "./outbound-traffic.js";

/** Builds the smallest typed WebSocket envelope needed by the classifier seam. */
function sessionMessage(message: Record<string, unknown>): WSOutboundMessage {
  return { type: "session", message } as WSOutboundMessage;
}

describe("classifyOutboundMessage", () => {
  test("classifies authoritative catch-up responses as state-sync", () => {
    expect(
      [
        "fetch_agent_timeline_response",
        "fetch_agents_response",
        "fetch_agent_history_response",
        "fetch_workspaces_response",
        "get_providers_snapshot_response",
        "providers_snapshot_update",
      ].map((type) => classifyOutboundMessage(sessionMessage({ type }))),
    ).toEqual(Array.from({ length: 6 }, () => ({ trafficClass: "state-sync" })));
  });

  test("classifies only completed live tool calls as bulk-live candidates", () => {
    expect(
      classifyOutboundMessage(
        sessionMessage({
          type: "agent_stream",
          payload: {
            event: {
              type: "timeline",
              item: { type: "tool_call", status: "completed" },
            },
          },
        }),
      ),
    ).toEqual({ trafficClass: "bulk-live", compressible: true });

    expect(
      ["running", "failed", "canceled"].map((status) =>
        classifyOutboundMessage(
          sessionMessage({
            type: "agent_stream",
            payload: {
              event: {
                type: "timeline",
                item: { type: "tool_call", status },
              },
            },
          }),
        ),
      ),
    ).toEqual(Array.from({ length: 3 }, () => ({ trafficClass: "realtime" })));
  });

  test("keeps incremental, control, and unknown messages realtime", () => {
    expect(
      classifyOutboundMessage(
        sessionMessage({
          type: "agent_stream",
          payload: {
            event: {
              type: "timeline",
              item: { type: "assistant_message", text: "incremental" },
            },
          },
        }),
      ),
    ).toEqual({ trafficClass: "realtime" });
    expect(classifyOutboundMessage(sessionMessage({ type: "future_message" }))).toEqual({
      trafficClass: "realtime",
    });
    expect(classifyOutboundMessage({ type: "pong" } as WSOutboundMessage)).toEqual({
      trafficClass: "realtime",
    });
  });
});
