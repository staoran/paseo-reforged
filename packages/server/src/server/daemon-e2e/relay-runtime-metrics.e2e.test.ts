import { Writable } from "node:stream";

import pino from "pino";
import { expect, test } from "vitest";

import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";

test("daemon runtime metrics retain the configured relay transport policy", async () => {
  /** Structured production log records emitted by the isolated daemon. */
  const records: unknown[] = [];
  /** Real pino destination capturing the final WebSocket runtime snapshot. */
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      const lines = chunk
        .toString("utf8")
        .split("\n")
        .filter((line: string) => line.length > 0);
      for (const line of lines) records.push(JSON.parse(line));
      callback();
    },
  });
  /** Production logger wired through the daemon bootstrap. */
  const logger = pino({ level: "info" }, destination);
  /** Real daemon whose relay runtime must share the WebSocket diagnostics recorder. */
  const daemon = await createTestPaseoDaemon({
    logger,
    relayEnabled: true,
    relayEndpoint: "127.0.0.1:1",
    relayUseTls: false,
    relayTransport: {
      ciphertextEncoding: "base64",
      compression: { enabled: false },
    },
  });

  await daemon.close();

  expect(records).toContainEqual(
    expect.objectContaining({
      msg: "ws_runtime_metrics",
      relayTransport: expect.objectContaining({
        configuredPolicy: {
          ciphertextEncoding: "base64",
          compressionEnabled: false,
        },
      }),
    }),
  );
});
