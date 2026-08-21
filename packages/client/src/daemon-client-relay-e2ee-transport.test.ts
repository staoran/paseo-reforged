import { deflateRawSync } from "node:zlib";
import {
  deriveSharedKey,
  encrypt,
  exportPublicKey,
  generateKeyPair,
  importPublicKey,
} from "@getpaseo/relay";
import { prepareDeflateFramedPayload } from "@getpaseo/relay/e2ee";
import { describe, expect, test, vi } from "vitest";
import { createEncryptedTransport } from "./daemon-client-relay-e2ee-transport.js";
import { DaemonClientRuntimeMetrics } from "./daemon-client-runtime-metrics.js";
import type { DaemonTransport } from "./daemon-client-transport-types.js";

/** Successful application delivery observed after framed decode. */
interface RelayTransportApplicationOutcome {
  /** Discriminator for an application delivery. */
  kind: "application";
  /** Decoded application payload. */
  data: unknown;
  /** Transport opcode associated with the application payload. */
  isBinary: boolean;
}

/** Protocol close observed before application delivery. */
interface RelayTransportClosedOutcome {
  /** Discriminator for a transport close. */
  kind: "closed";
}

/** First observable application delivery or protocol close after framed decode. */
type RelayTransportDecodeOutcome = RelayTransportApplicationOutcome | RelayTransportClosedOutcome;

describe("daemon client relay E2EE transport", () => {
  test("advertises raw DEFLATE when the client relay transport starts", async () => {
    /** Daemon identity supplied through the pairing result. */
    const daemonKeyPair = generateKeyPair();
    /** Plaintext handshake and encrypted application writes observed on the base transport. */
    const sent: (string | Uint8Array | ArrayBuffer)[] = [];
    /** Base transport callback that begins the encrypted handshake. */
    let openHandler: (() => void) | null = null;
    /** Physical transport used by the public encrypted transport adapter. */
    const base: DaemonTransport = {
      send: (data) => sent.push(data),
      close: vi.fn(),
      onOpen: (handler) => {
        openHandler = handler;
        return () => {
          if (openHandler === handler) openHandler = null;
        };
      },
      onClose: () => () => {},
      onError: () => () => {},
      onMessage: () => () => {},
    };
    /** Public encrypted transport under test. */
    const encrypted = createEncryptedTransport({
      base,
      daemonPublicKeyB64: exportPublicKey(daemonKeyPair.publicKey),
      logger: { warn: vi.fn() },
    });

    openHandler?.();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    /** First relay write containing the client capability advertisement. */
    const hello = JSON.parse(sent[0] as string) as {
      capabilities?: { framedCiphertextV1?: { compressionAlgorithms?: unknown } };
    };
    encrypted.close();

    expect(hello.capabilities?.framedCiphertextV1?.compressionAlgorithms).toEqual(["deflate-raw"]);
  });

  test("does not advertise raw DEFLATE when no client decoder is available", async () => {
    /** Daemon identity supplied through the pairing result. */
    const daemonKeyPair = generateKeyPair();
    /** Plaintext handshake writes observed on the base transport. */
    const sent: (string | Uint8Array | ArrayBuffer)[] = [];
    /** Base transport callback that begins the encrypted handshake. */
    let openHandler: (() => void) | null = null;
    /** Physical transport used by the public encrypted transport adapter. */
    const base: DaemonTransport = {
      send: (data) => sent.push(data),
      close: vi.fn(),
      onOpen: (handler) => {
        openHandler = handler;
        return () => {
          if (openHandler === handler) openHandler = null;
        };
      },
      onClose: () => () => {},
      onError: () => () => {},
      onMessage: () => () => {},
    };
    /** Public encrypted transport configured without a framed compression decoder. */
    const encrypted = createEncryptedTransport({
      base,
      daemonPublicKeyB64: exportPublicKey(daemonKeyPair.publicKey),
      logger: { warn: vi.fn() },
      compressionAdapter: null,
    });

    openHandler?.();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    /** First relay write containing the client capability advertisement. */
    const rawHello = sent[0];
    if (typeof rawHello !== "string") throw new Error("Expected a text E2EE hello");
    /** Parsed hello observed at the public transport boundary. */
    const hello: unknown = JSON.parse(rawHello);
    encrypted.close();

    expect(hello).toMatchObject({
      capabilities: { framedCiphertextV1: { compressionAlgorithms: [] } },
    });
  });

  test("delivers daemon raw DEFLATE text through the client transport events", async () => {
    /** Daemon identity used for the synthetic encrypted application frame. */
    const daemonKeyPair = generateKeyPair();
    /** Base transport writes containing hello and authenticated mode confirm. */
    const sent: (string | Uint8Array | ArrayBuffer)[] = [];
    /** Base transport callback that begins the encrypted handshake. */
    let openHandler: (() => void) | null = null;
    /** Base transport callback that forwards daemon WebSocket frames. */
    let messageHandler: ((data: unknown, isBinary: boolean) => void) | null = null;
    /** Base transport callback that reports physical closure. */
    let closeHandler: ((event?: unknown) => void) | null = null;
    /** Physical transport used by the public encrypted transport adapter. */
    const base: DaemonTransport = {
      send: (data) => sent.push(data),
      close: (code, reason) => closeHandler?.({ code, reason }),
      onOpen: (handler) => {
        openHandler = handler;
        return () => {
          if (openHandler === handler) openHandler = null;
        };
      },
      onClose: (handler) => {
        closeHandler = handler;
        return () => {
          if (closeHandler === handler) closeHandler = null;
        };
      },
      onError: () => () => {},
      onMessage: (handler) => {
        messageHandler = handler;
        return () => {
          if (messageHandler === handler) messageHandler = null;
        };
      },
    };
    /** Client runtime log payloads emitted after the real decode completes. */
    const runtimeEntries: object[] = [];
    /** Content-free metrics recorder passed through the encrypted transport adapter. */
    const runtimeMetrics = new DaemonClientRuntimeMetrics(
      { info: (entry) => runtimeEntries.push(entry) },
      {
        connectionPath: "relay",
        serverId: null,
        getConnectionStatus: () => "connected",
      },
    );
    /** Public encrypted transport under test. */
    const encrypted = createEncryptedTransport({
      base,
      daemonPublicKeyB64: exportPublicKey(daemonKeyPair.publicKey),
      logger: { warn: vi.fn() },
      runtimeMetrics,
    });
    /** First public application or close result after the compressed frame arrives. */
    let resolveOutcome: ((outcome: RelayTransportDecodeOutcome) => void) | null = null;
    /** Outcome promise preventing a protocol close from hanging the test. */
    const outcome = new Promise<RelayTransportDecodeOutcome>((resolve) => {
      resolveOutcome = resolve;
    });
    /** Physical close signal for a later malformed compressed frame. */
    let resolveClosed: (() => void) | null = null;
    /** Close promise proves the malformed frame is rejected before application delivery. */
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    /** Completion signal emitted only after the authenticated mode confirm settles. */
    let resolveOpened: (() => void) | null = null;
    /** Public open event proving application frames may now be accepted. */
    const opened = new Promise<void>((resolve) => {
      resolveOpened = resolve;
    });
    encrypted.onOpen(() => resolveOpened?.());
    encrypted.onMessage((data, isBinary) =>
      resolveOutcome?.({ kind: "application", data, isBinary }),
    );
    encrypted.onClose(() => {
      resolveOutcome?.({ kind: "closed" });
      resolveClosed?.();
    });

    openHandler?.();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    /** Client hello carrying the ephemeral key for daemon-side encryption. */
    const hello = JSON.parse(sent[0] as string) as { key: string };
    /** Shared key independently derived on the synthetic daemon side. */
    const sharedKey = deriveSharedKey(daemonKeyPair.secretKey, importPublicKey(hello.key));
    messageHandler?.(
      JSON.stringify({
        type: "e2ee_ready",
        capabilities: {
          binaryCiphertext: true,
          framedCiphertextV1: {
            ciphertextEncoding: "binary",
            compressionAlgorithms: ["deflate-raw"],
          },
        },
      }),
      false,
    );
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    await opened;
    /** Compressible daemon state payload above the protocol minimum. */
    const original = '{"source":"daemon","kind":"state-sync"}\n'.repeat(128);
    /** Independent Node raw DEFLATE output copied out of its pooled Buffer. */
    const nodeCompressed = deflateRawSync(new TextEncoder().encode(original), { level: 1 });
    /** Standalone raw DEFLATE bytes used by the authenticated envelope. */
    const compressed = nodeCompressed.buffer.slice(
      nodeCompressed.byteOffset,
      nodeCompressed.byteOffset + nodeCompressed.byteLength,
    );
    /** Authenticated compressed envelope built outside the client decode path. */
    const prepared = prepareDeflateFramedPayload(original, compressed);

    messageHandler?.(encrypt(sharedKey, prepared.plaintext), true);
    const firstOutcome = await outcome;
    /** Independent invalid raw bytes that still satisfy authenticated envelope size gates. */
    const invalidCompressed = new Uint8Array(64).fill(0xff).buffer;
    /** Authenticated envelope whose codec fails only when the real fflate decoder runs. */
    const invalidPrepared = prepareDeflateFramedPayload("x".repeat(4_096), invalidCompressed);
    messageHandler?.(encrypt(sharedKey, invalidPrepared.plaintext), true);
    await closed;
    runtimeMetrics.flush({ final: true });
    encrypted.close();

    expect(firstOutcome).toEqual({ kind: "application", data: original, isBinary: false });
    const relayTransport = (runtimeEntries[0] as { relayTransport: unknown }).relayTransport;
    expect(relayTransport).toMatchObject({
      negotiatedModeCount: { "framed-v1-binary": 1 },
      inboundFrames: [
        {
          ciphertextEncoding: "binary",
          codec: "deflate-raw",
          frameCount: 1,
          originalBytes: new TextEncoder().encode(original).byteLength,
          encodedBytes: compressed.byteLength,
          wireBytes:
            prepared.plaintext.byteLength -
            prepared.encodedByteLength +
            prepared.encodedByteLength +
            40,
        },
      ],
      inboundDecodeMs: [
        {
          ciphertextEncoding: "binary",
          codec: "deflate-raw",
          p50: expect.any(Number),
          p95: expect.any(Number),
          max: expect.any(Number),
        },
      ],
      framedProtocolErrorCount: { "decode-failed": 1 },
      pendingReceiveWireBytes: { p95: 256, max: 256 },
    });
    expect(JSON.stringify(relayTransport)).not.toContain("fflate");
  });
});
