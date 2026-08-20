import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { runRelayFrameCodecBenchmarkCli } from "./benchmark-relay-frame-codec.js";

/** Temporary directories owned by this test file and removed after each case. */
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("relay frame codec benchmark CLI", () => {
  test("requires every corpus path and at least five measured runs", async () => {
    await expect(
      runRelayFrameCodecBenchmarkCli([
        "--json",
        "json-input",
        "--terminal",
        "terminal-input",
        "--file",
        "file-input",
      ]),
    ).rejects.toThrow("Missing required relay benchmark option --tool-call");
    await expect(
      runRelayFrameCodecBenchmarkCli([
        "--json",
        "json-input",
        "--terminal",
        "terminal-input",
        "--file",
        "file-input",
        "--tool-call",
        "tool-call-input",
        "--runs",
        "4",
      ]),
    ).rejects.toThrow("Relay benchmark --runs must be an integer >= 5");
  });

  test("prints the complete aggregate matrix without paths or corpus content", async () => {
    /** Isolated corpus root whose sensitive-looking name must never reach stdout. */
    const directory = await mkdtemp(join(tmpdir(), "private-relay-benchmark-path-"));
    temporaryDirectories.push(directory);
    /** Unique marker representing session content that must never reach stdout. */
    const contentMarker = "PRIVATE_SESSION_CONTENT_0095";
    /** Explicit input paths required by the public CLI contract. */
    const inputs = {
      json: join(directory, "private-json-session.json"),
      terminal: join(directory, "private-terminal-stream.bin"),
      file: join(directory, "private-file-transfer.txt"),
      toolCall: join(directory, "private-tool-call.json"),
    };
    await Promise.all([
      writeFile(inputs.json, JSON.stringify({ marker: contentMarker, rows: ["alpha", "alpha"] })),
      writeFile(inputs.terminal, `${contentMarker}\r\nterminal output\r\n`.repeat(8)),
      writeFile(inputs.file, `${contentMarker}\nfile payload\n`.repeat(64)),
      writeFile(
        inputs.toolCall,
        JSON.stringify({ status: "completed", output: contentMarker.repeat(8) }),
      ),
    ]);
    /** Captured stdout chunks at the approved benchmark seam. */
    const stdout: string[] = [];

    await runRelayFrameCodecBenchmarkCli(
      [
        "--json",
        inputs.json,
        "--terminal",
        inputs.terminal,
        "--file",
        inputs.file,
        "--tool-call",
        inputs.toolCall,
        "--runs",
        "5",
      ],
      {
        writeStdout: (value) => stdout.push(value),
      },
    );

    /** Complete content-free benchmark report. */
    const report = stdout.join("");
    expect(report).toContain("relay-frame-codec-benchmark version=1 runs=5 warmupRuns=1");
    expect(report).toMatch(
      /environment os=\S+ arch=\S+ cpu=\S+ node=v\d+\.\d+\.\d+ runtime=node productionLevel=1 researchLevels=1,3,6 eventLoopResolutionMs=1/,
    );
    expect(report).toMatch(/corpus=json variant=legacy /);
    expect(report).toMatch(/corpus=terminal-256b variant=framed-binary-deflate-l1 /);
    expect(report).toMatch(/corpus=terminal-1024b variant=framed-base64-deflate-l3 /);
    expect(report).toMatch(/corpus=terminal-4096b variant=framed-binary-deflate-l6 /);
    expect(report).toMatch(/corpus=file variant=framed-base64-identity /);
    expect(report).toMatch(/corpus=tool-call variant=framed-binary-deflate-l1 /);
    expect(report).toMatch(
      /frames=\d+ originalBytes=\d+ encodedBytes=\d+ encryptedBytes=\d+ wireBytes=\d+ compressionRatio=\d+\.\d{4} wireRatio=\d+\.\d{4}/,
    );
    expect(report).toMatch(
      /candidateBytes=\d+ adoptedFrames=\d+ adoptionRate=\d+\.\d{4} runtimeEligible=(?:true|false) wireFrameBytesP50=\d+\.\d{3} wireFrameBytesP95=\d+\.\d{3} wireFrameBytesMax=\d+\.\d{3}/,
    );
    expect(report).toMatch(
      /wallMsP50=\d+\.\d{3} wallMsP95=\d+\.\d{3} wallMsMax=\d+\.\d{3} cpuMsP50=\d+\.\d{3}/,
    );
    expect(report).toMatch(
      /prepareMsP50=\d+\.\d{3} prepareMsP95=\d+\.\d{3} prepareMsMax=\d+\.\d{3} decodeMsP50=\d+\.\d{3} decodeMsP95=\d+\.\d{3} decodeMsMax=\d+\.\d{3} throughputMiBpsP50=\d+\.\d{3}/,
    );
    expect(report).not.toContain(directory);
    expect(report).not.toContain(inputs.json);
    expect(report).not.toContain(contentMarker);
  });

  test("uses explicit session formats for terminal output and completed tool-call boundaries", async () => {
    /** Isolated input root whose source paths must remain private. */
    const directory = await mkdtemp(join(tmpdir(), "private-relay-session-format-"));
    temporaryDirectories.push(directory);
    /** Explicit corpus paths accepted by the public CLI. */
    const inputs = {
      json: join(directory, "state-sync.json"),
      terminal: join(directory, "codex-session.jsonl"),
      file: join(directory, "file-transfer.bin"),
      toolCall: join(directory, "paseo-timeline-segment.json"),
    };
    /** Private marker repeated enough to pass the bulk-live compression gate. */
    const privateToolOutput = "PRIVATE_COMPLETED_TOOL_OUTPUT_0095".repeat(700);
    /** Codex session records containing two real exec outputs and one unrelated tool output. */
    const terminalRecords = [
      { payload: { type: "custom_tool_call", call_id: "exec-a", name: "exec" } },
      {
        payload: {
          type: "custom_tool_call_output",
          call_id: "exec-a",
          output: [
            { type: "text", text: "A".repeat(300) },
            { type: "text", text: "B".repeat(100) },
          ],
        },
      },
      { payload: { type: "custom_tool_call", call_id: "other", name: "view_image" } },
      {
        payload: {
          type: "custom_tool_call_output",
          call_id: "other",
          output: [{ type: "text", text: "IGNORED_NON_TERMINAL_OUTPUT" }],
        },
      },
      { payload: { type: "custom_tool_call", call_id: "exec-b", name: "exec" } },
      {
        payload: {
          type: "custom_tool_call_output",
          call_id: "exec-b",
          output: [{ type: "text", text: "C".repeat(200) }],
        },
      },
    ];
    /** Paseo canonical rows containing one completed and one running tool call. */
    const timelineRows = [
      {
        seq: 10,
        timestamp: "2026-08-20T00:00:00.000Z",
        item: {
          type: "tool_call",
          callId: "completed-call",
          name: "shell",
          detail: { type: "plain_text", text: privateToolOutput },
          status: "completed",
          error: null,
        },
      },
      {
        seq: 11,
        timestamp: "2026-08-20T00:00:01.000Z",
        item: {
          type: "tool_call",
          callId: "running-call",
          name: "shell",
          detail: { type: "plain_text", text: "RUNNING_OUTPUT_MUST_BE_IGNORED".repeat(700) },
          status: "running",
          error: null,
        },
      },
    ];
    await Promise.all([
      writeFile(inputs.json, JSON.stringify({ rows: ["state", "state"] })),
      writeFile(
        inputs.terminal,
        terminalRecords.map((record) => JSON.stringify(record)).join("\n"),
      ),
      writeFile(inputs.file, "file-transfer-content\n".repeat(256)),
      writeFile(inputs.toolCall, JSON.stringify(timelineRows)),
    ]);
    /** Captured aggregate report at the approved stdout seam. */
    const stdout: string[] = [];

    await runRelayFrameCodecBenchmarkCli(
      [
        "--json",
        inputs.json,
        "--terminal",
        inputs.terminal,
        "--terminal-format",
        "codex-session-jsonl",
        "--file",
        inputs.file,
        "--tool-call",
        inputs.toolCall,
        "--tool-call-format",
        "paseo-timeline-segment",
        "--runs",
        "5",
      ],
      {
        writeStdout: (value) => stdout.push(value),
      },
    );

    /** Content-free report proving extraction and semantic event framing. */
    const report = stdout.join("");
    expect(report).toMatch(/corpus=terminal-256b variant=legacy frames=3 originalBytes=600 /);
    expect(report).toMatch(/corpus=terminal-1024b variant=legacy frames=1 originalBytes=600 /);
    expect(report).toMatch(
      /corpus=tool-call variant=framed-binary-deflate-l1 frames=1 .*adoptedFrames=1 /,
    );
    expect(report).not.toContain(privateToolOutput);
    expect(report).not.toContain("IGNORED_NON_TERMINAL_OUTPUT");
    expect(report).not.toContain(directory);
  });
});
