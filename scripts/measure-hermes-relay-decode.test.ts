import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import {
  runHermesRelayDecodeCli,
  type HermesProcessExecutor,
} from "./measure-hermes-relay-decode.js";

/** Existing executable used only to satisfy the explicit path preflight in injected tests. */
const EXISTING_EXECUTABLE = process.execPath;
/** Prefix used by the generated Hermes source and fake process output. */
const REPORT_PREFIX = "PASEO_HERMES_DECODE_REPORT=";

/** Builds one structurally valid fake Hermes report with configurable latency. */
function buildScriptReport(options: { oneMiBP95: number; fourMiBP95: number }): string {
  /** Whether both fixed frame thresholds pass. */
  const passed = options.oneMiBP95 <= 50 && options.fourMiBP95 <= 150;
  return `${REPORT_PREFIX}${JSON.stringify({
    schemaVersion: 1,
    measuredRuns: 5,
    warmupRuns: 3,
    completedMeasuredFrames: 10,
    orderVerified: true,
    frames: [
      {
        label: "1MiB",
        originalBytes: 1_048_576,
        compressedBytes: 140_000,
        outputBytes: 1_048_576,
        maxOutputBytes: 1_048_577,
        p95Ms: options.oneMiBP95,
        thresholdMs: 50,
        checksumVerified: true,
        passed: options.oneMiBP95 <= 50,
      },
      {
        label: "4MiB",
        originalBytes: 4_194_304,
        compressedBytes: 580_000,
        outputBytes: 4_194_304,
        maxOutputBytes: 4_194_305,
        p95Ms: options.fourMiBP95,
        thresholdMs: 150,
        checksumVerified: true,
        passed: options.fourMiBP95 <= 150,
      },
    ],
    passed,
  })}\n`;
}

/** Creates an injected Hermes process seam and captures the generated source before cleanup. */
function createFakeExecutor(options: {
  oneMiBP95: number;
  fourMiBP95: number;
  generatedSources: string[];
}): HermesProcessExecutor {
  return async (request) => {
    if (request.args[0] === "-version") {
      return {
        stdout:
          "DEBUG build\nHermes JavaScript compiler and Virtual Machine.\n" +
          "Hermes release version: 0.12.0\nHBC bytecode version: 89\n",
        stderr: "",
      };
    }
    /** Generated source path passed as the final VM argument. */
    const sourcePath = request.args.at(-1);
    if (!sourcePath) throw new Error("Missing generated Hermes source path");
    options.generatedSources.push(await readFile(sourcePath, "utf8"));
    return {
      stdout: buildScriptReport(options),
      stderr: "",
    };
  };
}

describe("Hermes relay decode measurement CLI", () => {
  test("requires an explicit VM and at least five measured runs", async () => {
    await expect(runHermesRelayDecodeCli({ args: [] })).rejects.toThrow(
      "Missing required Hermes VM option --hermes",
    );
    await expect(
      runHermesRelayDecodeCli({
        args: ["--hermes", EXISTING_EXECUTABLE, "--runs", "4"],
      }),
    ).rejects.toThrow("Hermes decode --runs must be an integer >= 5");
  });

  test("prints a content-free report from fixed Node vectors executed by Hermes", async () => {
    /** Generated sources captured at the injectable process boundary. */
    const generatedSources: string[] = [];
    /** Captured content-free CLI report. */
    const stdout: string[] = [];
    /** Fake process preserving the real generated-harness boundary. */
    const executeProcess = createFakeExecutor({
      oneMiBP95: 12,
      fourMiBP95: 48,
      generatedSources,
    });

    const report = await runHermesRelayDecodeCli({
      args: ["--hermes", EXISTING_EXECUTABLE, "--runs", "5"],
      executeProcess,
      io: { writeStdout: (value) => stdout.push(value) },
    });

    expect(report.passed).toBe(true);
    expect(report.runtime).toEqual({
      releaseVersion: "0.12.0",
      hbcBytecodeVersion: 89,
      buildKind: "DEBUG",
    });
    expect(report.evidenceScope).toBe("cli-supplemental-not-device-release");
    expect(generatedSources).toHaveLength(1);
    expect(generatedSources[0]).toContain("fflate.inflateSync");
    expect(generatedSources[0]).toContain('originalBytes":4194304');
    expect(stdout.join("")).not.toContain(EXISTING_EXECUTABLE);
    expect(stdout.join("")).not.toContain("compressedBase64");
  });

  test("fails the command when Hermes exceeds either Spec p95 threshold", async () => {
    /** Generated sources captured before the temporary directory is removed. */
    const generatedSources: string[] = [];
    /** Captured report proving failure remains observable to an operator. */
    const stdout: string[] = [];

    await expect(
      runHermesRelayDecodeCli({
        args: ["--hermes", EXISTING_EXECUTABLE, "--runs", "5"],
        executeProcess: createFakeExecutor({
          oneMiBP95: 51,
          fourMiBP95: 149,
          generatedSources,
        }),
        io: { writeStdout: (value) => stdout.push(value) },
      }),
    ).rejects.toThrow("Hermes relay decode gate failed");

    expect(generatedSources).toHaveLength(1);
    expect(stdout.join("")).toContain('"passed": false');
    expect(stdout.join("")).toContain('"p95Ms": 51');
  });
});
