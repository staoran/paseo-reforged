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
import type { DaemonTransport } from "./daemon-client-transport-types.js";

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
    const encrypted = createEncryptedTransport(base, exportPublicKey(daemonKeyPair.publicKey), {
      warn: vi.fn(),
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
    /** Public encrypted transport under test. */
    const encrypted = createEncryptedTransport(base, exportPublicKey(daemonKeyPair.publicKey), {
      warn: vi.fn(),
    });
    /** First public application or close result after the compressed frame arrives. */
    let resolveOutcome:
      | ((outcome: { kind: string; data?: unknown; isBinary?: boolean }) => void)
      | null = null;
    /** Outcome promise preventing a protocol close from hanging the test. */
    const outcome = new Promise<{ kind: string; data?: unknown; isBinary?: boolean }>((resolve) => {
      resolveOutcome = resolve;
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
    encrypted.onClose(() => resolveOutcome?.({ kind: "closed" }));

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
    encrypted.close();

    expect(firstOutcome).toEqual({ kind: "application", data: original, isBinary: false });
  });
});
