import { createHash } from "node:crypto";

import { describe, it, expect } from "vitest";
import { WebSocket } from "ws";
import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  deriveSharedKey,
  encrypt,
  decrypt,
} from "./crypto.js";
import { MAX_FRAMED_WIRE_BYTES } from "./framed-ciphertext.js";

// This live test uses the hosted relay's real TLS endpoint. Self-hosted relay TLS
// opt-in is covered at URL-building/integration level so the local E2E does not
// need to provision trusted certificates.
const RELAY_BASE_URL = process.env.PASEO_LIVE_RELAY_URL ?? "wss://relay.paseo.sh";
/** Largest binary framed wire accepted by the exclusive 32 MiB production cap. */
const NEAR_LIMIT_BINARY_WIRE_BYTES = MAX_FRAMED_WIRE_BYTES - 1;
/** Largest canonical Base64 wire aligned to four bytes below the exclusive cap. */
const NEAR_LIMIT_BASE64_WIRE_BYTES = MAX_FRAMED_WIRE_BYTES - 4;
/** Source bytes whose unpadded Base64 representation exactly reaches the text target. */
const NEAR_LIMIT_BASE64_SOURCE_BYTES = (NEAR_LIMIT_BASE64_WIRE_BYTES / 4) * 3;
/** Per-frame timeout allowing a near-limit payload to cross a remote hosted relay. */
const NEAR_LIMIT_FRAME_TIMEOUT_MS = 120_000;

/** Retries one live hosted-relay operation without hiding its final error. */
async function withRetry<T>(
  fn: () => Promise<T>,
  options: { retries: number; delayMs: number },
): Promise<T> {
  async function attempt(attemptNumber: number, lastError: unknown): Promise<T> {
    if (attemptNumber > options.retries) {
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }
    try {
      return await fn();
    } catch (error) {
      if (attemptNumber < options.retries) {
        await new Promise((r) => setTimeout(r, options.delayMs));
      }
      return attempt(attemptNumber + 1, error);
    }
  }
  return attempt(0, null);
}

/** Waits for one WebSocket to open or fail within the live-test deadline. */
function waitOpen(ws: WebSocket, label: string): Promise<void> {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    /** Removes all single-use listeners after one terminal outcome. */
    const cleanup = () => {
      clearTimeout(timeout);
      ws.off("open", onOpen);
      ws.off("error", onError);
      ws.off("close", onClose);
    };
    /** Open deadline for the remote TLS/WebSocket handshake. */
    const timeout = setTimeout(() => {
      cleanup();
      rejectPromise(new Error(`Timed out opening ${label} websocket`));
    }, 10_000);
    /** Successful WebSocket open observer. */
    const onOpen = () => {
      cleanup();
      resolvePromise();
    };
    /** Failed WebSocket open observer. */
    const onError = (err: Error) => {
      cleanup();
      rejectPromise(err);
    };
    /** Early close observer preserving the failing socket label. */
    const onClose = (code: number, reason: Buffer) => {
      cleanup();
      rejectPromise(
        new Error(
          `${label} websocket closed before open: code=${code} reason=${reason.toString("utf8")}`,
        ),
      );
    };
    ws.once("open", onOpen);
    ws.once("error", onError);
    ws.once("close", onClose);
  });
}

/** Waits for the v2 server control socket to announce a specific client connection. */
function waitForConnected(ws: WebSocket, connectionId: string): Promise<void> {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    /** Removes all control-socket observers after one terminal outcome. */
    const cleanup = () => {
      clearTimeout(timeout);
      ws.off("message", onMessage);
      ws.off("error", onError);
      ws.off("close", onClose);
    };
    /** Connection-announcement deadline. */
    const timeout = setTimeout(() => {
      cleanup();
      rejectPromise(new Error("Timed out waiting for connected"));
    }, 10_000);
    /** Validates one v2 control message against the expected connection ID. */
    const onMessage = (raw: WebSocket.RawData) => {
      try {
        /** Parsed untrusted hosted-relay control message. */
        const msg = JSON.parse(raw.toString());
        if (msg && msg.type === "connected" && msg.connectionId === connectionId) {
          cleanup();
          resolvePromise();
        }
      } catch {
        // ignore
      }
    };
    /** Control-socket error observer. */
    const onError = (error: Error) => {
      cleanup();
      rejectPromise(error);
    };
    /** Control-socket close observer. */
    const onClose = (code: number, reason: Buffer) => {
      cleanup();
      rejectPromise(
        new Error(
          `Server control websocket closed: code=${code} reason=${reason.toString("utf8")}`,
        ),
      );
    };
    ws.on("message", onMessage);
    ws.once("error", onError);
    ws.once("close", onClose);
  });
}

/** Waits for one small relay message and normalizes it to the requested legacy test shape. */
function waitForOnceMessage<T extends "string" | "buffer">(
  ws: WebSocket,
  mode: T,
  timeoutError: string,
): Promise<T extends "string" ? string : Buffer> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(timeoutError)), 10_000);
    const onMessage = (data: WebSocket.RawData) => {
      clearTimeout(timeout);
      resolve(
        (mode === "string" ? data.toString() : (data as Buffer)) as T extends "string"
          ? string
          : Buffer,
      );
    };
    ws.once("message", onMessage);
  });
}

/** One raw WebSocket frame observed after opaque hosted-relay forwarding. */
interface ObservedRelayFrame {
  /** Exact forwarded payload bytes. */
  data: Buffer;
  /** Forwarded WebSocket opcode classification. */
  isBinary: boolean;
}

/** Waits for one near-limit frame while preserving its opcode and exact bytes. */
function waitForOnceRelayFrame(options: {
  /** Socket expected to receive the opaque frame. */
  receiver: WebSocket;
  /** Socket sending the frame and potentially closed by ingress policy. */
  sender: WebSocket;
  /** Content-free representation label included in failures. */
  label: string;
}): Promise<ObservedRelayFrame> {
  return new Promise((resolvePromise, rejectPromise) => {
    /** Removes all frame/error/close observers after one terminal outcome. */
    const cleanup = () => {
      clearTimeout(timeout);
      options.receiver.off("message", onMessage);
      options.receiver.off("error", onReceiverError);
      options.receiver.off("close", onReceiverClose);
      options.sender.off("error", onSenderError);
      options.sender.off("close", onSenderClose);
    };
    /** Rejects once with cleanup and a stage-specific external error. */
    const fail = (error: Error) => {
      cleanup();
      rejectPromise(error);
    };
    /** Deadline protecting an explicit external-environment gate. */
    const timeout = setTimeout(() => {
      fail(new Error(`Timed out waiting for near-limit ${options.label} frame`));
    }, NEAR_LIMIT_FRAME_TIMEOUT_MS);
    /** Single-use frame observer installed before the sender writes. */
    const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
      cleanup();
      resolvePromise({ data: normalizeRawData(data), isBinary });
    };
    /** Receiver-side transport failure observer. */
    const onReceiverError = (error: Error) => {
      fail(new Error(`Near-limit ${options.label} receiver error: ${error.message}`));
    };
    /** Receiver-side policy close observer. */
    const onReceiverClose = (code: number, reason: Buffer) => {
      fail(
        new Error(
          `Near-limit ${options.label} receiver closed: code=${code} reason=${reason.toString("utf8")}`,
        ),
      );
    };
    /** Sender-side transport failure observer. */
    const onSenderError = (error: Error) => {
      fail(new Error(`Near-limit ${options.label} sender error: ${error.message}`));
    };
    /** Sender-side policy close observer. */
    const onSenderClose = (code: number, reason: Buffer) => {
      fail(
        new Error(
          `Near-limit ${options.label} sender closed: code=${code} reason=${reason.toString("utf8")}`,
        ),
      );
    };
    options.receiver.once("message", onMessage);
    options.receiver.once("error", onReceiverError);
    options.receiver.once("close", onReceiverClose);
    options.sender.once("error", onSenderError);
    options.sender.once("close", onSenderClose);
  });
}

/** Converts every `ws` RawData representation to one exact Buffer. */
function normalizeRawData(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.concat(data);
}

/** One deterministic near-limit wire representation sent through the opaque relay. */
interface NearLimitRelayFrame {
  /** Text or binary WebSocket payload. */
  payload: string | Buffer;
  /** Expected WebSocket opcode classification. */
  isBinary: boolean;
  /** Exact payload byte length below the production cap. */
  wireBytes: number;
  /** Independent expected SHA-256 digest. */
  sha256: string;
}

/** Builds high-entropy deterministic bytes without storing fixture content in the repository. */
function createDeterministicBytes(byteLength: number, seed: number): Buffer {
  /** Exact output buffer used as an opaque ciphertext-like payload. */
  const output = Buffer.allocUnsafe(byteLength);
  /** Reproducible xorshift32 state. */
  let state = seed >>> 0;
  for (let index = 0; index < output.byteLength; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    output[index] = state & 0xff;
  }
  return output;
}

/** Computes a standard content digest independently of relay framing. */
function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Builds the largest valid binary or Base64 framed-wire representation below 32 MiB. */
function createNearLimitRelayFrame(encoding: "base64" | "binary"): NearLimitRelayFrame {
  if (encoding === "binary") {
    /** High-entropy binary payload at the exact accepted edge. */
    const payload = createDeterministicBytes(NEAR_LIMIT_BINARY_WIRE_BYTES, 0x1a2b3c4d);
    return {
      payload,
      isBinary: true,
      wireBytes: payload.byteLength,
      sha256: sha256(payload),
    };
  }
  /** High-entropy bytes whose canonical Base64 has the exact aligned wire length. */
  const source = createDeterministicBytes(NEAR_LIMIT_BASE64_SOURCE_BYTES, 0x5e6f7788);
  /** Canonical unpadded-at-the-end Base64 text sent as a WebSocket text frame. */
  const payload = source.toString("base64");
  if (Buffer.byteLength(payload) !== NEAR_LIMIT_BASE64_WIRE_BYTES) {
    throw new Error("Near-limit Base64 fixture has an unexpected wire length");
  }
  return {
    payload,
    isBinary: false,
    wireBytes: NEAR_LIMIT_BASE64_WIRE_BYTES,
    sha256: sha256(payload),
  };
}

/** Sends one explicit text or binary frame and waits for local write acceptance. */
function sendRelayFrame(ws: WebSocket, frame: NearLimitRelayFrame): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    ws.send(frame.payload, { binary: frame.isBinary }, (error) => {
      if (error) {
        rejectPromise(error);
        return;
      }
      resolvePromise();
    });
  });
}

describe("Live relay (relay.paseo.sh) E2E", () => {
  const liveIt = process.env.RUN_LIVE_RELAY_E2E === "1" ? it : it.skip;

  liveIt("bridges encrypted traffic end-to-end", { timeout: 45_000 }, async () => {
    await withRetry(
      async () => {
        const serverId = `live-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const connectionId = `clt_live_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const serverControlUrl = `${RELAY_BASE_URL}/ws?serverId=${encodeURIComponent(serverId)}&role=server&v=2`;
        const serverDataUrl = `${RELAY_BASE_URL}/ws?serverId=${encodeURIComponent(
          serverId,
        )}&role=server&connectionId=${encodeURIComponent(connectionId)}&v=2`;
        const clientUrl = `${RELAY_BASE_URL}/ws?serverId=${encodeURIComponent(
          serverId,
        )}&role=client&connectionId=${encodeURIComponent(connectionId)}&v=2`;

        // === Key setup ===
        const daemonKeyPair = generateKeyPair();
        const daemonPubKeyB64 = exportPublicKey(daemonKeyPair.publicKey);

        const clientKeyPair = generateKeyPair();
        const clientPubKeyB64 = exportPublicKey(clientKeyPair.publicKey);

        const daemonPubKeyOnClient = importPublicKey(daemonPubKeyB64);
        const clientSharedKey = deriveSharedKey(clientKeyPair.secretKey, daemonPubKeyOnClient);

        // === Connect ===
        const daemonControlWs = new WebSocket(serverControlUrl);
        const clientWs = new WebSocket(clientUrl);
        const connected = waitForConnected(daemonControlWs, connectionId);
        let daemonWs: WebSocket | null = null;

        try {
          await Promise.all([
            waitOpen(daemonControlWs, "server-control"),
            waitOpen(clientWs, "client"),
            connected,
          ]);

          daemonWs = new WebSocket(serverDataUrl);
          await waitOpen(daemonWs, "server-data");

          // === Handshake ===
          // Client sends hello with its public key (not encrypted).
          clientWs.send(JSON.stringify({ type: "hello", key: clientPubKeyB64 }));

          const daemonReceivedHello = await waitForOnceMessage(
            daemonWs,
            "string",
            "Timed out waiting for hello",
          );

          const hello = JSON.parse(daemonReceivedHello) as {
            type: string;
            key?: string;
          };
          expect(hello.type).toBe("hello");
          expect(typeof hello.key).toBe("string");

          const clientPubKeyOnDaemon = importPublicKey(hello.key!);
          const daemonSharedKey = deriveSharedKey(daemonKeyPair.secretKey, clientPubKeyOnDaemon);

          // === Encrypted exchange ===
          const plaintextFromClient = "hello-from-client";
          const ciphertextFromClient = encrypt(clientSharedKey, plaintextFromClient);
          clientWs.send(Buffer.from(ciphertextFromClient));

          const daemonReceivedCiphertext = await waitForOnceMessage(
            daemonWs,
            "buffer",
            "Timed out waiting for encrypted message",
          );

          const decryptedOnDaemon = decrypt(
            daemonSharedKey,
            daemonReceivedCiphertext.buffer.slice(
              daemonReceivedCiphertext.byteOffset,
              daemonReceivedCiphertext.byteOffset + daemonReceivedCiphertext.byteLength,
            ),
          );
          expect(new TextDecoder().decode(decryptedOnDaemon)).toBe(plaintextFromClient);

          const plaintextFromDaemon = "hello-from-daemon";
          const ciphertextFromDaemon = encrypt(daemonSharedKey, plaintextFromDaemon);
          daemonWs.send(Buffer.from(ciphertextFromDaemon));

          const clientReceivedCiphertext = await waitForOnceMessage(
            clientWs,
            "buffer",
            "Timed out waiting for encrypted response",
          );

          const decryptedOnClient = decrypt(
            clientSharedKey,
            clientReceivedCiphertext.buffer.slice(
              clientReceivedCiphertext.byteOffset,
              clientReceivedCiphertext.byteOffset + clientReceivedCiphertext.byteLength,
            ),
          );
          expect(new TextDecoder().decode(decryptedOnClient)).toBe(plaintextFromDaemon);
        } finally {
          daemonControlWs.close();
          daemonWs?.close();
          clientWs.close();
        }
      },
      { retries: 2, delayMs: 250 },
    );
  });

  for (const encoding of ["binary", "base64"] as const) {
    liveIt(
      `forwards a near-32 MiB ${encoding} framed wire representation byte-for-byte`,
      { timeout: 180_000 },
      async () => {
        /** Unique opaque route preventing collisions with another live probe. */
        const serverId = `live-limit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        /** Unique v2 connection routed through the server control socket. */
        const connectionId = `clt_limit_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        /** Long-lived server control route for v2 connection announcements. */
        const serverControlUrl = `${RELAY_BASE_URL}/ws?serverId=${encodeURIComponent(serverId)}&role=server&v=2`;
        /** Per-client server data route used for opaque application frames. */
        const serverDataUrl = `${RELAY_BASE_URL}/ws?serverId=${encodeURIComponent(
          serverId,
        )}&role=server&connectionId=${encodeURIComponent(connectionId)}&v=2`;
        /** Client data route paired with the announced v2 connection ID. */
        const clientUrl = `${RELAY_BASE_URL}/ws?serverId=${encodeURIComponent(
          serverId,
        )}&role=client&connectionId=${encodeURIComponent(connectionId)}&v=2`;
        /** Server control WebSocket. */
        const daemonControlWs = new WebSocket(serverControlUrl);
        /** Remote client WebSocket. */
        const clientWs = new WebSocket(clientUrl);
        /** Connection announcement registered before either socket opens. */
        const connected = waitForConnected(daemonControlWs, connectionId);
        /** Lazily opened daemon-side data WebSocket. */
        let daemonWs: WebSocket | null = null;

        try {
          await Promise.all([
            waitOpen(daemonControlWs, `near-limit-${encoding}-server-control`),
            waitOpen(clientWs, `near-limit-${encoding}-client`),
            connected,
          ]);
          daemonWs = new WebSocket(serverDataUrl);
          await waitOpen(daemonWs, `near-limit-${encoding}-server-data`);

          /** Deterministic payload whose wire size is strictly below 32 MiB. */
          const frame = createNearLimitRelayFrame(encoding);
          /** Receive waiter installed before the large sender write. */
          const receivedPromise = waitForOnceRelayFrame({
            receiver: daemonWs,
            sender: clientWs,
            label: encoding,
          });
          await sendRelayFrame(clientWs, frame);
          /** Opaque frame observed after one hosted-relay hop. */
          const received = await receivedPromise;

          expect(frame.wireBytes).toBeLessThan(MAX_FRAMED_WIRE_BYTES);
          expect(received.isBinary).toBe(frame.isBinary);
          expect(received.data.byteLength).toBe(frame.wireBytes);
          expect(sha256(received.data)).toBe(frame.sha256);
        } finally {
          daemonControlWs.close();
          daemonWs?.close();
          clientWs.close();
        }
      },
    );
  }
});
