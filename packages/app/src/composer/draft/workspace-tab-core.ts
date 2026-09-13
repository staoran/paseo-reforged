import { resolveSubmissionReadiness } from "@/provider-selection/provider-selection";
import type { AgentAttachment, FirstAgentContext } from "@getpaseo/protocol/messages";

export interface WorkspaceDraftAutoSubmitConfig {
  provider: string;
  model: string | null;
}

/** Builds first-agent metadata for automatic naming from a workspace draft submission */
export function buildWorkspaceDraftFirstAgentContext(input: {
  text: string;
  attachments: readonly AgentAttachment[];
  titleLanguage: NonNullable<FirstAgentContext["titleLanguage"]>;
}): FirstAgentContext | undefined {
  const prompt = input.text.trim();
  if (!prompt && input.attachments.length === 0) {
    return undefined;
  }

  return {
    ...(prompt ? { prompt } : {}),
    ...(input.attachments.length > 0 ? { attachments: [...input.attachments] } : {}),
    titleLanguage: input.titleLanguage,
  };
}

export function shouldAllowEmptyDraftText(input: {
  allowsEmptyAutoSubmit: boolean;
  attachments: readonly unknown[];
}): boolean {
  return input.allowsEmptyAutoSubmit || input.attachments.length > 0;
}

export function validateDraftSubmission(input: {
  text: string;
  allowsEmptyAutoSubmit: boolean;
  composerState: {
    providerDefinitions: unknown[];
    selectedProvider: string | null;
    isModelLoading: boolean;
    effectiveModelId: string | null;
    availableModels: unknown[];
  };
  autoSubmitConfig: WorkspaceDraftAutoSubmitConfig | null;
  workspaceDirectory: string | null;
  hasClient: boolean;
}): string | null {
  const {
    text,
    allowsEmptyAutoSubmit,
    composerState,
    autoSubmitConfig,
    workspaceDirectory,
    hasClient,
  } = input;
  const readiness = resolveSubmissionReadiness({
    text,
    allowsEmptyAutoSubmit,
    providerCount: composerState.providerDefinitions.length,
    selection: {
      provider: composerState.selectedProvider,
      modelId: composerState.effectiveModelId ?? "",
      availableModels: composerState.availableModels,
      isModelLoading: composerState.isModelLoading,
    },
    autoSubmitConfig,
    workspaceDirectory,
    hasClient,
  });
  return readiness.ok ? null : (readiness.reason ?? null);
}
