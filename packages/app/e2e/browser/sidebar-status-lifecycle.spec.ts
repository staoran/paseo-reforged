import { test, expect, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { getServerId } from "../support/helpers/server-id";
import { selectSidebarStatusGrouping } from "../support/helpers/sidebar";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";

type StatusBucket = "attention" | "running" | "done";

interface StatusLifecycleClient {
  /** Reads the authoritative lifecycle and attention state from the daemon. */
  fetchAgent(options: {
    agentId: string;
  }): Promise<{ agent: { status: string; requiresAttention: boolean } } | null>;

  /** Releases the provider runtime while retaining the durable agent record. */
  closeAgentRuntime(agentId: string): Promise<{ closed: boolean }>;
}

/** Locates one workspace row inside its expected status group. */
function workspaceRowInBucket(page: Page, bucket: StatusBucket, workspaceId: string) {
  return page
    .getByTestId(`sidebar-status-group-rows-${bucket}`)
    .getByTestId(`sidebar-workspace-row-${getServerId()}:${workspaceId}`);
}

/** Waits for a workspace to settle into one authoritative sidebar bucket. */
async function expectWorkspaceBucket(
  page: Page,
  bucket: StatusBucket,
  workspaceId: string,
): Promise<void> {
  await expect(workspaceRowInBucket(page, bucket, workspaceId)).toBeVisible({ timeout: 30_000 });
}

test("an idle session stays ready after reading and becomes done only after runtime close", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "sidebar-status-lifecycle-",
    title: "Status lifecycle",
    model: "ten-second-stream",
    initialPrompt: "emit 1 coalesced agent stream updates",
  });
  const lifecycleClient = agent.client as unknown as StatusLifecycleClient;

  try {
    const firstFinish = await agent.client.waitForFinish(agent.agentId, 15_000);
    expect(firstFinish.status).toBe("idle");

    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await selectSidebarStatusGrouping(page);
    await expectWorkspaceBucket(page, "attention", agent.workspaceId);

    await openAgentRoute(page, agent);
    await expect
      .poll(
        async () =>
          (await lifecycleClient.fetchAgent({ agentId: agent.agentId }))?.agent.requiresAttention,
        { timeout: 30_000 },
      )
      .toBe(false);
    await expectWorkspaceBucket(page, "attention", agent.workspaceId);

    await agent.client.sendAgentMessage(
      agent.agentId,
      "Keep working for the status lifecycle test.",
    );
    await agent.client.waitForAgentUpsert(
      agent.agentId,
      (snapshot) => snapshot.status === "running",
      15_000,
    );
    await expectWorkspaceBucket(page, "running", agent.workspaceId);

    const secondFinish = await agent.client.waitForFinish(agent.agentId, 30_000);
    expect(secondFinish.status).toBe("idle");
    const composer = page
      .locator("textarea[data-composer-input]")
      .filter({ visible: true })
      .first();
    await expect(composer).toBeVisible({ timeout: 30_000 });
    await composer.evaluate((element) => element.blur());
    await composer.focus();
    await expect
      .poll(
        async () =>
          (await lifecycleClient.fetchAgent({ agentId: agent.agentId }))?.agent.requiresAttention,
        { timeout: 30_000 },
      )
      .toBe(false);
    await expectWorkspaceBucket(page, "attention", agent.workspaceId);

    await expect(lifecycleClient.closeAgentRuntime(agent.agentId)).resolves.toMatchObject({
      closed: true,
    });
    await expectWorkspaceBucket(page, "done", agent.workspaceId);
  } finally {
    await agent.cleanup();
  }
});
