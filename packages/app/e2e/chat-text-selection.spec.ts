import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { expectComposerVisible } from "./helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "./helpers/mock-agent";

const SELECTED_TEXT = "Keep all three selection actions.";

function visibleComposers(page: Page): Locator {
  return page.locator("textarea[data-composer-input]").filter({ visible: true });
}

async function selectMessageText(page: Page): Promise<void> {
  await page.getByText(SELECTED_TEXT, { exact: true }).evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect(page.getByTestId("chat-selection-bubble")).toBeVisible();
}

async function countVisibleComposersWithValue(page: Page, value: string): Promise<number> {
  return visibleComposers(page).evaluateAll((elements, expectedValue) => {
    let count = 0;
    for (const element of elements) {
      if ((element as HTMLTextAreaElement).value === expectedValue) count += 1;
    }
    return count;
  }, value);
}

test("selected chat text exposes and completes all three legacy actions", async ({ page }) => {
  test.setTimeout(120_000);
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "chat-text-selection-",
    title: "Chat text selection",
    initialPrompt: SELECTED_TEXT,
  });

  try {
    await agent.client.waitForFinish(agent.agentId, 30_000);
    await openAgentRoute(page, agent);
    await expectComposerVisible(page);

    const composer = visibleComposers(page).first();
    await composer.fill("Existing draft");
    await selectMessageText(page);
    await expect(page.getByTestId("chat-selection-bubble").getByRole("button")).toHaveCount(3);
    await page.getByTestId("chat-selection-ask").click();
    await expect(composer).toHaveValue(`Existing draft\n${SELECTED_TEXT}`);

    await composer.fill("");
    await selectMessageText(page);
    await page.getByTestId("chat-selection-save-preset").click();
    await expect(page.getByText("Saved as preset", { exact: true })).toBeVisible();
    await page.getByTestId("composer-presets-menu").click();
    await page
      .getByTestId("composer-presets-content")
      .getByText(SELECTED_TEXT, { exact: true })
      .click();
    await expect(composer).toHaveValue(SELECTED_TEXT);

    await composer.fill("");
    await selectMessageText(page);
    await page.getByTestId("chat-selection-ask-new-window").click();
    await expect(visibleComposers(page)).toHaveCount(2);
    await expect.poll(() => countVisibleComposersWithValue(page, SELECTED_TEXT)).toBe(1);
  } finally {
    await agent.cleanup();
  }
});
