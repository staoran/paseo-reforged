import {
  deriveSharedKey,
  encrypt,
  exportPublicKey,
  generateKeyPair,
  importPublicKey,
} from "@getpaseo/relay";
import { describe, expect, test, vi } from "vitest";
import { createEncryptedTransport } from "./daemon-client-relay-e2ee-transport.js";
import { DaemonClientRuntimeMetrics } from "./daemon-client-runtime-metrics.js";
import type { DaemonTransport } from "./daemon-client-transport-types.js";

/** Narrows one captured handshake wire to text before JSON parsing. */
function requireTextWire(wire: string | Uint8Array | ArrayBuffer | undefined): string {
  if (typeof wire !== "string") throw new Error("Expected a text E2EE handshake");
  return wire;
}

/** Parses one captured JSON wire after validating its object boundary. */
function parseJsonWire(
  wire: string | Uint8Array | ArrayBuffer | undefined,
): Record<string, unknown> {
  const parsed: unknown = JSON.parse(requireTextWire(wire));
  if (parsed === null) throw new Error("Expected a JSON object handshake");
  if (typeof parsed !== "object") throw new Error("Expected a JSON object handshake");
  if (Array.isArray(parsed)) throw new Error("Expected a JSON object handshake");
  return parsed;
}

/** Extracts the ephemeral public key from one client hello. */
function parseHelloWire(wire: string | Uint8Array | ArrayBuffer | undefined): string {
  const parsed = parseJsonWire(wire);
  if (typeof parsed.key !== "string") throw new Error("Expected a client hello key");
  return parsed.key;
}

/** Extracts the content-free relay metrics object from one runtime log entry. */
function requireRelayTransportEntry(entry: object | undefined): unknown {
  if (entry === undefined) throw new Error("Expected relay transport runtime metrics");
  if (!("relayTransport" in entry)) throw new Error("Expected relay transport runtime metrics");
  return entry.relayTransport;
}

describe("daemon client relay E2EE transport", () => {
  test("keeps the production client hello on legacy binary ciphertext", async () => {
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
    const hello = parseJsonWire(sent[0]);
    encrypted.close();

    expect(hello).toEqual({
      type: "e2ee_hello",
      key: expect.any(String),
      capabilities: { binaryCiphertext: true },
    });
  });

  test("advertises framed ciphertext only through the isolated validation opt-in", async () => {
    /** Daemon identity supplied through the pairing result. */
    const daemonKeyPair = generateKeyPair();
    /** Plaintext client hello observed on the physical transport. */
    const sent: (string | Uint8Array | ArrayBuffer)[] = [];
    /** Base transport callback that begins the encrypted handshake. */
    let openHandler: (() => void) | null = null;
    /** Physical transport used by the validation-only encrypted adapter. */
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
    /** Public encrypted transport with the release gate bypassed only for validation. */
    const encrypted = createEncryptedTransport({
      base,
      daemonPublicKeyB64: exportPublicKey(daemonKeyPair.publicKey),
      logger: { warn: vi.fn() },
      validation: { enableFramedCiphertextV1: true },
    });

    openHandler?.();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    /** First relay write containing the validation-only capability advertisement. */
    const hello = parseJsonWire(sent[0]);
    encrypted.close();

    expect(hello).toEqual({
      type: "e2ee_hello",
      key: expect.any(String),
      capabilities: {
        binaryCiphertext: true,
        framedCiphertextV1: {
          ciphertextEncodings: ["base64", "binary"],
          compressionAlgorithms: ["deflate-raw"],
        },
      },
    });
  });

  test("connects and exchanges legacy Base64 when no decoder is available", async () => {
    /** Daemon identity supplied through the pairing result. */
    const daemonKeyPair = generateKeyPair();
    /** Plaintext handshake and encrypted application writes observed on the base transport. */
    const sent: (string | Uint8Array | ArrayBuffer)[] = [];
    /** Base transport callback that begins the encrypted handshake. */
    let openHandler: (() => void) | null = null;
    /** Base transport callback forwarding daemon WebSocket frames. */
    let messageHandler: ((data: unknown, isBinary: boolean) => void) | null = null;
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
      onMessage: (handler) => {
        messageHandler = handler;
        return () => {
          if (messageHandler === handler) messageHandler = null;
        };
      },
    };
    /** Public encrypted transport configured without a framed compression decoder. */
    const encrypted = createEncryptedTransport({
      base,
      daemonPublicKeyB64: exportPublicKey(daemonKeyPair.publicKey),
      logger: { warn: vi.fn() },
      compressionAdapter: null,
    });

    /** Public open signal emitted after the legacy ready frame is accepted. */
    let resolveOpened: (() => void) | null = null;
    /** Promise proving the adapter does not wait for a framed confirmation. */
    const opened = new Promise<void>((resolve) => {
      resolveOpened = resolve;
    });
    /** Decrypted application values observed at the public adapter seam. */
    const received: Array<{ data: unknown; isBinary: boolean }> = [];
    encrypted.onOpen(() => resolveOpened?.());
    encrypted.onMessage((data, isBinary) => received.push({ data, isBinary }));

    openHandler?.();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    /** Client hello carrying the ephemeral key for independent legacy encryption. */
    const hello = parseJsonWire(sent[0]);
    if (typeof hello.key !== "string") throw new Error("Expected a client hello key");
    /** Shared key independently derived by the synthetic legacy daemon. */
    const sharedKey = deriveSharedKey(daemonKeyPair.secretKey, importPublicKey(hello.key));

    messageHandler?.(JSON.stringify({ type: "e2ee_ready" }), false);
    await opened;
    expect(sent).toHaveLength(1);

    encrypted.send("client-base64");
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    /** Legacy Base64 ciphertext produced independently for one daemon response. */
    const daemonCiphertext = Buffer.from(
      new Uint8Array(encrypt(sharedKey, "daemon-base64")),
    ).toString("base64");
    messageHandler?.(daemonCiphertext, false);
    await vi.waitFor(() => expect(received).toHaveLength(1));
    encrypted.close();

    expect(hello).toEqual({
      type: "e2ee_hello",
      key: expect.any(String),
      capabilities: { binaryCiphertext: true },
    });
    expect(typeof sent[1]).toBe("string");
    expect(received).toEqual([{ data: "daemon-base64", isBinary: false }]);
  });

  test("ignores an unoffered framed selection and exchanges legacy hybrid traffic", async () => {
    /** Daemon identity used for the synthetic legacy hybrid exchange. */
    const daemonKeyPair = generateKeyPair();
    /** Base transport writes containing hello and encrypted application traffic. */
    const sent: (string | Uint8Array | ArrayBuffer)[] = [];
    /** Base transport callback that begins the encrypted handshake. */
    let openHandler: (() => void) | null = null;
    /** Base transport callback that forwards daemon WebSocket frames. */
    let messageHandler: ((data: unknown, isBinary: boolean) => void) | null = null;
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
    /** Completion signal emitted when the legacy hybrid ready is accepted. */
    let resolveOpened: (() => void) | null = null;
    /** Public open event proving no framed confirmation is required. */
    const opened = new Promise<void>((resolve) => {
      resolveOpened = resolve;
    });
    /** Decrypted application values observed at the adapter seam. */
    const received: Array<{ data: unknown; isBinary: boolean }> = [];
    encrypted.onOpen(() => resolveOpened?.());
    encrypted.onMessage((data, isBinary) => received.push({ data, isBinary }));

    openHandler?.();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    /** Client hello carrying the ephemeral key for daemon-side encryption. */
    const hello = parseHelloWire(sent[0]);
    /** Shared key independently derived on the synthetic daemon side. */
    const sharedKey = deriveSharedKey(daemonKeyPair.secretKey, importPublicKey(hello));
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
    await opened;
    expect(sent).toHaveLength(1);

    /** Binary application payload proving the retained hybrid representation. */
    const clientBinary = new Uint8Array([1, 2, 3]).buffer;
    encrypted.send(clientBinary);
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    /** Independently encrypted binary daemon response on the legacy hybrid wire. */
    const daemonBinary = new Uint8Array([4, 5, 6]).buffer;
    messageHandler?.(encrypt(sharedKey, daemonBinary), true);
    await vi.waitFor(() => expect(received).toHaveLength(1));
    runtimeMetrics.flush({ final: true });
    encrypted.close();

    expect(sent[1]).toBeInstanceOf(ArrayBuffer);
    expect(received[0]?.isBinary).toBe(true);
    expect(new Uint8Array(received[0]?.data as ArrayBuffer)).toEqual(new Uint8Array(daemonBinary));
    const relayTransport = requireRelayTransportEntry(runtimeEntries[0]);
    expect(relayTransport).toMatchObject({
      negotiatedModeCount: { "legacy-hybrid": 1, "framed-v1-binary": 0 },
      inboundFrames: [],
      inboundDecodeMs: [],
    });
  });
});
