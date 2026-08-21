import type { RelayTrafficHint } from "../relay-frame-compression.js";

// OOM backstop for a socket whose client stopped draining. A daemon normally has
// 1-10 physical sockets (tens at the outside), so 64 MiB bounds abandoned queues
// without treating ordinary large frames as a protocol or frame-size violation.
export const MAX_PHYSICAL_SOCKET_BUFFERED_BYTES = 64 * 1024 * 1024;
// Current clients ping every 10 seconds. Four delayed cycles fit inside the
// lease without making an abandoned application socket linger for minutes.
export const APPLICATION_SOCKET_LEASE_MS = 45_000;
export const APPLICATION_SOCKET_LEASE_CHECK_INTERVAL_MS = 10_000;

type Clock = () => number;

export class ApplicationSocketLease<TSocket extends object> {
  private readonly deadlines = new Map<TSocket, number>();

  constructor(private readonly clock: Clock = Date.now) {}

  claim(socket: TSocket): void {
    this.deadlines.set(socket, this.clock() + APPLICATION_SOCKET_LEASE_MS);
  }

  renew(socket: TSocket): void {
    if (this.deadlines.has(socket)) {
      this.claim(socket);
    }
  }

  release(socket: TSocket): void {
    this.deadlines.delete(socket);
  }

  listExpired(): TSocket[] {
    const now = this.clock();
    const expired: TSocket[] = [];
    for (const [socket, deadline] of this.deadlines) {
      if (deadline > now) continue;
      expired.push(socket);
    }
    return expired;
  }

  clear(): void {
    this.deadlines.clear();
  }
}

export function outboundFrameByteLength(data: string | Uint8Array | ArrayBuffer): number {
  if (typeof data === "string") return Buffer.byteLength(data);
  return data.byteLength;
}

/** Inputs for the relay-only classified send extension. */
export interface PhysicalSendClassifiedOptions {
  /** Application frame passed to the physical socket. */
  data: string | Uint8Array | ArrayBuffer;
  /** Semantic class retained through relay frame preparation. */
  hint: RelayTrafficHint;
}

interface BoundedPhysicalSocket {
  readyState: number;
  bufferedAmount?: number;
  send: (
    data: string | Uint8Array | ArrayBuffer,
    callback?: (error?: Error) => void,
  ) => void | Promise<void>;
  /** Relay-only extension that retains sender semantics through framed preparation. */
  sendClassified?: (options: PhysicalSendClassifiedOptions) => void | Promise<void>;
}

interface PhysicalSendDispatch {
  /** Immediate or awaitable result returned by the selected socket send method. */
  result: void | Promise<void>;
  /** Whether the selected method declares a completion callback parameter. */
  expectsCallback: boolean;
}

/** Selects the relay-aware send extension when both a hint and extension are available. */
function dispatchPhysicalFrame(params: {
  /** Physical direct or encrypted relay socket. */
  socket: BoundedPhysicalSocket;
  /** Application frame passed unchanged to the selected send method. */
  frame: string | Uint8Array | ArrayBuffer;
  /** Optional relay-only semantic classification. */
  trafficHint?: RelayTrafficHint;
  /** Optional physical completion callback. */
  callback?: (error?: Error) => void;
}): PhysicalSendDispatch {
  const { socket, frame, trafficHint, callback } = params;
  if (trafficHint && socket.sendClassified) {
    return {
      result: socket.sendClassified({ data: frame, hint: trafficHint }),
      expectsCallback: false,
    };
  }
  return {
    result: callback ? socket.send(frame, callback) : socket.send(frame),
    expectsCallback: socket.send.length >= 2,
  };
}

/** Sends one bounded frame and resolves after the selected transport completes. */
export async function sendBoundedPhysicalFrameAndWait(params: {
  socket: BoundedPhysicalSocket;
  frame: string | Uint8Array | ArrayBuffer;
  frameBytes?: number;
  trafficHint?: RelayTrafficHint;
  onHighWater: () => void;
}): Promise<boolean> {
  const {
    socket,
    frame,
    frameBytes = outboundFrameByteLength(frame),
    trafficHint,
    onHighWater,
  } = params;
  if (socket.readyState !== 1) return false;
  if (!physicalSocketHasCapacity(socket, frameBytes)) {
    onHighWater();
    return false;
  }

  await new Promise<void>((resolve, reject) => {
    let callbackUsed = false;
    /** Selected physical send and its declared completion convention. */
    const dispatch = dispatchPhysicalFrame({
      socket,
      frame,
      trafficHint,
      callback: (error) => {
        callbackUsed = true;
        if (error) reject(error);
        else resolve();
      },
    });
    if (dispatch.result && typeof dispatch.result.then === "function") {
      dispatch.result.then(resolve, reject);
    } else if (!dispatch.expectsCallback && !callbackUsed) {
      resolve();
    }
  });
  return true;
}

/** Returns whether a socket can accept one additional frame under the hard byte bound. */
export function physicalSocketHasCapacity(
  socket: Pick<BoundedPhysicalSocket, "bufferedAmount">,
  frameBytes: number,
): boolean {
  if (typeof socket.bufferedAmount !== "number") return true;
  return socket.bufferedAmount + frameBytes <= MAX_PHYSICAL_SOCKET_BUFFERED_BYTES;
}

/** Sends one bounded frame without waiting for transport completion. */
export function sendBoundedPhysicalFrame(params: {
  socket: BoundedPhysicalSocket;
  frame: string | Uint8Array | ArrayBuffer;
  frameBytes?: number;
  trafficHint?: RelayTrafficHint;
  onHighWater: () => void;
}): boolean {
  const {
    socket,
    frame,
    frameBytes = outboundFrameByteLength(frame),
    trafficHint,
    onHighWater,
  } = params;
  if (socket.readyState !== 1) return false;
  if (!physicalSocketHasCapacity(socket, frameBytes)) {
    onHighWater();
    return false;
  }
  /** Selected direct or relay-aware send result. */
  const dispatch = dispatchPhysicalFrame({ socket, frame, trafficHint });
  if (dispatch.result && typeof dispatch.result.then === "function") {
    void dispatch.result.catch(() => undefined);
  }
  return true;
}
