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

  test("switches directly from a workspace menu to its project menu on consecutive right-clicks", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-context-switch-" });
    const workspaceKey = `${getServerId()}:${workspace.workspaceId}`;

    try {
      await gotoAppShell(page);
      const workspaceRow = page.getByTestId(`sidebar-workspace-row-${workspaceKey}`);
      const projectRow = page.getByTestId(`sidebar-project-row-${workspace.projectId}`);
      await expect(workspaceRow).toBeVisible({ timeout: 30_000 });
      await expect(projectRow).toBeVisible();

      const projectBounds = await projectRow.boundingBox();
      if (!projectBounds) throw new Error("Project row has no clickable bounds");

      await workspaceRow.click({ button: "right" });
      const workspaceMenu = page.getByTestId(`sidebar-workspace-context-${workspaceKey}`);
      await expect(workspaceMenu).toBeVisible();

      await page.mouse.click(projectBounds.x + 12, projectBounds.y + projectBounds.height / 2, {
        button: "right",
      });

      await expect(
        page.getByTestId(`sidebar-project-context-${workspace.projectId}`),
      ).toBeVisible();
      await expect(workspaceMenu).not.toBeVisible();
    } finally {
      await workspace.cleanup();
    }
  });

  test("outside left-click closes the menu and does not activate an underlying control", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-context-dismiss-" });
    const workspaceKey = `${getServerId()}:${workspace.workspaceId}`;

    try {
      await gotoAppShell(page);
      const workspaceRow = page.getByTestId(`sidebar-workspace-row-${workspaceKey}`);
      const displayPreferences = page.getByTestId("sidebar-display-preferences-menu");
      await expect(workspaceRow).toBeVisible({ timeout: 30_000 });
      await expect(displayPreferences).toBeVisible();

      await workspaceRow.click({ button: "right" });
      const workspaceMenu = page.getByTestId(`sidebar-workspace-context-${workspaceKey}`);
      await expect(workspaceMenu).toBeVisible();

      await displayPreferences.click();

      await expect(page.getByTestId("sidebar-grouping-status")).not.toBeVisible();
      await expect(workspaceMenu).not.toBeVisible();
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
