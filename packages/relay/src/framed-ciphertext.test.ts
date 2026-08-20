import { describe, expect, it, vi } from "vitest";

import {
  createClientChannel,
  createDaemonChannel,
  type CiphertextEncoding,
  type ConfiguredCiphertextEncoding,
  type EncryptedChannelEvents,
  type EncryptedChannelRuntimeObserver,
  type Transport,
} from "./encrypted-channel.js";
import {
  decrypt,
  deriveSharedKey,
  encrypt,
  exportPublicKey,
  generateKeyPair,
  importPublicKey,
} from "./crypto.js";
import { arrayBufferToBase64, base64ToArrayBuffer } from "./base64.js";
import { createFflateFrameCompressionAdapter } from "./fflate-frame-compression.js";
import {
  decodeFramedCiphertextWire,
  decodeFramedPayload,
  framedCiphertextWireByteLength,
  MAX_FRAMED_WIRE_BYTES,
  prepareDeflateFramedPayload,
  prepareIdentityFramedPayload,
  type FrameCompressionAdapter,
} from "./framed-ciphertext.js";

/** Plaintext ready frame selecting identity-only framed binary ciphertext. */
const FRAMED_BINARY_READY = JSON.stringify({
  type: "e2ee_ready",
  capabilities: {
    binaryCiphertext: true,
    framedCiphertextV1: {
      ciphertextEncoding: "binary",
      compressionAlgorithms: [],
    },
  },
});

/** Plaintext ready frame selecting identity-only framed Base64 ciphertext. */
const FRAMED_BASE64_READY = JSON.stringify({
  type: "e2ee_ready",
  capabilities: {
    framedCiphertextV1: {
      ciphertextEncoding: "base64",
      compressionAlgorithms: [],
    },
  },
});

/** Delivers the common framed-binary selection through the public transport seam. */
function deliverFramedBinaryReady(transport: Transport): void {
  transport.onmessage?.({ data: FRAMED_BINARY_READY, isBinary: false });
}

/** Delivers the common framed-Base64 selection through the public transport seam. */
function deliverFramedBase64Ready(transport: Transport): void {
  transport.onmessage?.({ data: FRAMED_BASE64_READY, isBinary: false });
}

/** Public transport fixture for one daemon-side framed handshake. */
interface DaemonFramedHandshakeFixture {
  /** Transport carrying plaintext handshake and legacy-encrypted confirm frames. */
  transport: Transport;
  /** All daemon writes observed at the transport boundary. */
  sent: (string | ArrayBuffer)[];
  /** Promise completed when the daemon writes its plaintext ready selection. */
  readySent: Promise<void>;
  /** Releases an optional deferred ready transport write. */
  releaseReady: () => void;
  /** Waits until the public transport has observed the requested number of writes. */
  waitForSentCount: (count: number) => Promise<void>;
  /** Public channel promise whose resolution represents application attach. */
  channelPromise: ReturnType<typeof createDaemonChannel>;
  /** Exact plaintext hello used for repeat-delivery scenarios. */
  helloText: string;
  /** Independently derived key for constructing authenticated client frames. */
  sharedKey: ReturnType<typeof deriveSharedKey>;
}

/** Creates a daemon handshake using only public transport and crypto boundaries. */
function startDaemonFramedHandshake(args: {
  /** Ordered framed encodings offered by the synthetic client. */
  ciphertextEncodings: readonly CiphertextEncoding[];
  /** Compression decoders offered by the synthetic client. */
  compressionAlgorithms?: readonly string[];
  /** Optional raw framed offer used to exercise capability parser compatibility. */
  framedOffer?: unknown;
  /** Whether the synthetic client also offers the legacy binary capability. */
  binaryCiphertext?: boolean;
  /** Immutable daemon encoding preference for this synthetic data connection. */
  configuredEncoding?: ConfiguredCiphertextEncoding;
  /** Compression codecs implemented by the synthetic daemon runtime. */
  daemonCompressionAlgorithms?: readonly string[];
  /** Holds the ready transport write so FIFO frames can be delivered before attach. */
  holdReadySend?: boolean;
  /** Optional application callbacks observed after daemon attach. */
  events?: EncryptedChannelEvents;
  /** Optional physical close observer for protocol failures. */
  close?: Transport["close"];
  /** Whether a physical close request emits the matching transport close event. */
  echoCloseEvent?: boolean;
}): DaemonFramedHandshakeFixture {
  // Long-lived daemon identity used by the responder under test.
  const daemonKeyPair = generateKeyPair();
  // Ephemeral client identity supplied through the public hello frame.
  const clientKeyPair = generateKeyPair();
  // All daemon writes observed at the public transport seam.
  const sent: (string | ArrayBuffer)[] = [];
  // Resolver for the optional ready-send barrier.
  let completeReadySend: (() => void) | null = null;
  // Public release for tests that need to enqueue FIFO frames before attach.
  const releaseReady = (): void => {
    completeReadySend?.();
    completeReadySend = null;
  };
  // Pending observers keyed by the minimum transport write count they require.
  const sentCountWaiters = new Map<number, Array<() => void>>();
  // Resolves after the requested public transport write has occurred.
  const waitForSentCount = (count: number): Promise<void> => {
    if (sent.length >= count) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const waiters = sentCountWaiters.get(count) ?? [];
      waiters.push(resolve);
      sentCountWaiters.set(count, waiters);
    });
  };
  // Completion signal for the daemon's plaintext ready write.
  let resolveReadySent: (() => void) | null = null;
  // Promise completed when selection is externally observable.
  const readySent = new Promise<void>((resolve) => {
    resolveReadySent = resolve;
  });
  // Transport declared before its close adapter so a real close event can be echoed.
  let transport: Transport;
  // Physical close observer retained separately from the optional close-event echo.
  const observeClose = args.close ?? vi.fn();
  // Transport with synchronous writes and caller-controlled close observation.
  transport = {
    send: (data) => {
      sent.push(data);
      resolveReadySent?.();
      for (const [count, waiters] of sentCountWaiters) {
        if (sent.length < count) continue;
        sentCountWaiters.delete(count);
        for (const resolve of waiters) resolve();
      }
      if (sent.length === 1 && args.holdReadySend) {
        return new Promise<void>((resolve) => {
          completeReadySend = resolve;
        });
      }
    },
    close: (code, reason) => {
      observeClose(code, reason);
      if (args.echoCloseEvent) transport.onclose?.(code ?? 1000, reason ?? "");
    },
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  // Public daemon channel promise whose resolution represents application attach.
  const channelPromise = createDaemonChannel(transport, daemonKeyPair, args.events, {
    ciphertextEncoding: args.configuredEncoding ?? "auto",
    compressionAlgorithms: args.daemonCompressionAlgorithms,
  });
  // Exact client hello retained for duplicate-delivery tests.
  const helloText = JSON.stringify({
    type: "e2ee_hello",
    key: exportPublicKey(clientKeyPair.publicKey),
    capabilities: {
      ...(args.binaryCiphertext === false ? {} : { binaryCiphertext: true }),
      framedCiphertextV1:
        args.framedOffer !== undefined
          ? args.framedOffer
          : {
              ciphertextEncodings: [...args.ciphertextEncodings],
              compressionAlgorithms: [...(args.compressionAlgorithms ?? [])],
            },
    },
  });
  // Shared key independently derived for authenticated synthetic client frames.
  const sharedKey = deriveSharedKey(clientKeyPair.secretKey, daemonKeyPair.publicKey);
  transport.onmessage?.({ data: helloText, isBinary: false });

  return {
    transport,
    sent,
    readySent,
    releaseReady,
    waitForSentCount,
    channelPromise,
    helloText,
    sharedKey,
  };
}

/** Delivers one independently encrypted legacy Base64 text frame to a daemon fixture. */
function deliverLegacyEncryptedText(
  fixture: DaemonFramedHandshakeFixture,
  plaintext: string,
): void {
  const wire = arrayBufferToBase64(encrypt(fixture.sharedKey, plaintext));
  fixture.transport.onmessage?.({ data: wire, isBinary: false });
}

/** Builds an authenticated v1 identity envelope plaintext for an independent wire vector. */
function buildIdentityEnvelope(binary: boolean, payload: readonly number[]): ArrayBuffer {
  // Fixed header plus the caller-supplied original application bytes.
  const envelope = new Uint8Array(8 + payload.length);
  envelope[0] = 0x50;
  envelope[1] = 0x01;
  envelope[2] = binary ? 0x01 : 0x00;
  envelope[3] = 0x00;
  new DataView(envelope.buffer).setUint32(4, payload.length, false);
  envelope.set(payload, 8);
  return envelope.buffer;
}

/** Observes a public promise after all microtasks in the current transport turn can settle. */
async function observePromiseState(
  promise: Promise<unknown>,
): Promise<"pending" | "fulfilled" | "rejected"> {
  // State updated only by the public promise's fulfillment or rejection handlers.
  let state: "pending" | "fulfilled" | "rejected" = "pending";
  void promise.then(
    () => {
      state = "fulfilled";
      return undefined;
    },
    () => {
      state = "rejected";
      return undefined;
    },
  );
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return state;
}

/** Public transport fixture for one opened client-side framed channel. */
interface ClientFramedChannelFixture {
  /** Transport carrying plaintext handshake and encrypted application frames. */
  transport: Transport;
  /** All client writes observed at the transport boundary. */
  sent: (string | ArrayBuffer)[];
  /** Open encrypted channel exposed by the public factory. */
  channel: Awaited<ReturnType<typeof createClientChannel>>;
  /** Independently derived key for constructing or inspecting daemon frames. */
  sharedKey: ReturnType<typeof deriveSharedKey>;
}

/** Opens a client channel with a synthetic framed selection at the public transport seam. */
async function openClientFramedChannel(args: {
  /** Framed ciphertext representation selected by the synthetic daemon. */
  ciphertextEncoding: TestCiphertextEncoding;
  /** Optional application callbacks observed after client open. */
  events?: EncryptedChannelEvents;
  /** Optional physical close observer for protocol failures. */
  close?: Transport["close"];
  /** Optional runtime decoder controlling the client's compression advertisement. */
  compressionAdapter?: FrameCompressionAdapter;
  /** Compression algorithms selected by the synthetic daemon. */
  compressionAlgorithms?: readonly string[];
  /** Optional content-free observer supplied at the public channel boundary. */
  runtimeObserver?: EncryptedChannelRuntimeObserver;
}): Promise<ClientFramedChannelFixture> {
  // Daemon identity used to derive the same channel key as the client.
  const daemonKeyPair = generateKeyPair();
  // All client writes observed at the public transport seam.
  const sent: (string | ArrayBuffer)[] = [];
  // Completion signal for the framed client handshake.
  let resolveOpened: (() => void) | null = null;
  // Promise completed after the mode confirm is sent.
  const opened = new Promise<void>((resolve) => {
    resolveOpened = resolve;
  });
  // Capturing transport with caller-controlled close observation.
  const transport: Transport = {
    send: (data) => {
      sent.push(data);
    },
    close: args.close ?? vi.fn(),
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  // Client channel observed only through its public factory and events.
  const channel = await createClientChannel(
    transport,
    exportPublicKey(daemonKeyPair.publicKey),
    {
      ...args.events,
      onopen: () => {
        args.events?.onopen?.();
        resolveOpened?.();
      },
    },
    {
      compressionAdapter: args.compressionAdapter,
      runtimeObserver: args.runtimeObserver,
    },
  );
  // Client hello carrying the ephemeral key for independent key derivation.
  const hello = JSON.parse(sent[0] as string) as { key: string };
  // Shared key independently derived on the synthetic daemon side.
  const sharedKey = deriveSharedKey(daemonKeyPair.secretKey, importPublicKey(hello.key));

  if (args.compressionAlgorithms) {
    transport.onmessage?.({
      data: JSON.stringify({
        type: "e2ee_ready",
        capabilities: {
          ...(args.ciphertextEncoding === "binary" ? { binaryCiphertext: true } : {}),
          framedCiphertextV1: {
            ciphertextEncoding: args.ciphertextEncoding,
            compressionAlgorithms: [...args.compressionAlgorithms],
          },
        },
      }),
      isBinary: false,
    });
  } else if (args.ciphertextEncoding === "binary") {
    deliverFramedBinaryReady(transport);
  } else {
    deliverFramedBase64Ready(transport);
  }
  await opened;

  return { transport, sent, channel, sharedKey };
}

describe("framed ciphertext v1 contract", () => {
  it("delivers framed traffic when every runtime observer callback throws", async () => {
    /** Application messages received after observer failures are isolated. */
    const received: Array<string | ArrayBuffer> = [];
    /** Observer whose public callbacks deliberately fail at every valid-frame stage. */
    const runtimeObserver: EncryptedChannelRuntimeObserver = {
      onNegotiatedTransport: () => {
        throw new Error("negotiated observer failed");
      },
      onInboundFrame: () => {
        throw new Error("inbound observer failed");
      },
      onPendingReceiveWireBytes: () => {
        throw new Error("pending observer failed");
      },
    };
    /** Open framed channel observed only through public transport and events. */
    const fixture = await openClientFramedChannel({
      ciphertextEncoding: "binary",
      runtimeObserver,
      events: { onmessage: (data) => received.push(data) },
    });
    /** Independently prepared and encrypted application frame. */
    const prepared = prepareIdentityFramedPayload("observer-independent");

    fixture.transport.onmessage?.({
      data: encrypt(fixture.sharedKey, prepared.plaintext),
      isBinary: true,
    });
    await vi.waitFor(() => expect(received).toEqual(["observer-independent"]));

    expect(fixture.channel.isOpen()).toBe(true);
  });

  it("encodes and decodes the exact authenticated identity envelope", async () => {
    const prepared = prepareIdentityFramedPayload("ok");
    expect(new Uint8Array(prepared.plaintext)).toEqual(
      new Uint8Array([0x50, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x6f, 0x6b]),
    );

    await expect(decodeFramedPayload(prepared.plaintext)).resolves.toEqual({
      data: "ok",
      binary: false,
      codec: "identity",
      originalByteLength: 2,
      encodedByteLength: 2,
    });
  });

  it("computes exact framed binary and Base64 wire lengths", () => {
    expect({
      binary: framedCiphertextWireByteLength(2, "binary"),
      base64: framedCiphertextWireByteLength(2, "base64"),
    }).toEqual({ binary: 50, base64: 68 });
  });

  it("accepts only canonical padded Base64 for framed ciphertext", () => {
    // Canonical one-byte ciphertext representation with required padding.
    const canonical = "AQ==";
    // Non-canonical forms forbidden before framed ciphertext allocation or decryption.
    const malformed = ["AQ", " AQ==", "AQ==\n", "-Q==", "_Q==", "AQ==="];

    expect(new Uint8Array(decodeFramedCiphertextWire(canonical, false, "base64"))).toEqual(
      new Uint8Array([0x01]),
    );
    for (const wire of malformed) {
      expect(() => decodeFramedCiphertextWire(wire, false, "base64")).toThrow(
        "canonical padded Base64",
      );
    }
  });

  it("preserves permissive URL-safe unpadded Base64 decoding for legacy traffic", () => {
    expect(new Uint8Array(base64ToArrayBuffer("  _w\n"))).toEqual(new Uint8Array([0xff]));
  });

  it("rejects framed text and binary ciphertext at the relay wire limit", () => {
    // Largest binary wire that remains strictly below the production relay cap.
    const acceptedBinary = new ArrayBuffer(MAX_FRAMED_WIRE_BYTES - 1);
    // Canonical Base64 text whose ASCII wire length reaches the forbidden boundary.
    const rejectedBase64 = "AAAA".repeat(MAX_FRAMED_WIRE_BYTES / 4);

    expect(decodeFramedCiphertextWire(acceptedBinary, true, "binary")).toBe(acceptedBinary);
    expect(() =>
      decodeFramedCiphertextWire(new ArrayBuffer(MAX_FRAMED_WIRE_BYTES), true, "binary"),
    ).toThrow("wire byte limit");
    expect(() => decodeFramedCiphertextWire(rejectedBase64, false, "base64")).toThrow(
      "wire byte limit",
    );
  });

  it("inflates a safe authenticated deflate envelope through the decoder adapter", async () => {
    // Encoded bytes chosen independently from the adapter output for the parser contract.
    const encoded = new Uint8Array(64).fill(0x7a);
    // Authenticated binary envelope with a valid 64:1 compression ratio.
    const envelope = new Uint8Array(8 + encoded.byteLength);
    envelope.set([0x50, 0x01, 0x01, 0x01, 0x00, 0x00, 0x10, 0x00]);
    envelope.set(encoded, 8);
    // Exact logical bytes returned by the bounded platform decoder.
    const original = new Uint8Array(4096).fill(0x2a);
    // Adapter observation at the public framed parser boundary.
    const inflateRaw = vi.fn(async () => original.buffer);

    const decoded = await decodeFramedPayload(envelope.buffer, { inflateRaw });

    expect(inflateRaw).toHaveBeenCalledOnce();
    expect(inflateRaw).toHaveBeenCalledWith(encoded.buffer, 4096, 4097);
    expect(decoded).toEqual({
      data: original.buffer,
      binary: true,
      codec: "deflate-raw",
      originalByteLength: 4096,
      encodedByteLength: 64,
    });
  });

  it.each([
    { caseName: "below the compression minimum", originalLength: 4095, encodedLength: 64 },
    {
      caseName: "above the compression input limit",
      originalLength: 4 * 1024 * 1024 + 1,
      encodedLength: 64,
    },
    { caseName: "without minimum savings", originalLength: 4096, encodedLength: 4032 },
    { caseName: "above the compression ratio limit", originalLength: 4096, encodedLength: 31 },
    { caseName: "with an empty encoded payload", originalLength: 4096, encodedLength: 0 },
  ])(
    "rejects deflate metadata $caseName before invoking the decoder",
    async ({ originalLength, encodedLength }) => {
      // Authenticated envelope whose declared lengths exercise one parser guard.
      const envelope = new Uint8Array(8 + encodedLength);
      envelope.set([0x50, 0x01, 0x01, 0x01]);
      new DataView(envelope.buffer).setUint32(4, originalLength, false);
      envelope.fill(0x61, 8);
      // Decoder boundary that must remain untouched for unsafe metadata.
      const inflateRaw = vi.fn(async () => new ArrayBuffer(0));

      await expect(decodeFramedPayload(envelope.buffer, { inflateRaw })).rejects.toThrow();
      expect(inflateRaw).not.toHaveBeenCalled();
    },
  );

  it("rejects deflate output that differs from the authenticated original length", async () => {
    // Safe authenticated deflate envelope declaring a 4096-byte binary result.
    const envelope = new Uint8Array(8 + 64);
    envelope.set([0x50, 0x01, 0x01, 0x01, 0x00, 0x00, 0x10, 0x00]);
    envelope.fill(0x61, 8);
    // Bounded adapter returns one byte fewer than the authenticated declaration.
    const inflateRaw = vi.fn(async () => new ArrayBuffer(4095));

    await expect(decodeFramedPayload(envelope.buffer, { inflateRaw })).rejects.toThrow(
      "output length mismatch",
    );
  });

  it.each([
    { caseName: "a truncated header", envelope: new Uint8Array(7).buffer },
    {
      caseName: "an unknown magic byte",
      envelope: new Uint8Array([0x51, 0x01, 0x00, 0x00, 0, 0, 0, 0]).buffer,
    },
    {
      caseName: "an unknown version",
      envelope: new Uint8Array([0x50, 0x02, 0x00, 0x00, 0, 0, 0, 0]).buffer,
    },
    {
      caseName: "reserved flags",
      envelope: new Uint8Array([0x50, 0x01, 0x02, 0x00, 0, 0, 0, 0]).buffer,
    },
    {
      caseName: "an unknown codec",
      envelope: new Uint8Array([0x50, 0x01, 0x00, 0x02, 0, 0, 0, 0]).buffer,
    },
    {
      caseName: "an identity length mismatch",
      envelope: new Uint8Array([0x50, 0x01, 0x00, 0x00, 0, 0, 0, 1]).buffer,
    },
  ])("rejects authenticated envelope metadata with $caseName", async ({ envelope }) => {
    await expect(decodeFramedPayload(envelope)).rejects.toThrow();
  });

  it.each(["identity", "deflate-raw"] as const)(
    "rejects invalid UTF-8 restored from a $codec text envelope",
    async (codec) => {
      // Text envelope bytes selected independently for each codec path.
      const envelope =
        codec === "identity"
          ? new Uint8Array([0x50, 0x01, 0x00, 0x00, 0, 0, 0, 1, 0xff])
          : new Uint8Array(8 + 64);
      if (codec === "deflate-raw") {
        envelope.set([0x50, 0x01, 0x00, 0x01, 0x00, 0x00, 0x10, 0x00]);
        envelope.fill(0x61, 8);
      }
      // Decoder output containing no valid UTF-8 start byte.
      const invalidText = new Uint8Array(4096).fill(0xff);
      // Adapter used only by the compressed vector.
      const adapter =
        codec === "deflate-raw" ? { inflateRaw: async () => invalidText.buffer } : undefined;

      await expect(decodeFramedPayload(envelope.buffer, adapter)).rejects.toThrow();
    },
  );

  it("advertises framed identity when no compression decoder is configured", async () => {
    // Daemon identity transferred to the client through the pairing channel.
    const daemonKeyPair = generateKeyPair();
    // Open signal used to stop the client's legacy handshake retry timer.
    let resolveOpen: (() => void) | null = null;
    // Client open promise completed after the synthetic old-daemon ready frame.
    const opened = new Promise<void>((resolve) => {
      resolveOpen = resolve;
    });
    // Capturing public transport seam for the plaintext hello frame.
    const transport: Transport = {
      send: vi.fn(),
      close: vi.fn(),
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    // Client channel under test.
    const channel = await createClientChannel(transport, exportPublicKey(daemonKeyPair.publicKey), {
      onopen: () => resolveOpen?.(),
    });
    // First client wire frame is the plaintext capability offer.
    const hello = JSON.parse(
      (transport.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string,
    ) as { capabilities?: unknown };

    transport.onmessage?.({ data: JSON.stringify({ type: "e2ee_ready" }), isBinary: false });
    await opened;
    channel.close();

    expect(hello.capabilities).toEqual({
      binaryCiphertext: true,
      framedCiphertextV1: {
        ciphertextEncodings: ["base64", "binary"],
        compressionAlgorithms: [],
      },
    });
  });

  it("advertises deflate-raw only when a client compression decoder is configured", async () => {
    // Daemon identity transferred to the client through the pairing channel.
    const daemonKeyPair = generateKeyPair();
    // Open signal used to stop the client's legacy handshake retry timer.
    let resolveOpen: (() => void) | null = null;
    // Client open promise completed after the synthetic old-daemon ready frame.
    const opened = new Promise<void>((resolve) => {
      resolveOpen = resolve;
    });
    // Capturing public transport seam for the plaintext hello frame.
    const transport: Transport = {
      send: vi.fn(),
      close: vi.fn(),
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    // Runtime decoder whose presence gates the advertised codec.
    const compressionAdapter = { inflateRaw: vi.fn(async () => new ArrayBuffer(0)) };
    // Client channel under test.
    const channel = await createClientChannel(
      transport,
      exportPublicKey(daemonKeyPair.publicKey),
      { onopen: () => resolveOpen?.() },
      { compressionAdapter },
    );
    // First client wire frame is the plaintext capability offer.
    const hello = JSON.parse(
      (transport.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string,
    ) as { capabilities?: unknown };

    transport.onmessage?.({ data: JSON.stringify({ type: "e2ee_ready" }), isBinary: false });
    await opened;
    channel.close();

    expect(hello.capabilities).toEqual({
      binaryCiphertext: true,
      framedCiphertextV1: {
        ciphertextEncodings: ["base64", "binary"],
        compressionAlgorithms: ["deflate-raw"],
      },
    });
  });

  it("opens after a daemon selects the advertised deflate-raw decoder", async () => {
    // Daemon identity used to inspect the authenticated mode confirmation.
    const daemonKeyPair = generateKeyPair();
    // All client writes observed at the public transport boundary.
    const sent: (string | ArrayBuffer)[] = [];
    // First public handshake outcome after the daemon selection arrives.
    let resolveOutcome: ((outcome: "opened" | "closed") => void) | null = null;
    // Outcome promise prevents an invalid selection from hanging the test.
    const outcome = new Promise<"opened" | "closed">((resolve) => {
      resolveOutcome = resolve;
    });
    // Capturing transport used for hello, confirm, and protocol closure.
    const transport: Transport = {
      send: (data) => sent.push(data),
      close: () => resolveOutcome?.("closed"),
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    // Runtime decoder whose presence authorizes the selected codec.
    const compressionAdapter = { inflateRaw: vi.fn(async () => new ArrayBuffer(0)) };
    // Client channel under test.
    const channel = await createClientChannel(
      transport,
      exportPublicKey(daemonKeyPair.publicKey),
      { onopen: () => resolveOutcome?.("opened") },
      { compressionAdapter },
    );
    // Client hello carrying the ephemeral key used for independent confirm inspection.
    const hello = JSON.parse(sent[0] as string) as { key: string };
    // Shared key independently derived on the synthetic daemon side.
    const sharedKey = deriveSharedKey(daemonKeyPair.secretKey, importPublicKey(hello.key));

    transport.onmessage?.({
      data: JSON.stringify({
        type: "e2ee_ready",
        capabilities: {
          binaryCiphertext: true,
          framedCiphertextV1: {
            ciphertextEncoding: "binary",
            compressionAlgorithms: ["deflate-raw"],
          },
        },
      }),
      isBinary: false,
    });
    const firstOutcome = await outcome;
    // Confirm remains legacy Base64 even when the selected application wire is binary.
    const confirm =
      typeof sent[1] === "string"
        ? JSON.parse(new TextDecoder().decode(decrypt(sharedKey, base64ToArrayBuffer(sent[1]))))
        : null;
    if (channel.isOpen()) channel.close();

    expect({ firstOutcome, confirm }).toEqual({
      firstOutcome: "opened",
      confirm: {
        type: "e2ee_mode_confirm",
        mode: "framed-ciphertext-v1",
        ciphertextEncoding: "binary",
        compressionAlgorithms: ["deflate-raw"],
      },
    });
  });

  it.each([
    { ciphertextEncoding: "binary" as const, payloadKind: "text" as const },
    { ciphertextEncoding: "binary" as const, payloadKind: "binary" as const },
    { ciphertextEncoding: "base64" as const, payloadKind: "text" as const },
    { ciphertextEncoding: "base64" as const, payloadKind: "binary" as const },
  ])(
    "restores daemon raw DEFLATE $payloadKind through framed $ciphertextEncoding",
    async ({ ciphertextEncoding, payloadKind }) => {
      // First public result of the compressed inbound frame.
      let resolveOutcome: ((outcome: "application" | "closed") => void) | null = null;
      // Outcome promise prevents a decoder integration failure from hanging the test.
      const outcome = new Promise<"application" | "closed">((resolve) => {
        resolveOutcome = resolve;
      });
      // Exact application values exposed by the client channel.
      const received: (string | ArrayBuffer)[] = [];
      // Portable codec used for both the compatibility vector and client decode path.
      const compressionAdapter = createFflateFrameCompressionAdapter();
      // Open client with raw DEFLATE selected on the requested framed representation.
      const fixture = await openClientFramedChannel({
        ciphertextEncoding,
        compressionAdapter,
        compressionAlgorithms: ["deflate-raw"],
        close: () => resolveOutcome?.("closed"),
        events: {
          onmessage: (data) => {
            received.push(data);
            resolveOutcome?.("application");
          },
        },
      });
      // Compressible state-sync bytes satisfying every authenticated metadata gate.
      const originalBytes = new TextEncoder().encode(
        '{"line":"state-sync","value":12345}\n'.repeat(128),
      );
      // Original application type represented independently from its shared bytes.
      const original =
        payloadKind === "text" ? new TextDecoder().decode(originalBytes) : originalBytes.buffer;
      // Raw DEFLATE bytes generated through the portable adapter.
      const compressed = await compressionAdapter.deflateRaw(originalBytes.buffer, 1);
      // Authenticated envelope built independently from the channel receive path.
      const prepared = prepareDeflateFramedPayload(original, compressed);
      // Encrypted wire represented exactly as selected for this connection.
      const encrypted = encrypt(fixture.sharedKey, prepared.plaintext);
      const wire = ciphertextEncoding === "binary" ? encrypted : arrayBufferToBase64(encrypted);

      fixture.transport.onmessage?.({
        data: wire,
        isBinary: ciphertextEncoding === "binary",
      });
      const firstOutcome = await outcome;
      // Public result normalized only after retaining the original observable type.
      const restored =
        typeof received[0] === "string"
          ? { kind: "text", value: received[0] }
          : {
              kind: "binary",
              value: Array.from(new Uint8Array(received[0] as ArrayBuffer)),
            };
      if (fixture.channel.isOpen()) fixture.channel.close();

      expect({ firstOutcome, restored }).toEqual({
        firstOutcome: "application",
        restored:
          payloadKind === "text"
            ? { kind: "text", value: original }
            : { kind: "binary", value: Array.from(originalBytes) },
      });
    },
  );

  it("delivers asynchronously decoded framed messages in transport order", async () => {
    // Portable codec generates independent authenticated input vectors.
    const codec = createFflateFrameCompressionAdapter();
    // Barrier keeps the first decode incomplete while the second wire arrives.
    let releaseFirstDecode: (() => void) | null = null;
    const firstDecodeReleased = new Promise<void>((resolve) => {
      releaseFirstDecode = resolve;
    });
    // Signal proving the first decoder invocation reached its async boundary.
    let resolveFirstDecodeStarted: (() => void) | null = null;
    const firstDecodeStarted = new Promise<void>((resolve) => {
      resolveFirstDecodeStarted = resolve;
    });
    // Number of decoder calls observable through the public adapter seam.
    let decodeCount = 0;
    // Decoder whose first operation is deliberately slower than later operations.
    const compressionAdapter: FrameCompressionAdapter = {
      inflateRaw: async (input, expectedLength, maxOutputLength) => {
        decodeCount += 1;
        if (decodeCount === 1) {
          resolveFirstDecodeStarted?.();
          await firstDecodeReleased;
        }
        return codec.inflateRaw(input, expectedLength, maxOutputLength);
      },
    };
    // Application messages observed only through the ordered public callback.
    const received: string[] = [];
    // Completion signal after both application messages are delivered.
    let resolveReceivedBoth: (() => void) | null = null;
    const receivedBoth = new Promise<void>((resolve) => {
      resolveReceivedBoth = resolve;
    });
    // Open framed binary channel with raw DEFLATE selected.
    const fixture = await openClientFramedChannel({
      ciphertextEncoding: "binary",
      compressionAdapter,
      compressionAlgorithms: ["deflate-raw"],
      events: {
        onmessage: (data) => {
          if (typeof data === "string") received.push(data);
          if (received.length === 2) resolveReceivedBoth?.();
        },
      },
    });
    // Ordered logical payloads whose compressed frames can finish out of order.
    const payloads = ["first-state-sync\n".repeat(256), "second-state-sync\n".repeat(256)];
    // Independent framed ciphertext wires delivered in transport order.
    const wires: ArrayBuffer[] = [];
    for (const payload of payloads) {
      const bytes = new TextEncoder().encode(payload).buffer;
      const compressed = await codec.deflateRaw(bytes, 1);
      const prepared = prepareDeflateFramedPayload(payload, compressed);
      wires.push(encrypt(fixture.sharedKey, prepared.plaintext));
    }

    fixture.transport.onmessage?.({ data: wires[0], isBinary: true });
    await firstDecodeStarted;
    fixture.transport.onmessage?.({ data: wires[1], isBinary: true });
    await Promise.resolve();
    expect(decodeCount).toBe(1);

    releaseFirstDecode?.();
    await receivedBoth;
    if (fixture.channel.isOpen()) fixture.channel.close();

    expect(received).toEqual(payloads);
  });

  it("closes before queued framed wire exceeds the receive high-water mark", async () => {
    // Portable codec prepares one valid frame that can hold the receive FIFO open.
    const codec = createFflateFrameCompressionAdapter();
    // Barrier retains the first raw-wire reservation during asynchronous decode.
    let releaseDecode: (() => void) | null = null;
    const decodeReleased = new Promise<void>((resolve) => {
      releaseDecode = resolve;
    });
    // Signal proving the first item is active rather than merely queued.
    let resolveDecodeStarted: (() => void) | null = null;
    const decodeStarted = new Promise<void>((resolve) => {
      resolveDecodeStarted = resolve;
    });
    // Decoder holds exactly one valid frame at the public adapter boundary.
    const compressionAdapter: FrameCompressionAdapter = {
      inflateRaw: async (input, expectedLength, maxOutputLength) => {
        resolveDecodeStarted?.();
        await decodeReleased;
        return codec.inflateRaw(input, expectedLength, maxOutputLength);
      },
    };
    // First physical close request caused by aggregate raw-wire pressure.
    let resolveClosed: (() => void) | null = null;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    // No application value may escape after a high-water failure.
    const received: (string | ArrayBuffer)[] = [];
    // Open client whose decoder and close seam are controlled by the test.
    const fixture = await openClientFramedChannel({
      ciphertextEncoding: "binary",
      compressionAdapter,
      compressionAlgorithms: ["deflate-raw"],
      close: () => resolveClosed?.(),
      events: { onmessage: (data) => received.push(data) },
    });
    // Small valid compressed frame holds the active reservation.
    const payload = "receive-reservation\n".repeat(256);
    const payloadBytes = new TextEncoder().encode(payload).buffer;
    const compressed = await codec.deflateRaw(payloadBytes, 1);
    const prepared = prepareDeflateFramedPayload(payload, compressed);
    const firstWire = encrypt(fixture.sharedKey, prepared.plaintext);

    fixture.transport.onmessage?.({ data: firstWire, isBinary: true });
    await decodeStarted;
    // Each queued frame is below 32 MiB, while both plus the active item exceed 64 MiB.
    const largeWireBytes = MAX_FRAMED_WIRE_BYTES - 1;
    fixture.transport.onmessage?.({ data: new ArrayBuffer(largeWireBytes), isBinary: true });
    fixture.transport.onmessage?.({ data: new ArrayBuffer(largeWireBytes), isBinary: true });
    const closeState = await observePromiseState(closed);

    releaseDecode?.();
    await Promise.resolve();
    if (fixture.channel.isOpen()) fixture.channel.close();

    expect({ closeState, received }).toEqual({ closeState: "fulfilled", received: [] });
  });

  it("reserves framed client wire that arrives in the same turn as ready", async () => {
    // Daemon identity transferred to the client through the pairing boundary.
    const daemonKeyPair = generateKeyPair();
    // Physical close observer must fire before asynchronous ready processing begins.
    const close = vi.fn();
    // Public transport captures the client hello and accepts synthetic daemon frames.
    const transport: Transport = {
      send: vi.fn(),
      close,
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    // New client always offers framed-v1, even without a compression decoder.
    const channel = await createClientChannel(transport, exportPublicKey(daemonKeyPair.publicKey));

    // Ready and all following wires arrive before the receive promise tail runs.
    deliverFramedBinaryReady(transport);
    transport.onmessage?.({ data: new ArrayBuffer(30 * 1024 * 1024), isBinary: true });
    transport.onmessage?.({ data: new ArrayBuffer(30 * 1024 * 1024), isBinary: true });
    transport.onmessage?.({ data: new ArrayBuffer(5 * 1024 * 1024), isBinary: true });
    const closeCallsInTransportTurn = close.mock.calls.length;
    if (channel.isOpen()) channel.close();

    expect(closeCallsInTransportTurn).toBe(1);
  });

  it("closes before the daemon handshake backlog exceeds the receive high-water mark", async () => {
    // First physical close request while the daemon ready write remains pending.
    let resolveClosed: (() => void) | null = null;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    // Daemon factory holds ready so all following wires remain in its pre-attach FIFO.
    const fixture = startDaemonFramedHandshake({
      ciphertextEncodings: ["binary"],
      holdReadySend: true,
      close: () => resolveClosed?.(),
    });
    // Observe rejection from the public factory without leaving an unhandled promise.
    const channelOutcome = fixture.channelPromise.then(
      () => "opened" as const,
      () => "rejected" as const,
    );
    await fixture.readySent;
    // Each raw frame is individually below 32 MiB; their aggregate crosses 64 MiB.
    const largeWireBytes = MAX_FRAMED_WIRE_BYTES - 1;
    fixture.transport.onmessage?.({ data: new ArrayBuffer(largeWireBytes), isBinary: true });
    fixture.transport.onmessage?.({ data: new ArrayBuffer(largeWireBytes), isBinary: true });
    fixture.transport.onmessage?.({ data: new ArrayBuffer(3), isBinary: true });

    const closeState = await observePromiseState(closed);
    fixture.releaseReady();

    expect({ closeState, channelOutcome: await channelOutcome }).toEqual({
      closeState: "fulfilled",
      channelOutcome: "rejected",
    });
  });

  it("preserves the legacy daemon handshake backlog without framed receive limits", async () => {
    // Legacy hybrid selection has no common framed representation.
    const close = vi.fn();
    const fixture = startDaemonFramedHandshake({
      ciphertextEncodings: [],
      holdReadySend: true,
      close,
    });
    await fixture.readySent;
    // Existing legacy behavior retains these opaque frames until ready completes.
    fixture.transport.onmessage?.({ data: new ArrayBuffer(33 * 1024 * 1024), isBinary: true });
    fixture.transport.onmessage?.({ data: new ArrayBuffer(33 * 1024 * 1024), isBinary: true });
    const closeCallsBeforeReady = close.mock.calls.length;

    fixture.releaseReady();
    // Public channel carries the negotiated snapshot after exact confirmation.
    const channel = await fixture.channelPromise;
    if (channel.isOpen()) channel.close();

    expect(closeCallsBeforeReady).toBe(0);
  });

  it("shares the receive budget while the daemon hands backlog ownership to the channel", async () => {
    // Physical close observer distinguishes immediate shared-budget rejection from later decode failure.
    const close = vi.fn();
    // Daemon transport becomes available before the deferred ready write is released.
    let transport: Transport | null = null;
    // Close count captured synchronously inside the public open callback.
    let closeCallsDuringOpen = -1;
    // Factory backlog can remain below 64 MiB before the channel receives new traffic.
    const fixture = startDaemonFramedHandshake({
      ciphertextEncodings: ["binary"],
      holdReadySend: true,
      close,
      events: {
        onopen: () => {
          transport?.onmessage?.({ data: new ArrayBuffer(5 * 1024 * 1024), isBinary: true });
          closeCallsDuringOpen = close.mock.calls.length;
        },
      },
    });
    transport = fixture.transport;
    await fixture.readySent;
    // Exact confirm leads the retained FIFO and attaches the framed channel.
    deliverLegacyEncryptedText(
      fixture,
      JSON.stringify({
        type: "e2ee_mode_confirm",
        mode: "framed-ciphertext-v1",
        ciphertextEncoding: "binary",
        compressionAlgorithms: [],
      }),
    );
    // Two individually valid raw wires consume nearly all factory receive capacity.
    const largeWireBytes = 30 * 1024 * 1024;
    fixture.transport.onmessage?.({ data: new ArrayBuffer(largeWireBytes), isBinary: true });
    fixture.transport.onmessage?.({ data: new ArrayBuffer(largeWireBytes), isBinary: true });

    fixture.releaseReady();
    const channel = await fixture.channelPromise;

    expect({ closeCallsDuringOpen, channelOpen: channel.isOpen() }).toEqual({
      closeCallsDuringOpen: 1,
      channelOpen: false,
    });
  });

  it("closes a framed channel and suppresses an in-flight decode after transport error", async () => {
    // Portable codec prepares one valid compressed ciphertext vector.
    const codec = createFflateFrameCompressionAdapter();
    // Barrier retains decoded output until after transport failure.
    let releaseDecode: (() => void) | null = null;
    const decodeReleased = new Promise<void>((resolve) => {
      releaseDecode = resolve;
    });
    // Signal proving the decoder has started before the error arrives.
    let resolveDecodeStarted: (() => void) | null = null;
    const decodeStarted = new Promise<void>((resolve) => {
      resolveDecodeStarted = resolve;
    });
    // Framed decoder controlled at the runtime adapter seam.
    const compressionAdapter: FrameCompressionAdapter = {
      inflateRaw: async (input, expectedLength, maxOutputLength) => {
        resolveDecodeStarted?.();
        await decodeReleased;
        return codec.inflateRaw(input, expectedLength, maxOutputLength);
      },
    };
    // Public close signal expected immediately from transport failure.
    let resolveClosed: (() => void) | null = null;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    // Application callback must not receive work completed after failure.
    const received: (string | ArrayBuffer)[] = [];
    const fixture = await openClientFramedChannel({
      ciphertextEncoding: "binary",
      compressionAdapter,
      compressionAlgorithms: ["deflate-raw"],
      close: () => resolveClosed?.(),
      events: { onmessage: (data) => received.push(data) },
    });
    // Independently prepared valid compressed frame enters asynchronous decode.
    const payload = "transport-error\n".repeat(256);
    const bytes = new TextEncoder().encode(payload).buffer;
    const compressed = await codec.deflateRaw(bytes, 1);
    const prepared = prepareDeflateFramedPayload(payload, compressed);
    fixture.transport.onmessage?.({
      data: encrypt(fixture.sharedKey, prepared.plaintext),
      isBinary: true,
    });
    await decodeStarted;

    fixture.transport.onerror?.(new Error("transport failed"));
    const closeState = await observePromiseState(closed);
    releaseDecode?.();
    await Promise.resolve();

    expect({ closeState, received, channelOpen: fixture.channel.isOpen() }).toEqual({
      closeState: "fulfilled",
      received: [],
      channelOpen: false,
    });
  });

  it.each(["binary", "base64"] as const)(
    "sends an already prepared framed payload once through $ciphertextEncoding",
    async (ciphertextEncoding) => {
      // Daemon fixture negotiates the requested representation before the prepared send.
      const fixture = startDaemonFramedHandshake({ ciphertextEncodings: [ciphertextEncoding] });
      await fixture.readySent;
      deliverLegacyEncryptedText(
        fixture,
        JSON.stringify({
          type: "e2ee_mode_confirm",
          mode: "framed-ciphertext-v1",
          ciphertextEncoding,
          compressionAlgorithms: [],
        }),
      );
      const channel = await fixture.channelPromise;
      fixture.sent.length = 0;
      // Envelope prepared once at the public framed-payload boundary.
      const prepared = prepareIdentityFramedPayload("prepared-once");

      const outbound = channel.prepareOutboundFrame(prepared);
      await channel.sendPreparedFrame(outbound);
      // Prepared wire decoded only at the selected representation boundary.
      const wire = fixture.sent[0];
      const ciphertext =
        ciphertextEncoding === "binary"
          ? (wire as ArrayBuffer)
          : base64ToArrayBuffer(wire as string);
      const authenticatedPlaintext = decrypt(fixture.sharedKey, ciphertext);
      if (channel.isOpen()) channel.close();

      expect(new Uint8Array(authenticatedPlaintext)).toEqual(new Uint8Array(prepared.plaintext));
    },
  );

  it("keeps client outbound payloads identity after deflate-raw is selected", async () => {
    // Portable decoder authorizing the synthetic daemon selection.
    const compressionAdapter = createFflateFrameCompressionAdapter();
    // Open binary channel whose peer may compress daemon-to-client traffic.
    const fixture = await openClientFramedChannel({
      ciphertextEncoding: "binary",
      compressionAdapter,
      compressionAlgorithms: ["deflate-raw"],
    });
    fixture.sent.length = 0;
    // Large compressible upload that must still remain identity in protocol v1.
    const original = '{"direction":"client-to-daemon"}\n'.repeat(256);

    await fixture.channel.send(original);
    // Authenticated application envelope inspected independently at the wire boundary.
    const plaintext = decrypt(fixture.sharedKey, fixture.sent[0] as ArrayBuffer);
    if (fixture.channel.isOpen()) fixture.channel.close();

    expect(new Uint8Array(plaintext)[3]).toBe(0x00);
    expect(new TextDecoder().decode(plaintext.slice(8))).toBe(original);
  });

  it.each([
    {
      selectionViolation: "an unoffered compression algorithm",
      selection: {
        ciphertextEncoding: "binary",
        compressionAlgorithms: ["deflate-raw"],
      },
    },
    {
      selectionViolation: "an unsupported ciphertext encoding",
      selection: {
        ciphertextEncoding: "hex",
        compressionAlgorithms: [],
      },
    },
  ])("closes when ready contains $selectionViolation", async ({ selection }) => {
    // Daemon identity transferred to the client through the pairing channel.
    const daemonKeyPair = generateKeyPair();
    // Completion signal for protocol close or an incorrect legacy open transition.
    let resolveOutcome: ((outcome: "closed" | "opened") => void) | null = null;
    // First public decision after the unauthorized selection arrives.
    const outcome = new Promise<"closed" | "opened">((resolve) => {
      resolveOutcome = resolve;
    });
    // Captured physical close operation for unauthorized selection rejection.
    const close = vi.fn(() => resolveOutcome?.("closed"));
    // All client writes used to prove no confirm is emitted for an unauthorized selection.
    const sent: (string | ArrayBuffer)[] = [];
    // Public transport seam for the client handshake under test.
    const transport: Transport = {
      send: (data) => sent.push(data),
      close,
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    // Client advertises an empty compression decoder list in its hello.
    const channel = await createClientChannel(transport, exportPublicKey(daemonKeyPair.publicKey), {
      onopen: () => resolveOutcome?.("opened"),
    });

    // Present but unauthorized selection must fail closed instead of becoming a legacy ready.
    transport.onmessage?.({
      data: JSON.stringify({
        type: "e2ee_ready",
        capabilities: {
          binaryCiphertext: true,
          framedCiphertextV1: selection,
        },
      }),
      isBinary: false,
    });
    const firstOutcome = await outcome;
    const observed = {
      firstOutcome,
      sentCount: sent.length,
      closeCallCount: close.mock.calls.length,
      channelOpen: channel.isOpen(),
    };
    if (channel.isOpen()) channel.close();

    expect(observed).toEqual({
      firstOutcome: "closed",
      sentCount: 1,
      closeCallCount: 1,
      channelOpen: false,
    });
  });

  it("configured auto prefers framed binary from a dual offer", async () => {
    // Real client offer order lists Base64 before binary and a decoder unavailable locally.
    const fixture = startDaemonFramedHandshake({
      ciphertextEncodings: ["base64", "binary"],
      compressionAlgorithms: ["deflate-raw"],
    });
    await fixture.readySent;

    // Selection is asserted before confirm so an incorrect ready cannot strand the test pending.
    expect(JSON.parse(fixture.sent[0] as string)).toEqual({
      type: "e2ee_ready",
      capabilities: {
        binaryCiphertext: true,
        framedCiphertextV1: {
          ciphertextEncoding: "binary",
          compressionAlgorithms: [],
        },
      },
    });

    // Exact selection confirmation encrypted with the established legacy wire.
    deliverLegacyEncryptedText(
      fixture,
      JSON.stringify({
        type: "e2ee_mode_confirm",
        mode: "framed-ciphertext-v1",
        ciphertextEncoding: "binary",
        compressionAlgorithms: [],
      }),
    );
    const daemonChannel = await fixture.channelPromise;
    expect(daemonChannel.isOpen()).toBe(true);
    if (daemonChannel.isOpen()) daemonChannel.close();
  });

  it("exposes the authenticated framed selection with the daemon codec intersection", async () => {
    // Both peers explicitly implement the fixed raw DEFLATE framed codec.
    const fixture = startDaemonFramedHandshake({
      ciphertextEncodings: ["binary"],
      compressionAlgorithms: ["deflate-raw"],
      daemonCompressionAlgorithms: ["deflate-raw"],
    });
    await fixture.readySent;
    // Exact authenticated echo completes the daemon's immutable connection selection.
    deliverLegacyEncryptedText(
      fixture,
      JSON.stringify({
        type: "e2ee_mode_confirm",
        mode: "framed-ciphertext-v1",
        ciphertextEncoding: "binary",
        compressionAlgorithms: ["deflate-raw"],
      }),
    );
    const channel = await fixture.channelPromise;

    expect(channel.getNegotiatedTransport()).toEqual({
      mode: "framed-v1",
      ciphertextEncoding: "binary",
      compressionAlgorithms: ["deflate-raw"],
    });
    channel.close();
  });

  it("configured auto selects framed Base64 from a Base64-only offer", async () => {
    // Auto policy has only one common framed representation.
    const fixture = startDaemonFramedHandshake({
      ciphertextEncodings: ["base64"],
    });
    await fixture.readySent;

    // Base64 selection deliberately omits the legacy binary capability echo.
    expect(JSON.parse(fixture.sent[0] as string)).toEqual({
      type: "e2ee_ready",
      capabilities: {
        framedCiphertextV1: {
          ciphertextEncoding: "base64",
          compressionAlgorithms: [],
        },
      },
    });

    // Exact Base64 selection confirmation encrypted with the established legacy wire.
    deliverLegacyEncryptedText(
      fixture,
      JSON.stringify({
        type: "e2ee_mode_confirm",
        mode: "framed-ciphertext-v1",
        ciphertextEncoding: "base64",
        compressionAlgorithms: [],
      }),
    );
    const daemonChannel = await fixture.channelPromise;
    expect(daemonChannel.isOpen()).toBe(true);
    if (daemonChannel.isOpen()) daemonChannel.close();
  });

  it("treats a malformed framed offer as absent while preserving legacy binary capability", async () => {
    // Structurally invalid framed capability must not invalidate the authenticated hello key.
    const fixture = startDaemonFramedHandshake({
      ciphertextEncodings: [],
      framedOffer: {
        ciphertextEncodings: "binary",
        compressionAlgorithms: [],
      },
    });
    await fixture.readySent;
    const daemonChannel = await fixture.channelPromise;
    const observed = {
      ready: JSON.parse(fixture.sent[0] as string),
      channelOpen: daemonChannel.isOpen(),
    };
    if (daemonChannel.isOpen()) daemonChannel.close();

    expect(observed).toEqual({
      ready: {
        type: "e2ee_ready",
        capabilities: { binaryCiphertext: true },
      },
      channelOpen: true,
    });
  });

  it("ignores unknown offer tokens and selects the remaining framed Base64 capability", async () => {
    // Unknown additive tokens surround the one encoding implemented by both peers.
    const fixture = startDaemonFramedHandshake({
      ciphertextEncodings: [],
      framedOffer: {
        ciphertextEncodings: ["future-text", "base64"],
        compressionAlgorithms: ["future-codec"],
      },
    });
    await fixture.readySent;
    expect(JSON.parse(fixture.sent[0] as string)).toEqual({
      type: "e2ee_ready",
      capabilities: {
        framedCiphertextV1: {
          ciphertextEncoding: "base64",
          compressionAlgorithms: [],
        },
      },
    });

    // Exact authenticated echo completes the valid selection after unknown tokens are ignored.
    deliverLegacyEncryptedText(
      fixture,
      JSON.stringify({
        type: "e2ee_mode_confirm",
        mode: "framed-ciphertext-v1",
        ciphertextEncoding: "base64",
        compressionAlgorithms: [],
      }),
    );
    const daemonChannel = await fixture.channelPromise;
    expect(daemonChannel.isOpen()).toBe(true);
    if (daemonChannel.isOpen()) daemonChannel.close();
  });

  it.each([
    {
      configuredEncoding: "auto" as const,
      peerOffer: "no framed or legacy binary capability",
      expectedMode: "legacy Base64",
      ciphertextEncodings: [] as const,
      binaryCiphertext: false,
      expectedReady: { type: "e2ee_ready" },
      confirmEncoding: null,
    },
    {
      configuredEncoding: "base64" as const,
      peerOffer: "both framed encodings",
      expectedMode: "framed Base64",
      ciphertextEncodings: ["base64", "binary"] as const,
      binaryCiphertext: true,
      expectedReady: {
        type: "e2ee_ready",
        capabilities: {
          framedCiphertextV1: {
            ciphertextEncoding: "base64",
            compressionAlgorithms: [],
          },
        },
      },
      confirmEncoding: "base64" as const,
    },
    {
      configuredEncoding: "base64" as const,
      peerOffer: "framed binary only",
      expectedMode: "legacy Base64",
      ciphertextEncodings: ["binary"] as const,
      binaryCiphertext: true,
      expectedReady: { type: "e2ee_ready" },
      confirmEncoding: null,
    },
    {
      configuredEncoding: "binary" as const,
      peerOffer: "both framed encodings",
      expectedMode: "framed binary",
      ciphertextEncodings: ["base64", "binary"] as const,
      binaryCiphertext: true,
      expectedReady: {
        type: "e2ee_ready",
        capabilities: {
          binaryCiphertext: true,
          framedCiphertextV1: {
            ciphertextEncoding: "binary",
            compressionAlgorithms: [],
          },
        },
      },
      confirmEncoding: "binary" as const,
    },
    {
      configuredEncoding: "binary" as const,
      peerOffer: "framed Base64 and legacy binary",
      expectedMode: "legacy hybrid",
      ciphertextEncodings: ["base64"] as const,
      binaryCiphertext: true,
      expectedReady: {
        type: "e2ee_ready",
        capabilities: { binaryCiphertext: true },
      },
      confirmEncoding: null,
    },
    {
      configuredEncoding: "binary" as const,
      peerOffer: "framed Base64 only",
      expectedMode: "legacy Base64",
      ciphertextEncodings: ["base64"] as const,
      binaryCiphertext: false,
      expectedReady: { type: "e2ee_ready" },
      confirmEncoding: null,
    },
  ])(
    "selects $expectedMode for configured $configuredEncoding with $peerOffer",
    async ({
      configuredEncoding,
      ciphertextEncodings,
      binaryCiphertext,
      expectedReady,
      confirmEncoding,
    }) => {
      // Policy and peer offer are injected through the public daemon factory seam.
      const fixture = startDaemonFramedHandshake({
        configuredEncoding,
        ciphertextEncodings,
        binaryCiphertext,
      });
      await fixture.readySent;

      expect(JSON.parse(fixture.sent[0] as string)).toEqual(expectedReady);

      if (confirmEncoding !== null) {
        // Framed selection requires the exact authenticated echo before attach.
        deliverLegacyEncryptedText(
          fixture,
          JSON.stringify({
            type: "e2ee_mode_confirm",
            mode: "framed-ciphertext-v1",
            ciphertextEncoding: confirmEncoding,
            compressionAlgorithms: [],
          }),
        );
      }
      const daemonChannel = await fixture.channelPromise;
      expect(daemonChannel.isOpen()).toBe(true);
      if (daemonChannel.isOpen()) daemonChannel.close();
    },
  );

  it("configured auto falls back to legacy hybrid with no shared framed encoding", async () => {
    // Empty framed offer is valid but has no representation in common with the daemon.
    const fixture = startDaemonFramedHandshake({ ciphertextEncodings: [] });
    await fixture.readySent;

    // Legacy negotiation attaches immediately and retains the separately offered binary capability.
    const daemonChannel = await fixture.channelPromise;
    const observed = {
      ready: JSON.parse(fixture.sent[0] as string),
      channelOpen: daemonChannel.isOpen(),
    };
    if (daemonChannel.isOpen()) daemonChannel.close();

    expect(observed).toEqual({
      ready: {
        type: "e2ee_ready",
        capabilities: { binaryCiphertext: true },
      },
      channelOpen: true,
    });
  });

  it.each([
    {
      ciphertextEncoding: "binary" as const,
      expectedCapabilities: {
        binaryCiphertext: true,
        framedCiphertextV1: {
          ciphertextEncoding: "binary",
          compressionAlgorithms: [],
        },
      },
    },
    {
      ciphertextEncoding: "base64" as const,
      expectedCapabilities: {
        framedCiphertextV1: {
          ciphertextEncoding: "base64",
          compressionAlgorithms: [],
        },
      },
    },
  ])(
    "locks daemon framed $ciphertextEncoding for original binary payloads in both directions",
    async ({ ciphertextEncoding, expectedCapabilities }) => {
      // Application payloads observed after exact confirm and daemon attach.
      const received: (string | ArrayBuffer)[] = [];
      // Completion signal for the independently constructed inbound frame.
      let resolveReceived: (() => void) | null = null;
      // Promise completed only through the daemon channel's public receive callback.
      const receivedOne = new Promise<void>((resolve) => {
        resolveReceived = resolve;
      });
      // Single-encoding offer makes the expected connection selection unambiguous.
      const fixture = startDaemonFramedHandshake({
        ciphertextEncodings: [ciphertextEncoding],
        events: {
          onmessage: (data) => {
            received.push(data);
            resolveReceived?.();
          },
        },
      });
      await fixture.readySent;
      expect(JSON.parse(fixture.sent[0] as string)).toEqual({
        type: "e2ee_ready",
        capabilities: expectedCapabilities,
      });

      // Exact authenticated echo is the only transition into the selected framed mode.
      deliverLegacyEncryptedText(
        fixture,
        JSON.stringify({
          type: "e2ee_mode_confirm",
          mode: "framed-ciphertext-v1",
          ciphertextEncoding,
          compressionAlgorithms: [],
        }),
      );
      const daemonChannel = await fixture.channelPromise;

      // Outbound raw bytes must use the locked representation and binary envelope flag.
      const payloadBytes = [0x00, 0xff, 0x62];
      await daemonChannel.send(Uint8Array.from(payloadBytes).buffer);
      const outboundWire = fixture.sent[1];
      const outboundWireEncoding = outboundWire instanceof ArrayBuffer ? "binary" : "base64";
      expect(outboundWireEncoding).toBe(ciphertextEncoding);
      const outboundCiphertext =
        ciphertextEncoding === "binary"
          ? (outboundWire as ArrayBuffer)
          : base64ToArrayBuffer(outboundWire as string);
      expect(new Uint8Array(decrypt(fixture.sharedKey, outboundCiphertext))).toEqual(
        new Uint8Array(buildIdentityEnvelope(true, payloadBytes)),
      );

      // Inbound raw bytes represented with the same locked opcode recover as ArrayBuffer.
      const inboundCiphertext = encrypt(
        fixture.sharedKey,
        buildIdentityEnvelope(true, payloadBytes),
      );
      fixture.transport.onmessage?.({
        data:
          ciphertextEncoding === "binary"
            ? inboundCiphertext
            : arrayBufferToBase64(inboundCiphertext),
        isBinary: ciphertextEncoding === "binary",
      });
      const deliveryState = await observePromiseState(receivedOne);
      expect({ deliveryState, receivedLength: received.length }).toEqual({
        deliveryState: "fulfilled",
        receivedLength: 1,
      });
      expect(received[0]).toBeInstanceOf(ArrayBuffer);
      expect(new Uint8Array(received[0] as ArrayBuffer)).toEqual(Uint8Array.from(payloadBytes));
      daemonChannel.close();
    },
  );

  it("keeps the daemon channel pending until the exact mode confirm is authenticated", async () => {
    // Application messages exposed before or after authenticated attach.
    const daemonMessages: (string | ArrayBuffer)[] = [];
    // Binary-only handshake whose public promise represents application attach.
    const fixture = startDaemonFramedHandshake({
      ciphertextEncodings: ["binary"],
      holdReadySend: true,
      events: { onmessage: (data) => daemonMessages.push(data) },
    });
    await fixture.readySent;
    fixture.releaseReady();
    // Public factory promise must remain pending after all work from the ready write can settle.
    const stateBeforeConfirm = await observePromiseState(fixture.channelPromise);

    // Exact confirmation independently encoded from the wire contract.
    deliverLegacyEncryptedText(
      fixture,
      JSON.stringify({
        type: "e2ee_mode_confirm",
        mode: "framed-ciphertext-v1",
        ciphertextEncoding: "binary",
        compressionAlgorithms: [],
      }),
    );
    const daemonChannel = await fixture.channelPromise;
    const observed = {
      stateBeforeConfirm,
      daemonMessages,
      channelOpenAfterConfirm: daemonChannel.isOpen(),
    };
    if (daemonChannel.isOpen()) daemonChannel.close();

    expect(observed).toEqual({
      stateBeforeConfirm: "pending",
      daemonMessages: [],
      channelOpenAfterConfirm: true,
    });
  });

  it("does not attach a framed daemon channel after transport closes during the ready write", async () => {
    // Public open callback that must remain untouched after the transport closes.
    const onopen = vi.fn();
    // Held ready write lets an exact confirm queue before the close event wins the handshake.
    const fixture = startDaemonFramedHandshake({
      ciphertextEncodings: ["binary"],
      holdReadySend: true,
      events: { onopen },
    });
    await fixture.readySent;

    // Exact confirm is already in transport order but cannot attach before ready finishes.
    deliverLegacyEncryptedText(
      fixture,
      JSON.stringify({
        type: "e2ee_mode_confirm",
        mode: "framed-ciphertext-v1",
        ciphertextEncoding: "binary",
        compressionAlgorithms: [],
      }),
    );
    // Transport closure rejects the public factory while its ready write is still pending.
    fixture.transport.onclose?.(1006, "network lost");
    // Exact public rejection retained before the deferred transport write is released.
    const rejectionMessage = await fixture.channelPromise.then(
      () => "fulfilled",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );

    fixture.releaseReady();
    // One transport turn lets every continuation after the ready write attempt to settle.
    const finalFactoryState = await observePromiseState(fixture.channelPromise);

    expect({
      rejectionMessage,
      finalFactoryState,
      openCallCount: onopen.mock.calls.length,
    }).toEqual({
      rejectionMessage: "Connection closed during handshake: 1006 network lost",
      finalFactoryState: "rejected",
      openCallCount: 0,
    });
  });

  it("processes exact confirm before the following framed application frame in receive FIFO", async () => {
    // Application payloads observed after the pending selection is authenticated.
    const received: (string | ArrayBuffer)[] = [];
    // Completion signal for the first framed application callback.
    let resolveReceived: (() => void) | null = null;
    // Promise completed only through the public daemon receive event.
    const receivedOne = new Promise<void>((resolve) => {
      resolveReceived = resolve;
    });
    // Physical close observer must remain unused for a valid pipelined sequence.
    const close = vi.fn();
    // Ready send is held so confirm and application frames share one buffered FIFO batch.
    const fixture = startDaemonFramedHandshake({
      ciphertextEncodings: ["binary"],
      holdReadySend: true,
      close,
      events: {
        onmessage: (data) => {
          received.push(data);
          resolveReceived?.();
        },
      },
    });
    await fixture.readySent;

    // Exact legacy Base64 confirm is the first encrypted frame in transport order.
    deliverLegacyEncryptedText(
      fixture,
      JSON.stringify({
        type: "e2ee_mode_confirm",
        mode: "framed-ciphertext-v1",
        ciphertextEncoding: "binary",
        compressionAlgorithms: [],
      }),
    );
    // Framed binary application ciphertext immediately follows without an extra daemon ack RTT.
    const applicationBytes = Array.from(new TextEncoder().encode("after-confirm"));
    fixture.transport.onmessage?.({
      data: encrypt(fixture.sharedKey, buildIdentityEnvelope(false, applicationBytes)),
      isBinary: true,
    });
    fixture.releaseReady();

    const daemonChannel = await fixture.channelPromise;
    const deliveryState = await observePromiseState(receivedOne);
    const observed = {
      deliveryState,
      received,
      closeCallCount: close.mock.calls.length,
      channelOpen: daemonChannel.isOpen(),
    };
    if (daemonChannel.isOpen()) daemonChannel.close();

    expect(observed).toEqual({
      deliveryState: "fulfilled",
      received: ["after-confirm"],
      closeCallCount: 0,
      channelOpen: true,
    });
  });

  it("repeats the saved framed selection for the same hello while mode confirm is pending", async () => {
    // Physical close observer distinguishes retry handling from protocol failure.
    const close = vi.fn();
    // Real client offer used to establish the daemon's saved binary selection.
    const fixture = startDaemonFramedHandshake({
      ciphertextEncodings: ["base64", "binary"],
      close,
      holdReadySend: true,
    });
    await fixture.readySent;
    fixture.releaseReady();
    // Observe attach state after the daemon has installed its post-ready receive seam.
    const stateBeforeConfirm = await observePromiseState(fixture.channelPromise);

    // Same-key retry must resend the connection's already saved selection.
    const secondReadySent = fixture.waitForSentCount(2);
    fixture.transport.onmessage?.({ data: fixture.helloText, isBinary: false });
    await secondReadySent;
    // Both plaintext ready frames must carry the same exact selection.
    const readyFrames = fixture.sent.slice(0, 2).map((wire) => JSON.parse(wire as string));

    // Exact confirmation completes the pending selection after the retry.
    deliverLegacyEncryptedText(
      fixture,
      JSON.stringify({
        type: "e2ee_mode_confirm",
        mode: "framed-ciphertext-v1",
        ciphertextEncoding: "binary",
        compressionAlgorithms: [],
      }),
    );
    const daemonChannel = await fixture.channelPromise;
    const observed = {
      readyFrames,
      stateBeforeConfirm,
      channelOpenAfterConfirm: daemonChannel.isOpen(),
      closeCallCount: close.mock.calls.length,
    };
    if (daemonChannel.isOpen()) daemonChannel.close();

    expect(observed).toEqual({
      readyFrames: [
        {
          type: "e2ee_ready",
          capabilities: {
            binaryCiphertext: true,
            framedCiphertextV1: {
              ciphertextEncoding: "binary",
              compressionAlgorithms: [],
            },
          },
        },
        {
          type: "e2ee_ready",
          capabilities: {
            binaryCiphertext: true,
            framedCiphertextV1: {
              ciphertextEncoding: "binary",
              compressionAlgorithms: [],
            },
          },
        },
      ],
      stateBeforeConfirm: "pending",
      channelOpenAfterConfirm: true,
      closeCallCount: 0,
    });
  });

  it("replays a buffered same-key hello before attach while the first ready write is pending", async () => {
    // Held ready write keeps the retried hello in the daemon handshake backlog.
    const fixture = startDaemonFramedHandshake({
      ciphertextEncodings: ["binary"],
      holdReadySend: true,
    });
    await fixture.readySent;
    fixture.transport.onmessage?.({ data: fixture.helloText, isBinary: false });
    fixture.releaseReady();
    // Public attach state and transport writes after the backlog has had a full turn to drain.
    const stateBeforeConfirm = await observePromiseState(fixture.channelPromise);
    const readyFrames = fixture.sent.slice(0, 2).map((wire) => JSON.parse(wire as string));

    // Complete the intended pending selection so either implementation path is cleaned up.
    deliverLegacyEncryptedText(
      fixture,
      JSON.stringify({
        type: "e2ee_mode_confirm",
        mode: "framed-ciphertext-v1",
        ciphertextEncoding: "binary",
        compressionAlgorithms: [],
      }),
    );
    const daemonChannel = await fixture.channelPromise;
    if (daemonChannel.isOpen()) daemonChannel.close();

    const expectedReady = {
      type: "e2ee_ready",
      capabilities: {
        binaryCiphertext: true,
        framedCiphertextV1: {
          ciphertextEncoding: "binary",
          compressionAlgorithms: [],
        },
      },
    };
    expect({ stateBeforeConfirm, readyFrames }).toEqual({
      stateBeforeConfirm: "pending",
      readyFrames: [expectedReady, expectedReady],
    });
  });

  it("repeats the saved framed selection after attach without changing binary mode", async () => {
    // Binary-only offer fixes the selected representation for the connection lifetime.
    const fixture = startDaemonFramedHandshake({ ciphertextEncodings: ["binary"] });
    await fixture.readySent;
    // Exact confirmation moves the daemon through its public attach gate.
    deliverLegacyEncryptedText(
      fixture,
      JSON.stringify({
        type: "e2ee_mode_confirm",
        mode: "framed-ciphertext-v1",
        ciphertextEncoding: "binary",
        compressionAlgorithms: [],
      }),
    );
    const daemonChannel = await fixture.channelPromise;

    // Same-key retry after attach must echo the saved selection, not rebuild a legacy ready.
    const repeatedReadySent = fixture.waitForSentCount(2);
    fixture.transport.onmessage?.({ data: fixture.helloText, isBinary: false });
    await repeatedReadySent;
    // A following text payload must still use framed binary wire and the text envelope flag.
    const applicationPayload = "after-rehello";
    await daemonChannel.send(applicationPayload);
    const applicationWire = fixture.sent[2];
    const payloadBytes = Array.from(new TextEncoder().encode(applicationPayload));
    const observed = {
      readyFrames: fixture.sent.slice(0, 2).map((wire) => JSON.parse(wire as string)),
      channelOpen: daemonChannel.isOpen(),
      applicationWireIsBinary: applicationWire instanceof ArrayBuffer,
    };
    if (daemonChannel.isOpen()) daemonChannel.close();

    const expectedReady = {
      type: "e2ee_ready",
      capabilities: {
        binaryCiphertext: true,
        framedCiphertextV1: {
          ciphertextEncoding: "binary",
          compressionAlgorithms: [],
        },
      },
    };
    expect(observed).toEqual({
      readyFrames: [expectedReady, expectedReady],
      channelOpen: true,
      applicationWireIsBinary: true,
    });
    expect(new Uint8Array(decrypt(fixture.sharedKey, applicationWire as ArrayBuffer))).toEqual(
      new Uint8Array(buildIdentityEnvelope(false, payloadBytes)),
    );
  });

  it.each([
    {
      firstFrameKind: "ordinary application JSON",
      plaintext: JSON.stringify({ type: "application_before_confirm" }),
    },
    {
      firstFrameKind: "non-JSON application text",
      plaintext: "application-before-confirm",
    },
  ])(
    "closes without attaching when a pending daemon selection receives $firstFrameKind first",
    async ({ plaintext }) => {
      // Application messages that must remain empty before authenticated attach.
      const daemonMessages: (string | ArrayBuffer)[] = [];
      // Completion signal for either forbidden delivery or protocol closure.
      let resolveOutcome: ((outcome: "application" | "closed") => void) | null = null;
      // Promise capturing the first externally observable protocol decision.
      const outcome = new Promise<"application" | "closed">((resolve) => {
        resolveOutcome = resolve;
      });
      // Transport close boundary representing fail-closed behavior.
      const close = vi.fn(() => resolveOutcome?.("closed"));
      // Binary-only handshake carrying the invalid first encrypted frame.
      const fixture = startDaemonFramedHandshake({
        ciphertextEncodings: ["binary"],
        close,
        echoCloseEvent: true,
        holdReadySend: true,
        events: {
          onmessage: (data) => {
            daemonMessages.push(data);
            resolveOutcome?.("application");
          },
        },
      });
      // Channel reference retained only for cleanup if the broken implementation attaches.
      let resolvedChannel: Awaited<ReturnType<typeof createDaemonChannel>> | null = null;
      void fixture.channelPromise.then(
        (channel) => {
          resolvedChannel = channel;
          return undefined;
        },
        () => undefined,
      );
      await fixture.readySent;

      // Any legacy-encrypted application text is invalid before exact confirm.
      deliverLegacyEncryptedText(fixture, plaintext);
      fixture.releaseReady();
      const firstOutcome = await outcome;
      // Physical closure must not be followed by a late application attach.
      const channelPromiseState = await observePromiseState(fixture.channelPromise);
      const observed = {
        firstOutcome,
        daemonMessages,
        closeCallCount: close.mock.calls.length,
        channelPromiseState,
      };
      if (resolvedChannel?.isOpen()) resolvedChannel.close();

      expect(observed).toEqual({
        firstOutcome: "closed",
        daemonMessages: [],
        closeCallCount: 1,
        channelPromiseState: "rejected",
      });
    },
  );

  it("closes a pending daemon selection when exact confirm uses a binary WebSocket frame", async () => {
    // Completion signal for application attach or protocol closure, whichever occurs first.
    let resolveOutcome: ((outcome: "attached" | "closed") => void) | null = null;
    // Public outcome proves the wrong opcode cannot cross the pending attach gate.
    const outcome = new Promise<"attached" | "closed">((resolve) => {
      resolveOutcome = resolve;
    });
    // Physical close observer for the confirm opcode violation.
    const close = vi.fn(() => resolveOutcome?.("closed"));
    // Binary-only framed offer whose confirm must still use legacy Base64 text.
    const fixture = startDaemonFramedHandshake({
      ciphertextEncodings: ["binary"],
      close,
      echoCloseEvent: true,
      holdReadySend: true,
    });
    // Channel reference retained only for cleanup if the broken implementation attaches.
    let resolvedChannel: Awaited<ReturnType<typeof createDaemonChannel>> | null = null;
    void fixture.channelPromise.then(
      (channel) => {
        resolvedChannel = channel;
        resolveOutcome?.("attached");
        return undefined;
      },
      () => undefined,
    );
    await fixture.readySent;

    // Exact confirm bytes are unchanged; only their WebSocket opcode is deliberately wrong.
    const confirmText = JSON.stringify({
      type: "e2ee_mode_confirm",
      mode: "framed-ciphertext-v1",
      ciphertextEncoding: "binary",
      compressionAlgorithms: [],
    });
    // Legacy Base64 confirmation represented as bytes in a binary WebSocket frame.
    const confirmWire = arrayBufferToBase64(encrypt(fixture.sharedKey, confirmText));
    fixture.transport.onmessage?.({
      data: new TextEncoder().encode(confirmWire).buffer,
      isBinary: true,
    });
    fixture.releaseReady();
    const firstOutcome = await outcome;
    // Protocol close must occur without ever fulfilling the daemon attach promise.
    const channelPromiseState = await observePromiseState(fixture.channelPromise);
    const observed = {
      firstOutcome,
      closeCallCount: close.mock.calls.length,
      channelAttached: resolvedChannel !== null,
      channelPromiseState,
    };
    if (resolvedChannel?.isOpen()) resolvedChannel.close();

    expect(observed).toEqual({
      firstOutcome: "closed",
      closeCallCount: 1,
      channelAttached: false,
      channelPromiseState: "rejected",
    });
  });

  it.each([
    {
      mismatch: "mode differs from ready",
      confirm: {
        type: "e2ee_mode_confirm",
        mode: "legacy",
        ciphertextEncoding: "binary",
        compressionAlgorithms: [],
      },
    },
    {
      mismatch: "ciphertext encoding differs from ready",
      confirm: {
        type: "e2ee_mode_confirm",
        mode: "framed-ciphertext-v1",
        ciphertextEncoding: "base64",
        compressionAlgorithms: [],
      },
    },
    {
      mismatch: "codec list differs",
      confirm: {
        type: "e2ee_mode_confirm",
        mode: "framed-ciphertext-v1",
        ciphertextEncoding: "binary",
        compressionAlgorithms: ["deflate-raw"],
      },
    },
    {
      mismatch: "omits compression algorithms",
      confirm: {
        type: "e2ee_mode_confirm",
        mode: "framed-ciphertext-v1",
        ciphertextEncoding: "binary",
      },
    },
  ])("closes a pending daemon selection when confirm $mismatch", async ({ confirm }) => {
    // Application messages that must remain empty for a mismatched confirm.
    const daemonMessages: (string | ArrayBuffer)[] = [];
    // Completion signal for application attach or protocol closure, whichever occurs first.
    let resolveOutcome: ((outcome: "attached" | "closed") => void) | null = null;
    // Promise capturing whether authentication gates application attach.
    const outcome = new Promise<"attached" | "closed">((resolve) => {
      resolveOutcome = resolve;
    });
    // Transport close boundary representing selection mismatch rejection.
    const close = vi.fn(() => resolveOutcome?.("closed"));
    // Binary-only handshake carrying the authenticated mismatch.
    const fixture = startDaemonFramedHandshake({
      ciphertextEncodings: ["binary"],
      close,
      echoCloseEvent: true,
      holdReadySend: true,
      events: { onmessage: (data) => daemonMessages.push(data) },
    });
    // Channel reference retained only for cleanup if the broken implementation attaches.
    let resolvedChannel: Awaited<ReturnType<typeof createDaemonChannel>> | null = null;
    void fixture.channelPromise.then(
      (channel) => {
        resolvedChannel = channel;
        resolveOutcome?.("attached");
        return undefined;
      },
      () => undefined,
    );
    await fixture.readySent;

    // Authenticated confirm deliberately disagrees with the saved binary selection.
    deliverLegacyEncryptedText(fixture, JSON.stringify(confirm));
    fixture.releaseReady();
    const firstOutcome = await outcome;
    // A mismatched authenticated confirm must never fulfill the daemon attach promise.
    const channelPromiseState = await observePromiseState(fixture.channelPromise);
    const observed = {
      firstOutcome,
      daemonMessages,
      closeCallCount: close.mock.calls.length,
      channelAttached: resolvedChannel !== null,
      channelPromiseState,
    };
    if (resolvedChannel?.isOpen()) resolvedChannel.close();

    expect(observed).toEqual({
      firstOutcome: "closed",
      daemonMessages: [],
      closeCallCount: 1,
      channelAttached: false,
      channelPromiseState: "rejected",
    });
  });

  it("sends identity text as framed binary with the exact authenticated v1 envelope", async () => {
    // Daemon identity used to derive the same channel key as the client.
    const daemonKeyPair = generateKeyPair();
    // Open signal completed after the framed selection and mode confirm.
    let resolveOpen: (() => void) | null = null;
    // Client open promise for the negotiated framed mode.
    const opened = new Promise<void>((resolve) => {
      resolveOpen = resolve;
    });
    // Capturing transport seam for handshake and encrypted application frames.
    const transport: Transport = {
      send: vi.fn(),
      close: vi.fn(),
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    // Client channel under test.
    const channel = await createClientChannel(transport, exportPublicKey(daemonKeyPair.publicKey), {
      onopen: () => resolveOpen?.(),
    });
    // Client hello supplies the ephemeral key needed for independent decryption.
    const hello = JSON.parse(
      (transport.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string,
    ) as { key: string };
    // Shared key independently derived from the two public handshake inputs.
    const sharedKey = deriveSharedKey(daemonKeyPair.secretKey, importPublicKey(hello.key));

    transport.onmessage?.({
      data: JSON.stringify({
        type: "e2ee_ready",
        capabilities: {
          binaryCiphertext: true,
          framedCiphertextV1: {
            ciphertextEncoding: "binary",
            compressionAlgorithms: [],
          },
        },
      }),
      isBinary: false,
    });
    await opened;
    (transport.send as ReturnType<typeof vi.fn>).mockClear();

    await channel.send("hi");
    channel.close();

    // Single application wire frame emitted after clearing hello and confirm traffic.
    const wire = (transport.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(wire).toBeInstanceOf(ArrayBuffer);

    // Authenticated plaintext must match the independent v1 header vector exactly.
    const authenticatedPlaintext = new Uint8Array(decrypt(sharedKey, wire as ArrayBuffer));
    expect(authenticatedPlaintext).toEqual(
      new Uint8Array([0x50, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x68, 0x69]),
    );
  });

  it("sends an original binary payload as framed Base64 with the authenticated binary flag", async () => {
    // Open Base64 channel observed only through its public transport seam.
    const fixture = await openClientFramedChannel({ ciphertextEncoding: "base64" });
    fixture.sent.length = 0;

    // ASCII-looking bytes must retain their original binary type.
    const binaryPayload = new Uint8Array([0x62, 0x69, 0x6e]).buffer;
    await fixture.channel.send(binaryPayload);
    fixture.channel.close();

    // Framed Base64 always uses a text WebSocket representation.
    const wire = fixture.sent[0];
    expect(typeof wire).toBe("string");
    // Independent vector fixes magic, version, binary flag, identity codec, length, and bytes.
    const authenticatedPlaintext = new Uint8Array(
      decrypt(fixture.sharedKey, base64ToArrayBuffer(wire as string)),
    );
    expect(authenticatedPlaintext).toEqual(
      new Uint8Array([0x50, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x03, 0x62, 0x69, 0x6e]),
    );
  });

  it("restores framed binary identity text to the original application payload", async () => {
    // Daemon identity used to derive an independently encrypted inbound frame.
    const daemonKeyPair = generateKeyPair();
    // Application messages exposed by the encrypted channel.
    const received: (string | ArrayBuffer)[] = [];
    // Completion signal for the first application message.
    let resolveReceived: (() => void) | null = null;
    // Promise completed through the public onmessage event.
    const receivedOne = new Promise<void>((resolve) => {
      resolveReceived = resolve;
    });
    // Completion signal for the framed client handshake.
    let resolveOpen: (() => void) | null = null;
    // Promise completed after the mode confirm is sent.
    const opened = new Promise<void>((resolve) => {
      resolveOpen = resolve;
    });
    // Capturing transport for hello, confirm, and synthetic inbound ciphertext.
    const transport: Transport = {
      send: vi.fn(),
      close: vi.fn(),
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    // Framed client observed only through channel events.
    const channel = await createClientChannel(transport, exportPublicKey(daemonKeyPair.publicKey), {
      onopen: () => resolveOpen?.(),
      onmessage: (data) => {
        received.push(data);
        resolveReceived?.();
      },
    });
    // Client hello carrying the ephemeral key for independent daemon encryption.
    const hello = JSON.parse(
      (transport.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string,
    ) as { key: string };
    // Shared key independently derived on the synthetic daemon side.
    const sharedKey = deriveSharedKey(daemonKeyPair.secretKey, importPublicKey(hello.key));

    deliverFramedBinaryReady(transport);
    await opened;

    // Exact authenticated identity envelope for the original text "ok".
    const envelope = new Uint8Array([0x50, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x6f, 0x6b]);
    transport.onmessage?.({ data: encrypt(sharedKey, envelope.buffer), isBinary: true });
    await receivedOne;
    channel.close();

    expect(received).toHaveLength(1);
    expect(typeof received[0]).toBe("string");
    expect(received[0]).toBe("ok");
  });

  it("restores a framed Base64 original binary payload as ArrayBuffer", async () => {
    // Daemon identity used to derive an independently encrypted inbound frame.
    const daemonKeyPair = generateKeyPair();
    // Application messages exposed by the encrypted channel.
    const received: (string | ArrayBuffer)[] = [];
    // Completion signal for the first application message.
    let resolveReceived: (() => void) | null = null;
    // Promise completed through the public onmessage event.
    const receivedOne = new Promise<void>((resolve) => {
      resolveReceived = resolve;
    });
    // Completion signal for the framed Base64 client handshake.
    let resolveOpen: (() => void) | null = null;
    // Promise completed after the mode confirm is sent.
    const opened = new Promise<void>((resolve) => {
      resolveOpen = resolve;
    });
    // Capturing transport for hello, confirm, and synthetic inbound ciphertext.
    const transport: Transport = {
      send: vi.fn(),
      close: vi.fn(),
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    // Framed client observed only through channel events.
    const channel = await createClientChannel(transport, exportPublicKey(daemonKeyPair.publicKey), {
      onopen: () => resolveOpen?.(),
      onmessage: (data) => {
        received.push(data);
        resolveReceived?.();
      },
    });
    // Client hello carrying the ephemeral key for independent daemon encryption.
    const hello = JSON.parse(
      (transport.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string,
    ) as { key: string };
    // Shared key independently derived on the synthetic daemon side.
    const sharedKey = deriveSharedKey(daemonKeyPair.secretKey, importPublicKey(hello.key));

    deliverFramedBase64Ready(transport);
    await opened;

    // Exact identity envelope whose ASCII payload remains explicitly binary.
    const envelope = new Uint8Array([
      0x50, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x03, 0x62, 0x69, 0x6e,
    ]);
    const wire = arrayBufferToBase64(encrypt(sharedKey, envelope.buffer));
    transport.onmessage?.({ data: wire, isBinary: false });
    await receivedOne;
    channel.close();

    expect(received).toHaveLength(1);
    expect(received[0]).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(received[0] as ArrayBuffer)).toEqual(new Uint8Array([0x62, 0x69, 0x6e]));
  });

  it("closes without opening when the legacy Base64 mode confirm write fails", async () => {
    // Daemon identity transferred to the client through the pairing channel.
    const daemonKeyPair = generateKeyPair();
    // All attempted hello and confirm writes at the public transport seam.
    const sent: (string | ArrayBuffer)[] = [];
    // Completion signal for physical closure or an incorrect open transition.
    let resolveOutcome: ((outcome: "closed" | "opened") => void) | null = null;
    const outcome = new Promise<"closed" | "opened">((resolve) => {
      resolveOutcome = resolve;
    });
    // Captured protocol failure reported through the channel event interface.
    const errors: string[] = [];
    const close = vi.fn(() => resolveOutcome?.("closed"));
    // Transport accepts hello but rejects the selected mode confirmation.
    const transport: Transport = {
      send: (data) => {
        sent.push(data);
        if (sent.length === 2) return Promise.reject(new Error("confirm write failed"));
      },
      close,
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    const channel = await createClientChannel(transport, exportPublicKey(daemonKeyPair.publicKey), {
      onopen: () => resolveOutcome?.("opened"),
      onerror: (error) => errors.push(error.message),
    });

    deliverFramedBinaryReady(transport);
    const firstOutcome = await outcome;
    const observed = {
      firstOutcome,
      sentCount: sent.length,
      errors,
      closeCalls: close.mock.calls,
      channelOpen: channel.isOpen(),
    };
    if (channel.isOpen()) channel.close();

    expect(observed).toEqual({
      firstOutcome: "closed",
      sentCount: 2,
      errors: ["confirm write failed"],
      closeCalls: [[1011, "confirm write failed"]],
      channelOpen: false,
    });
  });

  it.each([
    {
      ciphertextEncoding: "binary" as const,
      payloadKind: "binary",
      payload: new Uint8Array([0x00, 0xff, 0x62]).buffer,
      payloadBytes: [0x00, 0xff, 0x62],
      binary: true,
    },
    {
      ciphertextEncoding: "base64" as const,
      payloadKind: "text",
      payload: "ok",
      payloadBytes: [0x6f, 0x6b],
      binary: false,
    },
  ])(
    "sends original $payloadKind payload as framed $ciphertextEncoding with an exact identity envelope",
    async ({ ciphertextEncoding, payload, payloadBytes, binary }) => {
      // Open channel observed only through the public transport fixture.
      const fixture = await openClientFramedChannel({ ciphertextEncoding });
      fixture.sent.length = 0;

      await fixture.channel.send(payload);

      // Wire representation is fixed by the negotiated selection, independent of payload type.
      expect(fixture.sent).toHaveLength(1);
      const wire = fixture.sent[0];
      const wireEncoding = wire instanceof ArrayBuffer ? "binary" : "base64";
      expect(wireEncoding).toBe(ciphertextEncoding);
      const ciphertext =
        ciphertextEncoding === "binary"
          ? (wire as ArrayBuffer)
          : base64ToArrayBuffer(wire as string);
      expect(new Uint8Array(decrypt(fixture.sharedKey, ciphertext))).toEqual(
        new Uint8Array(buildIdentityEnvelope(binary, payloadBytes)),
      );
      fixture.channel.close();
    },
  );

  it.each([
    {
      ciphertextEncoding: "binary" as const,
      payloadKind: "binary",
      payload: new Uint8Array([0x00, 0xff, 0x62]),
      binary: true,
      expectedPayload: { kind: "binary", value: [0x00, 0xff, 0x62] },
    },
    {
      ciphertextEncoding: "base64" as const,
      payloadKind: "text",
      payload: "ok",
      binary: false,
      expectedPayload: { kind: "text", value: "ok" },
    },
  ])(
    "restores original $payloadKind payload from framed $ciphertextEncoding ciphertext",
    async ({ ciphertextEncoding, payload, binary, expectedPayload }) => {
      // Application values observed at the public receive callback.
      const received: (string | ArrayBuffer)[] = [];
      // Completion signal for the first application callback.
      let resolveReceived: (() => void) | null = null;
      // Promise completed only through the public onmessage event.
      const receivedOne = new Promise<void>((resolve) => {
        resolveReceived = resolve;
      });
      // Open channel with the selected representation and public receive seam.
      const fixture = await openClientFramedChannel({
        ciphertextEncoding,
        events: {
          onmessage: (data) => {
            received.push(data);
            resolveReceived?.();
          },
        },
      });
      // Independently encrypted v1 envelope carrying the original type flag.
      const payloadBytes =
        typeof payload === "string"
          ? Array.from(new TextEncoder().encode(payload))
          : Array.from(new Uint8Array(payload));
      const encrypted = encrypt(fixture.sharedKey, buildIdentityEnvelope(binary, payloadBytes));
      const wire = ciphertextEncoding === "binary" ? encrypted : arrayBufferToBase64(encrypted);
      fixture.transport.onmessage?.({
        data: wire,
        isBinary: ciphertextEncoding === "binary",
      });
      await receivedOne;

      expect(received).toHaveLength(1);
      // Normalize the public union only after preserving its observable original type.
      const receivedPayload =
        typeof received[0] === "string"
          ? { kind: "text", value: received[0] }
          : { kind: "binary", value: Array.from(new Uint8Array(received[0] as ArrayBuffer)) };
      expect(receivedPayload).toEqual(expectedPayload);
      fixture.channel.close();
    },
  );

  it.each([
    { selectedEncoding: "base64" as const, wrongOpcode: "binary" },
    { selectedEncoding: "binary" as const, wrongOpcode: "text" },
  ])(
    "closes a framed $selectedEncoding channel when ciphertext uses a $wrongOpcode WebSocket frame",
    async ({ selectedEncoding }) => {
      // Application messages that must remain empty after an opcode violation.
      const received: (string | ArrayBuffer)[] = [];
      // Completion signal for forbidden delivery or protocol closure.
      let resolveOutcome: ((outcome: "application" | "closed") => void) | null = null;
      // Promise capturing the first public decision for the wrong opcode.
      const outcome = new Promise<"application" | "closed">((resolve) => {
        resolveOutcome = resolve;
      });
      // Captured physical close operation for protocol failure.
      const close = vi.fn(() => resolveOutcome?.("closed"));
      // Open framed channel observed only through public events and transport.
      const fixture = await openClientFramedChannel({
        ciphertextEncoding: selectedEncoding,
        close,
        events: {
          onmessage: (data) => {
            received.push(data);
            resolveOutcome?.("application");
          },
        },
      });

      // Valid text envelope represented with the opposite WebSocket opcode.
      const envelope = new Uint8Array([0x50, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x6f, 0x6b]);
      const ciphertext = encrypt(fixture.sharedKey, envelope.buffer);
      const base64Ciphertext = arrayBufferToBase64(ciphertext);
      const wrongOpcodeFrame =
        selectedEncoding === "base64"
          ? { data: new TextEncoder().encode(base64Ciphertext).buffer, isBinary: true }
          : { data: base64Ciphertext, isBinary: false };
      fixture.transport.onmessage?.(wrongOpcodeFrame);
      const firstOutcome = await outcome;
      const observed = {
        firstOutcome,
        received,
        closeCallCount: close.mock.calls.length,
        channelOpen: fixture.channel.isOpen(),
      };
      if (fixture.channel.isOpen()) fixture.channel.close();

      expect(observed).toEqual({
        firstOutcome: "closed",
        received: [],
        closeCallCount: 1,
        channelOpen: false,
      });
    },
  );

  it("closes framed Base64 traffic before decryption when its wire is non-canonical", async () => {
    // Completion signal for the asynchronous framed receive decision.
    let resolveClosed: (() => void) | null = null;
    // Promise completed only through the public transport close boundary.
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    // Physical close observation exposing the framed parser's protocol reason.
    const close = vi.fn(() => resolveClosed?.());
    // Open client locked to strict framed Base64 receive semantics.
    const fixture = await openClientFramedChannel({ ciphertextEncoding: "base64", close });

    fixture.transport.onmessage?.({ data: "AQ", isBinary: false });
    await closed;

    expect(close).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledWith(1011, "Framed ciphertext requires canonical padded Base64");
    expect(fixture.channel.isOpen()).toBe(false);
  });

  it("forwards ordinary application JSON as the exact original string", async () => {
    // Daemon identity used to derive an independently encrypted application frame.
    const daemonKeyPair = generateKeyPair();
    // Completion signal for the legacy client handshake.
    let resolveOpened: (() => void) | null = null;
    // Promise completed after the plaintext ready frame is accepted.
    const opened = new Promise<void>((resolve) => {
      resolveOpened = resolve;
    });
    // Exact application values exposed at the public channel seam.
    const receivedMessages: (string | ArrayBuffer)[] = [];
    // Completion signal for the application payload callback.
    let resolveReceived: (() => void) | null = null;
    // Promise completed after the opaque payload crosses the channel seam.
    const received = new Promise<void>((resolve) => {
      resolveReceived = resolve;
    });
    // Capturing transport used for the public hello and synthetic inbound ciphertext.
    const transport: Transport = {
      send: vi.fn(),
      close: vi.fn(),
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    // Client channel whose application callback is the observed public boundary.
    const channel = await createClientChannel(transport, exportPublicKey(daemonKeyPair.publicKey), {
      onopen: () => resolveOpened?.(),
      onmessage: (data) => {
        receivedMessages.push(data);
        resolveReceived?.();
      },
    });
    // Client hello carrying the ephemeral key for independent encryption.
    const hello = JSON.parse(
      (transport.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string,
    ) as { key: string };
    // Shared key independently derived before observing application parsing.
    const sharedKey = deriveSharedKey(daemonKeyPair.secretKey, importPublicKey(hello.key));

    transport.onmessage?.({ data: JSON.stringify({ type: "e2ee_ready" }), isBinary: false });
    await opened;

    // Ordinary business JSON that must remain opaque to the encrypted transport.
    const applicationPayload = '{ "type": "application_payload", "value": 1 }';
    transport.onmessage?.({
      data: arrayBufferToBase64(encrypt(sharedKey, applicationPayload)),
      isBinary: false,
    });
    await received;
    channel.close();

    expect(receivedMessages).toEqual([applicationPayload]);
  });

  it("sends application messages queued during the framed handshake before messages created by onopen", async () => {
    // Daemon identity used to decrypt the observed application wire order.
    const daemonKeyPair = generateKeyPair();
    // All plaintext handshake and encrypted application transport writes.
    const sent: (string | ArrayBuffer)[] = [];
    // Completion signal after hello, confirm, and two application frames.
    let resolveFourSends: (() => void) | null = null;
    // Promise completed when both application frames are observable on the wire.
    const fourSends = new Promise<void>((resolve) => {
      resolveFourSends = resolve;
    });
    // Transport that records the exact write order without adding timing behavior.
    const transport: Transport = {
      send: (data) => {
        sent.push(data);
        if (sent.length === 4) resolveFourSends?.();
      },
      close: vi.fn(),
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    // Client reference used by the public onopen callback.
    let channel: Awaited<ReturnType<typeof createClientChannel>> | null = null;
    channel = await createClientChannel(transport, exportPublicKey(daemonKeyPair.publicKey), {
      onopen: () => {
        void channel?.send("from-onopen");
      },
    });
    // Client hello carrying the ephemeral key for independent wire decryption.
    const hello = JSON.parse(sent[0] as string) as { key: string };
    // Shared key independently derived from the public handshake values.
    const sharedKey = deriveSharedKey(daemonKeyPair.secretKey, importPublicKey(hello.key));

    await channel.send("pending-before-ready");
    deliverFramedBinaryReady(transport);
    await fourSends;
    channel.close();

    // Application payload order decoded independently after the fixed v1 header.
    const applicationPayloads = sent.slice(2).map((wire) => {
      const authenticatedPlaintext = new Uint8Array(decrypt(sharedKey, wire as ArrayBuffer));
      return new TextDecoder().decode(authenticatedPlaintext.slice(8));
    });
    expect(applicationPayloads).toEqual(["pending-before-ready", "from-onopen"]);
  });

  it("delivers legacy application frames that arrive while the handshake backlog is flushing", async () => {
    // Daemon identity used to derive the synthetic legacy inbound ciphertext.
    const daemonKeyPair = generateKeyPair();
    // Application payloads observed through the public channel callback.
    const received: (string | ArrayBuffer)[] = [];
    // Completion signal for the inbound application frame.
    let resolveReceived: (() => void) | null = null;
    // Promise completed only through the public receive callback.
    const receivedOne = new Promise<void>((resolve) => {
      resolveReceived = resolve;
    });
    // Deferred completion that holds the queued application write in progress.
    let completeBacklogSend: (() => void) | undefined;
    // Signal emitted when backlog flushing reaches the transport boundary.
    let resolveBacklogStarted: (() => void) | null = null;
    // Promise proving that the channel is inside its opening transition.
    const backlogStarted = new Promise<void>((resolve) => {
      resolveBacklogStarted = resolve;
    });
    // Signal emitted once the client exposes the channel as open.
    let resolveOpened: (() => void) | null = null;
    // Promise completed after the deferred backlog write is released.
    const opened = new Promise<void>((resolve) => {
      resolveOpened = resolve;
    });
    // Exact transport writes used to recover the public client hello.
    const sent: (string | ArrayBuffer)[] = [];
    // Number of transport writes, including the initial plaintext hello.
    let sendCount = 0;
    // Transport that blocks only the first queued application ciphertext.
    const transport: Transport = {
      send: (data) => {
        sent.push(data);
        sendCount += 1;
        if (sendCount !== 2) return;
        return new Promise<void>((resolve) => {
          completeBacklogSend = resolve;
          resolveBacklogStarted?.();
        });
      },
      close: vi.fn(),
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    // Client channel observed only through its public events.
    const channel = await createClientChannel(transport, exportPublicKey(daemonKeyPair.publicKey), {
      onopen: () => resolveOpened?.(),
      onmessage: (data) => {
        received.push(data);
        resolveReceived?.();
      },
    });
    // Client hello carrying the ephemeral key for independent encryption.
    const hello = JSON.parse(sent[0] as string) as { key: string };
    // Shared key independently derived before the synthetic daemon frame.
    const sharedKey = deriveSharedKey(daemonKeyPair.secretKey, importPublicKey(hello.key));

    await channel.send("queued-before-ready");
    transport.onmessage?.({ data: JSON.stringify({ type: "e2ee_ready" }), isBinary: false });
    await backlogStarted;

    // Valid legacy application ciphertext delivered before backlog completion.
    const inbound = arrayBufferToBase64(encrypt(sharedKey, "from-daemon-during-opening"));
    transport.onmessage?.({ data: inbound, isBinary: false });

    completeBacklogSend?.();
    await opened;
    // Allow receive work ordered behind the released backlog write to settle publicly.
    const deliveryState = await observePromiseState(receivedOne);
    channel.close();

    expect({ deliveryState, received }).toEqual({
      deliveryState: "fulfilled",
      received: ["from-daemon-during-opening"],
    });
  });

  it("confirms repeated framed ready only once while mode confirmation is pending", async () => {
    // Daemon identity required to create the client channel.
    const daemonKeyPair = generateKeyPair();
    // All hello and confirm transport frames emitted by the client.
    const sent: (string | ArrayBuffer)[] = [];
    // Deferred confirm completions used to hold the channel in its transition state.
    const completeConfirms: Array<() => void> = [];
    // Completion signal for the first in-flight mode confirm.
    let resolveFirstConfirm: (() => void) | null = null;
    // Promise completed when the first ready reaches transport send.
    const firstConfirmStarted = new Promise<void>((resolve) => {
      resolveFirstConfirm = resolve;
    });
    // Number of public open events emitted by the client.
    let openCount = 0;
    // Completion signal for the first public open event.
    let resolveOpened: (() => void) | null = null;
    // Promise completed after confirmation is allowed to finish.
    const opened = new Promise<void>((resolve) => {
      resolveOpened = resolve;
    });
    // Transport whose encrypted confirm writes complete only when released by the test.
    const transport: Transport = {
      send: (data) => {
        sent.push(data);
        if (sent.length === 1) return;
        return new Promise<void>((resolve) => {
          completeConfirms.push(resolve);
          if (completeConfirms.length === 1) resolveFirstConfirm?.();
        });
      },
      close: vi.fn(),
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    // Client channel whose transition remains pending during duplicate ready delivery.
    const channel = await createClientChannel(transport, exportPublicKey(daemonKeyPair.publicKey), {
      onopen: () => {
        openCount += 1;
        resolveOpened?.();
      },
    });

    deliverFramedBinaryReady(transport);
    await firstConfirmStarted;
    deliverFramedBinaryReady(transport);
    // Observable transition state while the first confirmation write remains unresolved.
    const whileConfirmationPending = {
      confirmFrameCount: sent.length - 1,
      openCount,
    };
    for (const complete of completeConfirms) complete();
    await opened;

    // Observable idempotency result after both ready frames have completed.
    const observed = {
      confirmFrameCount: sent.length - 1,
      openCount,
    };
    channel.close();

    expect(whileConfirmationPending).toEqual({ confirmFrameCount: 1, openCount: 0 });
    expect(observed).toEqual({ confirmFrameCount: 1, openCount: 1 });
  });

  it.each([{ ciphertextEncoding: "base64" as const }, { ciphertextEncoding: "binary" as const }])(
    "sends the exact framed $ciphertextEncoding mode confirm as legacy Base64 ciphertext",
    async ({ ciphertextEncoding }) => {
      // Open framed client whose first two writes are hello and mode confirm.
      const fixture = await openClientFramedChannel({ ciphertextEncoding });
      expect(fixture.sent).toHaveLength(2);

      // Confirmation remains legacy Base64 ciphertext and never uses the framed envelope.
      const confirmWire = fixture.sent[1];
      expect(typeof confirmWire).toBe("string");
      const confirm = JSON.parse(
        new TextDecoder().decode(
          decrypt(fixture.sharedKey, base64ToArrayBuffer(confirmWire as string)),
        ),
      );
      expect(confirm).toEqual({
        type: "e2ee_mode_confirm",
        mode: "framed-ciphertext-v1",
        ciphertextEncoding,
        compressionAlgorithms: [],
      });
      fixture.channel.close();
    },
  );

  it("closes an attached framed Base64 daemon channel when legacy mode confirm is replayed", async () => {
    // Application callbacks must never receive the replayed transport-reserved message.
    const daemonMessages: (string | ArrayBuffer)[] = [];
    // Public protocol-close signal after the attached connection receives a replay.
    let resolveClosed: (() => void) | null = null;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const close = vi.fn(() => resolveClosed?.());
    // Base64 selection ensures the replay uses the expected opcode but lacks the framed envelope.
    const fixture = startDaemonFramedHandshake({
      ciphertextEncodings: ["base64"],
      close,
      events: { onmessage: (data) => daemonMessages.push(data) },
    });
    await fixture.readySent;
    const confirmText = JSON.stringify({
      type: "e2ee_mode_confirm",
      mode: "framed-ciphertext-v1",
      ciphertextEncoding: "base64",
      compressionAlgorithms: [],
    });
    // First exact confirm authenticates and attaches the selected connection.
    deliverLegacyEncryptedText(fixture, confirmText);
    const daemonChannel = await fixture.channelPromise;
    // The same legacy ciphertext shape is forbidden after framed mode is locked.
    deliverLegacyEncryptedText(fixture, confirmText);
    await closed;
    const observed = {
      ready: JSON.parse(fixture.sent[0] as string),
      daemonMessages,
      closeCallCount: close.mock.calls.length,
      channelOpen: daemonChannel.isOpen(),
    };
    if (daemonChannel.isOpen()) daemonChannel.close();

    expect(observed).toEqual({
      ready: {
        type: "e2ee_ready",
        capabilities: {
          framedCiphertextV1: {
            ciphertextEncoding: "base64",
            compressionAlgorithms: [],
          },
        },
      },
      daemonMessages: [],
      closeCallCount: 1,
      channelOpen: false,
    });
  });

  it("marks an open legacy daemon channel closed when reserved mode confirm is replayed", async () => {
    // Independent daemon and legacy client identities for the reserved-message replay.
    const daemonKeyPair = generateKeyPair();
    const clientKeyPair = generateKeyPair();
    // Shared key used to construct the authenticated transport-reserved frame.
    const sharedKey = deriveSharedKey(clientKeyPair.secretKey, daemonKeyPair.publicKey);
    // Application messages observed by a daemon with no pending framed selection.
    const daemonMessages: (string | ArrayBuffer)[] = [];
    // Completion signal for either forbidden delivery or protocol closure.
    let resolveDaemonOutcome: ((outcome: "application" | "closed") => void) | null = null;
    // Promise ensuring the assertion observes the daemon's complete decision.
    const daemonOutcome = new Promise<"application" | "closed">((resolve) => {
      resolveDaemonOutcome = resolve;
    });
    // Captured physical close operation for the reserved-message protocol result.
    const daemonClose = vi.fn(() => resolveDaemonOutcome?.("closed"));
    // Daemon transport established without a framed capability offer.
    const daemonTransport: Transport = {
      send: vi.fn(),
      close: daemonClose,
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    // Public daemon channel that must reserve confirm messages in every state.
    const daemonChannelPromise = createDaemonChannel(daemonTransport, daemonKeyPair, {
      onmessage: (data) => {
        daemonMessages.push(data);
        resolveDaemonOutcome?.("application");
      },
    });
    daemonTransport.onmessage?.({
      data: JSON.stringify({
        type: "e2ee_hello",
        key: exportPublicKey(clientKeyPair.publicKey),
      }),
      isBinary: false,
    });
    // Open legacy channel has no pending selection by construction.
    const daemonChannel = await daemonChannelPromise;
    // Exact confirm is validly authenticated but forbidden outside a pending selection.
    const confirmWire = arrayBufferToBase64(
      encrypt(
        sharedKey,
        JSON.stringify({
          type: "e2ee_mode_confirm",
          mode: "framed-ciphertext-v1",
          ciphertextEncoding: "binary",
          compressionAlgorithms: [],
        }),
      ),
    );
    daemonTransport.onmessage?.({ data: confirmWire, isBinary: false });
    // First observable result distinguishes protocol closure from application leakage.
    const outcome = await daemonOutcome;
    // Snapshot captured before cleanup can add a normal close call.
    const observed = {
      outcome,
      daemonMessages,
      closeCallCount: daemonClose.mock.calls.length,
      channelOpen: daemonChannel.isOpen(),
    };
    if (daemonChannel.isOpen()) daemonChannel.close();

    expect(observed).toEqual({
      outcome: "closed",
      daemonMessages: [],
      closeCallCount: 1,
      channelOpen: false,
    });
  });
});
