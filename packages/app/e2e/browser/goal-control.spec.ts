import { expect, test } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

/** Retryable manager error returned after the mock provider rejects one update. */
const PAUSE_FAILURE_MESSAGE = "Failed to update the Agent Goal in the provider.";

/** Partial-success error returned when Goal clear succeeds but turn interruption fails. */
const PARTIAL_TERMINATE_MESSAGE =
  "The Goal was cleared, but its active turn could not be interrupted.";

test.describe("Goal controls", () => {
  test("controls and recovers a provider-owned Goal through the real daemon", async ({ page }) => {
    test.setTimeout(120_000);
    const session = await seedMockAgentWorkspace({
      repoPrefix: "goal-control-",
      title: "Goal control e2e",
      model: "five-minute-stream",
      initialPrompt: "Keep the Goal control turn running for termination.",
      featureValues: {
        mockGoalObjective: "Ship complete Goal controls",
        mockGoalStepText: "Implement Goal controls",
        mockGoalStepActiveForm: "Implementing Goal controls",
        mockGoalSetFailures: 1,
        mockInterruptFailures: 1,
      },
    });

    try {
      await openAgentRoute(page, session);

      const goalTrack = page.getByTestId("goal-track");
      await expect(goalTrack).toBeVisible({ timeout: 60_000 });
      await expect(goalTrack).toContainText("Ship complete Goal controls");
      await expect(goalTrack).toContainText("Implementing Goal controls");
      await expect(goalTrack).toContainText("3k / 10k tokens · 1m 30s");
      await expect(page.getByLabel("Tasks", { exact: true })).toHaveCount(0);

      await page.getByRole("button", { name: "Pause Goal" }).click();
      await expect(page.getByTestId("goal-track-error")).toHaveText(PAUSE_FAILURE_MESSAGE);
      await expect(page.getByRole("button", { name: "Retry Goal sync" })).toBeVisible();

      await page.reload();
      await expect(page.getByRole("button", { name: "Retry Goal sync" })).toBeVisible({
        timeout: 30_000,
      });
      await page.getByRole("button", { name: "Retry Goal sync" }).click();
      await expect(page.getByRole("button", { name: "Pause Goal" })).toBeEnabled();

      await page.getByRole("button", { name: "Pause Goal" }).click();
      await expect(page.getByText("Paused", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Edit Goal" }).click();
      await expect(
        page.getByText("Saving starts a new Goal generation and resets its usage counters.", {
          exact: true,
        }),
      ).toBeVisible();
      const pausedGoal = await session.client.getAgentGoal(session.agentId);
      expect(pausedGoal.goal?.status).toBe("paused");
      await session.client.updateAgentGoal(
        session.agentId,
        { kind: "resume" },
        { expectedGeneration: pausedGoal.goal?.createdAt },
      );
      await expect(page.getByTestId("goal-editor-objective")).toHaveCount(0);
      await expect(page.getByText("Active", { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Pause Goal" }).click();
      await expect(page.getByText("Paused", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Edit Goal" }).click();
      await page.getByTestId("goal-editor-objective").fill("  Ship edited Goal controls  ");
      await page.getByRole("button", { name: "Save Goal" }).click();
      await expect(page.getByText("Ship edited Goal controls", { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Resume Goal" }).click();
      await expect(page.getByText("Active", { exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Terminate Goal" }).click();
      await expect(page.getByTestId("goal-track")).toHaveCount(0);
      await expect(page.getByText(PARTIAL_TERMINATE_MESSAGE, { exact: true })).toBeVisible();
    } finally {
      await session.cleanup();
    }
  });

  test("hides the Goal track when the provider has no Goal control", async ({ page }) => {
    const session = await seedMockAgentWorkspace({
      repoPrefix: "goal-control-unsupported-provider-",
      title: "Goal capability gate e2e",
    });

    try {
      await openAgentRoute(page, session);
      await expect(page.getByTestId("goal-track")).toHaveCount(0);
    } finally {
      await session.cleanup();
    }
  });
});
