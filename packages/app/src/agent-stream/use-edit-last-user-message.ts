import { useCallback, useMemo, useSyncExternalStore } from "react";
import { generateMessageId } from "@/types/stream";
import {
  getLastUserMessageEditControls,
  type LastUserMessageEditController,
  type LastUserMessageEditEffect,
  type LastUserMessageEditResponse,
  type LastUserMessageEditState,
} from "./edit-last-user-message-model";

interface UseEditLastUserMessageInput {
  controller: LastUserMessageEditController;
  agentId: string;
  messageId: string;
  message: string;
  isEligible: boolean;
  isAgentIdle: boolean;
  submitRequest: (request: {
    agentId: string;
    messageId: string;
    replacementText: string;
    replacementMessageId: string;
  }) => Promise<LastUserMessageEditResponse>;
  onEffect: (effect: LastUserMessageEditEffect) => Promise<void> | void;
  createReplacementMessageId?: () => string;
}

export interface EditLastUserMessageViewModel {
  state: LastUserMessageEditState;
  controls: ReturnType<typeof getLastUserMessageEditControls>;
  showAction: boolean;
  showEditor: boolean;
  begin(): void;
  setDraft(draft: string): void;
  cancel(): void;
  submit(): Promise<void>;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useEditLastUserMessage(
  input: UseEditLastUserMessageInput,
): EditLastUserMessageViewModel {
  const getSnapshot = useCallback(
    () => input.controller.getMessageState(input.messageId),
    [input.controller, input.messageId],
  );
  const state = useSyncExternalStore(input.controller.subscribe, getSnapshot, getSnapshot);
  const controls = useMemo(
    () => getLastUserMessageEditControls(state, input.isAgentIdle && input.isEligible),
    [input.isAgentIdle, input.isEligible, state],
  );

  const begin = useCallback(() => {
    if (input.isEligible && input.isAgentIdle) {
      input.controller.begin({ messageId: input.messageId, text: input.message });
    }
  }, [input.controller, input.isAgentIdle, input.isEligible, input.message, input.messageId]);
  const setDraft = useCallback(
    (draft: string) => input.controller.setDraft(draft),
    [input.controller],
  );
  const cancel = useCallback(() => input.controller.cancel(), [input.controller]);
  const submit = useCallback(async () => {
    const request = input.controller.prepareSubmission({
      agentId: input.agentId,
      isAgentIdle: input.isAgentIdle && input.isEligible,
      replacementMessageId: (input.createReplacementMessageId ?? generateMessageId)(),
    });
    if (!request) {
      return;
    }

    let effect: LastUserMessageEditEffect;
    try {
      const response = await input.submitRequest(request);
      effect = input.controller.resolve(response);
    } catch (error) {
      effect = input.controller.failUnknown(toErrorMessage(error));
    }
    await input.onEffect(effect);
  }, [input]);

  return {
    state,
    controls,
    showAction: state.phase === "closed" && input.isEligible,
    showEditor: state.phase === "editing" || state.phase === "pending",
    begin,
    setDraft,
    cancel,
    submit,
  };
}
