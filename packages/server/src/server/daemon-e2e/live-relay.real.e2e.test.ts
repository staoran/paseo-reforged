import { afterEach, describe, expect, test } from "vitest";
import pino from "pino";
import { z } from "zod";

import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { generateLocalPairingOffer } from "../pairing-offer.js";
import { CodexAppServerAgentClient } from "../agent/providers/codex-app-server-agent.js";
import { buildRelayWebSocketUrl } from "@getpaseo/protocol/daemon-endpoints";
import {
  parseConnectionOfferFromUrl,
  type ConnectionOffer,
} from "@getpaseo/protocol/connection-offer";

const relayEndpoint = process.env.PASEO_LIVE_RELAY_ENDPOINT ?? "paseo-relay-next.fly.dev:443";

/** Hosted relay representations covered by the live transparency matrix. */
const liveCiphertextScenarios = [
  { ciphertextEncoding: "base64", negotiatedMode: "framed-v1-base64" },
  { ciphertextEncoding: "binary", negotiatedMode: "framed-v1-binary" },
] as const;

/** Content-free client metrics fields consumed by the hosted relay probe. */
const RuntimeMetricsLogRecordSchema = z.object({
  msg: z.string().optional(),
  relayTransport: z
    .object({
      negotiatedModeCount: z.record(z.string(), z.number()).optional(),
      inboundFrames: z
        .array(
          z.object({
            codec: z.string().optional(),
            frameCount: z.number().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

interface RuntimeMetricsProbe {
  /** Client logger that receives content-free runtime metric records. */
  logger: pino.Logger;
  /** Negotiated relay modes observed after the live handshake. */
  negotiatedModes: string[];
  /** Inbound codecs observed on non-empty authenticated relay frames. */
  inboundCodecs: string[];
}

/** Captures only negotiated mode labels from the client's public metrics log. */
function createRuntimeMetricsProbe(): RuntimeMetricsProbe {
  const negotiatedModes: string[] = [];
  const inboundCodecs: string[] = [];
  const logger = pino(
    { level: "info" },
    {
      write(serialized: string): void {
        /** Parsed logger payload before schema validation. */
        const parsed: unknown = JSON.parse(serialized);
        /** Validated content-free metrics record. */
        const record = RuntimeMetricsLogRecordSchema.parse(parsed);
        if (record.msg !== "ws_runtime_metrics_client") return;
        for (const [mode, count] of Object.entries(
          record.relayTransport?.negotiatedModeCount ?? {},
        )) {
          if (count > 0) negotiatedModes.push(mode);
        }
        for (const frame of record.relayTransport?.inboundFrames ?? []) {
          if (typeof frame.codec === "string" && (frame.frameCount ?? 0) > 0) {
            inboundCodecs.push(frame.codec);
          }
        }
      },
    },
  );
  return { logger, negotiatedModes, inboundCodecs };
}

function requireOffer(url: string): ConnectionOffer {
  const offer = parseConnectionOfferFromUrl(url);
  if (!offer) {
    throw new Error("Pairing did not produce a relay connection offer");
  }
  return offer;
}

async function pairingOfferFor(daemon: TestPaseoDaemon): Promise<ConnectionOffer> {
  const pairing = await generateLocalPairingOffer({
    paseoHome: daemon.paseoHome,
    relayEnabled: true,
    relayEndpoint,
    relayPublicEndpoint: relayEndpoint,
    relayUseTls: true,
    relayPublicUseTls: true,
    includeQr: false,
  });
  if (!pairing.url) {
    throw new Error("Pairing did not produce a URL");
  }
  return requireOffer(pairing.url);
}

/** Creates a relay client and optionally enables fast content-free metrics flushing. */
function clientFor(offer: ConnectionOffer, metricsLogger?: pino.Logger): DaemonClient {
  return new DaemonClient({
    url: buildRelayWebSocketUrl({
      endpoint: offer.relay.endpoint,
      useTls: true,
      serverId: offer.serverId,
      role: "client",
    }),
    clientId: "clid_live_relay_acceptance",
    clientType: "cli",
    connectTimeoutMs: 30_000,
    e2ee: { enabled: true, daemonPublicKeyB64: offer.daemonPublicKeyB64 },
    reconnect: { enabled: false },
    ...(metricsLogger
      ? { logger: metricsLogger, runtimeMetricsIntervalMs: 60_000, runtimeMetricsWindowMs: 60_000 }
      : {}),
  });
}

/** Creates enough fake agent state to cross the state-sync compression threshold. */
async function seedStateSyncAgents(daemon: TestPaseoDaemon): Promise<void> {
  const seedClient = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    clientId: "clid_live_relay_seed",
    clientType: "cli",
    reconnect: { enabled: false },
  });
  try {
    await seedClient.connect();
    for (let index = 0; index < 40; index += 1) {
      await seedClient.createAgent({
        provider: "codex",
        cwd: daemon.staticDir,
        title: `Live relay state seed ${index}`,
        modeId: "full-access",
      });
    }
  } finally {
    await seedClient.close();
  }
}

describe("live hosted relay", () => {
  let daemon: TestPaseoDaemon | null = null;
  let client: DaemonClient | null = null;

  afterEach(async () => {
    await client?.close().catch(() => undefined);
    await daemon?.close();
  });

  for (const scenario of liveCiphertextScenarios) {
    test(`transparently carries authenticated framed ${scenario.ciphertextEncoding} traffic`, async () => {
      const metricsProbe = createRuntimeMetricsProbe();
      const logger = pino({ level: "silent" });
      daemon = await createTestPaseoDaemon({
        listen: "127.0.0.1",
        relayEnabled: true,
        relayEndpoint,
        relayUseTls: true,
        relayTransport: { ciphertextEncoding: scenario.ciphertextEncoding },
        logger,
      });
      await seedStateSyncAgents(daemon);
      const offer = await pairingOfferFor(daemon);
      client = clientFor(offer, metricsProbe.logger);

      await client.connect();
      expect((await client.fetchAgents()).entries).toHaveLength(40);
      await client.close();
      client = null;
      expect(metricsProbe.negotiatedModes).toContain(scenario.negotiatedMode);
      expect(metricsProbe.inboundCodecs).toContain("deflate-raw");
    }, 60_000);
  }

  test("carries a complete DaemonClient agent workflow through the hosted relay", async () => {
    const logger = pino({ level: "silent" });
    daemon = await createTestPaseoDaemon({
      listen: "127.0.0.1",
      relayEnabled: true,
      relayEndpoint,
      relayUseTls: true,
      agentClients: { codex: new CodexAppServerAgentClient(logger) },
      logger,
    });
    const offer = await pairingOfferFor(daemon);
    client = clientFor(offer);

    await client.connect();
    const initialAgents = await client.fetchAgents();
    const agent = await client.createAgent({
      provider: "codex",
      cwd: daemon.staticDir,
      title: "Live relay acceptance",
      modeId: "full-access",
    });
    await client.sendMessage(agent.id, "Respond with exactly: RELAY_ACCEPTANCE_OK");
    const finished = await client.waitForFinish(agent.id, 120_000);
    const timeline = await client.fetchAgentTimeline(agent.id, {
      direction: "tail",
      limit: 20,
      projection: "canonical",
    });
    const assistantText = timeline.entries
      .filter((entry) => entry.item.type === "assistant_message")
      .map((entry) => entry.item.text)
      .join("");

    expect(initialAgents.entries).toEqual([]);
    expect(agent).toMatchObject({
      provider: "codex",
      cwd: daemon.staticDir,
      status: "idle",
    });
    expect(finished).toMatchObject({ status: "idle" });
    expect(assistantText).toMatch(/^RELAY_ACCEPTANCE_OK\s*$/);
  }, 180_000);
});
