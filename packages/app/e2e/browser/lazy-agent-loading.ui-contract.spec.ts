import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { expectComposerVisible, submitMessage } from "../support/helpers/composer";
import { installDaemonWebSocketGate } from "../support/helpers/daemon-websocket-gate";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

const APP_SETTINGS_KEY = "@paseo:app-settings";
const REPLICA_CACHE_KEY = "@paseo:replica-cache";

/** Enables lazy loading before the App reads its persisted settings */
async function enableLazyAgentLoading(page: Page): Promise<void> {
  await page.addInitScript((settingsKey) => {
    const raw = localStorage.getItem(settingsKey);
    const settings = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    localStorage.setItem(settingsKey, JSON.stringify({ ...settings, lazyLoadAgents: true }));
  }, APP_SETTINGS_KEY);
}

/** Verifies that the next App boot read the persisted lazy-loading preference */
async function expectLazyAgentLoadingEnabled(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const raw = await page.evaluate(
        (settingsKey) => localStorage.getItem(settingsKey),
        APP_SETTINGS_KEY,
      );
      if (!raw) return false;
      try {
        return (JSON.parse(raw) as { lazyLoadAgents?: unknown }).lazyLoadAgents === true;
      } catch {
        return false;
      }
    })
    .toBe(true);
}

/** Waits until the focused agent's canonical prompt has reached the local replica cache */
async function waitForCachedPrompt(page: Page, agentId: string, prompt: string): Promise<void> {
  await expect
    .poll(async () => {
      const raw = await page.evaluate(
        (cacheKey) => localStorage.getItem(cacheKey),
        REPLICA_CACHE_KEY,
      );
      if (!raw) return false;
      try {
        const cache = JSON.parse(raw) as {
          hosts?: Array<{
            timeline?: {
              agentId?: string;
              items?: Array<{ kind?: string; text?: string }>;
            } | null;
          }>;
        };
        return Boolean(
          cache.hosts?.some(
            (host) =>
              host.timeline?.agentId === agentId &&
              host.timeline.items?.some(
                (item) => item.kind === "user_message" && item.text === prompt,
              ),
          ),
        );
      } catch {
        return false;
      }
    })
    .toBe(true);
}

/** Creates a mock Agent with finished provider history ready to cache or close */
async function seedFinishedMockAgent(input: {
  repoPrefix: string;
  title: string;
  initialPrompt: string;
}) {
  const agent = await seedMockAgentWorkspace({
    ...input,
    model: "e2e-fast-stream",
  });
  await agent.client.waitForFinish(agent.agentId, 30_000);
  return agent;
}

/** Releases an Agent runtime while keeping its durable provider history available */
async function closeMockAgent(
  agent: Awaited<ReturnType<typeof seedFinishedMockAgent>>,
): Promise<void> {
  await expect(agent.client.closeAgentRuntime(agent.agentId)).resolves.toMatchObject({
    closed: true,
  });
}

/** Confirms the daemon exposes the released Agent as closed before the passive App open */
async function expectMockAgentClosed(
  agent: Awaited<ReturnType<typeof seedFinishedMockAgent>>,
): Promise<void> {
  await expect
    .poll(async () => {
      const result = await agent.client.fetchAgent({ agentId: agent.agentId });
      return (result?.agent as { status?: unknown } | undefined)?.status ?? null;
    })
    .toBe("closed");
}

/** Confirms the directory source used by lazy loading has the closed Agent state */
async function expectMockAgentClosedInDirectory(
  agent: Awaited<ReturnType<typeof seedFinishedMockAgent>>,
): Promise<void> {
  await expect
    .poll(async () => {
      const result = await agent.client.fetchAgents({ scope: "active" });
      return result.entries.find((entry) => entry.agent.id === agent.agentId)?.agent.status ?? null;
    })
    .toBe("closed");
}

/** Returns only timeline requests directed at the Agent under test */
function agentTimelineRequests(
  gate: Awaited<ReturnType<typeof installDaemonWebSocketGate>>,
  agentId: string,
) {
  return gate
    .getClientRequests("fetch_agent_timeline_request")
    .filter((request) => request.agentId === agentId);
}

test.describe("Lazy Agent loading", () => {
  test.describe.configure({ timeout: 120_000 });

  test("keeps a closed Agent on local cache until the user explicitly starts it", async ({
    page,
  }) => {
    const gate = await installDaemonWebSocketGate(page);
    const initialPrompt = "Keep this closed Agent history local until explicit start.";
    const agent = await seedFinishedMockAgent({
      repoPrefix: "lazy-agent-manual-start-",
      title: "Lazy manual start",
      initialPrompt,
    });

    try {
      // Prime the browser's replica while the normal eager behavior is still active.
      await openAgentRoute(page, agent);
      await expect(page.getByText(initialPrompt, { exact: true }).first()).toBeVisible();
      await waitForCachedPrompt(page, agent.agentId, initialPrompt);

      // The passive reopen represents a later App session, after the eager cache warm-up page ended
      await page.goto("about:blank");
      await closeMockAgent(agent);
      await expectMockAgentClosed(agent);
      await expectMockAgentClosedInDirectory(agent);

      const timelineRequestCountBeforePassiveOpen = agentTimelineRequests(
        gate,
        agent.agentId,
      ).length;
      await enableLazyAgentLoading(page);
      await openAgentRoute(page, agent);
      await expectLazyAgentLoadingEnabled(page);
      await expectComposerVisible(page);
      await expect(page.getByText(initialPrompt, { exact: true }).first()).toBeVisible();
      await expect(page.getByTestId("agent-lazy-timeline-callout")).toBeVisible();
      await expect(page.getByTestId("agent-lazy-start")).toBeVisible();
      expect(agentTimelineRequests(gate, agent.agentId)).toHaveLength(
        timelineRequestCountBeforePassiveOpen,
      );

      await page.getByTestId("agent-lazy-start").click();

      await expect
        .poll(
          () =>
            agentTimelineRequests(gate, agent.agentId).at(timelineRequestCountBeforePassiveOpen) ??
            null,
        )
        .toMatchObject({
          agentId: agent.agentId,
          direction: "tail",
          projection: "projected",
        });
      await expect(page.getByTestId("agent-lazy-timeline-callout")).not.toBeVisible();
    } finally {
      await agent.cleanup();
    }
  });

  test("starts a closed Agent only after the user sends a message", async ({ page }) => {
    const gate = await installDaemonWebSocketGate(page);
    await enableLazyAgentLoading(page);
    const initialPrompt = "Keep this closed Agent history local until a message is sent.";
    const sentPrompt = "Start this Agent by sending this message.";
    const agent = await seedFinishedMockAgent({
      repoPrefix: "lazy-agent-send-message-",
      title: "Lazy send start",
      initialPrompt,
    });

    try {
      await closeMockAgent(agent);
      await expectMockAgentClosed(agent);
      await expectMockAgentClosedInDirectory(agent);
      await openAgentRoute(page, agent);
      await expectLazyAgentLoadingEnabled(page);
      await expectComposerVisible(page);
      expect(agentTimelineRequests(gate, agent.agentId)).toEqual([]);
      await expect(page.getByTestId("agent-lazy-timeline-callout")).toBeVisible();

      await submitMessage(page, sentPrompt);

      await expect.poll(() => gate.getClientRequestCount("send_agent_message_request")).toBe(1);
      await agent.client.waitForFinish(agent.agentId, 30_000);
      await expect(page.getByText(sentPrompt, { exact: true }).last()).toBeVisible();
      await expect.poll(() => agentTimelineRequests(gate, agent.agentId).length).toBeGreaterThan(0);
      await expect(page.getByTestId("agent-lazy-timeline-callout")).not.toBeVisible();
    } finally {
      await agent.cleanup();
    }
  });
});
