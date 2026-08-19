import { expect, test } from "vitest";

import { DaemonClient } from "./test-utils/index.js";
import { createTestPaseoDaemon } from "./test-utils/paseo-daemon.js";

test("daemon advertises relay transport policy support in server_info", async () => {
  // Real isolated daemon used to observe the emitted server_info payload.
  const daemon = await createTestPaseoDaemon();
  // Public client connection that parses the daemon capability response.
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });

  try {
    await client.connect();
    // Last validated server_info message received through the real WebSocket path.
    const serverInfo = client.getLastServerInfoMessage();
    expect(serverInfo?.features?.relayTransportPolicy).toBe(true);
  } finally {
    await client.close();
    await daemon.close();
  }
}, 15000);
