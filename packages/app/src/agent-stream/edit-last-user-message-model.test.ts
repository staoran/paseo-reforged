import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import {
  beginLastUserMessageEdit,
  cancelLastUserMessageEdit,
  createLastUserMessageEditController,
  failLastUserMessageEditUnknown,
  finishLastUserMessageEditRecovery,
  prepareLastUserMessageEditSubmission,
  resolveLastUserMessageEdit,
  setLastUserMessageEditDraft,
  getEditableLastUserMessageId,
  getLastUserMessageEditControls,
} from "./edit-last-user-message-model";

function userMessage(
  id: string,
  overrides: Partial<Extract<StreamItem, { kind: "user_message" }>> = {},
): Extract<StreamItem, { kind: "user_message" }> {
  return {
    kind: "user_message",
    id,
    text: `message ${id}`,
    timestamp: new Date("2026-08-03T12:00:00.000Z"),
    replayKind: "text_only",
    ...overrides,
  };
}

describe("getEditableLastUserMessageId", () => {
  it("selects the latest canonical text-only user message when the feature is idle and supported", () => {
    const tail: StreamItem[] = [
      userMessage("older"),
      {
        kind: "assistant_message",
        id: "answer",
        text: "answer",
        timestamp: new Date("2026-08-03T12:00:01.000Z"),
      },
    ];
    const head: StreamItem[] = [userMessage("latest")];

    expect(
      getEditableLastUserMessageId({
        tail,
        head,
        featureEnabled: true,
        capabilityEnabled: true,
        isAgentIdle: true,
        readOnly: false,
      }),
    ).toBe("latest");
  });

  it.each([
    ["the daemon feature is unavailable", { featureEnabled: false }, {}],
    ["the provider capability is unavailable", { capabilityEnabled: false }, {}],
    ["the agent is active", { isAgentIdle: false }, {}],
    ["the stream is read-only", { readOnly: true }, {}],
    ["the message is optimistic", {}, { optimistic: true as const }],
    ["the replay marker is absent", {}, { replayKind: undefined }],
    ["the message is blank", {}, { text: "  \n" }],
    [
      "the message has an image",
      {},
      {
        images: [
          {
            id: "image-1",
            mimeType: "image/png",
            storageType: "native-file" as const,
            storageKey: "C:\\temp\\image.png",
            createdAt: 1,
          },
        ],
      },
    ],
    [
      "the message has an attachment",
      {},
      {
        attachments: [
          {
            type: "text" as const,
            mimeType: "text/plain" as const,
            title: "context.txt",
            text: "context",
          },
        ],
      },
    ],
  ])("rejects the latest user message when %s", (_label, gateOverrides, itemOverrides) => {
    expect(
      getEditableLastUserMessageId({
        tail: [userMessage("latest", itemOverrides)],
        head: [],
        featureEnabled: true,
        capabilityEnabled: true,
        isAgentIdle: true,
        readOnly: false,
        ...gateOverrides,
      }),
    ).toBeNull();
  });

  it("does not skip a newer ineligible user message to expose an older edit action", () => {
    expect(
      getEditableLastUserMessageId({
        tail: [userMessage("older")],
        head: [userMessage("newer", { optimistic: true })],
        featureEnabled: true,
        capabilityEnabled: true,
        isAgentIdle: true,
        readOnly: false,
      }),
    ).toBeNull();
  });
});

describe("last user message edit transaction", () => {
  it("prepares one replacement request and enters pending state", () => {
    const editing = beginLastUserMessageEdit({
      messageId: "user-1",
      text: "original prompt",
    });
    const changed = setLastUserMessageEditDraft(editing, "replacement prompt");

    const submission = prepareLastUserMessageEditSubmission(changed, {
      agentId: "agent-1",
      isAgentIdle: true,
      replacementMessageId: "replacement-1",
    });

    expect(submission).toEqual({
      state: {
        phase: "pending",
        messageId: "user-1",
        originalText: "original prompt",
        draft: "replacement prompt",
      },
      request: {
        agentId: "agent-1",
        messageId: "user-1",
        replacementText: "replacement prompt",
        replacementMessageId: "replacement-1",
      },
    });
  });

  it("submits the original text to regenerate the latest answer", () => {
    const editing = beginLastUserMessageEdit({
      messageId: "user-1",
      text: "original prompt",
    });

    expect(getLastUserMessageEditControls(editing, true)).toEqual({
      canEdit: true,
      canCancel: true,
      canSubmit: true,
    });
    expect(
      prepareLastUserMessageEditSubmission(editing, {
        agentId: "agent-1",
        isAgentIdle: true,
        replacementMessageId: "replacement-1",
      }),
    ).toEqual({
      state: {
        phase: "pending",
        messageId: "user-1",
        originalText: "original prompt",
        draft: "original prompt",
      },
      request: {
        agentId: "agent-1",
        messageId: "user-1",
        replacementText: "original prompt",
        replacementMessageId: "replacement-1",
      },
    });
  });

  it("keeps the inline draft when the daemon proves history is unchanged", () => {
    const editing = setLastUserMessageEditDraft(
      beginLastUserMessageEdit({ messageId: "user-1", text: "original prompt" }),
      "replacement prompt",
    );
    const submission = prepareLastUserMessageEditSubmission(editing, {
      agentId: "agent-1",
      isAgentIdle: true,
      replacementMessageId: "replacement-1",
    });
    expect(submission).not.toBeNull();

    const resolved = resolveLastUserMessageEdit(submission!.state, {
      ok: false,
      historyState: "unchanged",
      replacementStarted: false,
      failureStage: "validation",
      error: "The target is no longer latest",
    });

    expect(resolved).toEqual({
      state: {
        phase: "editing",
        messageId: "user-1",
        originalText: "original prompt",
        draft: "replacement prompt",
      },
      effect: {
        kind: "unchanged",
        error: "The target is no longer latest",
      },
    });
  });

  it("moves the draft to the composer when history was rewound but replacement did not start", () => {
    const editing = setLastUserMessageEditDraft(
      beginLastUserMessageEdit({ messageId: "user-1", text: "original prompt" }),
      "replacement prompt",
    );
    const submission = prepareLastUserMessageEditSubmission(editing, {
      agentId: "agent-1",
      isAgentIdle: true,
      replacementMessageId: "replacement-1",
    });
    expect(submission).not.toBeNull();

    const resolved = resolveLastUserMessageEdit(submission!.state, {
      ok: false,
      historyState: "rewound",
      replacementStarted: false,
      failureStage: "start_turn",
      error: "Replacement turn failed to start",
    });

    expect(resolved).toEqual({
      state: { phase: "closed" },
      effect: {
        kind: "restore_composer",
        draft: "replacement prompt",
        error: "Replacement turn failed to start",
      },
    });
  });

  it("locks the edit and requests composer recovery plus resync when history is unknown", () => {
    const editing = setLastUserMessageEditDraft(
      beginLastUserMessageEdit({ messageId: "user-1", text: "original prompt" }),
      "replacement prompt",
    );
    const submission = prepareLastUserMessageEditSubmission(editing, {
      agentId: "agent-1",
      isAgentIdle: true,
      replacementMessageId: "replacement-1",
    });
    expect(submission).not.toBeNull();

    const resolved = resolveLastUserMessageEdit(submission!.state, {
      ok: false,
      historyState: "unknown",
      replacementStarted: false,
      failureStage: "rewind",
      error: "Provider rewind result is unknown",
    });

    expect(resolved).toEqual({
      state: {
        phase: "recovering",
        messageId: "user-1",
        originalText: "original prompt",
        draft: "replacement prompt",
      },
      effect: {
        kind: "restore_composer_and_resync",
        draft: "replacement prompt",
        error: "Provider rewind result is unknown",
      },
    });
  });

  it("closes the editor only after the replacement turn started", () => {
    const editing = setLastUserMessageEditDraft(
      beginLastUserMessageEdit({ messageId: "user-1", text: "original prompt" }),
      "replacement prompt",
    );
    const submission = prepareLastUserMessageEditSubmission(editing, {
      agentId: "agent-1",
      isAgentIdle: true,
      replacementMessageId: "replacement-1",
    });
    expect(submission).not.toBeNull();

    const resolved = resolveLastUserMessageEdit(submission!.state, {
      ok: true,
      historyState: "rewound",
      replacementStarted: true,
      failureStage: null,
      error: null,
    });

    expect(resolved).toEqual({
      state: { phase: "closed" },
      effect: { kind: "success" },
    });
  });

  it("treats a transport failure as unknown history", () => {
    const editing = setLastUserMessageEditDraft(
      beginLastUserMessageEdit({ messageId: "user-1", text: "original prompt" }),
      "replacement prompt",
    );
    const submission = prepareLastUserMessageEditSubmission(editing, {
      agentId: "agent-1",
      isAgentIdle: true,
      replacementMessageId: "replacement-1",
    });
    expect(submission).not.toBeNull();

    expect(failLastUserMessageEditUnknown(submission!.state, "Connection closed")).toEqual({
      state: {
        phase: "recovering",
        messageId: "user-1",
        originalText: "original prompt",
        draft: "replacement prompt",
      },
      effect: {
        kind: "restore_composer_and_resync",
        draft: "replacement prompt",
        error: "Connection closed",
      },
    });
  });

  it("cancels an open editor without producing a request", () => {
    const editing = setLastUserMessageEditDraft(
      beginLastUserMessageEdit({ messageId: "user-1", text: "original prompt" }),
      "replacement prompt",
    );

    expect(cancelLastUserMessageEdit(editing)).toEqual({ phase: "closed" });
  });

  it("derives submit availability and locks every control while pending or recovering", () => {
    const unchanged = beginLastUserMessageEdit({
      messageId: "user-1",
      text: "original prompt",
    });
    const changed = setLastUserMessageEditDraft(unchanged, "replacement prompt");
    const submission = prepareLastUserMessageEditSubmission(changed, {
      agentId: "agent-1",
      isAgentIdle: true,
      replacementMessageId: "replacement-1",
    });
    expect(submission).not.toBeNull();
    const recovery = failLastUserMessageEditUnknown(submission!.state, "Connection closed");

    expect([
      getLastUserMessageEditControls(unchanged, true),
      getLastUserMessageEditControls(changed, false),
      getLastUserMessageEditControls(changed, true),
      getLastUserMessageEditControls(submission!.state, true),
      getLastUserMessageEditControls(recovery.state, true),
    ]).toEqual([
      { canEdit: true, canCancel: true, canSubmit: true },
      { canEdit: true, canCancel: true, canSubmit: false },
      { canEdit: true, canCancel: true, canSubmit: true },
      { canEdit: false, canCancel: false, canSubmit: false },
      { canEdit: false, canCancel: false, canSubmit: false },
    ]);
  });

  it("unlocks only after authoritative recovery finishes", () => {
    const editing = setLastUserMessageEditDraft(
      beginLastUserMessageEdit({ messageId: "user-1", text: "original prompt" }),
      "replacement prompt",
    );
    const submission = prepareLastUserMessageEditSubmission(editing, {
      agentId: "agent-1",
      isAgentIdle: true,
      replacementMessageId: "replacement-1",
    });
    expect(submission).not.toBeNull();
    const recovery = failLastUserMessageEditUnknown(submission!.state, "Connection closed");

    expect(finishLastUserMessageEditRecovery(recovery.state)).toEqual({ phase: "closed" });
  });

  it("publishes controller state changes without reopening a pending transaction", () => {
    const controller = createLastUserMessageEditController();
    const phases: string[] = [];
    const unsubscribe = controller.subscribe(() => phases.push(controller.getState().phase));

    controller.begin({ messageId: "user-1", text: "original prompt" });
    controller.setDraft("replacement prompt");
    const submission = controller.prepareSubmission({
      agentId: "agent-1",
      isAgentIdle: true,
      replacementMessageId: "replacement-1",
    });
    controller.begin({ messageId: "user-2", text: "another prompt" });
    controller.cancel();
    unsubscribe();

    expect({ phases, submission, state: controller.getState() }).toEqual({
      phases: ["editing", "editing", "pending"],
      submission: {
        agentId: "agent-1",
        messageId: "user-1",
        replacementText: "replacement prompt",
        replacementMessageId: "replacement-1",
      },
      state: {
        phase: "pending",
        messageId: "user-1",
        originalText: "original prompt",
        draft: "replacement prompt",
      },
    });
  });
});
