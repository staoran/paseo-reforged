import { createStore } from "zustand/vanilla";
import { subscribeWithSelector } from "zustand/middleware";
import { describe, expect, it, vi } from "vitest";
import type { StreamItem } from "@/types/stream";
import {
  INACTIVE_AGENT_MESSAGE_SUBMISSIONS,
  INACTIVE_AGENT_PENDING_PERMISSION_LIST,
  INACTIVE_AGENT_STREAM_ITEMS,
  INACTIVE_AGENT_TURN_PRESENTATION,
  selectRetainedAgentMessageSubmissions,
  selectRetainedAgentPendingPermissions,
  selectRetainedAgentPresentationFeature,
  selectRetainedAgentProjectionLane,
  selectRetainedAgentStreamHead,
  selectRetainedAgentStreamTail,
  selectRetainedAgentTimelineDetached,
  selectRetainedAgentTimelineEpoch,
  selectRetainedAgentTurnPresentation,
} from "./retained-session-selectors";

const SERVER_ID = "server";
const AGENT_ID = "agent";

type SessionStoreSnapshot = Parameters<typeof selectRetainedAgentStreamTail>[0];

function userMessage(id: string): StreamItem {
  return {
    kind: "user_message",
    id,
    text: id,
    timestamp: new Date("2026-08-09T00:00:00.000Z"),
  };
}

function createSnapshot(input: {
  tail: StreamItem[];
  head: StreamItem[];
  epoch: string;
  turnId: string;
  hasNewer: boolean;
  featureEnabled: boolean;
}): SessionStoreSnapshot {
  return {
    sessions: {
      [SERVER_ID]: {
        agentStreamTail: new Map([[AGENT_ID, input.tail]]),
        agentStreamHead: new Map([[AGENT_ID, input.head]]),
        agentTimelineProjectionLanes: new Map([[AGENT_ID, { epoch: input.epoch }]]),
        messageSubmissions: new Map(),
        pendingPermissions: new Map(),
        agentTurnLiveness: new Map([
          [
            AGENT_ID,
            {
              phase: "open",
              turnId: input.turnId,
              startedAt: new Date("2026-08-09T00:00:00.000Z"),
              cancellationRequestId: null,
            },
          ],
        ]),
        agentTimelineCursor: new Map([[AGENT_ID, { epoch: input.epoch, startSeq: 1, endSeq: 2 }]]),
        agentTimelineHasNewer: new Map([[AGENT_ID, input.hasNewer]]),
        serverInfo: {
          features: {
            agentForkContextCursor: input.featureEnabled,
          },
        },
      },
    },
  } as unknown as SessionStoreSnapshot;
}

describe("retained agent session selectors", () => {
  it("returns stable sentinels while inactive across authoritative updates", () => {
    const first = createSnapshot({
      tail: [userMessage("tail-1")],
      head: [userMessage("head-1")],
      epoch: "epoch-1",
      turnId: "turn-1",
      hasNewer: false,
      featureEnabled: false,
    });
    const second = createSnapshot({
      tail: [userMessage("tail-2")],
      head: [userMessage("head-2")],
      epoch: "epoch-2",
      turnId: "turn-2",
      hasNewer: true,
      featureEnabled: true,
    });
    const store = createStore<SessionStoreSnapshot>()(subscribeWithSelector(() => first));
    const tailListener = vi.fn();
    const unsubscribe = store.subscribe(
      (state) => selectRetainedAgentStreamTail(state, false, SERVER_ID, AGENT_ID),
      tailListener,
    );

    for (const state of [first, second]) {
      expect(selectRetainedAgentStreamTail(state, false, SERVER_ID, AGENT_ID)).toBe(
        INACTIVE_AGENT_STREAM_ITEMS,
      );
      expect(selectRetainedAgentStreamHead(state, false, true, SERVER_ID, AGENT_ID)).toBe(
        INACTIVE_AGENT_STREAM_ITEMS,
      );
      expect(selectRetainedAgentProjectionLane(state, false, SERVER_ID, AGENT_ID)).toBeNull();
      expect(selectRetainedAgentMessageSubmissions(state, false, SERVER_ID, AGENT_ID)).toBe(
        INACTIVE_AGENT_MESSAGE_SUBMISSIONS,
      );
      expect(selectRetainedAgentTurnPresentation(state, false, SERVER_ID, AGENT_ID)).toBe(
        INACTIVE_AGENT_TURN_PRESENTATION,
      );
      expect(selectRetainedAgentPendingPermissions(state, false, SERVER_ID, AGENT_ID)).toBe(
        INACTIVE_AGENT_PENDING_PERMISSION_LIST,
      );
      expect(selectRetainedAgentTimelineEpoch(state, false, SERVER_ID, AGENT_ID)).toBeNull();
      expect(selectRetainedAgentTimelineDetached(state, false, SERVER_ID, AGENT_ID)).toBe(false);
      expect(
        selectRetainedAgentPresentationFeature(state, false, SERVER_ID, "agentForkContextCursor"),
      ).toBe(false);
    }

    store.setState(second, true);
    expect(tailListener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("reads the newest authoritative values on reactivation", () => {
    const tail = [userMessage("tail-latest")];
    const head = [userMessage("head-latest")];
    const latest = createSnapshot({
      tail,
      head,
      epoch: "epoch-latest",
      turnId: "turn-latest",
      hasNewer: true,
      featureEnabled: true,
    });

    expect(selectRetainedAgentStreamTail(latest, true, SERVER_ID, AGENT_ID)).toBe(tail);
    expect(selectRetainedAgentStreamHead(latest, true, true, SERVER_ID, AGENT_ID)).toBe(head);
    expect(selectRetainedAgentProjectionLane(latest, true, SERVER_ID, AGENT_ID)).toBe(
      latest.sessions[SERVER_ID]?.agentTimelineProjectionLanes.get(AGENT_ID),
    );
    expect(selectRetainedAgentTimelineEpoch(latest, true, SERVER_ID, AGENT_ID)).toBe(
      "epoch-latest",
    );
    expect(selectRetainedAgentTimelineDetached(latest, true, SERVER_ID, AGENT_ID)).toBe(true);
    expect(
      selectRetainedAgentPresentationFeature(latest, true, SERVER_ID, "agentForkContextCursor"),
    ).toBe(true);
    expect(selectRetainedAgentTurnPresentation(latest, true, SERVER_ID, AGENT_ID)).toMatchObject({
      isActive: true,
      turnId: "turn-latest",
    });
  });
});
