import type { Locator } from "@playwright/test";
import { test, expect, type Page } from "../support/fixtures";
import { openSettings } from "../support/helpers/app";
import { expandCompletedActivity } from "../support/helpers/agent-stream";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { getServerId } from "../support/helpers/server-id";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import {
  clickSettingsBackToWorkspace,
  expectSettingsHeader,
  openSettingsSection,
} from "../support/helpers/settings";

const APP_SETTINGS_KEY = "@paseo:app-settings";

const RICH_MARKDOWN = [
  "## Markdown rhythm",
  "",
  "This deliberately long paragraph verifies that automatic wrapping follows one stable prose line height across the full conversation width. It contains enough words to wrap onto several visual lines even on a compact viewport without introducing a Markdown block boundary.",
  "",
  "The next paragraph starts after a Markdown block boundary, so its first line must keep a visibly larger rhythm than two automatically wrapped lines inside the paragraph above.",
  "",
  "**Genuinely bold text** sits beside `inlineCode`, [Paseo docs](https://example.com), and [target.ts](target.ts#L42).",
  "",
  "### List rhythm",
  "",
  "- The first list item deliberately wraps across multiple visual lines so wrapped lines retain the normal prose line height while neighboring list items get extra separation.",
  "- The second list item starts after a visibly larger item-to-item gap.",
  "- The third list item includes [list-target.ts](list-target.ts#L88).",
].join("\n");

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

async function installFinalAnswerFixture(page: Page, markdown: string): Promise<void> {
  await page.routeWebSocket(daemonWsRoutePattern(), (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      if (typeof message !== "string") {
        socket.send(message);
        return;
      }

      try {
        const envelope = JSON.parse(message) as {
          type?: unknown;
          message?: {
            type?: unknown;
            payload?: { entries?: Array<{ item?: Record<string, unknown> }> };
          };
        };
        if (
          envelope.type === "session" &&
          envelope.message?.type === "fetch_agent_timeline_response"
        ) {
          const entries = envelope.message.payload?.entries;
          const finalAnswer = entries
            ?.map((entry) => entry.item)
            .findLast(
              (item) =>
                item?.type === "assistant_message" &&
                (item.phase === "final_answer" || item.text === "Synthetic load test complete"),
            );
          if (finalAnswer) finalAnswer.text = markdown;
          socket.send(JSON.stringify(envelope));
          return;
        }
      } catch {
        // Forward non-JSON daemon traffic unchanged.
      }

      socket.send(message);
    });
  });
}

async function readTextLineTops(locator: Locator): Promise<number[]> {
  await expect(locator).toBeVisible();
  return locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const tops = Array.from(range.getClientRects(), (rect) => Math.round(rect.top * 10) / 10);
    return [...new Set(tops)];
  });
}

async function readLeafTextStyle(locator: Locator) {
  await expect(locator).toBeVisible();
  return locator.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const textNode = walker.nextNode();
    const textElement = textNode?.parentElement ?? element;
    const style = getComputedStyle(textElement);
    return {
      fontSize: Number.parseFloat(style.fontSize),
      lineHeight: Number.parseFloat(style.lineHeight),
      letterSpacing: style.letterSpacing === "normal" ? 0 : Number.parseFloat(style.letterSpacing),
      fontWeight: style.fontWeight,
      color: style.color,
      backgroundColor: style.backgroundColor,
    };
  });
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
  const assistantMessages = page.getByTestId("assistant-message");
  return {
    user: page
      .getByTestId("user-message")
      .filter({ hasText: prompt })
      .locator("[data-pworkspace]")
      .first(),
    assistant: assistantMessages
      .getByText(/The change should keep scroll-to-bottom working/)
      .first(),
    code: assistantMessages.locator("[data-pmono]").last(),
    composer: page.getByRole("textbox", { name: "Message agent...", exact: true }).first(),
  };
}

async function readWorkspaceTypography(page: Page, prompt: string) {
  const locators = workspaceTypographyLocators(page, prompt);
  await expandCompletedActivity(page, locators.assistant);
  return {
    user: await readTypography(locators.user),
    assistant: await readTypography(locators.assistant),
    code: await readTypography(locators.code),
    composer: await readTypography(locators.composer),
  };
}

async function setStoredFontSize(
  page: Page,
  field: "uiFontSize" | "workspaceFontSize",
  fontSize: number,
): Promise<void> {
  await page.evaluate(
    ({ key, setting, size }) => {
      const raw = localStorage.getItem(key);
      const settings = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      localStorage.setItem(key, JSON.stringify({ ...settings, [setting]: size }));
    },
    { key: APP_SETTINGS_KEY, setting: field, size: fontSize },
  );
  await page.reload();
  await expectComposerVisible(page);
}

async function expectTextFits(locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  const metrics = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const fontSize = Number.parseFloat(style.fontSize);
    const lineHeight = Number.parseFloat(style.lineHeight);
    const rect = element.getBoundingClientRect();
    return {
      height: rect.height,
      fontSize,
      lineHeight,
      horizontalOverflow: element.scrollWidth > element.clientWidth + 1,
    };
  });
  expect(metrics.horizontalOverflow).toBe(false);
  expect(metrics.height).toBeGreaterThanOrEqual(metrics.fontSize);
  if (Number.isFinite(metrics.lineHeight)) {
    expect(metrics.lineHeight).toBeGreaterThanOrEqual(metrics.fontSize);
  }
  expect(metrics.height).toBeGreaterThanOrEqual(metrics.lineHeight);
}

test("renders final answer Markdown with distinct line and block rhythm", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "final-answer-markdown-",
    title: "Final answer Markdown",
    model: "ten-second-stream",
    initialPrompt: "Render the rich Markdown typography fixture.",
  });

  try {
    await agent.client.waitForFinish(agent.agentId, 30_000);
    await installFinalAnswerFixture(page, RICH_MARKDOWN);
    await page.setViewportSize({ width: 960, height: 900 });
    await openAgentRoute(page, agent);
    await expectComposerVisible(page);

    const assistant = page
      .getByTestId("assistant-message")
      .filter({ hasText: "Markdown rhythm" })
      .last();
    const heading = assistant.getByText("Markdown rhythm", { exact: true });
    const wrappedParagraph = assistant.getByText(/This deliberately long paragraph verifies/);
    const nextParagraph = assistant.getByText(/The next paragraph starts after/);
    const strong = assistant.getByText("Genuinely bold text", { exact: true });
    const inlineCode = assistant.getByText("inlineCode", { exact: true });
    const externalLink = assistant.getByText("Paseo docs", { exact: true });
    const fileLink = assistant.getByText("target.ts (line 42)", { exact: true });
    const firstListItem = assistant.getByText(/The first list item deliberately wraps/);
    const secondListItem = assistant.getByText(/The second list item starts after/);

    await expect(assistant).toBeVisible();
    const proseStyle = await readLeafTextStyle(wrappedParagraph);
    const expectedLineHeight = 22;
    expect(proseStyle).toMatchObject({
      fontSize: 16,
      lineHeight: expectedLineHeight,
      letterSpacing: 0,
    });

    const wrappedLineTops = await readTextLineTops(wrappedParagraph);
    const nextLineTops = await readTextLineTops(nextParagraph);
    expect(wrappedLineTops.length).toBeGreaterThan(1);
    for (let index = 1; index < wrappedLineTops.length; index += 1) {
      expect(wrappedLineTops[index]! - wrappedLineTops[index - 1]!).toBeCloseTo(
        expectedLineHeight,
        0,
      );
    }
    const blockBaselineDelta = nextLineTops[0]! - wrappedLineTops.at(-1)!;
    expect(blockBaselineDelta).toBeGreaterThan(expectedLineHeight);
    expect(blockBaselineDelta).toBeLessThanOrEqual(expectedLineHeight + 18);

    const firstListItemTops = await readTextLineTops(firstListItem);
    const secondListItemTops = await readTextLineTops(secondListItem);
    expect(firstListItemTops.length).toBeGreaterThan(1);
    for (let index = 1; index < firstListItemTops.length; index += 1) {
      expect(firstListItemTops[index]! - firstListItemTops[index - 1]!).toBeCloseTo(
        expectedLineHeight,
        0,
      );
    }
    expect(secondListItemTops[0]! - firstListItemTops.at(-1)!).toBeCloseTo(
      expectedLineHeight + 8,
      0,
    );

    expect((await readLeafTextStyle(strong)).fontWeight).toBe("700");
    expect((await readLeafTextStyle(heading)).fontSize).toBeGreaterThan(16);
    expect((await readLeafTextStyle(inlineCode)).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");

    const externalColor = (await readLeafTextStyle(externalLink)).color;
    expect((await readLeafTextStyle(fileLink)).color).toBe(externalColor);
    await expect(externalLink.locator("xpath=ancestor::a[1]")).toHaveAttribute(
      "href",
      "https://example.com",
    );
    await expect(fileLink.locator("xpath=ancestor::a[1]")).toHaveAttribute("href", "target.ts#L42");

    await expect(page.getByText(/^Worked for /).last()).toBeVisible();
    await expect(page.getByTestId("assistant-turn-completed-at").last()).toBeVisible();
    await expect(page.getByTestId("assistant-turn-completed-at").last()).toHaveText(
      /\d{1,2}:\d{2}/,
    );

    expect(
      await assistant.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
    const screenshotPath = testInfo.outputPath("final-answer-markdown-960x900-16px.png");
    await assistant.screenshot({ path: screenshotPath });
    await testInfo.attach("final-answer-markdown-960x900-16px", {
      path: screenshotPath,
      contentType: "image/png",
    });
  } finally {
    await agent.cleanup();
  }
});

async function expectInterfaceFontSize(locator: Locator, expected: number): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  const metrics = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fontSize: Number.parseFloat(style.fontSize),
      lineHeight: Number.parseFloat(style.lineHeight),
      height: element.getBoundingClientRect().height,
    };
  });
  expect(metrics.fontSize).toBe(expected);
  expect(metrics.height).toBeGreaterThanOrEqual(expected);
  if (Number.isFinite(metrics.lineHeight)) {
    expect(metrics.lineHeight).toBeGreaterThanOrEqual(expected);
  }
}

test("renders sidebar activity time as secondary metadata", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "sidebar-activity-time-",
    title: "Sidebar activity time",
    initialPrompt: "Show the sidebar activity metadata.",
  });

  try {
    await agent.client.waitForFinish(agent.agentId, 30_000);
    await openAgentRoute(page, agent);
    await expectComposerVisible(page);
    await setStoredFontSize(page, "uiFontSize", 16);

    const sidebarRow = page
      .getByTestId(`sidebar-workspace-row-${getServerId()}:${agent.workspaceId}`)
      .filter({ visible: true })
      .first();
    const sidebarTitle = sidebarRow.getByText(agent.workspaceName, { exact: true });
    const activityTime = sidebarRow.getByTestId("sidebar-workspace-activity-time");
    await expect(sidebarTitle).toBeVisible();
    await expect(activityTime).toBeVisible();

    const titleStyle = await sidebarTitle.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        color: style.color,
        fontSize: Number.parseFloat(style.fontSize),
      };
    });
    const activityStyle = await activityTime.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        color: style.color,
        fontSize: Number.parseFloat(style.fontSize),
        horizontalOverflow: element.scrollWidth > element.clientWidth + 1,
        whiteSpace: style.whiteSpace,
      };
    });

    expect(titleStyle.fontSize).toBe(16);
    expect(activityStyle.fontSize).toBe(13);
    expect(activityStyle.color).not.toBe(titleStyle.color);
    expect(activityStyle.whiteSpace).toBe("nowrap");
    expect(activityStyle.horizontalOverflow).toBe(false);

    const desktopScreenshotPath = testInfo.outputPath("sidebar-activity-time-desktop-16px.png");
    await page.screenshot({ path: desktopScreenshotPath });
    await testInfo.attach("sidebar-activity-time-desktop-16px", {
      path: desktopScreenshotPath,
      contentType: "image/png",
    });

    for (const [interfaceSize, expectedActivitySize] of [
      [20, 16],
      [24, 19],
      [11, 10],
    ] as const) {
      await setStoredFontSize(page, "uiFontSize", interfaceSize);
      await expect(sidebarTitle).toBeVisible();
      await expect(activityTime).toBeVisible();
      expect((await readTypography(sidebarTitle)).fontSize).toBe(interfaceSize);
      expect((await readTypography(activityTime)).fontSize).toBe(expectedActivitySize);
      expect(expectedActivitySize).toBeLessThan(interfaceSize);
    }

    await setStoredFontSize(page, "uiFontSize", 16);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await expect(page.getByTestId("sidebar-sessions")).toBeInViewport({ ratio: 1 });
    await expect(sidebarTitle).toBeVisible();
    await expect(activityTime).toBeVisible();

    const [compactTitleBox, compactActivityBox] = await Promise.all([
      sidebarTitle.boundingBox(),
      activityTime.boundingBox(),
    ]);
    if (!compactTitleBox || !compactActivityBox) {
      throw new Error("Expected sidebar title and activity time geometry in compact view");
    }
    expect(compactTitleBox.x + compactTitleBox.width).toBeLessThanOrEqual(compactActivityBox.x + 1);
    expect((await readTypography(activityTime)).fontSize).toBe(13);
    expect(
      await activityTime.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);

    const compactScreenshotPath = testInfo.outputPath("sidebar-activity-time-compact-16px.png");
    await page.screenshot({ path: compactScreenshotPath });
    await testInfo.attach("sidebar-activity-time-compact-16px", {
      path: compactScreenshotPath,
      contentType: "image/png",
    });
  } finally {
    await agent.cleanup();
  }
});

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
    await expect.poll(async () => (await readTypography(uiHeader)).fontSize).toBe(20);
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
    const resetWorkspace = await readWorkspaceTypography(page, prompt);
    expect(resetWorkspace.user).toEqual(initialWorkspace.user);
    expect(resetWorkspace.assistant).toEqual(initialWorkspace.assistant);
    expect(resetWorkspace.composer).toEqual(initialWorkspace.composer);
    expect(resetWorkspace.code).toEqual({
      fontFamily: initialWorkspace.code.fontFamily,
      fontSize: 12,
      lineHeight: 18,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    for (const size of [24, 11]) {
      await setStoredFontSize(page, "workspaceFontSize", size);
      const locators = workspaceTypographyLocators(page, prompt);
      await expandCompletedActivity(page, locators.assistant);
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

test("uses one configured size across interface surfaces", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "interface-typography-",
    title: "Interface typography",
  });

  try {
    await openAgentRoute(page, agent);
    await expectComposerVisible(page);

    for (const size of [20, 24, 11]) {
      await setStoredFontSize(page, "uiFontSize", size);
      const sidebarLabel = page
        .getByTestId(`sidebar-workspace-row-${getServerId()}:${agent.workspaceId}`)
        .filter({ visible: true })
        .first()
        .getByText(agent.workspaceName, { exact: true });
      const tabLabel = page
        .getByTestId(`workspace-tab-agent_${agent.agentId}`)
        .filter({ visible: true })
        .first()
        .getByText("Interface typography", { exact: true });
      await expectInterfaceFontSize(sidebarLabel, size);
      await expectInterfaceFontSize(tabLabel, size);

      const settingsHeader = await openAppearanceSettings(page);
      for (const locator of [
        settingsHeader,
        page.getByRole("textbox", { name: "Interface font size", exact: true }),
        page.getByText(
          "Used for navigation, controls, and labels. Leave empty for the system default",
          { exact: true },
        ),
      ]) {
        await expectInterfaceFontSize(locator, size);
      }
      await testInfo.attach(`interface-font-${size}-desktop`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
      await returnToWorkspace(page);
    }
  } finally {
    await agent.cleanup();
  }
});
