import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { openSessions } from "../support/helpers/archive-tab";
import { addConnectedHostAndReload, addOfflineHostAndReload } from "../support/helpers/hosts";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { seedMockAgentWorkspace, type MockAgentWorkspace } from "../support/helpers/mock-agent";
import { getServerId } from "../support/helpers/server-id";
// The constants module is plain TypeScript, so the Playwright runner can import
// it — reaching through the `.tsx` picker would drag React Native into Node.
import { ALL_HOSTS_OPTION_ID } from "@/components/hosts/host-picker-constants";
import { buildSessionsRoute } from "@/utils/host-routes";

const AGENT_ROW = '[data-testid^="agent-row-"]';
const APP_SETTINGS_KEY = "@paseo:app-settings";
const PRIMARY_LABEL = "Primary box";
const SECONDARY_LABEL = "Secondary box";
const LONG_PRIMARY_LABEL = "Primary workstation with a deliberately long descriptive host name";

/** Scopes every assertion to this spec's sessions on a shared daemon. */
const NONCE = `hsx${randomUUID().replaceAll("-", "").slice(0, 8)}`;

async function search(page: Page, query: string): Promise<void> {
  await page.getByTestId("sessions-search-input").fill(query);
}

async function selectHost(page: Page, serverId: string): Promise<void> {
  await page.getByTestId("sessions-host-filter-trigger").click();
  await page.getByTestId(`sessions-host-filter-item-${serverId}`).click();
}

async function expectRankedTitles(page: Page, titles: string[]): Promise<void> {
  const rows = page.locator(AGENT_ROW).filter({ hasText: NONCE });
  await expect(rows).toHaveCount(titles.length, { timeout: 30_000 });
  for (const [index, title] of titles.entries()) {
    await expect(rows.nth(index)).toContainText(title, { timeout: 30_000 });
  }
}

async function useInterfaceFontSize(page: Page, size: number): Promise<void> {
  await page.addInitScript(
    ({ key, fontSize }) => {
      const raw = localStorage.getItem(key);
      const settings = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      localStorage.setItem(key, JSON.stringify({ ...settings, uiFontSize: fontSize }));
    },
    { key: APP_SETTINGS_KEY, fontSize: size },
  );
}

// Searching across hosts is the case a single-daemon spec cannot see: each host
// ranks only its own sessions, so the merge is the only thing that can put the
// best match first.
test.describe("History search across hosts", () => {
  test.describe.configure({ timeout: 420_000 });

  test("ranks matches from every host together and narrows to one host on demand", async ({
    page,
  }) => {
    const secondaryServerId = `srv_hist_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const secondaryDaemon = await startIsolatedHostDaemon(secondaryServerId);
    const workspaces: MockAgentWorkspace[] = [];

    // The weak match is the newest session on the primary host and the strong
    // match is the oldest on the secondary, so only a real cross-host merge on
    // relevance can order them correctly.
    const weakTitle = `${NONCE} Unbilled usage report`;
    const strongTitle = `${NONCE} Bill the customer`;
    const unrelatedTitle = `${NONCE} Terminal resize fix`;

    try {
      workspaces.push(
        await seedMockAgentWorkspace({
          repoPrefix: "sessions-search-secondary-",
          port: secondaryDaemon.port,
          title: strongTitle,
        }),
      );
      for (const title of [unrelatedTitle, weakTitle]) {
        workspaces.push(
          await seedMockAgentWorkspace({
            repoPrefix: "sessions-search-primary-",
            title,
          }),
        );
      }

      await gotoAppShell(page);
      await addConnectedHostAndReload(page, {
        serverId: secondaryDaemon.serverId,
        label: SECONDARY_LABEL,
        port: secondaryDaemon.port,
        primaryLabel: PRIMARY_LABEL,
      });
      await openSessions(page);

      await expect(page.getByTestId("sessions-search-input")).toBeVisible({ timeout: 30_000 });

      // All hosts: the stronger match leads despite being the older session on
      // the other daemon.
      await search(page, `${NONCE} bill`);
      await expectRankedTitles(page, [strongTitle, weakTitle]);

      // One host: the other daemon's stronger match drops out entirely.
      await selectHost(page, getServerId());
      await expectRankedTitles(page, [weakTitle]);

      await selectHost(page, secondaryDaemon.serverId);
      await expectRankedTitles(page, [strongTitle]);

      // Back to all hosts, and clearing the query returns every seeded session.
      await selectHost(page, ALL_HOSTS_OPTION_ID);
      await page.getByTestId("sessions-search-clear").click();
      const rows = page.locator(AGENT_ROW).filter({ hasText: NONCE });
      await expect(rows).toHaveCount(3, { timeout: 30_000 });
    } finally {
      await Promise.allSettled(workspaces.map((workspace) => workspace.cleanup()));
      await Promise.allSettled([secondaryDaemon.close()]);
    }
  });

  test("names a host it could not reach instead of shrinking the results silently", async ({
    page,
  }) => {
    const reachableTitle = `${NONCE} Bill the reachable customer`;
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "sessions-search-offline-",
      title: reachableTitle,
    });

    try {
      await gotoAppShell(page);
      await addOfflineHostAndReload(page, {
        serverId: "sessions-search-unreachable",
        label: SECONDARY_LABEL,
        primaryLabel: PRIMARY_LABEL,
      });
      await openSessions(page);

      // The unreachable host's sessions were never searched. Reporting only the
      // matches that were found, with no word about the host that never
      // answered, is the failure this asserts against.
      await search(page, `${NONCE} bill`);
      await expect(page.getByTestId("sessions-host-errors")).toContainText(SECONDARY_LABEL, {
        timeout: 30_000,
      });
      await expectRankedTitles(page, [reachableTitle]);
    } finally {
      await workspace.cleanup().catch(() => undefined);
    }
  });

  test("shows a retryable host error and clears a query hidden by an unavailable host", async ({
    page,
  }) => {
    const offlineServerId = "sessions-search-selected-offline";
    const reachableTitle = `${NONCE} Query clear readiness`;
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "sessions-search-query-clear-",
      title: reachableTitle,
    });

    try {
      await gotoAppShell(page);
      await addOfflineHostAndReload(page, {
        serverId: offlineServerId,
        label: SECONDARY_LABEL,
        primaryLabel: PRIMARY_LABEL,
      });
      await openSessions(page);

      // The row proves the primary host and its capability handshake are ready;
      // an empty daemon gives this test no observable distinction from offline.
      await expect(page.locator(AGENT_ROW).filter({ hasText: reachableTitle })).toBeVisible({
        timeout: 30_000,
      });
      await search(page, `${NONCE} query-to-clear`);
      await selectHost(page, offlineServerId);

      const loadError = page.getByTestId("sessions-load-error");
      await expect(loadError).toContainText(SECONDARY_LABEL, { timeout: 30_000 });
      await expect(loadError.getByText("Try again", { exact: true })).toBeVisible();
      await expect(page.getByTestId("sessions-empty")).toHaveCount(0);
      await expect(page.getByTestId("sessions-search-input")).toHaveCount(0);

      await selectHost(page, getServerId());
      await expect(page.getByTestId("sessions-search-input")).toHaveValue("", {
        timeout: 30_000,
      });
    } finally {
      await workspace.cleanup().catch(() => undefined);
    }
  });

  test("stacks search and a long host filter at 320px with 24px interface text", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await useInterfaceFontSize(page, 24);
    await gotoAppShell(page);
    await page.goto(buildSessionsRoute());
    await addOfflineHostAndReload(page, {
      serverId: "sessions-search-layout-offline",
      label: SECONDARY_LABEL,
      primaryLabel: LONG_PRIMARY_LABEL,
    });
    await selectHost(page, getServerId());

    const searchInput = page.getByTestId("sessions-search-input");
    const searchField = page.getByTestId("sessions-search-field");
    const hostTrigger = page.getByTestId("sessions-host-filter-trigger");
    const hostLabel = hostTrigger.getByText(LONG_PRIMARY_LABEL, { exact: true });
    await expect(searchInput).toBeVisible({ timeout: 30_000 });
    await expect(searchInput).toHaveCSS("font-size", "24px");
    await expect(hostLabel).toBeVisible();

    const [searchBounds, hostBounds, labelBounds] = await Promise.all([
      searchField.boundingBox(),
      hostTrigger.boundingBox(),
      hostLabel.boundingBox(),
    ]);
    expect(searchBounds).not.toBeNull();
    expect(hostBounds).not.toBeNull();
    expect(labelBounds).not.toBeNull();
    if (!searchBounds || !hostBounds || !labelBounds) return;

    expect(searchBounds.x).toBeGreaterThanOrEqual(0);
    expect(searchBounds.x + searchBounds.width).toBeLessThanOrEqual(320);
    expect(hostBounds.x).toBeGreaterThanOrEqual(0);
    expect(hostBounds.x + hostBounds.width).toBeLessThanOrEqual(320);
    expect(searchBounds.y + searchBounds.height).toBeLessThanOrEqual(hostBounds.y);
    expect(searchBounds.height).toBeGreaterThanOrEqual(34);
    expect(Math.abs(searchBounds.height - hostBounds.height)).toBeLessThanOrEqual(1);
    expect(labelBounds.x).toBeGreaterThanOrEqual(hostBounds.x);
    expect(labelBounds.x + labelBounds.width).toBeLessThanOrEqual(hostBounds.x + hostBounds.width);

    const labelStyle = await hostLabel.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        overflow: style.overflow,
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
      };
    });
    expect(labelStyle).toEqual({
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
  });
});
