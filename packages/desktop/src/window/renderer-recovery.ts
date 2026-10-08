// Grace period after Chromium reports an unresponsive renderer
export const UNRESPONSIVE_DELAY_MS = 5_000;
// Main-process deadline including renderer termination, navigation and readiness
export const RECOVERY_TIMEOUT_MS = 15_000;

export type RendererFault =
  | { kind: "crashed"; reason: string; exitCode: number }
  | { kind: "unresponsive" }
  | { kind: "load-failed"; errorCode: number }
  | { kind: "recovery-failed"; message: string };

export interface RendererRecoveryPort {
  /** Whether the native window is no longer available */
  isDestroyed(): boolean;
  /** Replace the renderer and resolve only when the recovery page is visible */
  resetRenderer(signal: AbortSignal): Promise<void>;
  /** Ask through a native dialog that can be dismissed when the fault becomes stale */
  prompt(fault: RendererFault, signal: AbortSignal): Promise<"recover" | "dismiss" | "logs">;
  /** Open the existing desktop log directory */
  openLogs(): Promise<void>;
  /** Schedule on the main-process clock and return its cancellation function */
  schedule(callback: () => void, delay: number): () => void;
  /** Record diagnostics without transcript content */
  log(event: string, details?: unknown): void;
  /** Refresh native recovery actions when the operation state changes */
  changed(): void;
}

export interface RendererRecovery {
  /** Recover once per user action and join an already pending attempt */
  recover(): Promise<void>;
  /** Report a terminal renderer failure */
  reportFailure(fault: RendererFault): void;
  /** Start the grace period for a stalled renderer */
  unresponsive(): void;
  /** Cancel a transient stall and its obsolete native prompt */
  responsive(): void;
  /** Whether a user recovery is in progress */
  isRecovering(): boolean;
  /** Cancel work when the native window closes */
  dispose(): void;
}

interface RecoveryAttempt {
  // Cancellation shared with the renderer adapter
  abort: AbortController;
  // Promise returned to all callers of the same attempt
  promise: Promise<void>;
  /** Interrupt the attempt after another renderer failure */
  fail(message: string): void;
}

interface RecoveryPrompt {
  // Fault associated with the current native prompt
  fault: RendererFault;
  // Cancellation for an obsolete native prompt
  abort: AbortController;
}

/** Own recovery deadlines and user choices independently of the renderer */
export function createRendererRecovery(port: RendererRecoveryPort): RendererRecovery {
  // Recovery owned by this native window
  let attempt: RecoveryAttempt | null = null;
  // Native prompt currently awaiting a response
  let prompt: RecoveryPrompt | null = null;
  // Cancellation of the unresponsive grace period
  let cancelStall: (() => void) | null = null;
  // Suppress repeated automatic prompts for the same incident
  let incidentReported = false;
  // Window teardown prevents subsequent prompts and navigation
  let disposed = false;

  /** Clear the stall timer before recovery or teardown */
  function clearStall(): void {
    cancelStall?.();
    cancelStall = null;
  }

  /** Close a native prompt whose fault is no longer actionable */
  function cancelPrompt(): void {
    prompt?.abort.abort();
    prompt = null;
  }

  /** Offer a single native prompt without automatically retrying failed recovery */
  async function offer(fault: RendererFault): Promise<void> {
    if (disposed || port.isDestroyed() || prompt !== null) return;
    // Identity of this prompt protects against a late response after cancellation
    const current: RecoveryPrompt = { fault, abort: new AbortController() };
    prompt = current;
    try {
      // User choice delivered by the native dialog
      const choice = await port.prompt(fault, current.abort.signal);
      if (current.abort.signal.aborted || disposed) return;
      port.log("recovery-choice", choice);
      prompt = null;
      if (choice === "recover") await recover();
      else if (choice === "logs") await port.openLogs();
    } catch (error) {
      if (!current.abort.signal.aborted) port.log("native-prompt-failed", error);
    } finally {
      if (prompt === current) prompt = null;
    }
  }

  /** Restart only the renderer with a deadline that also covers a hung readiness probe */
  function recover(): Promise<void> {
    if (disposed || port.isDestroyed()) return Promise.resolve();
    if (attempt !== null) return attempt.promise;
    clearStall();
    cancelPrompt();
    // Cancellation for all adapter work belonging to this attempt
    const abort = new AbortController();
    // Interrupt handler settled by renderer failure, teardown or the deadline
    let interrupt!: (error: Error) => void;
    // Terminal failures race the real renderer operation
    const interrupted = new Promise<void>((_resolve, reject) => {
      interrupt = reject;
    });
    // Resolve all joined callers after success or actionable failure
    let finish!: () => void;
    // Shared operation promise set before adapter calls can emit events
    const promise = new Promise<void>((resolve) => {
      finish = resolve;
    });
    // Attempt identity keeps stale completions from changing newer work
    const current: RecoveryAttempt = {
      abort,
      promise,
      fail: (message) => interrupt(new Error(message)),
    };
    attempt = current;
    port.changed();
    port.log("recovery-started");
    // Deadline deliberately runs outside Chromium
    const cancelDeadline = port.schedule(
      () => current.fail("Renderer recovery timed out"),
      RECOVERY_TIMEOUT_MS,
    );
    void (async () => {
      // Actionable failure published only after pending state has been released
      let failure: RendererFault | null = null;
      try {
        await Promise.race([port.resetRenderer(abort.signal), interrupted]);
        if (!disposed) {
          incidentReported = false;
          port.log("recovery-succeeded");
        }
      } catch (error) {
        if (!disposed) {
          // Only a short exception description belongs in the native failure prompt
          const message = error instanceof Error ? error.message : String(error);
          failure = { kind: "recovery-failed", message };
          port.log("recovery-failed", failure);
        }
      } finally {
        cancelDeadline();
        abort.abort();
        attempt = null;
        if (!disposed) port.changed();
        finish();
      }
      if (failure !== null) void offer(failure);
    })();
    return promise;
  }

  /** Surface real failures while keeping intentional termination inside the adapter */
  function reportFailure(fault: RendererFault): void {
    if (disposed || port.isDestroyed()) return;
    clearStall();
    port.log("renderer-fault", fault);
    if (attempt !== null) {
      attempt.fail(`Replacement renderer failed (${fault.kind})`);
      return;
    }
    if (incidentReported) return;
    incidentReported = true;
    void offer(fault);
  }

  return {
    recover,
    reportFailure,
    unresponsive() {
      if (disposed || attempt !== null || cancelStall !== null || incidentReported) return;
      cancelStall = port.schedule(() => {
        cancelStall = null;
        reportFailure({ kind: "unresponsive" });
      }, UNRESPONSIVE_DELAY_MS);
    },
    responsive() {
      clearStall();
      if (prompt?.fault.kind === "unresponsive") cancelPrompt();
      incidentReported = false;
    },
    isRecovering: () => attempt !== null,
    dispose() {
      disposed = true;
      clearStall();
      cancelPrompt();
      attempt?.abort.abort();
      attempt?.fail("Window closed");
    },
  };
}
