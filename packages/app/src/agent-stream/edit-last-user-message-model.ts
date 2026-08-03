import type { StreamItem, UserMessageItem } from "@/types/stream";

export interface EditableLastUserMessageInput {
  tail: readonly StreamItem[];
  head: readonly StreamItem[];
  featureEnabled: boolean;
  capabilityEnabled: boolean;
  isAgentIdle: boolean;
  readOnly: boolean;
}

interface LastUserMessageEditFields {
  messageId: string;
  originalText: string;
  draft: string;
}

const CLOSED_LAST_USER_MESSAGE_EDIT_STATE: LastUserMessageEditState = { phase: "closed" };

export type LastUserMessageEditState =
  | { phase: "closed" }
  | ({ phase: "editing" } & LastUserMessageEditFields)
  | ({ phase: "pending" } & LastUserMessageEditFields)
  | ({ phase: "recovering" } & LastUserMessageEditFields);

export interface LastUserMessageEditRequest {
  agentId: string;
  messageId: string;
  replacementText: string;
  replacementMessageId: string;
}

export interface LastUserMessageEditResponse {
  ok: boolean;
  historyState: "unchanged" | "rewound" | "unknown";
  replacementStarted: boolean;
  failureStage: "validation" | "rewind" | "hydrate" | "start_turn" | null;
  error: string | null;
}

export type LastUserMessageEditEffect =
  | { kind: "success" }
  | {
      kind: "unchanged";
      error: string | null;
    }
  | {
      kind: "restore_composer";
      draft: string;
      error: string | null;
    }
  | {
      kind: "restore_composer_and_resync";
      draft: string;
      error: string | null;
    };

export function beginLastUserMessageEdit(input: {
  messageId: string;
  text: string;
}): LastUserMessageEditState {
  return {
    phase: "editing",
    messageId: input.messageId,
    originalText: input.text,
    draft: input.text,
  };
}

export function setLastUserMessageEditDraft(
  state: LastUserMessageEditState,
  draft: string,
): LastUserMessageEditState {
  return state.phase === "editing" ? { ...state, draft } : state;
}

export function cancelLastUserMessageEdit(
  state: LastUserMessageEditState,
): LastUserMessageEditState {
  return state.phase === "editing" ? { phase: "closed" } : state;
}

export function getLastUserMessageEditControls(
  state: LastUserMessageEditState,
  isAgentIdle: boolean,
): { canEdit: boolean; canCancel: boolean; canSubmit: boolean } {
  if (state.phase !== "editing") {
    return { canEdit: false, canCancel: false, canSubmit: false };
  }
  return {
    canEdit: true,
    canCancel: true,
    canSubmit: isAgentIdle && state.draft.trim().length > 0 && state.draft !== state.originalText,
  };
}

export function prepareLastUserMessageEditSubmission(
  state: LastUserMessageEditState,
  input: { agentId: string; isAgentIdle: boolean; replacementMessageId: string },
): { state: LastUserMessageEditState; request: LastUserMessageEditRequest } | null {
  if (
    state.phase !== "editing" ||
    !input.isAgentIdle ||
    state.draft.trim().length === 0 ||
    state.draft === state.originalText
  ) {
    return null;
  }

  return {
    state: { ...state, phase: "pending" },
    request: {
      agentId: input.agentId,
      messageId: state.messageId,
      replacementText: state.draft,
      replacementMessageId: input.replacementMessageId,
    },
  };
}

export function resolveLastUserMessageEdit(
  state: LastUserMessageEditState,
  response: LastUserMessageEditResponse,
): { state: LastUserMessageEditState; effect: LastUserMessageEditEffect } {
  if (state.phase === "pending" && response.ok && response.replacementStarted) {
    return {
      state: { phase: "closed" },
      effect: { kind: "success" },
    };
  }
  if (state.phase === "pending" && !response.ok && response.historyState === "unchanged") {
    return {
      state: { ...state, phase: "editing" },
      effect: { kind: "unchanged", error: response.error },
    };
  }
  if (state.phase === "pending" && !response.ok && response.historyState === "rewound") {
    return {
      state: { phase: "closed" },
      effect: {
        kind: "restore_composer",
        draft: state.draft,
        error: response.error,
      },
    };
  }
  if (state.phase === "pending" && !response.ok && response.historyState === "unknown") {
    return {
      state: { ...state, phase: "recovering" },
      effect: {
        kind: "restore_composer_and_resync",
        draft: state.draft,
        error: response.error,
      },
    };
  }
  throw new Error("Unsupported edit-last-user-message response transition");
}

export function failLastUserMessageEditUnknown(
  state: LastUserMessageEditState,
  error: string,
): { state: LastUserMessageEditState; effect: LastUserMessageEditEffect } {
  return resolveLastUserMessageEdit(state, {
    ok: false,
    historyState: "unknown",
    replacementStarted: false,
    failureStage: null,
    error,
  });
}

export function finishLastUserMessageEditRecovery(
  state: LastUserMessageEditState,
): LastUserMessageEditState {
  return state.phase === "recovering" ? { phase: "closed" } : state;
}

export interface LastUserMessageEditController {
  getState(): LastUserMessageEditState;
  getMessageState(messageId: string): LastUserMessageEditState;
  subscribe(listener: () => void): () => void;
  begin(input: { messageId: string; text: string }): void;
  setDraft(draft: string): void;
  cancel(): void;
  prepareSubmission(input: {
    agentId: string;
    isAgentIdle: boolean;
    replacementMessageId: string;
  }): LastUserMessageEditRequest | null;
  resolve(response: LastUserMessageEditResponse): LastUserMessageEditEffect;
  failUnknown(error: string): LastUserMessageEditEffect;
  finishRecovery(): void;
}

export function createLastUserMessageEditController(): LastUserMessageEditController {
  let state = CLOSED_LAST_USER_MESSAGE_EDIT_STATE;
  const listeners = new Set<() => void>();

  const publish = (next: LastUserMessageEditState) => {
    if (next === state) {
      return;
    }
    state = next;
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    getState: () => state,
    getMessageState: (messageId) =>
      state.phase !== "closed" && state.messageId === messageId
        ? state
        : CLOSED_LAST_USER_MESSAGE_EDIT_STATE,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    begin: (input) => {
      if (state.phase === "closed") {
        publish(beginLastUserMessageEdit(input));
      }
    },
    setDraft: (draft) => {
      if (state.phase === "editing" && state.draft !== draft) {
        publish(setLastUserMessageEditDraft(state, draft));
      }
    },
    cancel: () => publish(cancelLastUserMessageEdit(state)),
    prepareSubmission: (input) => {
      const submission = prepareLastUserMessageEditSubmission(state, input);
      if (!submission) {
        return null;
      }
      publish(submission.state);
      return submission.request;
    },
    resolve: (response) => {
      const resolved = resolveLastUserMessageEdit(state, response);
      publish(resolved.state);
      return resolved.effect;
    },
    failUnknown: (error) => {
      const failed = failLastUserMessageEditUnknown(state, error);
      publish(failed.state);
      return failed.effect;
    },
    finishRecovery: () => publish(finishLastUserMessageEditRecovery(state)),
  };
}

function findLatestUserMessage(
  tail: readonly StreamItem[],
  head: readonly StreamItem[],
): UserMessageItem | null {
  for (let index = head.length - 1; index >= 0; index -= 1) {
    const item = head[index];
    if (item?.kind === "user_message") {
      return item;
    }
  }
  for (let index = tail.length - 1; index >= 0; index -= 1) {
    const item = tail[index];
    if (item?.kind === "user_message") {
      return item;
    }
  }
  return null;
}

export function getEditableLastUserMessageId(input: EditableLastUserMessageInput): string | null {
  if (!input.featureEnabled || !input.capabilityEnabled || !input.isAgentIdle || input.readOnly) {
    return null;
  }

  const latest = findLatestUserMessage(input.tail, input.head);
  if (
    !latest ||
    latest.optimistic ||
    latest.replayKind !== "text_only" ||
    latest.text.trim().length === 0 ||
    (latest.images?.length ?? 0) > 0 ||
    (latest.attachments?.length ?? 0) > 0
  ) {
    return null;
  }
  return latest.id;
}
