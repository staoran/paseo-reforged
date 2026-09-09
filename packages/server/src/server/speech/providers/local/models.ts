import {
  cleanupStaleSherpaOnnxModelDownloads,
  ensureSherpaOnnxModels,
  getSherpaOnnxModelDir,
} from "./sherpa/model-downloader.js";
import {
  DEFAULT_LOCAL_STT_MODEL,
  DEFAULT_LOCAL_TTS_MODEL,
  LocalSttModelIdSchema,
  LocalTtsModelIdSchema,
  listSherpaOnnxModels,
  type LocalSpeechModelId,
  type LocalSttModelId,
  type LocalTtsModelId,
} from "./sherpa/model-catalog.js";

export {
  DEFAULT_LOCAL_STT_MODEL,
  DEFAULT_LOCAL_TTS_MODEL,
  LocalSttModelIdSchema,
  LocalTtsModelIdSchema,
  type LocalSpeechModelId,
  type LocalSttModelId,
  type LocalTtsModelId,
};

export type LocalSpeechModelSpec = ReturnType<typeof listSherpaOnnxModels>[number];

/** Options for one-shot cleanup of downloader-owned local speech temp files. */
export interface CleanupStaleLocalSpeechModelDownloadsOptions {
  /** Root configured for local speech model storage. */
  modelsDir: string;
  /** Logger used for best-effort cleanup diagnostics. */
  logger: import("pino").Logger;
}

export function listLocalSpeechModels(): LocalSpeechModelSpec[] {
  return listSherpaOnnxModels();
}

export function getLocalSpeechModelDir(modelsDir: string, modelId: LocalSpeechModelId): string {
  return getSherpaOnnxModelDir(modelsDir, modelId);
}

/** Runs best-effort startup cleanup for downloader-owned local model temp files. */
export async function cleanupStaleLocalSpeechModelDownloads(
  options: CleanupStaleLocalSpeechModelDownloadsOptions,
): Promise<void> {
  await cleanupStaleSherpaOnnxModelDownloads(options);
}

export async function ensureLocalSpeechModels(options: {
  modelsDir: string;
  modelIds: LocalSpeechModelId[];
  logger: import("pino").Logger;
  signal?: AbortSignal;
}): Promise<Record<LocalSpeechModelId, string>> {
  return ensureSherpaOnnxModels({
    modelsDir: options.modelsDir,
    modelIds: options.modelIds,
    logger: options.logger,
    signal: options.signal,
  });
}
