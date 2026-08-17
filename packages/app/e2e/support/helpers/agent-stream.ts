import { expect, type Locator, type Page } from "@playwright/test";
import { readScrollMetrics, waitForContentGrowth, expectNearBottom } from "./agent-bottom-anchor";

export async function awaitAssistantMessage(page: Page, hasText?: string | RegExp): Promise<void> {
  const messages = page.getByTestId("assistant-message");
  const target = hasText === undefined ? messages.first() : messages.filter({ hasText }).first();
  await expect(target).toBeVisible({ timeout: 30_000 });
}

export async function awaitToolCall(page: Page, toolName: string | RegExp): Promise<void> {
  const toolCall = page.getByTestId("tool-call-badge").filter({ hasText: toolName }).first();
  if (await toolCall.isVisible().catch(() => false)) {
    return;
  }
  await expandVisibleToolCallGroups(page, toolCall);
  await expect(toolCall).toBeVisible({ timeout: 30_000 });
}

/** Expands visible category groups until the requested nested content is revealed. */
async function expandVisibleToolCallGroups(page: Page, content: Locator): Promise<void> {
  const groups = page.getByTestId("tool-call-group").filter({ visible: true });
  await expect(groups.first()).toBeVisible({ timeout: 30_000 });
  const groupCount = await groups.count();
  for (let index = 0; index < groupCount; index += 1) {
    if (await content.isVisible().catch(() => false)) {
      return;
    }
    const toggle = groups.nth(index).getByRole("button").first();
    if ((await toggle.getAttribute("aria-expanded")) !== "true") {
      await toggle.click();
    }
  }
}

export async function expandCompletedActivity(
  page: Page,
  content: Locator = page.getByTestId("tool-call-badge").first(),
): Promise<void> {
  if (await content.isVisible().catch(() => false)) {
    return;
  }
  const fold = page.locator('[data-testid^="activity-fold-"]:visible').first();
  await expect(fold).toBeVisible({ timeout: 30_000 });
  if ((await fold.getAttribute("aria-expanded")) !== "true") {
    await fold.click();
  }
  if (!(await content.isVisible().catch(() => false))) {
    await expandVisibleToolCallGroups(page, content);
  }
  await expect(content).toBeVisible({ timeout: 30_000 });
}

export async function expectAgentIdle(page: Page, timeout = 30_000): Promise<void> {
  await expect(page.getByRole("button", { name: /stop|cancel/i })).toHaveCount(0, { timeout });
}

// The working indicator is an animated spinner View — no semantic ARIA role, testId is correct.
export async function expectInlineWorkingIndicator(page: Page): Promise<void> {
  await expect(page.getByTestId("turn-working-indicator")).toBeVisible({ timeout: 30_000 });
}

export async function expectRunningAgentChrome(page: Page, title: string): Promise<void> {
  const tab = page.getByRole("button", { name: title, exact: true });

  await expect(tab).toBeVisible({ timeout: 30_000 });
  await expect(tab.getByRole("progressbar", { name: "Agent running" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: /stop agent|canceling agent/i })).toBeVisible({
    timeout: 30_000,
  });
  await expectInlineWorkingIndicator(page);
}

export async function expectAgentReadyToInterrupt(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Stop agent", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "Canceling agent", exact: true })).toHaveCount(0);
}

export async function expectVisibleAgentSurfacesIdle(page: Page): Promise<void> {
  const visibleAgentTab = page
    .getByTestId(/^workspace-tab-agent_/)
    .filter({ visible: true })
    .first();

  await expect(visibleAgentTab).toBeVisible({ timeout: 30_000 });
  await expect(visibleAgentTab.getByRole("progressbar", { name: "Agent running" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /stop agent|canceling agent/i })).toHaveCount(0);
  await expect(page.getByTestId("turn-working-indicator")).toHaveCount(0);
  await expect(page.getByTestId("turn-working-elapsed")).toHaveCount(0);
}

export async function expectAgentSurfacesIdle(page: Page, title: string): Promise<void> {
  const tab = page.getByRole("button", { name: title, exact: true });

  await expect(tab).toBeVisible({ timeout: 30_000 });
  await expect(tab.getByRole("progressbar", { name: "Agent running" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /stop agent|canceling agent/i })).toHaveCount(0);
  await expect(page.getByTestId("turn-working-indicator")).toHaveCount(0);
  await expect(page.getByTestId("turn-working-elapsed")).toHaveCount(0);
  await expectTurnCopyButton(page);
}

export async function expectTurnCopyButton(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Copy turn" }).first()).toBeVisible({
    timeout: 30_000,
  });
}

export async function expectScrollFollowsNewContent(page: Page): Promise<void> {
  const { contentHeight } = await readScrollMetrics(page);
  await waitForContentGrowth(page, contentHeight);
  await expectNearBottom(page);
}
