import { deflateRawSync, inflateRawSync } from "node:zlib";
import { expect, test, vi } from "vitest";

import {
  createDaemonFrameCompression,
  createNodeRawDeflateCodec,
} from "./relay-frame-compression.js";

test("Node codec emits raw DEFLATE and restores exact bounded output", async () => {
  // Repetitive UTF-8 state payload large enough to exercise real compression.
  const original = new TextEncoder().encode("Paseo state snapshot\n".repeat(256));
  // Production Node adapter under test.
  const codec = createNodeRawDeflateCodec();

  const compressed = await codec.deflateRaw(original.buffer, 1);
  // Independent Node raw decoder proves the encoder emitted no gzip/zlib wrapper.
  const independentlyInflated = inflateRawSync(new Uint8Array(compressed));
  const restored = await codec.inflateRaw(compressed, original.byteLength, original.byteLength + 1);

  expect(new Uint8Array(independentlyInflated)).toEqual(original);
  expect(new Uint8Array(restored)).toEqual(original);
});

test.each([
  { caseName: "shorter than expected", actualLength: 4095 },
  { caseName: "longer than the output bound", actualLength: 4098 },
])("Node inflate rejects output $caseName without returning partial bytes", async (testCase) => {
  // Independently compressed raw stream with the selected logical output size.
  const compressed = deflateRawSync(Buffer.alloc(testCase.actualLength, 0x2a));
  // Production bounded Node decoder under test.
  const codec = createNodeRawDeflateCodec();

  await expect(
    codec.inflateRaw(
      compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength),
      4096,
      4097,
    ),
  ).rejects.toThrow();
});

test("uses identity above the compression input cap when the framed wire remains valid", async () => {
  // Payload exceeds only the 4 MiB compression policy cap, not the 32 MiB framed wire cap.
  const original = new Uint8Array(4 * 1024 * 1024 + 1).fill(0x2a);
  // Codec boundary must not receive oversized compression input.
  const deflateRaw = vi.fn(async () => new Uint8Array(64).buffer);
  // Isolated coordinator for the upper compression threshold.
  const compression = createDaemonFrameCompression({
    codec: {
      deflateRaw,
      inflateRaw: async () => original.buffer,
    },
  });

  const prepared = await compression.prepare(
    original.buffer,
    { trafficClass: "state-sync" },
    {
      compressionEnabled: true,
      negotiatedCompressionAlgorithms: ["deflate-raw"],
      ciphertextEncoding: "binary",
    },
  );

  expect(deflateRaw).not.toHaveBeenCalled();
  expect({
    codec: prepared.codec,
    originalByteLength: prepared.originalByteLength,
    encodedByteLength: prepared.encodedByteLength,
    wireByteLength: prepared.wireByteLength,
    skipReason: prepared.skipReason,
  }).toEqual({
    codec: "identity",
    originalByteLength: original.byteLength,
    encodedByteLength: original.byteLength,
    wireByteLength: original.byteLength + 48,
    skipReason: "too-large",
  });
  // Exact byte comparison avoids materializing a multi-million-element Vitest diff.
  const restoredIdentity = new Uint8Array(prepared.plaintext, 8);
  expect(restoredIdentity.byteLength).toBe(original.byteLength);
  expect(Buffer.compare(Buffer.from(restoredIdentity), Buffer.from(original))).toBe(0);
});

test("prepares eligible state sync as a level-1 raw DEFLATE frame", async () => {
  // Logical binary state snapshot at the minimum safe compression size.
  const original = new Uint8Array(4096).fill(0x2a);
  // Synthetic raw DEFLATE bytes satisfying both savings and ratio gates.
  const compressed = new Uint8Array(64).fill(0x7a);
  // Codec boundary exposing the daemon-private encoder level.
  const deflateRaw = vi.fn(async () => compressed.buffer);
  // Isolated coordinator whose gate and codec are deterministic for this test.
  const compression = createDaemonFrameCompression({
    codec: {
      deflateRaw,
      inflateRaw: async () => original.buffer,
    },
  });

  const prepared = await compression.prepare(
    original.buffer,
    { trafficClass: "state-sync" },
    {
      compressionEnabled: true,
      negotiatedCompressionAlgorithms: ["deflate-raw"],
      ciphertextEncoding: "binary",
    },
  );

  expect(deflateRaw).toHaveBeenCalledOnce();
  expect(deflateRaw).toHaveBeenCalledWith(original.buffer, 1);
  expect({
    binary: prepared.binary,
    codec: prepared.codec,
    originalByteLength: prepared.originalByteLength,
    encodedByteLength: prepared.encodedByteLength,
    wireByteLength: prepared.wireByteLength,
    ciphertextEncoding: prepared.ciphertextEncoding,
    trafficClass: prepared.trafficClass,
    skipReason: prepared.skipReason,
  }).toEqual({
    binary: true,
    codec: "deflate-raw",
    originalByteLength: 4096,
    encodedByteLength: 64,
    wireByteLength: 112,
    ciphertextEncoding: "binary",
    trafficClass: "state-sync",
    skipReason: null,
  });
  expect(new Uint8Array(prepared.plaintext.slice(0, 8))).toEqual(
    new Uint8Array([0x50, 0x01, 0x01, 0x01, 0x00, 0x00, 0x10, 0x00]),
  );
  expect(new Uint8Array(prepared.plaintext.slice(8))).toEqual(compressed);
});

test.each([
  { trafficClass: "bulk" as const, byteLength: 4096 },
  { trafficClass: "bulk-live" as const, byteLength: 16 * 1024 },
])("compresses eligible $trafficClass traffic at its exact lower bound", async (testCase) => {
  // Logical bytes exactly at the class-specific compression lower bound.
  const original = new Uint8Array(testCase.byteLength).fill(0x2a);
  // Safe compressed output satisfying both sender and receiver metadata gates.
  const compressed = new Uint8Array(Math.ceil(testCase.byteLength / 64)).fill(0x7a);
  // Codec boundary proving the candidate reached compression.
  const deflateRaw = vi.fn(async () => compressed.buffer);
  // Isolated coordinator for the positive class threshold.
  const compression = createDaemonFrameCompression({
    codec: { deflateRaw, inflateRaw: async () => original.buffer },
  });

  const prepared = await compression.prepare(
    original.buffer,
    { trafficClass: testCase.trafficClass, compressible: true },
    {
      compressionEnabled: true,
      negotiatedCompressionAlgorithms: ["deflate-raw"],
      ciphertextEncoding: "base64",
    },
  );

  expect(deflateRaw).toHaveBeenCalledOnce();
  expect({ codec: prepared.codec, skipReason: prepared.skipReason }).toEqual({
    codec: "deflate-raw",
    skipReason: null,
  });
});

test.each([
  {
    caseName: "compression is disabled",
    byteLength: 4096,
    hint: { trafficClass: "state-sync" as const },
    compressionEnabled: false,
    algorithms: ["deflate-raw"],
    skipReason: "configured-disabled",
  },
  {
    caseName: "the peer has no shared codec",
    byteLength: 4096,
    hint: { trafficClass: "state-sync" as const },
    compressionEnabled: true,
    algorithms: [],
    skipReason: "peer-unsupported",
  },
  {
    caseName: "traffic is realtime",
    byteLength: 4096,
    hint: { trafficClass: "realtime" as const },
    compressionEnabled: true,
    algorithms: ["deflate-raw"],
    skipReason: "traffic-ineligible",
  },
  {
    caseName: "bulk traffic is not marked compressible",
    byteLength: 4096,
    hint: { trafficClass: "bulk" as const },
    compressionEnabled: true,
    algorithms: ["deflate-raw"],
    skipReason: "traffic-ineligible",
  },
  {
    caseName: "state sync is below 4 KiB",
    byteLength: 4095,
    hint: { trafficClass: "state-sync" as const },
    compressionEnabled: true,
    algorithms: ["deflate-raw"],
    skipReason: "too-small",
  },
  {
    caseName: "bulk-live is below 16 KiB",
    byteLength: 16 * 1024 - 1,
    hint: { trafficClass: "bulk-live" as const, compressible: true },
    compressionEnabled: true,
    algorithms: ["deflate-raw"],
    skipReason: "too-small",
  },
])("uses identity without invoking the codec when $caseName", async (testCase) => {
  // Original binary bytes whose identity form must be preserved exactly.
  const original = new Uint8Array(testCase.byteLength).fill(0x2a);
  // Compression boundary that must remain untouched for ineligible input.
  const deflateRaw = vi.fn(async () => new Uint8Array(64).buffer);
  // Isolated coordinator for one pre-codec policy decision.
  const compression = createDaemonFrameCompression({
    codec: {
      deflateRaw,
      inflateRaw: async () => original.buffer,
    },
  });

  const prepared = await compression.prepare(original.buffer, testCase.hint, {
    compressionEnabled: testCase.compressionEnabled,
    negotiatedCompressionAlgorithms: testCase.algorithms,
    ciphertextEncoding: "binary",
  });

  expect(deflateRaw).not.toHaveBeenCalled();
  expect({
    codec: prepared.codec,
    originalByteLength: prepared.originalByteLength,
    encodedByteLength: prepared.encodedByteLength,
    skipReason: prepared.skipReason,
  }).toEqual({
    codec: "identity",
    originalByteLength: testCase.byteLength,
    encodedByteLength: testCase.byteLength,
    skipReason: testCase.skipReason,
  });
  expect(new Uint8Array(prepared.plaintext.slice(8))).toEqual(original);
});

test("uses two non-waiting compression slots and releases them after completion", async () => {
  // Eligible state payload shared by four independent preparation requests.
  const original = new Uint8Array(4096).fill(0x2a);
  // Safe compressed output returned after caller-controlled slow jobs complete.
  const compressed = new Uint8Array(64).fill(0x7a);
  // Completion callbacks retaining the first two codec jobs in flight.
  const completeJobs: Array<() => void> = [];
  // Codec that blocks its first two calls and completes later calls immediately.
  const deflateRaw = vi.fn(
    () =>
      new Promise<ArrayBuffer>((resolve) => {
        if (completeJobs.length < 2) {
          completeJobs.push(() => resolve(compressed.buffer));
          return;
        }
        resolve(compressed.buffer);
      }),
  );
  // Isolated coordinator whose two-slot state is observable through results only.
  const compression = createDaemonFrameCompression({
    codec: {
      deflateRaw,
      inflateRaw: async () => original.buffer,
    },
  });
  // Common eligible policy for every request in this gate scenario.
  const policy = {
    compressionEnabled: true,
    negotiatedCompressionAlgorithms: ["deflate-raw"],
    ciphertextEncoding: "binary" as const,
  };

  const first = compression.prepare(original.buffer, { trafficClass: "state-sync" }, policy);
  const second = compression.prepare(original.buffer, { trafficClass: "state-sync" }, policy);
  const third = await compression.prepare(original.buffer, { trafficClass: "state-sync" }, policy);

  expect(deflateRaw).toHaveBeenCalledTimes(2);
  expect({ codec: third.codec, skipReason: third.skipReason }).toEqual({
    codec: "identity",
    skipReason: "busy",
  });

  for (const complete of completeJobs) complete();
  await Promise.all([first, second]);
  const fourth = await compression.prepare(original.buffer, { trafficClass: "state-sync" }, policy);
  expect(deflateRaw).toHaveBeenCalledTimes(3);
  expect({ codec: fourth.codec, skipReason: fourth.skipReason }).toEqual({
    codec: "deflate-raw",
    skipReason: null,
  });
});

test("shares the two compression slots across daemon coordinators", async () => {
  // Eligible state payload used across two independently constructed coordinators.
  const original = new Uint8Array(4096).fill(0x2a);
  // Safe compressed bytes returned by every completed codec call.
  const compressed = new Uint8Array(64).fill(0x7a);
  // Completion callbacks retaining both jobs owned by the first coordinator.
  const completeJobs: Array<() => void> = [];
  // Slow codec used to occupy the process-wide capacity.
  const slowDeflateRaw = vi.fn(
    () =>
      new Promise<ArrayBuffer>((resolve) => {
        completeJobs.push(() => resolve(compressed.buffer));
      }),
  );
  // Independent codec that must remain untouched while another coordinator owns both slots.
  const secondDeflateRaw = vi.fn(async () => compressed.buffer);
  // Two coordinators model separate connections sharing one daemon process.
  const firstCoordinator = createDaemonFrameCompression({
    codec: { deflateRaw: slowDeflateRaw, inflateRaw: async () => original.buffer },
  });
  const secondCoordinator = createDaemonFrameCompression({
    codec: { deflateRaw: secondDeflateRaw, inflateRaw: async () => original.buffer },
  });
  // Common eligible policy for all connection-local prepare calls.
  const policy = {
    compressionEnabled: true,
    negotiatedCompressionAlgorithms: ["deflate-raw"],
    ciphertextEncoding: "binary" as const,
  };

  const first = firstCoordinator.prepare(original.buffer, { trafficClass: "state-sync" }, policy);
  const second = firstCoordinator.prepare(original.buffer, { trafficClass: "state-sync" }, policy);
  const crossCoordinator = await secondCoordinator.prepare(
    original.buffer,
    { trafficClass: "state-sync" },
    policy,
  );
  for (const complete of completeJobs) complete();
  await Promise.all([first, second]);

  expect(secondDeflateRaw).not.toHaveBeenCalled();
  expect({ codec: crossCoordinator.codec, skipReason: crossCoordinator.skipReason }).toEqual({
    codec: "identity",
    skipReason: "busy",
  });
});

test.each([
  {
    caseName: "the result has insufficient savings",
    compressedLength: 4032,
    skipReason: "no-gain",
  },
  { caseName: "the result exceeds the ratio limit", compressedLength: 31, skipReason: "ratio" },
  { caseName: "the adapter rejects", compressedLength: null, skipReason: "error" },
])("falls back to identity when $caseName", async (testCase) => {
  // Eligible logical state snapshot used for every post-codec decision.
  const original = new Uint8Array(4096).fill(0x2a);
  // Codec boundary returning the selected unsafe result or a runtime failure.
  const deflateRaw = vi.fn(async () => {
    if (testCase.compressedLength === null) throw new Error("codec failed");
    return new Uint8Array(testCase.compressedLength).buffer;
  });
  // Isolated coordinator that must contain codec failures within this frame.
  const compression = createDaemonFrameCompression({
    codec: {
      deflateRaw,
      inflateRaw: async () => original.buffer,
    },
  });

  const prepared = await compression.prepare(
    original.buffer,
    { trafficClass: "state-sync" },
    {
      compressionEnabled: true,
      negotiatedCompressionAlgorithms: ["deflate-raw"],
      ciphertextEncoding: "binary",
    },
  );

  expect(deflateRaw).toHaveBeenCalledOnce();
  expect({
    codec: prepared.codec,
    encodedByteLength: prepared.encodedByteLength,
    skipReason: prepared.skipReason,
  }).toEqual({
    codec: "identity",
    encodedByteLength: original.byteLength,
    skipReason: testCase.skipReason,
  });
  expect(new Uint8Array(prepared.plaintext.slice(8))).toEqual(original);
});
