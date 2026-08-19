import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import pino from "pino";
import { describe, expect, test } from "vitest";

import type { PaseoSpeechConfig } from "../../../bootstrap.js";
import { createSpeechService } from "../../speech-runtime.js";

/** Milliseconds in the 24-hour day used by file-age fixtures. */
const DAY_MS = 24 * 60 * 60 * 1_000;

interface CreateAgedFileOptions {
  /** Fixture file path. */
  filePath: string;
  /** Desired age relative to the current clock. */
  ageMs: number;
}

interface WithTimeoutOptions<T> {
  /** Asynchronous fixture operation being bounded. */
  promise: Promise<T>;
  /** Maximum duration before rejecting the fixture. */
  timeoutMs: number;
}

interface CreateLocalSpeechConfigOptions {
  /** Local speech model root used by the fixture. */
  modelsDir: string;
  /** Whether the fixture enables local voice text-to-speech. */
  isVoiceTtsEnabled: boolean;
}

/** Creates a real file with a controlled modification age. */
async function createAgedFile(options: CreateAgedFileOptions): Promise<void> {
  await mkdir(path.dirname(options.filePath), { recursive: true });
  await writeFile(options.filePath, "fixture");
  const modifiedAt = new Date(Date.now() - options.ageMs);
  await utimes(options.filePath, modifiedAt, modifiedAt);
}

/** Creates the local speech configuration shared by startup cleanup fixtures. */
function createLocalSpeechConfig(options: CreateLocalSpeechConfigOptions): PaseoSpeechConfig {
  return {
    providers: {
      dictationStt: { provider: "local", enabled: false, explicit: true },
      voiceTurnDetection: { provider: "local", enabled: false, explicit: true },
      voiceStt: { provider: "local", enabled: false, explicit: true },
      voiceTts: {
        provider: "local",
        enabled: options.isVoiceTtsEnabled,
        explicit: true,
      },
    },
    local: {
      modelsDir: options.modelsDir,
      models: {
        dictationStt: "parakeet-tdt-0.6b-v2-int8",
        voiceStt: "parakeet-tdt-0.6b-v2-int8",
        voiceTts: "kokoro-en-v0_19",
      },
    },
  };
}

/** Rejects a stalled asynchronous fixture while allowing its finally blocks to run. */
async function withTimeout<T>(options: WithTimeoutOptions<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      options.promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("speech runtime fixture timed out")),
          options.timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

/** Reports whether a fixture path remains after startup cleanup. */
function pathExists(filePath: string): boolean {
  return existsSync(filePath);
}

describe("local speech runtime startup", () => {
  test("removes stale downloader files only from Paseo-owned model locations", async () => {
    const modelsDir = await mkdtemp(path.join(tmpdir(), "paseo-local-speech-startup-"));
    const downloadsDir = path.join(modelsDir, ".downloads");
    const knownModelDir = path.join(modelsDir, "kokoro-en-v0_19", "onnx");
    const unknownModelDir = path.join(modelsDir, "legacy-model", "onnx");
    const staleDownload = path.join(downloadsDir, "model.tar.bz2.tmp-1001");
    const freshDownload = path.join(downloadsDir, "model.tar.bz2.tmp-1002");
    const staleModelFile = path.join(knownModelDir, "encoder.onnx.tmp-1003");
    const freshModelFile = path.join(knownModelDir, "decoder.onnx.tmp-1004");
    const completedArchive = path.join(downloadsDir, "model.tar.bz2");
    const completedModelFile = path.join(knownModelDir, "encoder.onnx");
    const unknownOldFile = path.join(downloadsDir, "model.tar.bz2.partial");
    const staleRootFile = path.join(modelsDir, "root-model.tmp-1005");
    const staleUnknownModelFile = path.join(unknownModelDir, "legacy.onnx.tmp-1006");
    const linkedExternalDir = path.join(modelsDir, "linked-external");
    const linkedModelDir = path.join(knownModelDir, "linked");
    const linkedExternalStaleFile = path.join(linkedExternalDir, "linked.onnx.tmp-1007");

    try {
      await Promise.all([
        createAgedFile({ filePath: staleDownload, ageMs: 8 * DAY_MS }),
        createAgedFile({ filePath: freshDownload, ageMs: 6 * DAY_MS }),
        createAgedFile({ filePath: staleModelFile, ageMs: 8 * DAY_MS }),
        createAgedFile({ filePath: freshModelFile, ageMs: 6 * DAY_MS }),
        createAgedFile({ filePath: completedArchive, ageMs: 8 * DAY_MS }),
        createAgedFile({ filePath: completedModelFile, ageMs: 8 * DAY_MS }),
        createAgedFile({ filePath: unknownOldFile, ageMs: 8 * DAY_MS }),
        createAgedFile({ filePath: staleRootFile, ageMs: 8 * DAY_MS }),
        createAgedFile({ filePath: staleUnknownModelFile, ageMs: 8 * DAY_MS }),
        createAgedFile({ filePath: linkedExternalStaleFile, ageMs: 8 * DAY_MS }),
      ]);
      await symlink(linkedExternalDir, linkedModelDir, "junction");

      const speechConfig = createLocalSpeechConfig({ modelsDir, isVoiceTtsEnabled: false });

      const runtime = createSpeechService({
        speechConfig,
        logger: pino({ level: "silent" }),
      });
      try {
        runtime.start();
        await runtime.ready;

        expect(pathExists(staleDownload)).toBe(false);
        expect(pathExists(staleModelFile)).toBe(false);
        expect(pathExists(freshDownload)).toBe(true);
        expect(pathExists(freshModelFile)).toBe(true);
        expect(pathExists(completedArchive)).toBe(true);
        expect(pathExists(completedModelFile)).toBe(true);
        expect(pathExists(unknownOldFile)).toBe(true);
        expect(pathExists(staleRootFile)).toBe(true);
        expect(pathExists(staleUnknownModelFile)).toBe(true);
        expect(pathExists(linkedExternalStaleFile)).toBe(true);
      } finally {
        runtime.stop();
      }
    } finally {
      await rm(modelsDir, { recursive: true, force: true });
    }
  });

  test("does not follow a linked local speech models root", async () => {
    const fixtureDir = await mkdtemp(path.join(tmpdir(), "paseo-local-speech-linked-root-"));
    const externalModelsDir = path.join(fixtureDir, "external-models");
    const linkedModelsDir = path.join(fixtureDir, "linked-models");
    const externalStaleDownload = path.join(
      externalModelsDir,
      ".downloads",
      "model.tar.bz2.tmp-1501",
    );

    try {
      await createAgedFile({ filePath: externalStaleDownload, ageMs: 8 * DAY_MS });
      await symlink(externalModelsDir, linkedModelsDir, "junction");
      const runtime = createSpeechService({
        speechConfig: createLocalSpeechConfig({
          modelsDir: linkedModelsDir,
          isVoiceTtsEnabled: false,
        }),
        logger: pino({ level: "silent" }),
      });

      try {
        runtime.start();
        await runtime.ready;
        expect(pathExists(externalStaleDownload)).toBe(true);
      } finally {
        runtime.stop();
      }
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  });

  test("does not repeat startup cleanup when model readiness reconciles", async () => {
    const modelsDir = await mkdtemp(path.join(tmpdir(), "paseo-local-speech-reconcile-"));
    const downloadsDir = path.join(modelsDir, ".downloads");
    const modelDir = path.join(modelsDir, "kokoro-en-v0_19");
    const startupStaleFile = path.join(downloadsDir, "startup.tar.bz2.tmp-2001");
    const reconcileStaleSource = path.join(modelsDir, "reconcile-staged.tmp-2002");
    const reconcileStaleFile = path.join(downloadsDir, "reconcile.tar.bz2.tmp-2002");
    const speechConfig = createLocalSpeechConfig({ modelsDir, isVoiceTtsEnabled: true });
    const runtime = createSpeechService({
      speechConfig,
      logger: pino({ level: "silent" }),
    });

    try {
      await Promise.all([
        createAgedFile({ filePath: startupStaleFile, ageMs: 8 * DAY_MS }),
        createAgedFile({ filePath: reconcileStaleSource, ageMs: 8 * DAY_MS }),
      ]);
      let stagedReconcile = false;
      let resolveReconciled!: () => void;
      const reconciled = new Promise<void>((resolve) => {
        resolveReconciled = resolve;
      });
      const unsubscribe = runtime.onReadinessChange((snapshot) => {
        const shouldStageReconcile = snapshot.download.inProgress && !stagedReconcile;
        if (shouldStageReconcile) {
          stagedReconcile = true;
          renameSync(reconcileStaleSource, reconcileStaleFile);
          mkdirSync(path.join(modelDir, "espeak-ng-data"), { recursive: true });
          writeFileSync(path.join(modelDir, "model.onnx"), "model");
          writeFileSync(path.join(modelDir, "voices.bin"), "voices");
          writeFileSync(path.join(modelDir, "tokens.txt"), "tokens");
          return;
        }
        const reconcileCompleted =
          stagedReconcile &&
          !snapshot.download.inProgress &&
          snapshot.missingLocalModelIds.length === 0;
        if (reconcileCompleted) {
          resolveReconciled();
        }
      });

      try {
        runtime.start();
        await runtime.ready;
        await withTimeout({ promise: reconciled, timeoutMs: 5_000 });

        expect(pathExists(startupStaleFile)).toBe(false);
        expect(pathExists(reconcileStaleFile)).toBe(true);
      } finally {
        unsubscribe();
        runtime.stop();
      }
    } finally {
      await rm(modelsDir, { recursive: true, force: true });
    }
  });
});
