import { expect, test } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import {
  withAcpStreamingMarkdown,
  requestAcpMarkdown,
  expectAcpMarkdown,
  reloadAcpMarkdown,
} from "../support/helpers/acp-streaming-markdown";
import {
  expectFinishedMarkdown,
  expectReloadedMarkdown,
  expectUnfinishedBold,
  expectUnfinishedLink,
  requestStreamingMarkdown,
  withStreamingMarkdown,
} from "../support/helpers/streaming-markdown";

test("formats unfinished Markdown while streaming and preserves the completed rendering", async ({
  page,
}, testInfo) => {
  await withStreamingMarkdown(page, testInfo, async (agent) => {
    await requestStreamingMarkdown(agent);
    await expectUnfinishedBold(page);
    await expectUnfinishedLink(page, agent, testInfo);
    await expectFinishedMarkdown(page, agent, testInfo);
    await expectReloadedMarkdown(page);
  });
});

test("renders punctuation-adjacent strong text at weight 700 after reopening", async ({
  page,
}, testInfo) => {
  const response = "**外发员工预请款要单列一条线。**例如财务先给员工运营款 300 元";
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "punctuation-strong-",
    title: "Punctuation strong",
    initialPrompt: "Replay the final answer.",
    featureValues: { mockAssistantResponse: response },
  });
  try {
    await agent.client.waitForAgentUpsert(agent.agentId, (snapshot) => snapshot.status === "idle");
    await openAgentRoute(page, agent);
    const message = page.getByTestId("assistant-message").last();
    const strong = message.locator('[data-paseo-markdown-tag="strong"]');
    await expect(strong).toHaveText("外发员工预请款要单列一条线。");
    await expect(strong).toHaveCSS("font-weight", "700");
    await expect(message).toHaveText(response.replaceAll("**", ""));
    await testInfo.attach("punctuation-strong-completed", {
      body: await page.screenshot(),
      contentType: "image/png",
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(strong).toHaveText("外发员工预请款要单列一条线。");
    await expect(strong).toHaveCSS("font-weight", "700");
    await expect(message).toHaveText(response.replaceAll("**", ""));
  } finally {
    await agent.cleanup();
  }
});

for (const width of [1100, 390]) {
  test(`ACP plugin chunks preserve Markdown and separate turns at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await withAcpStreamingMarkdown(page, async (agent) => {
      await requestAcpMarkdown(agent);
      await expectAcpMarkdown(page, 1);
      await requestAcpMarkdown(agent);
      await expectAcpMarkdown(page, 2);
      await reloadAcpMarkdown(page, testInfo);
    });
  });
}
