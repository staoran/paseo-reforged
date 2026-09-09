import { createWriteStream, type Dirent, type Stats } from "node:fs";
import { lstat, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type pino from "pino";

import {
  getSherpaOnnxModelSpec,
  listSherpaOnnxModels,
  type SherpaOnnxModelId,
} from "./model-catalog.js";
import { spawnProcess } from "../../../../../utils/spawn.js";

/** Maximum age retained for downloader-owned temporary files. */
const STALE_DOWNLOAD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
/** Exact suffix emitted by downloadToFile for incomplete downloads. */
const TEMP_DOWNLOAD_FILE_PATTERN = /\.tmp-\d+$/;

interface CleanupStaleDownloadsInDirectoryOptions {
  /** Root directory owned by the downloader cleanup. */
  ownedRoot: string;
  /** Directory currently being inspected. */
  directory: string;
  /** Modification-time cutoff for stale files. */
  cutoffMs: number;
  /** Logger used for best-effort cleanup diagnostics. */
  logger: pino.Logger;
}

interface OwnedPathOptions {
  /** Root that bounds the candidate path. */
  ownedRoot: string;
  /** Candidate path being checked. */
  candidatePath: string;
}

interface UnlinkedOwnedDirectoryOptions {
  /** Root directory owned by the downloader cleanup. */
  ownedRoot: string;
  /** Directory whose components must not be links. */
  directory: string;
}

/** Public options for one-shot stale model download cleanup. */
export interface CleanupStaleSherpaOnnxModelDownloadsOptions {
  /** Root configured for local speech model storage. */
  modelsDir: string;
  /** Logger used for best-effort cleanup diagnostics. */
  logger: pino.Logger;
}

/** Returns a filesystem error code without asserting the caught value's type. */
function getFilesystemErrorCode(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }
  if (!("code" in error)) {
    return null;
  }
  return typeof error.code === "string" ? error.code : null;
}

/** Reports whether a stat describes a directory rather than a directory link. */
function isUnlinkedDirectory(fileStat: Stats): boolean {
  return fileStat.isDirectory() && !fileStat.isSymbolicLink();
}

/** Reports whether a stat describes a regular file rather than a file link. */
function isUnlinkedFile(fileStat: Stats): boolean {
  return fileStat.isFile() && !fileStat.isSymbolicLink();
}

/** Reports whether a directory entry can be traversed without following a link. */
function isUnlinkedDirectoryEntry(entry: Dirent): boolean {
  return entry.isDirectory() && !entry.isSymbolicLink();
}

/** Reports whether a path is lexically contained by an owned root. */
function isWithinOwnedRoot(options: OwnedPathOptions): boolean {
  const relativePath = path.relative(options.ownedRoot, options.candidatePath);
  if (relativePath === "") {
    return true;
  }
  if (path.isAbsolute(relativePath)) {
    return false;
  }
  if (relativePath === "..") {
    return false;
  }
  return !relativePath.startsWith(`..${path.sep}`);
}

/** Verifies every directory component at or below the owned root is not a link. */
async function isUnlinkedOwnedDirectory(options: UnlinkedOwnedDirectoryOptions): Promise<boolean> {
  const resolvedRoot = path.resolve(options.ownedRoot);
  const resolvedDirectory = path.resolve(options.directory);
  if (!isWithinOwnedRoot({ ownedRoot: resolvedRoot, candidatePath: resolvedDirectory })) {
    return false;
  }

  const relativeDirectory = path.relative(resolvedRoot, resolvedDirectory);
  const components = relativeDirectory === "" ? [] : relativeDirectory.split(path.sep);
  let currentDirectory = resolvedRoot;
  const rootStat = await lstat(currentDirectory);
  if (!isUnlinkedDirectory(rootStat)) {
    return false;
  }
  for (const component of components) {
    currentDirectory = path.join(currentDirectory, component);
    const directoryStat = await lstat(currentDirectory);
    if (!isUnlinkedDirectory(directoryStat)) {
      return false;
    }
  }
  return true;
}

export interface EnsureSherpaOnnxModelOptions {
  modelsDir: string;
  modelId: SherpaOnnxModelId;
  logger: pino.Logger;
  signal?: AbortSignal;
}

export function getSherpaOnnxModelDir(modelsDir: string, modelId: SherpaOnnxModelId): string {
  const spec = getSherpaOnnxModelSpec(modelId);
  return path.join(modelsDir, spec.extractedDir);
}

/** Removes stale downloader-owned temp files without following directory links. */
async function cleanupStaleDownloadsInDirectory(
  options: CleanupStaleDownloadsInDirectoryOptions,
): Promise<number> {
  let entries: Dirent[];
  try {
    const directoryIsUnlinked = await isUnlinkedOwnedDirectory({
      ownedRoot: options.ownedRoot,
      directory: options.directory,
    });
    if (!directoryIsUnlinked) {
      return 0;
    }
    entries = await readdir(options.directory, { withFileTypes: true });
  } catch (error) {
    if (getFilesystemErrorCode(error) !== "ENOENT") {
      options.logger.warn(
        { err: error, directory: options.directory },
        "Failed to inspect local speech model downloads during startup cleanup",
      );
    }
    return 0;
  }

  let removedCount = 0;
  for (const entry of entries) {
    const entryPath = path.join(options.directory, entry.name);
    if (isUnlinkedDirectoryEntry(entry)) {
      removedCount += await cleanupStaleDownloadsInDirectory({
        ...options,
        directory: entryPath,
      });
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (!TEMP_DOWNLOAD_FILE_PATTERN.test(entry.name)) {
      continue;
    }

    try {
      const parentDirectory = path.dirname(entryPath);
      const parentIsUnlinked = await isUnlinkedOwnedDirectory({
        ownedRoot: options.ownedRoot,
        directory: parentDirectory,
      });
      if (!parentIsUnlinked) {
        continue;
      }
      const fileStat = await lstat(entryPath);
      if (!isUnlinkedFile(fileStat)) {
        continue;
      }
      if (fileStat.mtimeMs >= options.cutoffMs) {
        continue;
      }
      await rm(entryPath, { force: true });
      removedCount += 1;
    } catch (error) {
      options.logger.warn(
        { err: error, filePath: entryPath },
        "Failed to remove stale local speech model download",
      );
    }
  }
  return removedCount;
}

/** Best-effort startup cleanup for model download temp files older than seven days. */
export async function cleanupStaleSherpaOnnxModelDownloads(
  options: CleanupStaleSherpaOnnxModelDownloadsOptions,
): Promise<void> {
  const logger = options.logger.child({
    module: "speech",
    provider: "local",
    component: "model-downloader",
  });
  // The downloader owns only its archive staging area and catalog model directories.
  const cleanupDirectories = [
    path.join(options.modelsDir, ".downloads"),
    ...listSherpaOnnxModels().map((model) => path.join(options.modelsDir, model.extractedDir)),
  ];
  const cutoffMs = Date.now() - STALE_DOWNLOAD_MAX_AGE_MS;
  let removedCount = 0;
  for (const directory of cleanupDirectories) {
    removedCount += await cleanupStaleDownloadsInDirectory({
      ownedRoot: options.modelsDir,
      directory,
      cutoffMs,
      logger,
    });
  }
  if (removedCount > 0) {
    logger.info(
      { modelsDir: options.modelsDir, removedCount, maxAgeDays: 7 },
      "Removed stale local speech model downloads",
    );
  }
}

async function hasRequiredFiles(modelDir: string, requiredFiles: string[]): Promise<boolean> {
  const results = await Promise.all(
    requiredFiles.map(async (rel) => {
      const abs = path.join(modelDir, rel);
      try {
        const s = await stat(abs);
        if (s.isDirectory()) {
          return true;
        }
        return s.isFile() && s.size > 0;
      } catch {
        return false;
      }
    }),
  );
  return results.every((present) => present);
}

interface DownloadToFileOptions {
  url: string;
  outputPath: string;
  signal?: AbortSignal;
}

async function downloadToFile(options: DownloadToFileOptions): Promise<void> {
  const { url, outputPath } = options;
  const res = await fetch(url, { signal: options.signal });
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  }
  if (!res.body) {
    throw new Error(`Failed to download ${url}: missing response body`);
  }

  const tmpPath = `${outputPath}.tmp-${Date.now()}`;
  await mkdir(path.dirname(outputPath), { recursive: true });

  // The fetch ReadableStream type is slightly different from what Readable.fromWeb expects
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeStream = Readable.fromWeb(res.body as any);

  try {
    await pipeline(nodeStream, createWriteStream(tmpPath), { signal: options.signal });
    await rename(tmpPath, outputPath);
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function extractTarArchive(
  archivePath: string,
  destDir: string,
  signal?: AbortSignal,
): Promise<void> {
  await mkdir(destDir, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const child = spawnProcess("tar", ["xf", archivePath, "-C", destDir], {
      stdio: "inherit",
      signal,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited with code ${code}`));
    });
  });
}

async function isNonEmptyFile(filePath: string): Promise<boolean> {
  try {
    const s = await stat(filePath);
    return s.isFile() && s.size > 0;
  } catch {
    return false;
  }
}

export async function ensureSherpaOnnxModel(
  options: EnsureSherpaOnnxModelOptions,
): Promise<string> {
  const logger = options.logger.child({
    module: "speech",
    provider: "local",
    component: "model-downloader",
    modelId: options.modelId,
  });

  const spec = getSherpaOnnxModelSpec(options.modelId);
  const modelDir = path.join(options.modelsDir, spec.extractedDir);
  if (await hasRequiredFiles(modelDir, spec.requiredFiles)) {
    return modelDir;
  }

  logger.info({ modelsDir: options.modelsDir }, "Starting model download");

  try {
    const downloadsDir = path.join(options.modelsDir, ".downloads");
    const archiveFilename = path.basename(new URL(spec.archiveUrl).pathname);
    const archivePath = path.join(downloadsDir, archiveFilename);

    if (!(await isNonEmptyFile(archivePath))) {
      await downloadToFile({
        url: spec.archiveUrl,
        outputPath: archivePath,
        signal: options.signal,
      });
    }

    logger.info(
      {
        modelId: options.modelId,
        archivePath,
        modelDir,
      },
      "Extracting model archive",
    );
    await extractTarArchive(archivePath, options.modelsDir, options.signal);

    logger.info(
      {
        modelId: options.modelId,
        modelDir,
      },
      "Verifying downloaded model files",
    );
    if (!(await hasRequiredFiles(modelDir, spec.requiredFiles))) {
      throw new Error(
        `Downloaded and extracted ${archiveFilename}, but required files are still missing in ${modelDir}.`,
      );
    }

    logger.info(
      {
        modelId: options.modelId,
        archivePath,
      },
      "Finalizing model artifacts",
    );
    try {
      await rm(archivePath, { force: true });
    } catch {
      // ignore
    }

    logger.info({ modelDir }, "Model download completed");
    return modelDir;
  } catch (error) {
    logger.error({ err: error }, "Model download failed");
    throw error;
  }
}

export async function ensureSherpaOnnxModels(options: {
  modelsDir: string;
  modelIds: SherpaOnnxModelId[];
  logger: pino.Logger;
  signal?: AbortSignal;
}): Promise<Record<SherpaOnnxModelId, string>> {
  const uniq = Array.from(new Set(options.modelIds));
  const entries: Array<[SherpaOnnxModelId, string]> = await Promise.all(
    uniq.map(async (id) => {
      const modelPath = await ensureSherpaOnnxModel({
        modelsDir: options.modelsDir,
        modelId: id,
        logger: options.logger,
        signal: options.signal,
      });
      return [id, modelPath] as [SherpaOnnxModelId, string];
    }),
  );
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  return Object.fromEntries(entries) as Record<SherpaOnnxModelId, string>;
}
