import { expect, test } from "vitest";
import {
  APPLICATION_SOCKET_LEASE_MS,
  ApplicationSocketLease,
  MAX_PHYSICAL_SOCKET_BUFFERED_BYTES,
  sendBoundedPhysicalFrame,
  sendBoundedPhysicalFrameAndWait,
} from "./physical-socket.js";
import type { RelayTrafficHint } from "../relay-frame-compression.js";

test("sockets remain exempt until they send an application ping", () => {
  let now = 0;
  const lease = new ApplicationSocketLease<object>(() => now);
  const legacySocket = {};
  now = APPLICATION_SOCKET_LEASE_MS * 10;

  expect(lease.listExpired()).toEqual([]);
  lease.renew(legacySocket);
  expect(lease.listExpired()).toEqual([]);
});

test("inbound activity renews a claimed lease", () => {
  let now = 0;
  const lease = new ApplicationSocketLease<object>(() => now);
  const applicationSocket = {};
  lease.claim(applicationSocket);

  now = APPLICATION_SOCKET_LEASE_MS - 1;
  lease.renew(applicationSocket);
  now += APPLICATION_SOCKET_LEASE_MS - 1;
  expect(lease.listExpired()).toEqual([]);

  now += 1;
  expect(lease.listExpired()).toEqual([applicationSocket]);
  lease.release(applicationSocket);
  expect(lease.listExpired()).toEqual([]);
});

test("an application ping claims a socket lease", () => {
  let now = 0;
  const lease = new ApplicationSocketLease<object>(() => now);
  const rawSocket = {};

  lease.claim(rawSocket);
  now = APPLICATION_SOCKET_LEASE_MS;

  expect(lease.listExpired()).toEqual([rawSocket]);
});

test("the shared physical send boundary rejects binary above the hard bound", () => {
  const sent: Array<string | Uint8Array | ArrayBuffer> = [];
  let terminated = false;
  const socket = {
    readyState: 1,
    bufferedAmount: MAX_PHYSICAL_SOCKET_BUFFERED_BYTES - 1,
    send: (data: string | Uint8Array | ArrayBuffer) => sent.push(data),
  };

  const accepted = sendBoundedPhysicalFrame({
    socket,
    frame: new Uint8Array(2),
    onHighWater: () => {
      terminated = true;
    },
  });

  expect(accepted).toBe(false);
  expect(sent).toEqual([]);
  expect(terminated).toBe(true);
});

test("the awaitable physical send resolves only when that frame send completes", async () => {
  const sent: Array<string | Uint8Array | ArrayBuffer> = [];
  let completeSend: (() => void) | undefined;
  const socket = {
    readyState: 1,
    bufferedAmount: 0,
    send: (_data: string | Uint8Array | ArrayBuffer, callback?: (error?: Error) => void) => {
      sent.push(_data);
      if (callback) completeSend = () => callback();
    },
  };
  let completed = false;

  const sending = sendBoundedPhysicalFrameAndWait({
    socket,
    frame: new Uint8Array([1, 2, 3]),
    onHighWater: () => undefined,
  }).then(() => {
    return (completed = true);
  });

  await Promise.resolve();
  expect(completed).toBe(false);
  expect(
    sendBoundedPhysicalFrame({
      socket,
      frame: "unrelated",
      onHighWater: () => undefined,
    }),
  ).toBe(true);
  expect(sent).toEqual([new Uint8Array([1, 2, 3]), "unrelated"]);
  completeSend?.();
  await sending;
  expect(completed).toBe(true);
});

test("the awaitable physical send rejects callback errors", async () => {
  const socket = {
    readyState: 1,
    bufferedAmount: 0,
    send: (_data: string | Uint8Array | ArrayBuffer, callback?: (error?: Error) => void) =>
      callback?.(new Error("send failed")),
  };

  await expect(
    sendBoundedPhysicalFrameAndWait({
      socket,
      frame: new Uint8Array([1]),
      onHighWater: () => undefined,
    }),
  ).rejects.toThrow("send failed");
});

test("physical sends use relay classification when supported and ignore it on direct sockets", () => {
  /** Traffic hints observed by the relay-only classified send seam. */
  const relayHints: RelayTrafficHint[] = [];
  /** Ordinary send calls prove the relay path does not accidentally double-send. */
  const relayFallbackFrames: Array<string | Uint8Array | ArrayBuffer> = [];
  /** Relay-like socket exposes both WebSocket compatibility and classified sending. */
  const relaySocket = {
    readyState: 1,
    bufferedAmount: 0,
    send: (frame: string | Uint8Array | ArrayBuffer) => relayFallbackFrames.push(frame),
    sendClassified: ({ hint }: { hint: RelayTrafficHint }) => relayHints.push(hint),
  };
  /** Frames observed by a direct WebSocket without the relay extension. */
  const directFrames: Array<string | Uint8Array | ArrayBuffer> = [];
  /** Direct socket deliberately omits the classified extension. */
  const directSocket = {
    readyState: 1,
    bufferedAmount: 0,
    send: (frame: string | Uint8Array | ArrayBuffer) => directFrames.push(frame),
  };

  expect(
    sendBoundedPhysicalFrame({
      socket: relaySocket,
      frame: "catch-up",
      trafficHint: { trafficClass: "state-sync" },
      onHighWater: () => undefined,
    }),
  ).toBe(true);
  expect(
    sendBoundedPhysicalFrame({
      socket: directSocket,
      frame: "catch-up",
      trafficHint: { trafficClass: "state-sync" },
      onHighWater: () => undefined,
    }),
  ).toBe(true);

  expect(relayHints).toEqual([{ trafficClass: "state-sync" }]);
  expect(relayFallbackFrames).toEqual([]);
  expect(directFrames).toEqual(["catch-up"]);
});
