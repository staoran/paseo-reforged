import { test, expect } from "./fixtures";
import { gotoAppShell } from "./helpers/app";
import { seedWorkspace } from "./helpers/seed-client";
import { getServerId } from "./helpers/server-id";
import { expectProjectSettingsFormVisible } from "./helpers/project-settings";

test.describe("Sidebar context menus", () => {
  test.describe.configure({ timeout: 120_000 });

  test("project workspace row opens the same actions on right-click as its kebab", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-context-workspace-" });
    const workspaceKey = `${getServerId()}:${workspace.workspaceId}`;

    try {
      await gotoAppShell(page);
      const row = page.getByTestId(`sidebar-workspace-row-${workspaceKey}`);
      await expect(row).toBeVisible({ timeout: 30_000 });

      await row.click({ button: "right" });

      await expect(page.getByTestId(`sidebar-workspace-context-${workspaceKey}`)).toBeVisible();
      const renameItem = page.getByTestId(`sidebar-workspace-menu-rename-${workspaceKey}`);
      await expect(renameItem).toBeVisible();
      await expect(
        page.getByTestId(`sidebar-workspace-menu-archive-${workspaceKey}`),
      ).toBeVisible();
      await renameItem.click();
      await expect(
        page.getByTestId(`sidebar-workspace-rename-modal-${workspaceKey}-input`),
      ).toBeVisible();
    } finally {
      await workspace.cleanup();
    }
  });

  test("status workspace row opens the same actions on right-click as its kebab", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-context-status-" });
    const workspaceKey = `${getServerId()}:${workspace.workspaceId}`;

    try {
      await gotoAppShell(page);
      await page.getByTestId("sidebar-display-preferences-menu").click();
      await page.getByTestId("sidebar-grouping-status").click();

      const row = page.getByTestId(`sidebar-workspace-row-${workspaceKey}`);
      await expect(row).toBeVisible({ timeout: 30_000 });
      await row.click({ button: "right" });

      await expect(page.getByTestId(`sidebar-workspace-context-${workspaceKey}`)).toBeVisible();
      const renameItem = page.getByTestId(`sidebar-workspace-menu-rename-${workspaceKey}`);
      await expect(renameItem).toBeVisible();
      await expect(
        page.getByTestId(`sidebar-workspace-menu-archive-${workspaceKey}`),
      ).toBeVisible();
      await renameItem.click();
      await expect(
        page.getByTestId(`sidebar-workspace-rename-modal-${workspaceKey}-input`),
      ).toBeVisible();
    } finally {
      await workspace.cleanup();
    }
  });

  test("project row opens the same actions on right-click as its kebab", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-context-project-" });

    try {
      await gotoAppShell(page);
      const row = page.getByTestId(`sidebar-project-row-${workspace.projectId}`);
      await expect(row).toBeVisible({ timeout: 30_000 });

      await row.click({ button: "right" });

      await expect(
        page.getByTestId(`sidebar-project-context-${workspace.projectId}`),
      ).toBeVisible();
      const openSettingsItem = page.getByTestId(
        `sidebar-project-menu-open-settings-${workspace.projectId}`,
      );
      await expect(openSettingsItem).toBeVisible();
      await expect(
        page.getByTestId(`sidebar-project-menu-remove-${workspace.projectId}`),
      ).toBeVisible();
      await openSettingsItem.click();
      await expectProjectSettingsFormVisible(page);
    } finally {
      await workspace.cleanup();
    }
  });
});
