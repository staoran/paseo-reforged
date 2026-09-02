import { spawn } from "node:child_process";
import { deflateRawSync } from "node:zlib";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Prefix separating the machine-readable report from Hermes diagnostics. */
const HERMES_REPORT_PREFIX = "PASEO_HERMES_DECODE_REPORT=";
/** Minimum number of measured samples accepted by the p95 gate. */
const MIN_MEASURED_RUNS = 5;
/** Default number of measured samples for each frame size. */
const DEFAULT_MEASURED_RUNS = 20;
/** Fixed unreported warm-up samples for each frame size. */
const WARMUP_RUNS = 3;
/** Largest measured sample count accepted from the command line. */
const MAX_MEASURED_RUNS = 200;
/** Repository root derived without depending on the caller's working directory. */
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Browser-compatible fflate bundle executed directly by Hermes. */
const FFLATE_UMD_PATH = join(REPOSITORY_ROOT, "node_modules", "fflate", "umd", "index.js");

/** One fixed frame size and its Spec 0084 p95 threshold. */
interface HermesFrameSpec {
  /** Content-free report label. */
  label: "1MiB" | "4MiB";
  /** Exact authenticated output length. */
  originalBytes: number;
  /** Maximum accepted decode p95 in milliseconds. */
  thresholdMs: number;
  /** Distinct deterministic corpus seed. */
  seed: number;
}

/** Fixed frame contracts from Spec 0084 section 6.2. */
const HERMES_FRAME_SPECS: readonly HermesFrameSpec[] = [
  { label: "1MiB", originalBytes: 1024 * 1024, thresholdMs: 50, seed: 17 },
  { label: "4MiB", originalBytes: 4 * 1024 * 1024, thresholdMs: 150, seed: 73 },
];

/** Parsed command-line options for one explicit Hermes runtime. */
interface HermesDecodeCliOptions {
  /** Absolute path to a Hermes VM executable, not a compiler-only hermesc binary. */
  hermesPath: string;
  /** Measured samples per frame size after warm-up. */
  measuredRuns: number;
}

/** Deterministic compressed vector embedded into the temporary Hermes script. */
interface HermesDecodeVector {
  /** Content-free frame label. */
  label: HermesFrameSpec["label"];
  /** Exact authenticated output length. */
  originalBytes: number;
  /** Spec p95 threshold in milliseconds. */
  thresholdMs: number;
  /** Raw DEFLATE input length. */
  compressedBytes: number;
  /** Raw DEFLATE bytes encoded for a source-only temporary harness. */
  compressedBase64: string;
  /** Independent Adler-32 output checksum. */
  expectedAdler32: number;
  /** Independent rolling 32-bit output checksum. */
  expectedRolling32: number;
}

/** One frame result emitted by the Hermes VM. */
export interface HermesDecodeFrameResult {
  /** Content-free frame label. */
  label: HermesFrameSpec["label"];
  /** Exact authenticated output length. */
  originalBytes: number;
  /** Raw DEFLATE input length. */
  compressedBytes: number;
  /** Exact returned output length. */
  outputBytes: number;
  /** Production-compatible one-byte overflow sentinel allocation. */
  maxOutputBytes: number;
  /** Decode-plus-output-allocation p95 in milliseconds. */
  p95Ms: number;
  /** Spec p95 threshold in milliseconds. */
  thresholdMs: number;
  /** Whether both independent output checksums matched every sample. */
  checksumVerified: boolean;
  /** Whether correctness and p95 gates passed. */
  passed: boolean;
}

/** Machine-readable report emitted from inside Hermes. */
interface HermesScriptReport {
  /** Report schema version. */
  schemaVersion: 1;
  /** Number of measured samples per frame size. */
  measuredRuns: number;
  /** Number of unreported warm-up samples per frame size. */
  warmupRuns: number;
  /** Number of measured frames decoded and verified. */
  completedMeasuredFrames: number;
  /** Whether observed completion labels exactly matched invocation order. */
  orderVerified: boolean;
  /** Per-size correctness and latency results. */
  frames: HermesDecodeFrameResult[];
  /** Aggregate CLI gate verdict. */
  passed: boolean;
}

/** Content-free Hermes runtime identity parsed from `hermes -version`. */
export interface HermesRuntimeIdentity {
  /** Hermes release label. */
  releaseVersion: string;
  /** Hermes bytecode format version. */
  hbcBytecodeVersion: number;
  /** Runtime build kind reported by the executable. */
  buildKind: "DEBUG" | "RELEASE" | "unknown";
}

/** Final content-free CLI report. */
export interface HermesRelayDecodeReport extends HermesScriptReport {
  /** Runtime identity measured before executing the harness. */
  runtime: HermesRuntimeIdentity;
  /** Scope boundary preventing CLI evidence from being mistaken for a device gate. */
  evidenceScope: "cli-supplemental-not-device-release";
}

/** One child-process request at the injectable public CLI seam. */
export interface HermesProcessRequest {
  /** Explicit Hermes VM executable. */
  executable: string;
  /** Arguments passed without shell interpolation. */
  args: readonly string[];
}

/** Captured child-process output. */
export interface HermesProcessResult {
  /** Process standard output. */
  stdout: string;
  /** Process standard error. */
  stderr: string;
}

/** Injectable process executor used by the Vitest CLI seam. */
export type HermesProcessExecutor = (request: HermesProcessRequest) => Promise<HermesProcessResult>;

/** Output port used by tests and the process entrypoint. */
export interface HermesRelayDecodeCliIo {
  /** Receives the content-free JSON report. */
  writeStdout(value: string): void;
}

/** Inputs for one Hermes decode gate invocation. */
export interface RunHermesRelayDecodeCliOptions {
  /** Explicit command-line flags supplied by the operator or test. */
  args: readonly string[];
  /** Optional process executor used by tests. */
  executeProcess?: HermesProcessExecutor;
  /** Optional output sink used by tests instead of process stdout. */
  io?: HermesRelayDecodeCliIo;
}

/** Runs the fixed Hermes raw-DEFLATE correctness and p95 gate. */
export async function runHermesRelayDecodeCli(
  options: RunHermesRelayDecodeCliOptions,
): Promise<HermesRelayDecodeReport> {
  /** Validated operator options. */
  const parsed = parseCliOptions(options.args);
  /** Process seam selected for real execution or deterministic testing. */
  const executeProcess = options.executeProcess ?? executeHermesProcess;
  /** Content-free output sink. */
  const io = options.io ?? { writeStdout: (value: string) => process.stdout.write(value) };
  await access(parsed.hermesPath);

  /** Runtime version output proving the measured executable is a VM. */
  const versionResult = await executeProcess({ executable: parsed.hermesPath, args: ["-version"] });
  /** Parsed runtime identity retained without the executable path. */
  const runtime = parseHermesRuntimeIdentity(`${versionResult.stdout}\n${versionResult.stderr}`);
  /** Independent Node level-1 raw DEFLATE vectors. */
  const vectors = HERMES_FRAME_SPECS.map(createHermesDecodeVector);
  /** Actual fflate browser bundle used by the production adapter. */
  const fflateSource = await readFile(FFLATE_UMD_PATH, "utf8");
  /** Isolated temporary root removed even when Hermes fails. */
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "paseo-hermes-relay-decode-"));
  /** Temporary source passed directly to the Hermes VM. */
  const scriptPath = join(temporaryDirectory, "measure-hermes-relay-decode.js");

  try {
    await writeFile(
      scriptPath,
      buildHermesHarnessSource({ fflateSource, measuredRuns: parsed.measuredRuns, vectors }),
      "utf8",
    );
    /** Optimized Hermes execution containing the only measured decode work. */
    const execution = await executeProcess({
      executable: parsed.hermesPath,
      args: ["-O", scriptPath],
    });
    /** Strictly validated report produced inside Hermes. */
    const scriptReport = parseHermesScriptReport(execution.stdout, parsed.measuredRuns);
    /** Final report with a truthful non-device evidence boundary. */
    const report: HermesRelayDecodeReport = {
      ...scriptReport,
      runtime,
      evidenceScope: "cli-supplemental-not-device-release",
    };
    io.writeStdout(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.passed) {
      throw new Error("Hermes relay decode gate failed");
    }
    return report;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

/** Parses the small explicit CLI surface without scanning local runtimes. */
function parseCliOptions(args: readonly string[]): HermesDecodeCliOptions {
  /** Explicit Hermes VM path supplied by the operator. */
  let hermesPath: string | null = null;
  /** Measured samples requested by the operator. */
  let measuredRuns = DEFAULT_MEASURED_RUNS;
  for (let index = 0; index < args.length; index += 1) {
    /** Current supported option. */
    const flag = args[index];
    /** Current option value. */
    const value = args[index + 1];
    if (flag === "--hermes") {
      if (!value) throw new Error("Missing value for Hermes decode option --hermes");
      hermesPath = resolve(value);
      index += 1;
      continue;
    }
    if (flag === "--runs") {
      if (!value) throw new Error("Missing value for Hermes decode option --runs");
      measuredRuns = Number(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown Hermes decode option ${flag ?? "<missing>"}`);
  }
  if (!hermesPath) {
    throw new Error("Missing required Hermes VM option --hermes");
  }
  if (!Number.isInteger(measuredRuns) || measuredRuns < MIN_MEASURED_RUNS) {
    throw new Error(`Hermes decode --runs must be an integer >= ${MIN_MEASURED_RUNS}`);
  }
  if (measuredRuns > MAX_MEASURED_RUNS) {
    throw new Error(`Hermes decode --runs must be <= ${MAX_MEASURED_RUNS}`);
  }
  return { hermesPath, measuredRuns };
}

/** Creates one deterministic mixed-entropy frame and an independent level-1 raw DEFLATE vector. */
function createHermesDecodeVector(spec: HermesFrameSpec): HermesDecodeVector {
  /** Original deterministic frame bytes. */
  const original = createDeterministicFrame(spec);
  /** Node-generated raw DEFLATE bytes independent of fflate. */
  const compressed = deflateRawSync(original, { level: 1 });
  /** Independent checksums expected from every Hermes decode. */
  const checksums = calculateChecksums(original);
  return {
    label: spec.label,
    originalBytes: spec.originalBytes,
    thresholdMs: spec.thresholdMs,
    compressedBytes: compressed.byteLength,
    compressedBase64: compressed.toString("base64"),
    expectedAdler32: checksums.adler32,
    expectedRolling32: checksums.rolling32,
  };
}

/** Builds a fixed mixed-entropy frame with a compression ratio safely below 128:1. */
function createDeterministicFrame(spec: HermesFrameSpec): Uint8Array {
  /** Output bytes compressed into the independent golden vector. */
  const bytes = new Uint8Array(spec.originalBytes);
  /** Stateful pseudo-random lane used for one eighth of each 256-byte block. */
  let randomState = (0x9e3779b9 ^ spec.seed) >>> 0;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    /** Position inside the moderately compressible 256-byte pattern. */
    const lane = index & 0xff;
    if (lane < 224) {
      bytes[index] = (index * 13 + (index >>> 12) * 7 + spec.seed * 29) & 0xff;
      continue;
    }
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    bytes[index] = randomState & 0xff;
  }
  return bytes;
}

/** Calculates two independent unsigned 32-bit checksums without a crypto runtime dependency. */
function calculateChecksums(bytes: Uint8Array): { adler32: number; rolling32: number } {
  /** Adler-32 low accumulator. */
  let adlerA = 1;
  /** Adler-32 high accumulator. */
  let adlerB = 0;
  /** Independent order-sensitive rolling checksum. */
  let rolling = 5381;
  for (const value of bytes) {
    adlerA = (adlerA + value) % 65_521;
    adlerB = (adlerB + adlerA) % 65_521;
    rolling = ((rolling << 5) - rolling + value) >>> 0;
  }
  return {
    adler32: ((adlerB << 16) | adlerA) >>> 0,
    rolling32: rolling >>> 0,
  };
}

/** Inputs for generating one self-contained Hermes source file. */
interface BuildHermesHarnessSourceOptions {
  /** Exact fflate UMD bundle source. */
  fflateSource: string;
  /** Measured samples per frame size. */
  measuredRuns: number;
  /** Independent compressed vectors. */
  vectors: readonly HermesDecodeVector[];
}

/** Builds an ES5-compatible source harness whose decode and clock both execute inside Hermes. */
function buildHermesHarnessSource(options: BuildHermesHarnessSourceOptions): string {
  /** Serialized fixed vectors containing no operator or session data. */
  const vectorsJson = JSON.stringify(options.vectors);
  return `${options.fflateSource}
;(function () {
  "use strict";
  var vectors = ${vectorsJson};
  var measuredRuns = ${options.measuredRuns};
  var warmupRuns = ${WARMUP_RUNS};
  var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  // Decodes one embedded raw-DEFLATE vector without relying on browser atob.
  function decodeBase64(value) {
    var padding = value.slice(-2) === "==" ? 2 : value.slice(-1) === "=" ? 1 : 0;
    var output = new Uint8Array((value.length * 3 >> 2) - padding);
    var accumulator = 0;
    var bits = 0;
    var outputIndex = 0;
    for (var index = 0; index < value.length; index += 1) {
      var character = value.charAt(index);
      if (character === "=") break;
      var sextet = alphabet.indexOf(character);
      if (sextet < 0) throw new Error("Invalid embedded Base64 vector");
      accumulator = ((accumulator << 6) | sextet) >>> 0;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        output[outputIndex] = (accumulator >>> bits) & 255;
        outputIndex += 1;
      }
    }
    if (outputIndex !== output.length) throw new Error("Invalid embedded Base64 length");
    return output;
  }

  // Uses Hermes high-resolution time when available and Date.now otherwise.
  function nowMs() {
    if (typeof performance !== "undefined" && performance && typeof performance.now === "function") {
      return performance.now();
    }
    return Date.now();
  }

  // Computes the same independent checksums as the Node vector generator.
  function calculateChecksums(bytes) {
    var adlerA = 1;
    var adlerB = 0;
    var rolling = 5381;
    for (var index = 0; index < bytes.length; index += 1) {
      var value = bytes[index];
      adlerA = (adlerA + value) % 65521;
      adlerB = (adlerB + adlerA) % 65521;
      rolling = ((rolling << 5) - rolling + value) >>> 0;
    }
    return { adler32: ((adlerB << 16) | adlerA) >>> 0, rolling32: rolling >>> 0 };
  }

  // Returns the nearest-rank p95 used by the parent Spec.
  function percentile95(values) {
    var sorted = values.slice().sort(function (left, right) { return left - right; });
    return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
  }

  var compressedByLabel = {};
  var samplesByLabel = {};
  for (var vectorIndex = 0; vectorIndex < vectors.length; vectorIndex += 1) {
    var vector = vectors[vectorIndex];
    compressedByLabel[vector.label] = decodeBase64(vector.compressedBase64);
    samplesByLabel[vector.label] = [];
  }

  var observedOrder = [];
  var expectedOrder = [];
  for (var run = -warmupRuns; run < measuredRuns; run += 1) {
    var firstIndex = (run + warmupRuns) % vectors.length;
    for (var position = 0; position < vectors.length; position += 1) {
      var current = vectors[(firstIndex + position) % vectors.length];
      var startedAt = nowMs();
      var output = fflate.inflateSync(compressedByLabel[current.label], {
        out: new Uint8Array(current.originalBytes + 1)
      });
      var elapsedMs = nowMs() - startedAt;
      var checksums = calculateChecksums(output);
      if (output.length !== current.originalBytes) throw new Error("Hermes output length mismatch");
      if (checksums.adler32 !== current.expectedAdler32) throw new Error("Hermes Adler-32 mismatch");
      if (checksums.rolling32 !== current.expectedRolling32) throw new Error("Hermes rolling checksum mismatch");
      if (run >= 0) {
        samplesByLabel[current.label].push(elapsedMs);
        expectedOrder.push(current.label);
        observedOrder.push(current.label);
      }
    }
  }

  var orderVerified = expectedOrder.join(",") === observedOrder.join(",");
  var frameResults = [];
  var passed = orderVerified;
  for (var resultIndex = 0; resultIndex < vectors.length; resultIndex += 1) {
    var resultVector = vectors[resultIndex];
    var p95Ms = percentile95(samplesByLabel[resultVector.label]);
    var framePassed = p95Ms <= resultVector.thresholdMs;
    passed = passed && framePassed;
    frameResults.push({
      label: resultVector.label,
      originalBytes: resultVector.originalBytes,
      compressedBytes: resultVector.compressedBytes,
      outputBytes: resultVector.originalBytes,
      maxOutputBytes: resultVector.originalBytes + 1,
      p95Ms: p95Ms,
      thresholdMs: resultVector.thresholdMs,
      checksumVerified: true,
      passed: framePassed
    });
  }

  print("${HERMES_REPORT_PREFIX}" + JSON.stringify({
    schemaVersion: 1,
    measuredRuns: measuredRuns,
    warmupRuns: warmupRuns,
    completedMeasuredFrames: measuredRuns * vectors.length,
    orderVerified: orderVerified,
    frames: frameResults,
    passed: passed
  }));
}());
`;
}

/** Executes one Hermes process without a shell and rejects non-zero exits. */
function executeHermesProcess(request: HermesProcessRequest): Promise<HermesProcessResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    /** Hermes child process isolated from shell interpolation. */
    const child = spawn(request.executable, [...request.args], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    /** Captured standard output containing the report marker. */
    let stdout = "";
    /** Captured standard error containing bounded runtime diagnostics. */
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", rejectPromise);
    child.once("close", (code) => {
      if (code !== 0) {
        rejectPromise(new Error(`Hermes process exited with code ${code}: ${stderr.trim()}`));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}

/** Parses a content-free runtime identity from the official Hermes version banner. */
function parseHermesRuntimeIdentity(output: string): HermesRuntimeIdentity {
  /** Release label reported by Hermes. */
  const releaseMatch = /Hermes release version:\s*([^\s]+)/.exec(output);
  /** HBC format reported by Hermes. */
  const hbcMatch = /HBC bytecode version:\s*(\d+)/.exec(output);
  if (!releaseMatch?.[1] || !hbcMatch?.[1]) {
    throw new Error("The supplied --hermes executable did not report a Hermes VM version");
  }
  /** Runtime build kind reported by the executable. */
  let buildKind: HermesRuntimeIdentity["buildKind"] = "unknown";
  if (/DEBUG build/.test(output)) {
    buildKind = "DEBUG";
  } else if (/RELEASE build/.test(output)) {
    buildKind = "RELEASE";
  }
  return {
    releaseVersion: releaseMatch[1],
    hbcBytecodeVersion: Number(hbcMatch[1]),
    buildKind,
  };
}

/** Parses and validates the untrusted report line emitted by the Hermes process. */
function parseHermesScriptReport(stdout: string, expectedRuns: number): HermesScriptReport {
  /** Marker line isolated from any compiler diagnostics. */
  const reportLine = stdout.split(/\r?\n/).find((line) => line.startsWith(HERMES_REPORT_PREFIX));
  if (!reportLine) throw new Error("Hermes process did not emit a decode report");
  /** Untrusted JSON value emitted by the child process. */
  const parsed: unknown = JSON.parse(reportLine.slice(HERMES_REPORT_PREFIX.length));
  if (!isRecord(parsed)) throw new Error("Hermes decode report is not an object");
  if (parsed.schemaVersion !== 1) throw new Error("Unsupported Hermes decode report version");
  if (parsed.measuredRuns !== expectedRuns) throw new Error("Hermes decode report run mismatch");
  if (parsed.warmupRuns !== WARMUP_RUNS) throw new Error("Hermes decode report warm-up mismatch");
  if (parsed.completedMeasuredFrames !== expectedRuns * HERMES_FRAME_SPECS.length) {
    throw new Error("Hermes decode report completion mismatch");
  }
  if (typeof parsed.orderVerified !== "boolean" || typeof parsed.passed !== "boolean") {
    throw new Error("Hermes decode report verdict is invalid");
  }
  /** Untrusted frame matrix retained after property access for stable narrowing. */
  const rawFrames = parsed.frames;
  if (!Array.isArray(rawFrames) || rawFrames.length !== HERMES_FRAME_SPECS.length) {
    throw new Error("Hermes decode report frame matrix is invalid");
  }
  /** Strictly parsed per-size results in Spec order. */
  const frames = HERMES_FRAME_SPECS.map((spec) => parseHermesFrameResult(rawFrames, spec));
  /** Aggregate verdict independently recomputed from validated fields. */
  const expectedPassed = parsed.orderVerified && frames.every((frame) => frame.passed);
  if (parsed.passed !== expectedPassed) throw new Error("Hermes decode report aggregate mismatch");
  return {
    schemaVersion: 1,
    measuredRuns: expectedRuns,
    warmupRuns: WARMUP_RUNS,
    completedMeasuredFrames: expectedRuns * HERMES_FRAME_SPECS.length,
    orderVerified: parsed.orderVerified,
    frames,
    passed: parsed.passed,
  };
}

/** Parses one uniquely labelled frame result and re-evaluates its correctness and latency gates. */
function parseHermesFrameResult(
  values: readonly unknown[],
  spec: HermesFrameSpec,
): HermesDecodeFrameResult {
  /** Child report row matching the fixed frame label. */
  const matching = values.filter((value) => isRecord(value) && value.label === spec.label);
  if (matching.length !== 1 || !isRecord(matching[0])) {
    throw new Error(`Hermes decode report must contain one ${spec.label} row`);
  }
  /** Strictly narrowed result row. */
  const value = matching[0];
  /** Measured p95 emitted by Hermes. */
  const p95Ms = value.p95Ms;
  if (typeof p95Ms !== "number" || !Number.isFinite(p95Ms) || p95Ms < 0) {
    throw new Error(`Hermes ${spec.label} p95 is invalid`);
  }
  if (
    value.originalBytes !== spec.originalBytes ||
    value.outputBytes !== spec.originalBytes ||
    value.maxOutputBytes !== spec.originalBytes + 1 ||
    value.thresholdMs !== spec.thresholdMs ||
    typeof value.compressedBytes !== "number" ||
    !Number.isSafeInteger(value.compressedBytes) ||
    value.compressedBytes <= 0 ||
    value.checksumVerified !== true
  ) {
    throw new Error(`Hermes ${spec.label} correctness fields are invalid`);
  }
  /** Independently recomputed per-frame verdict. */
  const expectedPassed = p95Ms <= spec.thresholdMs;
  if (value.passed !== expectedPassed) {
    throw new Error(`Hermes ${spec.label} verdict is invalid`);
  }
  return {
    label: spec.label,
    originalBytes: spec.originalBytes,
    compressedBytes: value.compressedBytes,
    outputBytes: spec.originalBytes,
    maxOutputBytes: spec.originalBytes + 1,
    p95Ms,
    thresholdMs: spec.thresholdMs,
    checksumVerified: true,
    passed: expectedPassed,
  };
}

/** Narrows one unknown JSON value to a plain record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns whether this module is the process entrypoint rather than a test import. */
function isMainModule(): boolean {
  /** Executed script path supplied by Node or tsx. */
  const entry = process.argv[1];
  return Boolean(entry && pathToFileURL(resolve(entry)).href === import.meta.url);
}

if (isMainModule()) {
  runHermesRelayDecodeCli({ args: process.argv.slice(2) }).catch((error: unknown) => {
    /** Bounded CLI failure without vector contents. */
    const message =
      error instanceof Error ? error.message : "Hermes relay decode measurement failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
