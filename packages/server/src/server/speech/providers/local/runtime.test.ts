import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import pino from "pino";
import { describe, expect, test } from "vitest";

import type { PaseoSpeechConfig } from "../../../bootstrap.js";
import { initializeLocalSpeechServices } from "./runtime.js";

/** Milliseconds in the 24-hour day used by file-age fixtures. */
const DAY_MS = 24 * 60 * 60 * 1_000;

/** Creates a real file with a controlled modification age. */
async function createAgedFile(filePath: string, ageMs: number): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, "fixture");
  const modifiedAt = new Date(Date.now() - ageMs);
  await utimes(filePath, modifiedAt, modifiedAt);
}

/** Reports whether a fixture path remains after startup cleanup. */
async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

describe("local speech runtime startup", () => {
  test("removes only downloader temp files older than seven days", async () => {
    const modelsDir = await mkdtemp(path.join(tmpdir(), "paseo-local-speech-startup-"));
    const downloadsDir = path.join(modelsDir, ".downloads");
    const legacyModelDir = path.join(modelsDir, "legacy-model", "onnx");
    const staleDownload = path.join(downloadsDir, "model.tar.bz2.tmp-1001");
    const freshDownload = path.join(downloadsDir, "model.tar.bz2.tmp-1002");
    const staleModelFile = path.join(legacyModelDir, "encoder.onnx.tmp-1003");
    const freshModelFile = path.join(legacyModelDir, "decoder.onnx.tmp-1004");
    const completedArchive = path.join(downloadsDir, "model.tar.bz2");
    const completedModelFile = path.join(legacyModelDir, "encoder.onnx");
    const unknownOldFile = path.join(downloadsDir, "model.tar.bz2.partial");

    try {
      await Promise.all([
        createAgedFile(staleDownload, 8 * DAY_MS),
        createAgedFile(freshDownload, 6 * DAY_MS),
        createAgedFile(staleModelFile, 8 * DAY_MS),
        createAgedFile(freshModelFile, 6 * DAY_MS),
        createAgedFile(completedArchive, 8 * DAY_MS),
        createAgedFile(completedModelFile, 8 * DAY_MS),
        createAgedFile(unknownOldFile, 8 * DAY_MS),
      ]);

      const speechConfig: PaseoSpeechConfig = {
        providers: {
          dictationStt: { provider: "local", enabled: false, explicit: true },
          voiceTurnDetection: { provider: "local", enabled: false, explicit: true },
          voiceStt: { provider: "local", enabled: false, explicit: true },
          voiceTts: { provider: "local", enabled: false, explicit: true },
        },
        local: {
          modelsDir,
          models: {
            dictationStt: "parakeet-tdt-0.6b-v2-int8",
            voiceStt: "parakeet-tdt-0.6b-v2-int8",
            voiceTts: "kokoro-en-v0_19",
          },
        },
      };

      const runtime = await initializeLocalSpeechServices({
        providers: speechConfig.providers,
        speechConfig,
        logger: pino({ level: "silent" }),
      });
      runtime.cleanup();

      expect(await pathExists(staleDownload)).toBe(false);
      expect(await pathExists(staleModelFile)).toBe(false);
      expect(await pathExists(freshDownload)).toBe(true);
      expect(await pathExists(freshModelFile)).toBe(true);
      expect(await pathExists(completedArchive)).toBe(true);
      expect(await pathExists(completedModelFile)).toBe(true);
      expect(await pathExists(unknownOldFile)).toBe(true);
    } finally {
      await rm(modelsDir, { recursive: true, force: true });
    }
  });
});
