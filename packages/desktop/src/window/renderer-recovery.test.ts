import { describe, expect, it } from "vitest";
import {
  createRendererRecovery,
  RECOVERY_TIMEOUT_MS,
  UNRESPONSIVE_DELAY_MS,
  type RendererFault,
  type RendererRecoveryPort,
} from "./renderer-recovery.js";

/** Exercise recovery with a manually advanced main-process clock */
function harness() {
  // Scheduled callbacks and their cancellation state
  const timers: Array<{ callback: () => void; delay: number; canceled: boolean }> = [];
  // Native prompts still awaiting a user response
  const prompts: Array<{
    fault: RendererFault;
    signal: AbortSignal;
    answer: (choice: "recover" | "dismiss" | "logs") => void;
  }> = [];
  // Recovery operations still awaiting renderer readiness
  const resets: Array<{ signal: AbortSignal; ready: () => void; fail: (error: Error) => void }> =
    [];
  // Diagnostic events emitted by the controller
  const events: string[] = [];
  // Whether the window has been destroyed
  let destroyed = false;
  // Number of requests to open the log directory
  let logsOpened = 0;
  // Production dependencies replaced by explicit in-memory adapters
  const port: RendererRecoveryPort = {
    isDestroyed: () => destroyed,
    resetRenderer: (signal) =>
      new Promise<void>((resolve, reject) => {
        resets.push({ signal, ready: resolve, fail: reject });
      }),
    prompt: (fault, signal) =>
      new Promise((resolve) => {
        prompts.push({ fault, signal, answer: resolve });
      }),
    openLogs: async () => {
      logsOpened += 1;
    },
    schedule: (callback, delay) => {
      // One timer owned by the main-process clock
      const timer = { callback, delay, canceled: false };
      timers.push(timer);
      return () => {
        timer.canceled = true;
      };
    },
    log: (event) => events.push(event),
    changed: () => {},
  };
  // Controller under test
  const recovery = createRendererRecovery(port);
  return {
    recovery,
    prompts,
    resets,
    events,
    timers,
    logsOpened: () => logsOpened,
    destroy: () => {
      destroyed = true;
      recovery.dispose();
    },
    fire: (delay: number) => {
      for (const timer of timers.filter((entry) => entry.delay === delay && !entry.canceled)) {
        timer.canceled = true;
        timer.callback();
      }
    },
  };
}

/** Let native prompt continuations settle without waiting on a real timer */
async function settle(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

describe("renderer recovery", () => {
  it("waits for a sustained stall and cancels it when the window responds", () => {
    // Window with a transient stall
    const h = harness();
    h.recovery.unresponsive();
    expect(h.prompts).toHaveLength(0);
    h.recovery.responsive();
    h.fire(UNRESPONSIVE_DELAY_MS);
    expect(h.prompts).toHaveLength(0);
    h.recovery.unresponsive();
    h.fire(UNRESPONSIVE_DELAY_MS);
    expect(h.prompts.map((entry) => entry.fault.kind)).toEqual(["unresponsive"]);
  });

  it("reports crashes once and waits for the user's recovery choice", async () => {
    // Window whose renderer crashed
    const h = harness();
    h.recovery.reportFailure({ kind: "crashed", reason: "oom", exitCode: -1 });
    h.recovery.reportFailure({ kind: "crashed", reason: "oom", exitCode: -1 });
    expect(h.prompts).toHaveLength(1);
    expect(h.resets).toHaveLength(0);
    h.prompts[0].answer("recover");
    await settle();
    expect(h.resets).toHaveLength(1);
    h.resets[0].ready();
    await settle();
    expect(h.events).toContain("recovery-succeeded");
  });

  it("deduplicates manual recovery and releases its deadline on success", async () => {
    // Window receiving repeated tray clicks
    const h = harness();
    // First pending recovery
    const first = h.recovery.recover();
    expect(h.recovery.recover()).toBe(first);
    expect(h.recovery.isRecovering()).toBe(true);
    expect(h.resets).toHaveLength(1);
    h.resets[0].ready();
    await first;
    expect(h.recovery.isRecovering()).toBe(false);
    expect(h.timers.every((timer) => timer.canceled)).toBe(true);
    expect(h.prompts).toHaveLength(0);
  });

  it("bounds a hung renderer from the main process and allows a retry", async () => {
    // Window whose readiness probe never returns
    const h = harness();
    // Recovery waiting for the deadline
    const first = h.recovery.recover();
    h.fire(RECOVERY_TIMEOUT_MS);
    await first;
    expect(h.resets[0].signal.aborted).toBe(true);
    expect(h.prompts[0].fault.kind).toBe("recovery-failed");
    expect(h.resets).toHaveLength(1);
    h.prompts[0].answer("recover");
    await settle();
    expect(h.resets).toHaveLength(2);
    h.resets[1].ready();
    await settle();
    expect(h.events).toContain("recovery-succeeded");
  });

  it("turns another crash during recovery into a failure without an automatic loop", async () => {
    // Window whose replacement renderer also fails
    const h = harness();
    // Recovery interrupted by another crash
    const attempt = h.recovery.recover();
    h.recovery.reportFailure({ kind: "crashed", reason: "oom", exitCode: -1 });
    await attempt;
    expect(h.prompts.map((entry) => entry.fault.kind)).toEqual(["recovery-failed"]);
    expect(h.resets).toHaveLength(1);
  });

  it("aborts stale prompts before a manual recovery", async () => {
    // Window with a pending automatic prompt
    const h = harness();
    h.recovery.reportFailure({ kind: "load-failed", errorCode: -105 });
    // Manual recovery superseding that prompt
    const attempt = h.recovery.recover();
    expect(h.prompts[0].signal.aborted).toBe(true);
    h.prompts[0].answer("recover");
    h.resets[0].ready();
    await attempt;
    expect(h.resets).toHaveLength(1);
  });

  it("opens logs without reloading and cancels an obsolete stall prompt", async () => {
    // Window waiting for a native prompt response
    const h = harness();
    h.recovery.unresponsive();
    h.fire(UNRESPONSIVE_DELAY_MS);
    h.recovery.responsive();
    expect(h.prompts[0].signal.aborted).toBe(true);
    h.prompts[0].answer("recover");
    await settle();
    expect(h.resets).toHaveLength(0);
    h.recovery.reportFailure({ kind: "crashed", reason: "crashed", exitCode: 1 });
    h.prompts[1].answer("logs");
    await settle();
    expect(h.logsOpened()).toBe(1);
    expect(h.resets).toHaveLength(0);
  });

  it("cleans up pending work when the window closes", async () => {
    // Window closing during a recovery
    const h = harness();
    // Recovery interrupted by window disposal
    const attempt = h.recovery.recover();
    h.destroy();
    await attempt;
    expect(h.resets[0].signal.aborted).toBe(true);
    expect(h.timers.every((timer) => timer.canceled)).toBe(true);
    expect(h.prompts).toHaveLength(0);
    await h.recovery.recover();
    h.recovery.reportFailure({ kind: "crashed", reason: "crashed", exitCode: 1 });
    expect(h.resets).toHaveLength(1);
    expect(h.prompts).toHaveLength(0);
  });
});
