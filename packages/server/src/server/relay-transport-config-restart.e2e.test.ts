import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import pino from "pino";
import { afterEach, describe, expect, test } from "vitest";

import { createPaseoDaemon, type PaseoDaemon } from "./bootstrap.js";
import { loadConfig } from "./config.js";
import { savePersistedConfig } from "./persisted-config.js";
import { DaemonClient } from "./test-utils/index.js";

// Temporary Paseo homes created by restart lifecycle tests.
const tempDirs: string[] = [];

/** Starts a real daemon from the persisted config in the supplied Paseo home. */
async function startDaemonFromPersistedConfig(
  paseoHome: string,
): Promise<{ daemon: PaseoDaemon; port: number }> {
  // Production config loader output with an ephemeral test listener.
  const config = {
    ...loadConfig(paseoHome, { env: {} }),
    listen: "127.0.0.1:0",
  };
  // Silent logger for the isolated lifecycle daemon.
  const daemon = await createPaseoDaemon(config, pino({ level: "silent" }));
  try {
    await daemon.start();

    // Actual listener allocated by the operating system.
    const listenTarget = daemon.getListenTarget();
    if (!listenTarget || listenTarget.type !== "tcp") {
      throw new Error("Restart lifecycle daemon did not expose a TCP listener");
    }

    return { daemon, port: listenTarget.port };
  } catch (error) {
    await daemon.stop().catch(() => undefined);
    await daemon.agentManager.flush().catch(() => undefined);
    throw error;
  }
}

describe("relay transport config restart lifecycle", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  test("restores persisted relay transport policy through config RPC after restart", async () => {
    // Stable Paseo home shared by both daemon lifetimes.
    const paseoHome = await mkdtemp(path.join(os.tmpdir(), "paseo-relay-transport-restart-"));
    tempDirs.push(paseoHome);
    savePersistedConfig(paseoHome, {
      version: 1,
      daemon: { relay: { enabled: false } },
    });

    // First daemon lifetime used to persist policy through the public config RPC.
    const first = await startDaemonFromPersistedConfig(paseoHome);
    const firstClient = new DaemonClient({ url: `ws://127.0.0.1:${first.port}/ws` });
    try {
      await firstClient.connect();
      await firstClient.patchDaemonConfig({
        relay: {
          transport: {
            ciphertextEncoding: "binary",
            compression: { enabled: true },
          },
        },
      });
    } finally {
      await firstClient.close();
      await first.daemon.stop();
      await first.daemon.agentManager.flush();
    }

    // Restarted daemon must rebuild its mutable config from the same persisted home.
    const restarted = await startDaemonFromPersistedConfig(paseoHome);
    const restartedClient = new DaemonClient({ url: `ws://127.0.0.1:${restarted.port}/ws` });
    try {
      await restartedClient.connect();
      const response = await restartedClient.getDaemonConfig();
      expect(response.config.relay).toEqual({
        enabled: false,
        transport: {
          ciphertextEncoding: "binary",
          compression: { enabled: true },
        },
      });
    } finally {
      await restartedClient.close();
      await restarted.daemon.stop();
      await restarted.daemon.agentManager.flush();
    }
  }, 30_000);
});
