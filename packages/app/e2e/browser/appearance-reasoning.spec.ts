import { test, expect, type Page } from "../support/fixtures";
import { openSettings } from "../support/helpers/app";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { observeTimelineSubscriptions } from "../support/helpers/timeline-delivery";
import {
  clickSettingsBackToWorkspace,
  expectSettingsHeader,
  openSettingsSection,
} from "../support/helpers/settings";

const REASONING_TEXT =
  "Need to find the scroll container, the layout effect that watches for new messages, and any gesture handler that might fight with programmatic scrolling. Probably a ref on the FlatList plus a near-bottom threshold.";

const STANDARD_FINAL_TEXT = "(end of synthetic stream)";
const CHUNKED_FINAL_TEXT = "Synthetic load test complete";
const ACTIVITY_SETTING = "Keep completed turns expanded";
const REASONING_SETTING = "Expand reasoning and tool details";

test.setTimeout(180_000);

function activityFold(page: Page) {
  return page.locator('[data-testid^="activity-fold-"]').first();
}

function reasoningDetails(page: Page) {
  return page.getByText(REASONING_TEXT, { exact: true }).first();
}

function commentaryDetails(page: Page) {
  return page.getByText(/Cycle \d+/).first();
}

function readTool(page: Page) {
  return page
    .getByTestId("tool-call-badge")
    .filter({ hasText: /conversation-list\.tsx|read/i })
    .first();
}

function toolBadge(page: Page, label: RegExp) {
  return page.getByTestId("tool-call-badge").filter({ hasText: label }).first();
}

function toolGroup(page: Page, label: RegExp) {
  return page.getByTestId("tool-call-group").filter({ hasText: label }).first();
}

function thinkingTool(page: Page) {
  return toolBadge(page, /Thinking/i);
}

async function setExpansionSettings(
  page: Page,
  settings: { activity: boolean; reasoning: boolean },
): Promise<void> {
  await openSettings(page);
  await openSettingsSection(page, "appearance");
  await expectSettingsHeader(page, "Appearance");

  const toggles = [
    { toggle: page.getByRole("switch", { name: ACTIVITY_SETTING }), enabled: settings.activity },
    {
      toggle: page.getByRole("switch", { name: REASONING_SETTING }),
      enabled: settings.reasoning,
    },
  ];
  for (const { toggle, enabled } of toggles) {
    await expect(toggle).toBeVisible();
    if ((await toggle.isChecked()) !== enabled) {
      await toggle.click();
    }
    if (enabled) {
      await expect(toggle).toBeChecked();
    } else {
      await expect(toggle).not.toBeChecked();
    }
  }

  await clickSettingsBackToWorkspace(page);
  await expectComposerVisible(page);
}

test("keeps activity, tool groups, and tool details independently expandable", async ({ page }) => {
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "appearance-reasoning-",
    title: "Appearance reasoning",
    model: "ten-second-stream",
  });

  try {
    await openAgentRoute(page, agent);
    await expectComposerVisible(page);
    await setExpansionSettings(page, { activity: true, reasoning: false });
    await agent.client.sendAgentMessage(agent.agentId, "Verify reasoning expansion settings.");
    await expect(page.getByRole("button", { name: /stop|cancel/i }).first()).toBeVisible({
      timeout: 30_000,
    });

    const fold = activityFold(page);
    await expect(fold).toBeVisible({ timeout: 30_000 });
    await expect(reasoningDetails(page)).toHaveCount(0);
    await expect(thinkingTool(page)).toBeVisible();
    await expect(commentaryDetails(page)).toBeVisible();
    await expect(toolGroup(page, /read/i)).toBeVisible();
    await expect(readTool(page)).toHaveCount(0);

    await agent.client.waitForFinish(agent.agentId, 30_000);
    await fold.click();
    await expect(fold).toContainText(/Worked for .*s/);
    await expect(fold).not.toContainText(/Thinking/i);
    await fold.click();
    await expect(reasoningDetails(page)).toHaveCount(0);
    await expect(thinkingTool(page)).toBeVisible();
    await expect(commentaryDetails(page)).toBeVisible();
    await expect(toolGroup(page, /read/i)).toBeVisible();
    await expect(toolGroup(page, /search/i)).toBeVisible();
    await expect(readTool(page)).toHaveCount(0);

    await thinkingTool(page).getByRole("button").click();
    await expect(reasoningDetails(page)).toBeVisible();
    await thinkingTool(page).getByRole("button").click();
    await expect(reasoningDetails(page)).toHaveCount(0);

    await expect(page.getByText(/export function ConversationList/)).toHaveCount(0);
    await toolGroup(page, /read/i).click();
    await expect(readTool(page)).toBeVisible();
    await readTool(page).getByRole("button").click();
    await expect(page.getByText(/export function ConversationList/)).toBeVisible();
    await readTool(page).getByRole("button").click();
    await expect(page.getByText(/export function ConversationList/)).toHaveCount(0);
    await expect(page.getByText(STANDARD_FINAL_TEXT, { exact: true })).toBeVisible();

    await fold.click();
    await expect(reasoningDetails(page)).toHaveCount(0);
    await expect(commentaryDetails(page)).toHaveCount(0);
    await expect(readTool(page)).toHaveCount(0);
    await expect(page.getByText(STANDARD_FINAL_TEXT, { exact: true })).toBeVisible();

    await page.reload();
    await expectComposerVisible(page);
    await expect(reasoningDetails(page)).toHaveCount(0);
    await expect(thinkingTool(page)).toBeVisible();
    await expect(toolGroup(page, /read/i)).toBeVisible();
    await expect(readTool(page)).toHaveCount(0);
    await expect(page.getByText(STANDARD_FINAL_TEXT, { exact: true })).toBeVisible();

    await setExpansionSettings(page, { activity: false, reasoning: true });
    await expect(reasoningDetails(page)).toHaveCount(0);

    await page.reload();
    await expectComposerVisible(page);
    await expect(reasoningDetails(page)).toHaveCount(0);
    await expect(page.getByText(STANDARD_FINAL_TEXT, { exact: true })).toBeVisible();

    await activityFold(page).click();
    await expect(reasoningDetails(page)).toBeVisible();
    await expect(thinkingTool(page)).toBeVisible();
    await expect(toolGroup(page, /read/i)).toBeVisible();
    await expect(readTool(page)).toBeVisible();
    await expect(
      page
        .getByText(/export function ConversationList/)
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
  } finally {
    await agent.cleanup();
  }
});

test("collapses a hidden chat after it completes with a chunked final answer", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(180_000);
  const subscriptions = observeTimelineSubscriptions(page);
  const firstAgent = await seedMockAgentWorkspace({
    repoPrefix: "background-activity-fold-",
    title: "Background activity fold",
    model: "one-minute-stream",
  });
  const decoyAgents = await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      firstAgent.client.createAgent({
        provider: "mock",
        cwd: firstAgent.cwd,
        workspaceId: firstAgent.workspaceId,
        title: `Background activity decoy ${index + 1}`,
        modeId: "load-test",
        model: "ten-second-stream",
      }),
    ),
  );

  try {
    await openAgentRoute(page, firstAgent);
    await expectComposerVisible(page);
    await setExpansionSettings(page, { activity: false, reasoning: true });

    await firstAgent.client.sendAgentMessage(firstAgent.agentId, "Emit a chunked final answer.");
    await expect(page.getByRole("button", { name: /stop|cancel/i }).first()).toBeVisible({
      timeout: 30_000,
    });

    for (const [index, decoyAgent] of decoyAgents.entries()) {
      await page
        .getByRole("button", { name: `Background activity decoy ${index + 1}`, exact: true })
        .click();
      await subscriptions.waitForSubscribedAgent(decoyAgent.id, { timeout: 45_000 });
    }
    await subscriptions.waitForUnsubscribedAgent(firstAgent.agentId, { timeout: 45_000 });
    const finish = await firstAgent.client.waitForFinish(firstAgent.agentId, 90_000);
    expect(finish.status).toBe("idle");

    await page.getByRole("button", { name: "Background activity fold", exact: true }).click();
    const fold = activityFold(page);
    await expect(fold).toContainText(/Worked for /);
    await expect(page.getByText(CHUNKED_FINAL_TEXT, { exact: true })).toBeVisible();
    await expect(reasoningDetails(page)).toHaveCount(0);
    await expect(commentaryDetails(page)).toHaveCount(0);
    await expect(readTool(page)).toHaveCount(0);
  } finally {
    await firstAgent.cleanup();
  }
});
