import type { Locator } from "@playwright/test";
import { test, expect, type Page } from "./fixtures";
import { openSettings } from "./helpers/app";
import { expectComposerVisible } from "./helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "./helpers/mock-agent";
import {
  clickSettingsBackToWorkspace,
  expectSettingsHeader,
  openSettingsSection,
} from "./helpers/settings";

const APP_SETTINGS_KEY = "@paseo:app-settings";

type AppearanceField =
  | "uiFontFamily"
  | "uiFontSize"
  | "workspaceFontFamily"
  | "workspaceFontSize"
  | "monoFontFamily"
  | "codeFontSize";

interface Typography {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
}

async function readTypography(locator: Locator): Promise<Typography> {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fontFamily: style.fontFamily,
      fontSize: Number.parseFloat(style.fontSize),
      lineHeight: Number.parseFloat(style.lineHeight),
    };
  });
}

async function readStoredSetting(page: Page, field: AppearanceField): Promise<unknown> {
  return page.evaluate(
    ({ key, setting }) => {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as Record<string, unknown>)[setting] : undefined;
    },
    { key: APP_SETTINGS_KEY, setting: field },
  );
}

async function commitAppearanceField(
  page: Page,
  label: string,
  field: AppearanceField,
  value: string,
  expected: string | number,
): Promise<void> {
  const input = page.getByRole("textbox", { name: label, exact: true });
  await input.fill(value);
  await input.blur();
  await expect.poll(() => readStoredSetting(page, field)).toBe(expected);
}

async function openAppearanceSettings(page: Page): Promise<Locator> {
  await openSettings(page);
  await openSettingsSection(page, "appearance");
  await expectSettingsHeader(page, "Appearance");
  return page.getByTestId("settings-detail-header-title");
}

async function returnToWorkspace(page: Page): Promise<void> {
  await clickSettingsBackToWorkspace(page);
  await expectComposerVisible(page);
}

function workspaceTypographyLocators(page: Page, prompt: string) {
  const assistant = page.getByTestId("assistant-message").last();
  return {
    user: page
      .getByTestId("user-message")
      .filter({ hasText: prompt })
      .locator("[data-pworkspace]")
      .first(),
    assistant: assistant.getByText(/The change should keep scroll-to-bottom working/).first(),
    code: assistant.locator("[data-pmono]").last(),
    composer: page.getByRole("textbox", { name: "Message agent...", exact: true }).first(),
  };
}

async function readWorkspaceTypography(page: Page, prompt: string) {
  const locators = workspaceTypographyLocators(page, prompt);
  return {
    user: await readTypography(locators.user),
    assistant: await readTypography(locators.assistant),
    code: await readTypography(locators.code),
    composer: await readTypography(locators.composer),
  };
}

async function setStoredWorkspaceFontSize(page: Page, workspaceFontSize: number): Promise<void> {
  await page.evaluate(
    ({ key, size }) => {
      const raw = localStorage.getItem(key);
      const settings = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      localStorage.setItem(key, JSON.stringify({ ...settings, workspaceFontSize: size }));
    },
    { key: APP_SETTINGS_KEY, size: workspaceFontSize },
  );
  await page.reload();
  await expectComposerVisible(page);
}

async function expectTextFits(locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  const metrics = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const lineHeight = Number.parseFloat(style.lineHeight);
    const rect = element.getBoundingClientRect();
    return {
      height: rect.height,
      lineHeight,
      horizontalOverflow: element.scrollWidth > element.clientWidth + 1,
    };
  });
  expect(metrics.horizontalOverflow).toBe(false);
  expect(metrics.height).toBeGreaterThanOrEqual(metrics.lineHeight);
}

test("keeps interface, workspace, and code typography independent", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const prompt = "Verify independent workspace typography.";
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "appearance-typography-",
    title: "Appearance typography",
    model: "ten-second-stream",
    initialPrompt: prompt,
  });

  try {
    await agent.client.waitForFinish(agent.agentId, 30_000);
    await openAgentRoute(page, agent);
    await expectComposerVisible(page);

    const initialHeader = await readTypography(await openAppearanceSettings(page));
    await returnToWorkspace(page);
    const initialWorkspace = await readWorkspaceTypography(page, prompt);

    const uiHeader = await openAppearanceSettings(page);
    await commitAppearanceField(page, "Interface font family", "uiFontFamily", "serif", "serif");
    await commitAppearanceField(page, "Interface font size", "uiFontSize", "20", 20);
    const changedUi = await readTypography(uiHeader);
    expect(changedUi.fontFamily.toLowerCase()).toContain("serif");
    expect(changedUi.fontSize).toBe(20);
    expect(changedUi).not.toEqual(initialHeader);
    await returnToWorkspace(page);
    expect(await readWorkspaceTypography(page, prompt)).toEqual(initialWorkspace);

    const workspaceHeader = await openAppearanceSettings(page);
    await commitAppearanceField(
      page,
      "Workspace font family",
      "workspaceFontFamily",
      "cursive",
      "cursive",
    );
    await commitAppearanceField(page, "Workspace font size", "workspaceFontSize", "21", 21);
    expect(await readTypography(workspaceHeader)).toEqual(changedUi);
    await returnToWorkspace(page);
    const changedWorkspace = await readWorkspaceTypography(page, prompt);
    for (const surface of [
      changedWorkspace.user,
      changedWorkspace.assistant,
      changedWorkspace.composer,
    ]) {
      expect(surface.fontFamily.toLowerCase()).toContain("cursive");
      expect(surface.fontSize).toBe(21);
    }
    expect(changedWorkspace.code).toEqual(initialWorkspace.code);

    const codeHeader = await openAppearanceSettings(page);
    await commitAppearanceField(page, "Code font family", "monoFontFamily", "serif", "serif");
    await commitAppearanceField(page, "Code font size", "codeFontSize", "18", 18);
    expect(await readTypography(codeHeader)).toEqual(changedUi);
    await returnToWorkspace(page);
    const changedCode = await readWorkspaceTypography(page, prompt);
    expect(changedCode.user).toEqual(changedWorkspace.user);
    expect(changedCode.assistant).toEqual(changedWorkspace.assistant);
    expect(changedCode.composer).toEqual(changedWorkspace.composer);
    expect(changedCode.code.fontFamily.toLowerCase()).toContain("serif");
    expect(changedCode.code.fontSize).toBe(18);

    await page.reload();
    await expectComposerVisible(page);
    expect(await readWorkspaceTypography(page, prompt)).toEqual(changedCode);

    await openAppearanceSettings(page);
    await commitAppearanceField(page, "Interface font family", "uiFontFamily", "", "");
    await commitAppearanceField(page, "Interface font size", "uiFontSize", "16", 16);
    await commitAppearanceField(page, "Workspace font family", "workspaceFontFamily", "", "");
    await commitAppearanceField(page, "Workspace font size", "workspaceFontSize", "16", 16);
    await commitAppearanceField(page, "Code font family", "monoFontFamily", "", "");
    await commitAppearanceField(page, "Code font size", "codeFontSize", "12", 12);
    await returnToWorkspace(page);
    expect(await readWorkspaceTypography(page, prompt)).toEqual(initialWorkspace);

    await page.setViewportSize({ width: 390, height: 844 });
    for (const size of [24, 11]) {
      await setStoredWorkspaceFontSize(page, size);
      const locators = workspaceTypographyLocators(page, prompt);
      expect((await readTypography(locators.user)).fontSize).toBe(size);
      expect((await readTypography(locators.assistant)).fontSize).toBe(size);
      expect((await readTypography(locators.composer)).fontSize).toBe(size);
      await expectTextFits(locators.user);
      await expectTextFits(locators.assistant);
      await expectTextFits(locators.composer);
      await testInfo.attach(`workspace-font-${size}-mobile`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    }
  } finally {
    await agent.cleanup();
  }
});
