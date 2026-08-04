import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import { expect, test } from "vitest";

import type { StoredAgentRecord } from "./agent/agent-storage.js";
import { selectWorkspaceDefaultAgentId } from "./workspace-default-agent.js";

function storedAgent(id: string, overrides: Partial<StoredAgentRecord> = {}): StoredAgentRecord {
  return {
    id,
    provider: "codex",
    cwd: "/repo",
    workspaceId: "ws-1",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    labels: {},
    lastStatus: "closed",
    config: null,
    persistence: null,
    archivedAt: null,
    ...overrides,
  };
}

test("selectWorkspaceDefaultAgentId picks the earliest eligible root deterministically", () => {
  const agents = [
    storedAgent("root-z", { createdAt: "2026-03-02T00:00:00.000Z" }),
    storedAgent("root-b"),
    storedAgent("root-a"),
    storedAgent("archived", { archivedAt: "2026-03-03T00:00:00.000Z" }),
    storedAgent("internal", { internal: true }),
    storedAgent("delegated", {
      labels: { [PARENT_AGENT_ID_LABEL]: "parent-agent" },
    }),
    storedAgent("other-workspace", { workspaceId: "ws-2" }),
  ];

  expect(selectWorkspaceDefaultAgentId("ws-1", agents)).toBe("root-a");
  expect(selectWorkspaceDefaultAgentId("missing", agents)).toBeNull();
});
