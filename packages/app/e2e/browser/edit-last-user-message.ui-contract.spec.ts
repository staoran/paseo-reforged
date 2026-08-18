import { expect, test, type Page } from "../support/fixtures";
import { expectAgentIdle } from "../support/helpers/agent-stream";
import { installDaemonWebSocketGate } from "../support/helpers/daemon-websocket-gate";
import {
  attachImageFromMenu,
  cancelAgent,
  composerLocator,
  expectAttachmentPill,
  expectComposerDraft,
  expectComposerEditable,
  expectComposerVisible,
  submitMessage,
} from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { getWorkspaceTabTestIds } from "../support/helpers/workspace-tabs";

const EDIT_REQUEST_TYPE = "agent.edit_last_user_message.request";
const UNKNOWN_HISTORY_MESSAGE =
  "The conversation state could not be confirmed. Your edit was restored while history refreshes.";
const TEST_IMAGE = {
  name: "edit-gate.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  ),
};

function userMessage(page: Page, text: string) {
  return page.getByTestId("user-message").filter({ hasText: text });
}

function observeEditRequests(page: Page) {
  const requests: Array<Record<string, unknown>> = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      if (typeof payload !== "string") return;
      try {
        const envelope = JSON.parse(payload) as {
          type?: unknown;
          message?: Record<string, unknown>;
        } & Record<string, unknown>;
        const message = envelope.type === "session" ? envelope.message : envelope;
        if (message?.type === EDIT_REQUEST_TYPE) {
          requests.push(message);
        }
      } catch {
        // Ignore non-JSON frames from unrelated transports.
      }
    });
  });
  return requests;
}

function sortedIds(values: Array<{ id: string }>): string[] {
  return values.map((value) => value.id).sort();
}

test.describe("Edit latest user message", () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page }) => {
    await installDaemonWebSocketGate(page);
  });

  test("regenerates from the latest idle text message without creating navigation or session state", async ({
    page,
  }) => {
    const firstPrompt = "emit 1 coalesced agent stream updates for the first edit turn.";
    const latestPrompt = "emit 1 coalesced agent stream updates for the latest edit turn.";
    const replacementPrompt =
      "emit 1 coalesced agent stream updates for the edited replacement turn.";
    const editRequests = observeEditRequests(page);
    const session = await seedMockAgentWorkspace({
      repoPrefix: "edit-last-user-message-e2e-",
      title: "Edit latest user message e2e",
      initialPrompt: firstPrompt,
      featureValues: { mockEditLastUserMessageDelayMs: 1_200 },
    });

    try {
      await session.client.waitForFinish(session.agentId, 30_000);
      await openAgentRoute(page, session);
      await expectComposerVisible(page);
      await expect(userMessage(page, firstPrompt)).toBeVisible({ timeout: 15_000 });

      await submitMessage(page, latestPrompt);
      await expect(userMessage(page, latestPrompt)).toBeVisible({ timeout: 15_000 });
      await expectAgentIdle(page);

      const firstMessage = userMessage(page, firstPrompt);
      const latestMessage = userMessage(page, latestPrompt);
      await firstMessage.hover();
      await expect(firstMessage.getByTestId("edit-last-user-message-trigger")).toHaveCount(0);
      await latestMessage.hover();
      const editTrigger = latestMessage.getByTestId("edit-last-user-message-trigger");
      await expect(editTrigger).toBeVisible();

      const routeBefore = page.url();
      const browserPageCountBefore = page.context().pages().length;
      const tabIdsBefore = await getWorkspaceTabTestIds(page);
      const workspaceIdsBefore = sortedIds((await session.client.fetchWorkspaces()).entries);
      const agentIdsBefore = sortedIds(
        (await session.client.fetchAgents({ scope: "active" })).entries.map(({ agent }) => agent),
      );
      const providerSessionsBefore = await session.client.fetchRecentProviderSessions({
        cwd: session.cwd,
        providers: ["mock"],
        limit: 20,
      });

      await editTrigger.click();
      const editor = page.getByTestId("edit-last-user-message-editor");
      const input = editor.getByRole("textbox", { name: "Edit message" });
      await expect(input).toHaveValue(latestPrompt);
      await editor.getByRole("button", { name: "Cancel edit" }).click();
      await expect(editor).toHaveCount(0);
      expect(editRequests).toHaveLength(0);

      await latestMessage.hover();
      await latestMessage.getByTestId("edit-last-user-message-trigger").click();
      const reopenedEditor = page.getByTestId("edit-last-user-message-editor");
      const reopenedInput = reopenedEditor.getByRole("textbox", { name: "Edit message" });
      await expect(reopenedInput).toHaveValue(latestPrompt);
      await reopenedInput.fill(replacementPrompt);
      const submit = reopenedEditor.getByRole("button", { name: "Submit edit" });
      await expect(submit).toBeEnabled();
      await submit.evaluate((element) => {
        (element as HTMLElement).click();
        (element as HTMLElement).click();
      });

      await expect(reopenedInput).not.toBeEditable();
      await expect(reopenedEditor.getByRole("button", { name: "Cancel edit" })).toBeDisabled();
      await expect(submit).toBeDisabled();
      await expect.poll(() => editRequests.length).toBe(1);

      await expect(reopenedEditor).toHaveCount(0);
      const replacementMessage = userMessage(page, replacementPrompt);
      const unknownHistoryToast = page
        .getByTestId("app-toast-message")
        .filter({ hasText: UNKNOWN_HISTORY_MESSAGE });
      const editOutcome = await Promise.race([
        replacementMessage
          .waitFor({ state: "visible", timeout: 15_000 })
          .then(() => "replacement" as const),
        unknownHistoryToast
          .waitFor({ state: "visible", timeout: 15_000 })
          .then(() => "unknown" as const),
      ]);
      expect(editOutcome).toBe("replacement");
      await expect(replacementMessage).toHaveCount(1);
      await expect(userMessage(page, latestPrompt)).toHaveCount(0);
      await expect(userMessage(page, firstPrompt)).toBeVisible();
      await expectAgentIdle(page);
      await expect(unknownHistoryToast).toHaveCount(0);

      expect(editRequests[0]).toMatchObject({
        type: EDIT_REQUEST_TYPE,
        agentId: session.agentId,
        replacementText: replacementPrompt,
      });
      expect(page.url()).toBe(routeBefore);
      expect(page.context().pages()).toHaveLength(browserPageCountBefore);
      expect(await getWorkspaceTabTestIds(page)).toEqual(tabIdsBefore);
      expect(sortedIds((await session.client.fetchWorkspaces()).entries)).toEqual(
        workspaceIdsBefore,
      );
      expect(
        sortedIds(
          (await session.client.fetchAgents({ scope: "active" })).entries.map(({ agent }) => agent),
        ),
      ).toEqual(agentIdsBefore);
      const providerSessionsAfter = await session.client.fetchRecentProviderSessions({
        cwd: session.cwd,
        providers: ["mock"],
        limit: 20,
      });
      expect(providerSessionsAfter.entries).toEqual(providerSessionsBefore.entries);
    } finally {
      await session.cleanup();
    }
  });

  test("hides the edit action while running and when the latest message has an attachment", async ({
    page,
  }) => {
    const firstPrompt = "emit 1 coalesced agent stream updates for the edit gate baseline.";
    const runningPrompt = "Keep this mock turn running while edit eligibility is checked.";
    const attachmentPrompt = "emit 1 coalesced agent stream updates for the attachment edit gate.";
    const session = await seedMockAgentWorkspace({
      repoPrefix: "edit-last-user-message-gates-e2e-",
      title: "Edit latest user message gates e2e",
      initialPrompt: firstPrompt,
      featureValues: {
        mockPersistHistoryAcrossResume: true,
        mockRewriteUserMessageIdOnInterrupt: true,
      },
    });

    try {
      await session.client.waitForFinish(session.agentId, 30_000);
      await openAgentRoute(page, session);
      await expectComposerVisible(page);
      await expect(userMessage(page, firstPrompt)).toBeVisible({ timeout: 15_000 });
      await userMessage(page, firstPrompt).hover();
      await expect(page.getByTestId("edit-last-user-message-trigger")).toHaveCount(1);

      await submitMessage(page, runningPrompt);
      await expect(page.getByRole("button", { name: /stop|cancel/i }).first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByTestId("edit-last-user-message-trigger")).toHaveCount(0);
      await cancelAgent(page);
      await session.client.waitForFinish(session.agentId, 30_000);
      await page.goto("about:blank");
      await session.client.closeAgentRuntime(session.agentId);
      await openAgentRoute(page, session);
      await expectAgentIdle(page);
      await expectComposerEditable(page);

      const stoppedMessage = userMessage(page, runningPrompt).last();
      await expect(stoppedMessage).toBeVisible({ timeout: 15_000 });
      await stoppedMessage.hover();
      const stoppedEditTrigger = stoppedMessage.getByTestId("edit-last-user-message-trigger");
      await expect(stoppedEditTrigger).toBeVisible();
      await stoppedEditTrigger.click();
      const stoppedEditor = page.getByTestId("edit-last-user-message-editor");
      await expect(stoppedEditor.getByRole("textbox", { name: "Edit message" })).toHaveValue(
        runningPrompt,
      );
      await stoppedEditor.getByRole("button", { name: "Cancel edit" }).click();
      await expect(stoppedEditor).toHaveCount(0);

      await attachImageFromMenu(page, TEST_IMAGE);
      await expectAttachmentPill(page, "composer-image-attachment-pill");
      await submitMessage(page, attachmentPrompt);
      await expect(userMessage(page, attachmentPrompt)).toBeVisible({ timeout: 15_000 });
      await expectAgentIdle(page);
      await userMessage(page, attachmentPrompt).hover();
      await expect(page.getByTestId("edit-last-user-message-trigger")).toHaveCount(0);
    } finally {
      await session.cleanup();
    }
  });

  test("restores the draft to the composer when provider history cannot be confirmed", async ({
    page,
  }) => {
    const originalPrompt = "emit 1 coalesced agent stream updates for failed edit recovery.";
    const replacementPrompt = "Keep this replacement draft after the edit failure.";
    const editRequests = observeEditRequests(page);
    const session = await seedMockAgentWorkspace({
      repoPrefix: "edit-last-user-message-failure-e2e-",
      title: "Edit latest user message failure e2e",
      initialPrompt: originalPrompt,
      featureValues: { mockRewindError: "Configured edit rewind failure" },
    });

    try {
      await session.client.waitForFinish(session.agentId, 30_000);
      await openAgentRoute(page, session);
      await expectComposerVisible(page);
      const routeBefore = page.url();
      const originalMessage = userMessage(page, originalPrompt);
      await expect(originalMessage).toBeVisible({ timeout: 15_000 });
      await originalMessage.hover();
      await originalMessage.getByTestId("edit-last-user-message-trigger").click();

      const editor = page.getByTestId("edit-last-user-message-editor");
      await editor.getByRole("textbox", { name: "Edit message" }).fill(replacementPrompt);
      await editor.getByRole("button", { name: "Submit edit" }).click();

      await expect(page.getByTestId("app-toast-message")).toHaveText(UNKNOWN_HISTORY_MESSAGE);
      await expect(editor).toHaveCount(0);
      await expectComposerDraft(page, replacementPrompt);
      await expectComposerEditable(page);
      await expect(originalMessage).toBeVisible();
      await expect(userMessage(page, replacementPrompt)).toHaveCount(0);
      expect(editRequests).toHaveLength(1);
      expect(page.url()).toBe(routeBefore);

      await composerLocator(page).evaluate((element) => element.blur());
      await originalMessage.hover();
      await expect(originalMessage.getByTestId("edit-last-user-message-trigger")).toBeVisible();
    } finally {
      await session.cleanup();
    }
  });
});
