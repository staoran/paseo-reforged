import { expect, test } from "../support/fixtures";
import {
  installGoalControlFixture,
  PARTIAL_TERMINATE_MESSAGE,
} from "../support/helpers/goal-control";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

/** Stable generation used to verify optimistic concurrency across Goal edits. */
const INITIAL_GENERATION = "2026-08-18T08:00:00.000Z";

/** Retryable provider failure used to prove update error recovery in rendered UI. */
const PAUSE_FAILURE_MESSAGE = "The provider could not pause this Goal.";

test.describe("Goal controls", () => {
  test("controls and recovers a provider-owned Goal above the composer", async ({ page }) => {
    test.setTimeout(120_000);
    const session = await seedMockAgentWorkspace({
      repoPrefix: "goal-control-",
      title: "Goal control e2e",
      initialPrompt: "emit 2 agent stream updates",
    });

    try {
      await session.client.waitForFinish(session.agentId, 15_000);
      const fixture = await installGoalControlFixture(page, {
        agentId: session.agentId,
        goal: {
          objective: "Ship complete Goal controls",
          status: "active",
          tokenBudget: 10_000,
          tokensUsed: 2_500,
          timeUsedSeconds: 90,
          createdAt: INITIAL_GENERATION,
          updatedAt: "2026-08-18T08:01:30.000Z",
        },
        goalStep: {
          generation: INITIAL_GENERATION,
          ordinal: 1,
          text: "Implement Goal controls",
          activeForm: "Implementing Goal controls",
          status: "in_progress",
        },
      });

      await openAgentRoute(page, session);

      const goalTrack = page.getByTestId("goal-track");
      await expect(goalTrack).toBeVisible({ timeout: 60_000 });
      await expect(goalTrack).toContainText("Ship complete Goal controls");
      await expect(goalTrack).toContainText("Implementing Goal controls");
      await expect(goalTrack).toContainText("3k / 10k tokens · 1m 30s");
      await expect(page.getByLabel("Tasks", { exact: true })).toHaveCount(0);

      fixture.failNextUpdate("pause", PAUSE_FAILURE_MESSAGE);
      await page.getByRole("button", { name: "Pause Goal" }).click();
      await expect(page.getByTestId("goal-track-error")).toHaveText(PAUSE_FAILURE_MESSAGE);
      await expect(page.getByRole("button", { name: "Pause Goal" })).toBeEnabled();

      await page.getByRole("button", { name: "Pause Goal" }).click();
      await expect(page.getByText("Paused", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Edit Goal" }).click();
      await expect(
        page.getByText("Saving starts a new Goal generation and resets its usage counters.", {
          exact: true,
        }),
      ).toBeVisible();
      await page.getByTestId("goal-editor-objective").fill("  Ship edited Goal controls  ");
      await page.getByRole("button", { name: "Save Goal" }).click();
      await expect(page.getByText("Ship edited Goal controls", { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Resume Goal" }).click();
      await expect(page.getByText("Active", { exact: true })).toBeVisible();

      fixture.setSnapshotSync("stale");
      await fixture.drop();
      fixture.restore();
      await expect(page.getByRole("button", { name: "Retry Goal sync" })).toBeVisible({
        timeout: 30_000,
      });
      await page.getByRole("button", { name: "Retry Goal sync" }).click();
      await expect(page.getByRole("button", { name: "Pause Goal" })).toBeEnabled();

      await page.getByRole("button", { name: "Terminate Goal" }).click();
      await expect(page.getByTestId("goal-track")).toHaveCount(0);
      await expect(page.getByText(PARTIAL_TERMINATE_MESSAGE, { exact: true })).toBeVisible();

      const requests = fixture.requests();
      expect(requests.find((request) => request.operation === "pause")?.expectedGeneration).toBe(
        INITIAL_GENERATION,
      );
      const editGeneration = requests.find(
        (request) => request.operation === "replace_objective",
      )?.expectedGeneration;
      expect(editGeneration).toBe(INITIAL_GENERATION);
      const resumedGeneration = requests.find(
        (request) => request.operation === "resume",
      )?.expectedGeneration;
      expect(resumedGeneration).not.toBe(INITIAL_GENERATION);
      expect(
        requests.find((request) => request.operation === "terminate")?.expectedGeneration,
      ).toBe(resumedGeneration);
      expect(requests.some((request) => request.operation === "get")).toBe(true);
    } finally {
      await session.cleanup();
    }
  });

  test("hides a projected Goal when the daemon does not advertise the capability", async ({
    page,
  }) => {
    const session = await seedMockAgentWorkspace({
      repoPrefix: "goal-control-old-daemon-",
      title: "Goal capability gate e2e",
    });

    try {
      await installGoalControlFixture(page, {
        agentId: session.agentId,
        supported: false,
        goal: {
          objective: "Do not show this unsupported Goal",
          status: "active",
          tokenBudget: null,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: INITIAL_GENERATION,
          updatedAt: INITIAL_GENERATION,
        },
        goalStep: null,
      });

      await openAgentRoute(page, session);
      await expect(page.getByTestId("goal-track")).toHaveCount(0);
      await expect(
        page.getByText("Do not show this unsupported Goal", { exact: true }),
      ).toHaveCount(0);
    } finally {
      await session.cleanup();
    }
  });
});
