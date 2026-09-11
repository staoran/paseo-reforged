import { expect, test } from "../support/fixtures";
import {
  openAgentRoute,
  seedMockAgentWorkspace,
  type MockAgentWorkspace,
} from "../support/helpers/mock-agent";
import {
  waitForWorkspaceInReplicaCache,
  waitForWorkspaceToLeaveReplicaCache,
} from "../support/helpers/replica-cache-storage";

async function archiveWorkspaceOutsideTheApp(workspace: MockAgentWorkspace): Promise<void> {
  const result = await workspace.client.archiveWorkspace(workspace.workspaceId);
  expect(result.error).toBeNull();
}

test.describe("Workspace archive cache coherence", () => {
  test("an archived selected workspace cannot return from the durable cache", async ({ page }) => {
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "archive-cache-",
      title: "Archived cache workspace",
    });

    try {
      await openAgentRoute(page, workspace);
      await waitForWorkspaceInReplicaCache(page, workspace.workspaceId);

      await archiveWorkspaceOutsideTheApp(workspace);

      await waitForWorkspaceToLeaveReplicaCache(page, workspace.workspaceId);
    } finally {
      await workspace.cleanup();
    }
  });
});
