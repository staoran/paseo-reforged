import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { arch, cpus, platform } from "node:os";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateRaw, inflateRaw } from "node:zlib";

import { decrypt, encrypt, type SharedKey } from "../packages/relay/src/crypto.js";
import {
  decodeFramedPayload,
  MAX_COMPRESSION_INPUT_BYTES,
  MAX_COMPRESSION_RATIO,
  MIN_COMPRESSION_BYTES,
  MIN_COMPRESSION_SAVINGS_BYTES,
  MIN_COMPRESSION_SAVINGS_RATIO,
  prepareDeflateFramedPayload,
  prepareIdentityFramedPayload,
  type FrameCompressionAdapter,
  type PreparedFramedPayload,
} from "../packages/relay/src/framed-ciphertext.js";

/** Minimum measured iterations required after one unreported warm-up run. */
const MIN_BENCHMARK_RUNS = 5;
/** Default measured iterations when the operator does not provide `--runs`. */
const DEFAULT_BENCHMARK_RUNS = 5;
/** Event-loop sampling interval fine enough to evaluate the 5 ms regression gate. */
const EVENT_LOOP_DELAY_RESOLUTION_MS = 1;
/** State-sync JSON framing used to keep every research frame within v1 limits. */
const JSON_FRAME_BYTES = 256 * 1024;
/** Production file-transfer chunk size mirrored by the offline benchmark. */
const FILE_FRAME_BYTES = 256 * 1024;
/** Canonical completed tool-call output framing used by the bulk-live study. */
const TOOL_CALL_FRAME_BYTES = 64 * 1024;
/** Stricter production minimum for a completed live tool-call compression attempt. */
const BULK_LIVE_MIN_COMPRESSION_BYTES = 16 * 1024;
/** Terminal research sizes retained from the Spec 0084 feasibility study. */
const TERMINAL_FRAME_SIZES = [256, 1024, 4096] as const;
/** Private research levels; only level 1 is the runtime baseline. */
const RESEARCH_DEFLATE_LEVELS = [1, 3, 6] as const;
/** Number of MiB used by throughput formatting. */
const BYTES_PER_MIB = 1024 * 1024;

/** Stable labels accepted as explicit input flags. */
type InputLabel = "json" | "terminal" | "file" | "tool-call";
/** Explicit terminal source formats supported without content sniffing. */
type TerminalInputFormat = "raw" | "codex-session-jsonl";
/** Explicit completed tool-call source formats supported without content sniffing. */
type ToolCallInputFormat = "raw" | "paseo-timeline-segment";
/** Raw DEFLATE levels measured without expanding the runtime configuration surface. */
type ResearchDeflateLevel = (typeof RESEARCH_DEFLATE_LEVELS)[number];
/** Ciphertext representation included in one benchmark variant. */
type BenchmarkEncoding = "base64" | "binary";
/** Codec candidate included in one benchmark variant. */
type BenchmarkCodec = "identity" | "deflate-raw";

/** Parsed operator inputs; paths stay private and never enter rendered output. */
interface BenchmarkCliOptions {
  /** Explicit real JSON corpus path. */
  jsonPath: string;
  /** Explicit real terminal stream path. */
  terminalPath: string;
  /** Operator-selected terminal extraction format. */
  terminalFormat: TerminalInputFormat;
  /** Explicit real file-transfer corpus path. */
  filePath: string;
  /** Explicit real completed tool-call corpus path. */
  toolCallPath: string;
  /** Operator-selected completed tool-call extraction format. */
  toolCallFormat: ToolCallInputFormat;
  /** Measured iterations after warm-up. */
  runs: number;
}

/** Output port used by tests and the process entrypoint. */
export interface RelayFrameCodecBenchmarkCliIo {
  /** Receives content-free report text. */
  writeStdout(value: string): void;
}

/** One exact application frame and its comparison bytes. */
interface BenchmarkFrame {
  /** Text or binary value passed through the real relay primitives. */
  data: string | ArrayBuffer;
  /** Exact original bytes used only for counts and equality checks. */
  bytes: Uint8Array;
}

/** One reproducibly framed corpus derived from an explicit operator input. */
interface BenchmarkCorpus {
  /** Public bounded label that does not disclose the source path. */
  label: string;
  /** Actual application frames processed by every variant. */
  frames: BenchmarkFrame[];
  /** Legacy ciphertext representation used by the corresponding application traffic. */
  legacyEncoding: BenchmarkEncoding;
  /** Whether v1 runtime policy permits this semantic class to adopt compression. */
  runtimeCompressionEligible: boolean;
  /** Category-specific minimum applied before a candidate may be adopted. */
  minimumCompressionBytes: number;
}

/** One legacy, identity, or research-level framed comparison. */
interface BenchmarkVariant {
  /** Stable content-free output label. */
  label: string;
  /** Whether the authenticated v1 envelope is present. */
  framed: boolean;
  /** Locked framed representation, or null when legacy semantics select it per corpus. */
  encoding: BenchmarkEncoding | null;
  /** Candidate codec evaluated before runtime adoption gates. */
  codec: BenchmarkCodec;
  /** Private raw DEFLATE level for research rows. */
  level: ResearchDeflateLevel | null;
}

/** Byte totals and timings produced by one complete corpus run. */
interface BenchmarkRunSample {
  /** Number of application frames processed. */
  frames: number;
  /** Total unencoded application bytes. */
  originalBytes: number;
  /** Total candidate codec bytes before runtime adoption policy. */
  candidateBytes: number;
  /** Total bytes actually placed after the authenticated envelope header. */
  encodedBytes: number;
  /** Exact WebSocket wire bytes after encryption and representation. */
  wireBytes: number;
  /** Opaque NaCl bundle bytes before optional Base64 representation. */
  encryptedBytes: number;
  /** Frames whose raw DEFLATE candidate passed all v1 adoption gates. */
  adoptedFrames: number;
  /** Exact WebSocket byte size for every application frame in this run. */
  wireFrameBytes: number[];
  /** End-to-end benchmark wall time. */
  wallMs: number;
  /** Process user plus system CPU consumed during the run. */
  cpuMs: number;
  /** Compression/envelope/encryption/representation wall time. */
  prepareMs: number;
  /** Representation/decryption/envelope/inflate wall time. */
  decodeMs: number;
  /** Original MiB processed per second of preparation time. */
  throughputMiBps: number;
}

/** Percentile summary over measured runs. */
interface NumberSummary {
  /** Nearest-rank median. */
  p50: number;
  /** Nearest-rank 95th percentile. */
  p95: number;
  /** Largest measured value. */
  max: number;
}

/** Aggregated report row for one corpus and variant. */
interface BenchmarkResult {
  /** Corpus metadata shared with the row. */
  corpus: BenchmarkCorpus;
  /** Variant metadata shared with the row. */
  variant: BenchmarkVariant;
  /** Deterministic byte totals from the first measured run. */
  bytes: Pick<
    BenchmarkRunSample,
    | "frames"
    | "originalBytes"
    | "candidateBytes"
    | "encodedBytes"
    | "encryptedBytes"
    | "wireBytes"
    | "adoptedFrames"
  >;
  /** Deterministic WebSocket frame-size distribution. */
  wireFrameBytes: NumberSummary;
  /** End-to-end wall-time distribution. */
  wallMs: NumberSummary;
  /** Process CPU distribution. */
  cpuMs: NumberSummary;
  /** Outbound preparation distribution. */
  prepareMs: NumberSummary;
  /** Inbound decode distribution. */
  decodeMs: NumberSummary;
  /** Preparation throughput distribution. */
  throughputMiBps: NumberSummary;
  /** Event-loop 99th percentile observed across warm-up and measured runs. */
  eventLoopP99Ms: number;
}

/** All wire variants required by the Spec 0084 benchmark matrix. */
const BENCHMARK_VARIANTS: readonly BenchmarkVariant[] = [
  { label: "legacy", framed: false, encoding: null, codec: "identity", level: null },
  {
    label: "framed-base64-identity",
    framed: true,
    encoding: "base64",
    codec: "identity",
    level: null,
  },
  {
    label: "framed-binary-identity",
    framed: true,
    encoding: "binary",
    codec: "identity",
    level: null,
  },
  ...RESEARCH_DEFLATE_LEVELS.flatMap((level) => [
    {
      label: `framed-base64-deflate-l${level}`,
      framed: true,
      encoding: "base64" as const,
      codec: "deflate-raw" as const,
      level,
    },
    {
      label: `framed-binary-deflate-l${level}`,
      framed: true,
      encoding: "binary" as const,
      codec: "deflate-raw" as const,
      level,
    },
  ]),
];

/** Bounded raw DEFLATE decoder used by the actual framed parser. */
const BENCHMARK_COMPRESSION_ADAPTER: FrameCompressionAdapter = {
  inflateRaw: inflateRawBounded,
};

/** Runs the content-free relay frame benchmark from explicit CLI arguments. */
export async function runRelayFrameCodecBenchmarkCli(
  args: readonly string[],
  io: RelayFrameCodecBenchmarkCliIo = {
    writeStdout: (value) => process.stdout.write(value),
  },
): Promise<void> {
  /** Validated operator options retained only during this invocation. */
  const options = parseCliOptions(args);
  /** Explicit corpus bytes loaded with sanitized error messages. */
  const inputs = await Promise.all([
    readBenchmarkInput("json", options.jsonPath),
    readBenchmarkInput("terminal", options.terminalPath),
    readBenchmarkInput("file", options.filePath),
    readBenchmarkInput("tool-call", options.toolCallPath),
  ]);
  /** Reproducible semantic framing applied equally to every wire variant. */
  const corpora = buildCorpora(
    {
      json: inputs[0],
      terminal: inputs[1],
      file: inputs[2],
      toolCall: inputs[3],
    },
    options,
  );
  /** Ephemeral shared key used only to include real NaCl work in this process. */
  const sharedKey = new Uint8Array(randomBytes(32)) as SharedKey;

  io.writeStdout(`relay-frame-codec-benchmark version=1 runs=${options.runs} warmupRuns=1\n`);
  /** Content-free execution environment needed to compare repeated benchmark reports. */
  const cpu = sanitizeReportLabel(cpus()[0]?.model ?? "unknown");
  io.writeStdout(
    `environment os=${sanitizeReportLabel(platform())} arch=${sanitizeReportLabel(arch())} cpu=${cpu} node=${sanitizeReportLabel(process.version)} runtime=node productionLevel=1 researchLevels=${RESEARCH_DEFLATE_LEVELS.join(",")} eventLoopResolutionMs=${EVENT_LOOP_DELAY_RESOLUTION_MS}\n`,
  );
  for (const corpus of corpora) {
    /** Legacy result supplies the exact per-corpus wire baseline. */
    let legacyWireBytes = 0;
    for (const variant of BENCHMARK_VARIANTS) {
      /** Aggregated timings and deterministic bytes for this matrix row. */
      const result = await benchmarkVariant(corpus, variant, options.runs, sharedKey);
      if (variant.label === "legacy") legacyWireBytes = result.bytes.wireBytes;
      io.writeStdout(`${formatResult(result, legacyWireBytes)}\n`);
    }
  }
}

/** Parses required paths and the bounded measured-run count without echoing values. */
function parseCliOptions(args: readonly string[]): BenchmarkCliOptions {
  /** Private option values indexed by their public flag names. */
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    /** Current public option flag. */
    const flag = args[index];
    if (!flag?.startsWith("--")) throw new Error("Unexpected relay benchmark argument");
    if (!isSupportedFlag(flag)) throw new Error("Unsupported relay benchmark option");
    if (values.has(flag)) throw new Error(`Duplicate relay benchmark option ${flag}`);
    /** Private option value consumed without rendering it. */
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for relay benchmark option ${flag}`);
    }
    values.set(flag, value);
    index += 1;
  }

  /** Required path resolved by public input category. */
  const requiredPath = (flag: string): string => {
    /** Operator-provided path kept out of all error messages. */
    const value = values.get(flag);
    if (!value) throw new Error(`Missing required relay benchmark option ${flag}`);
    return value;
  };
  /** Optional measured-run count constrained by the benchmark contract. */
  const runsText = values.get("--runs");
  /** Numeric measured-run count after strict decimal validation. */
  const runs = runsText === undefined ? DEFAULT_BENCHMARK_RUNS : Number(runsText);
  if (!Number.isSafeInteger(runs) || runs < MIN_BENCHMARK_RUNS) {
    throw new Error(`Relay benchmark --runs must be an integer >= ${MIN_BENCHMARK_RUNS}`);
  }

  return {
    jsonPath: requiredPath("--json"),
    terminalPath: requiredPath("--terminal"),
    terminalFormat: parseTerminalInputFormat(values.get("--terminal-format")),
    filePath: requiredPath("--file"),
    toolCallPath: requiredPath("--tool-call"),
    toolCallFormat: parseToolCallInputFormat(values.get("--tool-call-format")),
    runs,
  };
}

/** Restricts CLI parsing to the stable v1 option set. */
function isSupportedFlag(flag: string): boolean {
  return [
    "--json",
    "--terminal",
    "--terminal-format",
    "--file",
    "--tool-call",
    "--tool-call-format",
    "--runs",
  ].includes(flag);
}

/** Resolves the explicit terminal format while preserving raw-input compatibility. */
function parseTerminalInputFormat(value: string | undefined): TerminalInputFormat {
  if (value === undefined || value === "raw") return "raw";
  if (value === "codex-session-jsonl") return value;
  throw new Error("Unsupported relay benchmark terminal format");
}

/** Resolves the explicit tool-call format while preserving raw-input compatibility. */
function parseToolCallInputFormat(value: string | undefined): ToolCallInputFormat {
  if (value === undefined || value === "raw") return "raw";
  if (value === "paseo-timeline-segment") return value;
  throw new Error("Unsupported relay benchmark tool-call format");
}

/** Reads one explicit corpus while preventing filesystem paths from entering errors. */
async function readBenchmarkInput(label: InputLabel, path: string): Promise<Uint8Array> {
  try {
    /** Exact file bytes copied out of Node's pooled Buffer backing store. */
    const bytes = new Uint8Array(await readFile(path));
    if (bytes.byteLength === 0) throw new Error("empty");
    return bytes;
  } catch (error) {
    /** Stable error code retained without the original path or message. */
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code ?? "invalid")
        : "invalid";
    // The original cause can contain the private corpus path, so expose only the bounded code.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(`Unable to read ${label} relay benchmark input (${code})`);
  }
}

/** Builds semantic corpus profiles without retaining any source path. */
function buildCorpora(
  inputs: {
    /** Raw UTF-8 JSON bytes. */
    json: Uint8Array;
    /** Raw terminal stream bytes. */
    terminal: Uint8Array;
    /** Raw file-transfer bytes. */
    file: Uint8Array;
    /** Raw UTF-8 completed tool-call bytes. */
    toolCall: Uint8Array;
  },
  options: Pick<BenchmarkCliOptions, "terminalFormat" | "toolCallFormat">,
): BenchmarkCorpus[] {
  /** Text state-sync frames whose legacy representation is Base64 text. */
  const jsonFrames = splitUtf8Frames("json", inputs.json, JSON_FRAME_BYTES);
  /** Terminal bytes extracted only through the operator-selected format. */
  const terminalBytes =
    options.terminalFormat === "codex-session-jsonl"
      ? extractCodexSessionTerminalOutput(inputs.terminal)
      : inputs.terminal;
  /** Binary file chunks mirroring the production FileChunk size. */
  const fileFrames = splitBinaryFrames(inputs.file, FILE_FRAME_BYTES);
  /** Completed tool-call events preserving real timeline boundaries when explicitly selected. */
  const toolCallFrames =
    options.toolCallFormat === "paseo-timeline-segment"
      ? extractPaseoTimelineToolCallFrames(inputs.toolCall)
      : splitUtf8Frames("tool-call", inputs.toolCall, TOOL_CALL_FRAME_BYTES);
  /** Core non-terminal corpora in stable output order. */
  const corpora: BenchmarkCorpus[] = [
    {
      label: "json",
      frames: jsonFrames,
      legacyEncoding: "base64",
      runtimeCompressionEligible: true,
      minimumCompressionBytes: MIN_COMPRESSION_BYTES,
    },
    ...TERMINAL_FRAME_SIZES.map((frameBytes) => ({
      label: `terminal-${frameBytes}b`,
      frames: splitBinaryFrames(terminalBytes, frameBytes),
      legacyEncoding: "binary" as const,
      runtimeCompressionEligible: false,
      minimumCompressionBytes: MIN_COMPRESSION_BYTES,
    })),
    {
      label: "file",
      frames: fileFrames,
      legacyEncoding: "binary",
      runtimeCompressionEligible: true,
      minimumCompressionBytes: MIN_COMPRESSION_BYTES,
    },
    {
      label: "tool-call",
      frames: toolCallFrames,
      legacyEncoding: "base64",
      runtimeCompressionEligible: true,
      minimumCompressionBytes: BULK_LIVE_MIN_COMPRESSION_BYTES,
    },
  ];
  return corpora;
}

/** Extracts ordered output bytes from `exec` tool results in one explicit Codex session JSONL. */
function extractCodexSessionTerminalOutput(input: Uint8Array): Uint8Array {
  try {
    /** Session text decoded strictly so corrupt input cannot be silently benchmarked. */
    const text = new TextDecoder("utf-8", { fatal: true }).decode(input);
    /** Tool names correlated by the opaque call ids present in the session records. */
    const toolNames = new Map<string, string>();
    /** Ordered terminal-like output chunks retained only for this benchmark invocation. */
    const outputChunks: Uint8Array[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (line.trim().length === 0) continue;
      /** One parsed session record inspected only through bounded structural fields. */
      const record: unknown = JSON.parse(line);
      if (!isRecord(record) || !isRecord(record.payload)) continue;
      /** Codex event payload used for tool-call correlation and output extraction. */
      const payload = record.payload;
      if (
        payload.type === "custom_tool_call" &&
        typeof payload.call_id === "string" &&
        typeof payload.name === "string"
      ) {
        toolNames.set(payload.call_id, payload.name);
        continue;
      }
      if (
        payload.type !== "custom_tool_call_output" ||
        typeof payload.call_id !== "string" ||
        toolNames.get(payload.call_id) !== "exec"
      ) {
        continue;
      }
      /** Text emitted by the real exec result, excluding its JSONL metadata wrapper. */
      const output = extractCodexExecOutputText(payload.output);
      if (output.length > 0) outputChunks.push(new TextEncoder().encode(output));
    }
    if (outputChunks.length === 0) throw new Error("empty");
    return concatenateBytes(outputChunks);
  } catch {
    throw new Error("Unable to decode terminal relay benchmark input (invalid-session-format)");
  }
}

/** Selects textual output blocks from one Codex exec result without serializing other metadata. */
function extractCodexExecOutputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    return output
      .flatMap((block) => (isRecord(block) && typeof block.text === "string" ? [block.text] : []))
      .join("");
  }
  if (isRecord(output) && typeof output.output === "string") return output.output;
  return "";
}

/** Rebuilds completed `agent_stream` messages from canonical Paseo timeline rows. */
function extractPaseoTimelineToolCallFrames(input: Uint8Array): BenchmarkFrame[] {
  try {
    /** Parsed canonical segment whose rows remain local to this benchmark invocation. */
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input));
    if (!Array.isArray(parsed)) throw new Error("invalid");
    /** One text frame per real completed tool-call timeline boundary. */
    const frames: BenchmarkFrame[] = [];
    for (const row of parsed) {
      if (!isRecord(row) || !isRecord(row.item)) continue;
      /** Canonical timeline item retained unchanged inside the reconstructed event. */
      const item = row.item;
      if (item.type !== "tool_call" || item.status !== "completed") continue;
      /** Stable timestamp used by both current agent-stream timestamp fields. */
      const timestamp =
        typeof row.timestamp === "string" ? row.timestamp : "1970-01-01T00:00:00.000Z";
      /** Optional canonical sequence preserved when it satisfies the wire contract. */
      const sequence =
        Number.isSafeInteger(row.seq) && Number(row.seq) >= 0 ? Number(row.seq) : undefined;
      /** Actual WebSocket session envelope rebuilt without retaining a real agent identifier. */
      const data = JSON.stringify({
        type: "session",
        message: {
          type: "agent_stream",
          payload: {
            agentId: "benchmark-agent",
            event: {
              type: "timeline",
              provider: "codex",
              item,
              timestamp,
            },
            timestamp,
            ...(sequence === undefined ? {} : { seq: sequence }),
          },
        },
      });
      /** Exact UTF-8 application bytes measured by every wire variant. */
      const bytes = new TextEncoder().encode(data);
      frames.push({ data, bytes });
    }
    if (frames.length === 0) throw new Error("empty");
    return frames;
  } catch {
    throw new Error("Unable to decode tool-call relay benchmark input (invalid-timeline-format)");
  }
}

/** Returns whether an unknown parsed value is a non-null object record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Concatenates exact byte chunks without retaining their source boundaries or metadata. */
function concatenateBytes(chunks: readonly Uint8Array[]): Uint8Array {
  /** Exact total size used for the single stream allocation. */
  const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  /** Contiguous stream bytes used by fixed terminal reframing. */
  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

/** Splits arbitrary bytes into exact standalone binary application frames. */
function splitBinaryFrames(input: Uint8Array, maximumBytes: number): BenchmarkFrame[] {
  /** Output frames preserving every input byte exactly once. */
  const frames: BenchmarkFrame[] = [];
  for (let offset = 0; offset < input.byteLength; offset += maximumBytes) {
    /** Standalone exact-size bytes for this application frame. */
    const bytes = input.slice(offset, Math.min(input.byteLength, offset + maximumBytes));
    frames.push({ data: bytes.buffer, bytes });
  }
  return frames;
}

/** Splits UTF-8 input at code-point boundaries and returns text application frames. */
function splitUtf8Frames(
  label: Extract<InputLabel, "json" | "tool-call">,
  input: Uint8Array,
  maximumBytes: number,
): BenchmarkFrame[] {
  /** Output frames preserving valid UTF-8 text without content retention elsewhere. */
  const frames: BenchmarkFrame[] = [];
  /** Fatal decoder rejects mislabeled or boundary-corrupted text input. */
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let offset = 0;
  try {
    while (offset < input.byteLength) {
      /** Candidate exclusive boundary capped by the research frame size. */
      let end = Math.min(input.byteLength, offset + maximumBytes);
      while (end < input.byteLength && (input[end] & 0xc0) === 0x80) end -= 1;
      if (end <= offset) throw new Error("invalid UTF-8 boundary");
      /** Exact original bytes used for equality and aggregate byte counts. */
      const bytes = input.slice(offset, end);
      /** Text value passed through production UTF-8 envelope normalization. */
      const data = decoder.decode(bytes);
      frames.push({ data, bytes });
      offset = end;
    }
  } catch {
    throw new Error(`Unable to decode ${label} relay benchmark input (invalid-utf8)`);
  }
  return frames;
}

/** Executes warm-up and measured runs for one corpus/variant combination. */
async function benchmarkVariant(
  corpus: BenchmarkCorpus,
  variant: BenchmarkVariant,
  runs: number,
  sharedKey: SharedKey,
): Promise<BenchmarkResult> {
  /** Event-loop delay sampler used as a non-content CPU contention signal. */
  const eventLoopDelay = monitorEventLoopDelay({ resolution: EVENT_LOOP_DELAY_RESOLUTION_MS });
  eventLoopDelay.enable();
  try {
    await runVariantOnce(corpus, variant, sharedKey);
    /** Measured samples retained only as aggregate numeric metadata. */
    const samples: BenchmarkRunSample[] = [];
    for (let run = 0; run < runs; run += 1) {
      samples.push(await runVariantOnce(corpus, variant, sharedKey));
    }
    /** First sample contains deterministic byte totals checked against later runs. */
    const first = samples[0];
    if (!first) throw new Error("Relay benchmark produced no measured samples");
    for (const sample of samples.slice(1)) assertStableByteTotals(first, sample);
    return {
      corpus,
      variant,
      bytes: {
        frames: first.frames,
        originalBytes: first.originalBytes,
        candidateBytes: first.candidateBytes,
        encodedBytes: first.encodedBytes,
        encryptedBytes: first.encryptedBytes,
        wireBytes: first.wireBytes,
        adoptedFrames: first.adoptedFrames,
      },
      wireFrameBytes: summarize(first.wireFrameBytes),
      wallMs: summarize(samples.map((sample) => sample.wallMs)),
      cpuMs: summarize(samples.map((sample) => sample.cpuMs)),
      prepareMs: summarize(samples.map((sample) => sample.prepareMs)),
      decodeMs: summarize(samples.map((sample) => sample.decodeMs)),
      throughputMiBps: summarize(samples.map((sample) => sample.throughputMiBps)),
      eventLoopP99Ms: finiteMetric(eventLoopDelay.percentile(99) / 1_000_000),
    };
  } finally {
    eventLoopDelay.disable();
  }
}

/** Processes every frame through real compression, envelope, crypto, and decode primitives. */
async function runVariantOnce(
  corpus: BenchmarkCorpus,
  variant: BenchmarkVariant,
  sharedKey: SharedKey,
): Promise<BenchmarkRunSample> {
  /** Process CPU baseline for this measured run. */
  const cpuStarted = process.cpuUsage();
  /** End-to-end monotonic wall baseline for this measured run. */
  const wallStarted = performance.now();
  let originalBytes = 0;
  let candidateBytes = 0;
  let encodedBytes = 0;
  let encryptedBytes = 0;
  let wireBytes = 0;
  let adoptedFrames = 0;
  /** Exact final size of each deterministic WebSocket application frame. */
  const wireFrameBytes: number[] = [];
  let prepareMs = 0;
  let decodeMs = 0;

  for (const frame of corpus.frames) {
    originalBytes += frame.bytes.byteLength;
    /** Outbound full-chain start for this application frame. */
    const prepareStarted = performance.now();
    /** Raw codec candidate retained only until this frame finishes. */
    const candidate =
      variant.codec === "deflate-raw"
        ? await deflateRawAsync(frame.bytes, variant.level ?? 1)
        : frame.bytes.slice().buffer;
    candidateBytes += candidate.byteLength;
    /** Whether the research candidate is legal and effective under runtime policy. */
    const adopted =
      variant.codec === "deflate-raw" && canAdoptCandidate(corpus, frame.bytes, candidate);
    if (adopted) adoptedFrames += 1;
    /** Prepared authenticated envelope, omitted on the legacy wire. */
    let prepared: PreparedFramedPayload | null = null;
    if (variant.framed) {
      prepared = adopted
        ? prepareDeflateFramedPayload(frame.data, candidate)
        : prepareIdentityFramedPayload(frame.data);
    }
    /** Actual bytes passed into NaCl for this variant. */
    const plaintext = prepared?.plaintext ?? frame.data;
    /** Opaque encrypted bundle matching the production primitive. */
    const encrypted = encrypt(sharedKey, plaintext);
    encryptedBytes += encrypted.byteLength;
    /** Representation selected by legacy semantics or framed negotiation. */
    const encoding = variant.encoding ?? corpus.legacyEncoding;
    /** Final opaque WebSocket value used for exact wire byte measurement. */
    const wire = encodeCiphertext(encrypted, encoding);
    prepareMs += performance.now() - prepareStarted;
    encodedBytes += prepared?.encodedByteLength ?? frame.bytes.byteLength;
    /** Exact ASCII or binary byte count for this WebSocket application frame. */
    const wireByteLength = typeof wire === "string" ? wire.length : wire.byteLength;
    wireBytes += wireByteLength;
    wireFrameBytes.push(wireByteLength);

    /** Inbound full-chain start for this application frame. */
    const decodeStarted = performance.now();
    /** Ciphertext bytes restored from the locked WebSocket representation. */
    const decodedWire = decodeCiphertext(wire, encoding);
    /** Authenticated plaintext restored by the production crypto primitive. */
    const decrypted = decrypt(sharedKey, decodedWire);
    /** Original application bytes restored through legacy or framed decoding. */
    const restored = variant.framed
      ? applicationBytes(
          await decodeFramedPayload(decrypted, BENCHMARK_COMPRESSION_ADAPTER).then(
            (decoded) => decoded.data,
          ),
        )
      : new Uint8Array(decrypted);
    decodeMs += performance.now() - decodeStarted;
    if (!equalBytes(restored, frame.bytes)) {
      throw new Error(`Relay benchmark round-trip mismatch for corpus ${corpus.label}`);
    }
  }

  /** End-to-end wall duration including correctness checks. */
  const wallMs = performance.now() - wallStarted;
  /** User and system CPU delta reported by Node in microseconds. */
  const cpu = process.cpuUsage(cpuStarted);
  /** Original-data throughput based on outbound preparation wall time. */
  const throughputMiBps = prepareMs > 0 ? originalBytes / BYTES_PER_MIB / (prepareMs / 1000) : 0;
  return {
    frames: corpus.frames.length,
    originalBytes,
    candidateBytes,
    encodedBytes,
    encryptedBytes,
    wireBytes,
    adoptedFrames,
    wireFrameBytes,
    wallMs: finiteMetric(wallMs),
    cpuMs: finiteMetric((cpu.user + cpu.system) / 1000),
    prepareMs: finiteMetric(prepareMs),
    decodeMs: finiteMetric(decodeMs),
    throughputMiBps: finiteMetric(throughputMiBps),
  };
}

/** Applies the v1 semantic, size, savings, and ratio gates to a research candidate. */
function canAdoptCandidate(
  corpus: BenchmarkCorpus,
  original: Uint8Array,
  candidate: ArrayBuffer,
): boolean {
  if (!corpus.runtimeCompressionEligible) return false;
  if (original.byteLength < corpus.minimumCompressionBytes) return false;
  if (original.byteLength > MAX_COMPRESSION_INPUT_BYTES || candidate.byteLength === 0) return false;
  if (original.byteLength > candidate.byteLength * MAX_COMPRESSION_RATIO) return false;
  /** Required fixed or proportional reduction, whichever is larger. */
  const requiredSavings = Math.max(
    MIN_COMPRESSION_SAVINGS_BYTES,
    Math.ceil(original.byteLength * MIN_COMPRESSION_SAVINGS_RATIO),
  );
  return candidate.byteLength <= original.byteLength - requiredSavings;
}

/** Compresses one independent raw DEFLATE candidate at a private research level. */
function deflateRawAsync(input: Uint8Array, level: ResearchDeflateLevel): Promise<ArrayBuffer> {
  return new Promise((resolvePromise, rejectPromise) => {
    deflateRaw(Buffer.from(input), { level }, (error, output) => {
      if (error) {
        rejectPromise(new Error("Relay benchmark raw DEFLATE failed"));
        return;
      }
      resolvePromise(exactArrayBuffer(output));
    });
  });
}

/** Inflates one raw DEFLATE frame under the authenticated output bound. */
function inflateRawBounded(
  input: ArrayBuffer,
  expectedLength: number,
  maxOutputLength: number,
): Promise<ArrayBuffer> {
  return new Promise((resolvePromise, rejectPromise) => {
    inflateRaw(Buffer.from(input), { maxOutputLength }, (error, output) => {
      if (error || output.byteLength !== expectedLength) {
        rejectPromise(new Error("Relay benchmark bounded raw inflate failed"));
        return;
      }
      resolvePromise(exactArrayBuffer(output));
    });
  });
}

/** Copies a Node buffer into an exact standalone ArrayBuffer. */
function exactArrayBuffer(input: Uint8Array): ArrayBuffer {
  /** Detached exact-size copy that cannot include a pooled Node Buffer tail. */
  const output = new Uint8Array(input.byteLength);
  output.set(input);
  return output.buffer;
}

/** Encodes opaque ciphertext in the selected WebSocket representation. */
function encodeCiphertext(
  ciphertext: ArrayBuffer,
  encoding: BenchmarkEncoding,
): string | ArrayBuffer {
  return encoding === "base64" ? Buffer.from(ciphertext).toString("base64") : ciphertext.slice(0);
}

/** Decodes opaque ciphertext from the selected WebSocket representation. */
function decodeCiphertext(wire: string | ArrayBuffer, encoding: BenchmarkEncoding): ArrayBuffer {
  if (encoding === "base64") {
    if (typeof wire !== "string") throw new Error("Relay benchmark Base64 wire mismatch");
    return exactArrayBuffer(Buffer.from(wire, "base64"));
  }
  if (!(wire instanceof ArrayBuffer)) throw new Error("Relay benchmark binary wire mismatch");
  return wire.slice(0);
}

/** Normalizes one decoded text or binary value for byte-for-byte validation. */
function applicationBytes(data: string | ArrayBuffer): Uint8Array {
  return typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
}

/** Compares exact bytes without serializing application content. */
function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/** Rejects nondeterministic byte accounting while allowing timing variance. */
function assertStableByteTotals(expected: BenchmarkRunSample, actual: BenchmarkRunSample): void {
  if (
    expected.frames !== actual.frames ||
    expected.originalBytes !== actual.originalBytes ||
    expected.candidateBytes !== actual.candidateBytes ||
    expected.encodedBytes !== actual.encodedBytes ||
    expected.encryptedBytes !== actual.encryptedBytes ||
    expected.wireBytes !== actual.wireBytes ||
    expected.adoptedFrames !== actual.adoptedFrames ||
    !equalNumbers(expected.wireFrameBytes, actual.wireFrameBytes)
  ) {
    throw new Error("Relay benchmark byte totals changed between measured runs");
  }
}

/** Compares deterministic numeric arrays without serializing benchmark content. */
function equalNumbers(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

/** Summarizes finite non-negative samples using nearest-rank percentiles. */
function summarize(values: readonly number[]): NumberSummary {
  /** Normalized ascending samples used by every percentile. */
  const sorted = values.map(finiteMetric).sort((left, right) => left - right);
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1) ?? 0,
  };
}

/** Selects one nearest-rank percentile from an ascending sample set. */
function percentile(sorted: readonly number[], quantile: number): number {
  if (sorted.length === 0) return 0;
  /** Nearest-rank index clamped to the available sample range. */
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index] ?? 0;
}

/** Converts invalid or negative runtime measurements to a safe zero. */
function finiteMetric(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Renders one content-free aggregate row with fixed labels and numeric fields only. */
function formatResult(result: BenchmarkResult, legacyWireBytes: number): string {
  /** Candidate codec ratio retained even when runtime policy selects identity. */
  const compressionRatio =
    result.bytes.originalBytes > 0 ? result.bytes.candidateBytes / result.bytes.originalBytes : 0;
  /** Exact wire ratio against the measured legacy row for this corpus. */
  const wireRatio = legacyWireBytes > 0 ? result.bytes.wireBytes / legacyWireBytes : 0;
  /** Fraction of input frames whose candidate passed every v1 runtime gate. */
  const adoptionRate =
    result.bytes.frames > 0 ? result.bytes.adoptedFrames / result.bytes.frames : 0;
  return [
    `corpus=${result.corpus.label}`,
    `variant=${result.variant.label}`,
    `frames=${result.bytes.frames}`,
    `originalBytes=${result.bytes.originalBytes}`,
    `encodedBytes=${result.bytes.encodedBytes}`,
    `encryptedBytes=${result.bytes.encryptedBytes}`,
    `wireBytes=${result.bytes.wireBytes}`,
    `compressionRatio=${compressionRatio.toFixed(4)}`,
    `wireRatio=${wireRatio.toFixed(4)}`,
    `candidateBytes=${result.bytes.candidateBytes}`,
    `adoptedFrames=${result.bytes.adoptedFrames}`,
    `adoptionRate=${adoptionRate.toFixed(4)}`,
    `runtimeEligible=${result.corpus.runtimeCompressionEligible}`,
    `wireFrameBytesP50=${result.wireFrameBytes.p50.toFixed(3)}`,
    `wireFrameBytesP95=${result.wireFrameBytes.p95.toFixed(3)}`,
    `wireFrameBytesMax=${result.wireFrameBytes.max.toFixed(3)}`,
    `wallMsP50=${result.wallMs.p50.toFixed(3)}`,
    `wallMsP95=${result.wallMs.p95.toFixed(3)}`,
    `wallMsMax=${result.wallMs.max.toFixed(3)}`,
    `cpuMsP50=${result.cpuMs.p50.toFixed(3)}`,
    `cpuMsP95=${result.cpuMs.p95.toFixed(3)}`,
    `cpuMsMax=${result.cpuMs.max.toFixed(3)}`,
    `prepareMsP50=${result.prepareMs.p50.toFixed(3)}`,
    `prepareMsP95=${result.prepareMs.p95.toFixed(3)}`,
    `prepareMsMax=${result.prepareMs.max.toFixed(3)}`,
    `decodeMsP50=${result.decodeMs.p50.toFixed(3)}`,
    `decodeMsP95=${result.decodeMs.p95.toFixed(3)}`,
    `decodeMsMax=${result.decodeMs.max.toFixed(3)}`,
    `throughputMiBpsP50=${result.throughputMiBps.p50.toFixed(3)}`,
    `throughputMiBpsP95=${result.throughputMiBps.p95.toFixed(3)}`,
    `throughputMiBpsMax=${result.throughputMiBps.max.toFixed(3)}`,
    `eventLoopP99Ms=${result.eventLoopP99Ms.toFixed(3)}`,
  ].join(" ");
}

/** Normalizes one public environment label to a single path-free report token. */
function sanitizeReportLabel(value: string): string {
  const normalized = value
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9._,+-]/g, "_");
  return normalized.length > 0 ? normalized : "unknown";
}

/** Returns whether this module is the process entrypoint rather than a test import. */
function isMainModule(): boolean {
  /** Executed script path supplied by Node or tsx. */
  const entry = process.argv[1];
  return Boolean(entry && pathToFileURL(resolve(entry)).href === import.meta.url);
}

if (isMainModule()) {
  runRelayFrameCodecBenchmarkCli(process.argv.slice(2)).catch((error: unknown) => {
    /** Sanitized CLI failure produced by parsers and category-aware readers. */
    const message = error instanceof Error ? error.message : "Relay benchmark failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
