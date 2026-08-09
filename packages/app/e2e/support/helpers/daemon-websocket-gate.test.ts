import { describe, expect, it } from "vitest";
import { upsertLatestHeldMessage } from "./daemon-websocket-gate";

describe("daemon WebSocket gate latest-message holds", () => {
  it("keeps only the latest snapshot for a held key", () => {
    const held = [
      { key: "agent-update:agent-1:running", revision: 1 },
      { key: "message:send_agent_message_response", revision: 1 },
    ];

    expect(
      upsertLatestHeldMessage(held, {
        key: "agent-update:agent-1:running",
        revision: 2,
      }),
    ).toBe(false);
    expect(
      upsertLatestHeldMessage(held, {
        key: "agent-update:agent-2:running",
        revision: 1,
      }),
    ).toBe(true);
    expect(held).toEqual([
      { key: "agent-update:agent-1:running", revision: 2 },
      { key: "message:send_agent_message_response", revision: 1 },
      { key: "agent-update:agent-2:running", revision: 1 },
    ]);
  });
});
