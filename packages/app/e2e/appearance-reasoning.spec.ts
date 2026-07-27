import { test, expect, type Page } from "./fixtures";
import { openSettings } from "./helpers/app";
import { expectComposerVisible } from "./helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "./helpers/mock-agent";
import {
  clickSettingsBackToWorkspace,
  expectSettingsHeader,
  openSettingsSection,
} from "./helpers/settings";

const REASONING_TEXT =
  "Need to find the scroll container, the layout effect that watches for new messages, and any gesture handler that might fight with programmatic scrolling. Probably a ref on the FlatList plus a near-bottom threshold.";

function thinkingButton(page: Page) {
  return page
    .getByTestId("tool-call-badge")
    .filter({ hasText: "Thinking" })
    .first()
    .getByRole("button");
}

function reasoningDetails(page: Page) {
  return page.getByText(REASONING_TEXT, { exact: true }).first();
}

async function toggleAutoExpandReasoning(page: Page, enabled: boolean): Promise<void> {
  await openSettings(page);
  await openSettingsSection(page, "appearance");
  await expectSettingsHeader(page, "Appearance");

  const toggle = page.getByRole("switch");
  await expect(toggle).toHaveCount(1);
  await toggle.click();
  if (enabled) {
    await expect(toggle).toBeChecked();
  } else {
    await expect(toggle).not.toBeChecked();
  }

  await clickSettingsBackToWorkspace(page);
  await expectComposerVisible(page);
}

test("applies reasoning auto-expand changes to existing blocks without locking manual state", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "appearance-reasoning-",
    title: "Appearance reasoning",
    model: "ten-second-stream",
    initialPrompt: "Verify reasoning expansion settings.",
  });

  try {
    await agent.client.waitForFinish(agent.agentId, 30_000);
    await openAgentRoute(page, agent);
    await expectComposerVisible(page);

    const reasoning = thinkingButton(page);
    await expect(reasoning).toBeVisible({ timeout: 30_000 });
    await expect(reasoningDetails(page)).toHaveCount(0);

    await toggleAutoExpandReasoning(page, true);
    await expect(reasoningDetails(page)).toBeVisible();

    await toggleAutoExpandReasoning(page, false);
    await expect(reasoningDetails(page)).toHaveCount(0);

    await toggleAutoExpandReasoning(page, true);
    await expect(reasoningDetails(page)).toBeVisible();

    await reasoning.click();
    await expect(reasoningDetails(page)).toHaveCount(0);
  } finally {
    await agent.cleanup();
  }
});
