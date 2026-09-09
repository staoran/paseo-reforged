import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { test } from "../support/fixtures";
import { openSessions, resetSeededPageState } from "../support/helpers/archive-tab";
import { installDaemonWebSocketGate } from "../support/helpers/daemon-websocket-gate";
import { seedMockAgentWorkspace, type MockAgentWorkspace } from "../support/helpers/mock-agent";

const AGENT_ROW = '[data-testid^="agent-row-"]';

/**
 * Every seeded title opens with the same nonce, so a query of "<nonce> term"
 * can only reach this spec's sessions. The daemon is shared with the rest of
 * the browser suite and its history is whatever those specs left behind.
 */
const NONCE = `hsq${randomUUID().replaceAll("-", "").slice(0, 8)}`;

const TITLES = {
  billing: `${NONCE} Add Stripe billing`,
  unbilled: `${NONCE} Unbilled usage report`,
  terminal: `${NONCE} Terminal resize fix`,
} as const;

async function search(page: Page, query: string): Promise<void> {
  await page.getByTestId("sessions-search-input").fill(query);
}

function rowTitles(page: Page) {
  return page.locator(AGENT_ROW);
}

async function expectVisibleTitles(page: Page, titles: string[]): Promise<void> {
  const rows = rowTitles(page).filter({ hasText: NONCE });
  await expect(rows).toHaveCount(titles.length, { timeout: 30_000 });
  for (const [index, title] of titles.entries()) {
    await expect(rows.nth(index)).toContainText(title, { timeout: 30_000 });
  }
}

test("recovers when the host connects after the history screen mounts", async ({ page }) => {
  const gate = await installDaemonWebSocketGate(page);
  await gate.drop();

  try {
    await resetSeededPageState(page);
    await openSessions(page);
    await expect(page.getByTestId("sessions-load-error")).toBeVisible({ timeout: 30_000 });

    gate.restore();
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByTestId("sessions-search-input")).toBeVisible({ timeout: 30_000 });
  } finally {
    gate.restore();
  }
});

test.describe("History search", () => {
  const workspaces: MockAgentWorkspace[] = [];

  test.describe.configure({ timeout: 300_000 });

  test.beforeAll(async () => {
    for (const title of [TITLES.terminal, TITLES.unbilled, TITLES.billing]) {
      workspaces.push(
        await seedMockAgentWorkspace({
          repoPrefix: "sessions-search-",
          title,
        }),
      );
    }
  });

  test.afterAll(async () => {
    await Promise.allSettled(workspaces.map((workspace) => workspace.cleanup()));
  });

  test("searches, ranks, highlights, and clears session history", async ({ page }) => {
    await resetSeededPageState(page);
    await openSessions(page);

    await test.step("narrows history and restores chronological grouping", async () => {
      await expectVisibleTitles(page, [TITLES.billing, TITLES.unbilled, TITLES.terminal]);
      await expect(page.getByText("Today", { exact: true })).toHaveCount(1, {
        timeout: 30_000,
      });

      await search(page, `${NONCE} billing`);
      await expectVisibleTitles(page, [TITLES.billing]);
      await expect(page.getByText("Today", { exact: true })).toHaveCount(0, {
        timeout: 30_000,
      });

      await page.getByTestId("sessions-search-clear").click();
      await expect(page.getByTestId("sessions-search-input")).toHaveValue("");
      await expectVisibleTitles(page, [TITLES.billing, TITLES.unbilled, TITLES.terminal]);
      await expect(page.getByText("Today", { exact: true })).toHaveCount(1, {
        timeout: 30_000,
      });
    });

    await test.step("ranks whole-word matches above substrings", async () => {
      await search(page, `${NONCE} bill`);
      await expectVisibleTitles(page, [TITLES.billing, TITLES.unbilled]);
    });

    await test.step("highlights exact and typo-resolved matches", async () => {
      await search(page, `${NONCE} billing`);
      const row = page.locator(AGENT_ROW).filter({ hasText: NONCE }).first();
      await expect(row.getByText("billing", { exact: true })).toBeVisible({ timeout: 30_000 });

      await search(page, `${NONCE} bulling`);
      await expectVisibleTitles(page, [TITLES.billing]);
      const typoRow = page.locator(AGENT_ROW).filter({ hasText: NONCE }).first();
      await expect(typoRow.getByText("billing", { exact: true })).toBeVisible({
        timeout: 30_000,
      });
    });

    await test.step("distinguishes no matches from empty history", async () => {
      await search(page, `${NONCE} kubernetes`);
      await expect(page.getByTestId("sessions-empty")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("No sessions match")).toBeVisible({ timeout: 30_000 });

      await page.getByText("Clear search").click();
      await expectVisibleTitles(page, [TITLES.billing, TITLES.unbilled, TITLES.terminal]);
    });
  });
});
