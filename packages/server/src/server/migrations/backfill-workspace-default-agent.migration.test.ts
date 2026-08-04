import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

import { afterEach, beforeEach, expect, test } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentStorage, type StoredAgentRecord } from "../agent/agent-storage.js";
import {
  createPersistedWorkspaceRecord,
  FileBackedWorkspaceRegistry,
} from "../workspace-registry.js";
import { backfillWorkspaceDefaultAgentIds } from "./backfill-workspace-default-agent.migration.js";

function storedAgent(id: string, workspaceId: string, createdAt: string): StoredAgentRecord {
  return {
    id,
    provider: "codex",
    cwd: "/repo",
    workspaceId,
    createdAt,
    updatedAt: createdAt,
    labels: {},
    lastStatus: "closed",
    config: null,
    persistence: null,
    archivedAt: null,
  };
}

let tmpDir: string;
let agentStorage: AgentStorage;
let workspaceRegistry: FileBackedWorkspaceRegistry;
const logger = createTestLogger();

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "workspace-default-agent-backfill-"));
  agentStorage = new AgentStorage(path.join(tmpDir, "agents"), logger);
  workspaceRegistry = new FileBackedWorkspaceRegistry(
    path.join(tmpDir, "projects", "workspaces.json"),
    logger,
  );
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

test("backfill preserves a valid default and repairs only invalid references", async () => {
  const unchangedUpdatedAt = "2026-03-05T00:00:00.000Z";
  await workspaceRegistry.upsert(
    createPersistedWorkspaceRecord({
      workspaceId: "ws-valid",
      defaultAgentId: "root-newer",
      projectId: "proj",
      cwd: "/repo/valid",
      kind: "directory",
      displayName: "valid",
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: unchangedUpdatedAt,
    }),
  );
  await workspaceRegistry.upsert(
    createPersistedWorkspaceRecord({
      workspaceId: "ws-invalid",
      defaultAgentId: "missing-agent",
      projectId: "proj",
      cwd: "/repo/invalid",
      kind: "directory",
      displayName: "invalid",
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: unchangedUpdatedAt,
    }),
  );
  await agentStorage.upsert(storedAgent("root-older", "ws-valid", "2026-03-01T00:00:00.000Z"));
  await agentStorage.upsert(storedAgent("root-newer", "ws-valid", "2026-03-02T00:00:00.000Z"));
  await agentStorage.upsert(storedAgent("root-b", "ws-invalid", "2026-03-01T00:00:00.000Z"));
  await agentStorage.upsert(storedAgent("root-a", "ws-invalid", "2026-03-01T00:00:00.000Z"));

  await expect(
    backfillWorkspaceDefaultAgentIds({ agentStorage, workspaceRegistry, logger }),
  ).resolves.toBe(1);
  await expect(workspaceRegistry.get("ws-valid")).resolves.toMatchObject({
    defaultAgentId: "root-newer",
    updatedAt: unchangedUpdatedAt,
  });
  await expect(workspaceRegistry.get("ws-invalid")).resolves.toMatchObject({
    defaultAgentId: "root-a",
    updatedAt: unchangedUpdatedAt,
  });
});
