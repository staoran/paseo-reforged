import { dialog, shell, type BrowserWindow } from "electron";
import log from "electron-log/main";
import path from "node:path";
import {
  createRendererRecovery,
  type RendererFault,
  type RendererRecovery,
} from "./renderer-recovery.js";

// A rendered project action and a produced frame distinguish recovery from document load
const RECOVERY_READY_SOURCE = `new Promise((resolve) => {
  const check = () => {
    const action = document.querySelector('[data-testid="open-project-submit"]');
    if (action && action.getBoundingClientRect().width > 0 &&
        action.getBoundingClientRect().height > 0) {
      requestAnimationFrame(() => resolve(true));
      return;
    }
    setTimeout(check, 100);
  };
  check();
})`;

export interface RendererRecoveryOptions {
  // Native window whose renderer can be replaced
  win: BrowserWindow;
  // Existing project picker route in the dev or packaged origin
  recoveryUrl: string;
  /** Release pending navigation and guest registrations before replacement */
  beforeReset(): void;
  /** Update tray actions after pending state changes */
  changed(): void;
}

/** Explain the detected failure without claiming that every blank screen is observable */
function faultMessage(fault: RendererFault): string {
  switch (fault.kind) {
    case "crashed":
      return fault.reason === "oom"
        ? "The Paseo window ran out of memory."
        : "The Paseo window's renderer stopped.";
    case "unresponsive":
      return "The Paseo window is not responding.";
    case "load-failed":
      return "The Paseo window could not load.";
    case "recovery-failed":
      return "The Paseo window could not be recovered. You can try again from the tray.";
  }
}

/** Attach native fault events and replace Chromium without closing its BrowserWindow */
export function setupRendererRecovery(options: RendererRecoveryOptions): RendererRecovery {
  // Window and web contents retain their identity throughout recovery
  const { win, recoveryUrl } = options;
  // Renderer event source for this host window only
  const contents = win.webContents;
  // Expected termination while deliberately replacing the renderer
  let terminatingRenderer = false;

  /** Ask through the main process so a dead renderer cannot hide the recovery action */
  async function prompt(fault: RendererFault, signal: AbortSignal) {
    // Native response survives renderer failure
    const response = await dialog.showMessageBox(win, {
      type: fault.kind === "recovery-failed" ? "error" : "warning",
      title: "Recover Paseo window",
      message: faultMessage(fault),
      detail:
        "Recovery opens the project picker and keeps background agents running. " +
        "Unsaved input may be lost. If memory is still full, free some memory before retrying.",
      buttons: ["Recover window", "Not now", "Open logs"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      signal,
    });
    if (response.response === 0) return "recover";
    if (response.response === 2) return "logs";
    return "dismiss";
  }

  /** Wait for deliberate termination and remove listeners even when the deadline expires */
  function terminateRenderer(signal: AbortSignal): Promise<void> {
    if (contents.isCrashed()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      /** Release listeners before continuing or canceling the attempt */
      function cleanup(): void {
        contents.removeListener("render-process-gone", gone);
        signal.removeEventListener("abort", canceled);
        terminatingRenderer = false;
      }
      /** A deliberate exit completes only the termination phase */
      function gone(): void {
        cleanup();
        resolve();
      }
      /** A main-process deadline must also bound termination */
      function canceled(): void {
        cleanup();
        reject(new Error("Renderer termination canceled"));
      }
      contents.once("render-process-gone", gone);
      signal.addEventListener("abort", canceled, { once: true });
      terminatingRenderer = true;
      try {
        contents.forcefullyCrashRenderer();
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  /** Load a safe destination in a fresh renderer and require a visible application action */
  async function resetRenderer(signal: AbortSignal): Promise<void> {
    options.beforeReset();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    contents.stop();
    await terminateRenderer(signal);
    signal.throwIfAborted();
    await contents.loadURL(recoveryUrl);
    signal.throwIfAborted();
    // Unknown at the Chromium evaluation boundary until checked
    const ready: unknown = await contents.executeJavaScript(RECOVERY_READY_SOURCE);
    signal.throwIfAborted();
    if (ready !== true) throw new Error("Recovery page did not become visible");
  }

  // Per-window recovery state never calls app.quit or daemon controls
  const recovery = createRendererRecovery({
    isDestroyed: () => win.isDestroyed(),
    resetRenderer,
    prompt,
    openLogs: async () => {
      // shell.openPath returns a failure description rather than rejecting
      const error = await shell.openPath(path.dirname(log.transports.file.getFile().path));
      if (error) dialog.showErrorBox("Could not open Paseo logs", error);
    },
    schedule: (callback, delay) => {
      // Timers run in the Electron main process even when Chromium is hung
      const timer = setTimeout(callback, delay);
      return () => clearTimeout(timer);
    },
    log: (event, details) => {
      log.info(`[renderer-recovery] ${event}`, { webContentsId: contents.id, details });
    },
    changed: options.changed,
  });

  /** Ignore the intentional crash and report an unexpected exit from either renderer */
  function rendererGone(_event: Electron.Event, details: Electron.RenderProcessGoneDetails): void {
    if (terminatingRenderer || details.reason === "clean-exit") return;
    win.show();
    recovery.reportFailure({ kind: "crashed", reason: details.reason, exitCode: details.exitCode });
  }

  /** Report only the main document and ignore canceled navigation */
  function loadFailed(
    _event: Electron.Event,
    errorCode: number,
    _description: string,
    _url: string,
    isMainFrame: boolean,
  ): void {
    if (!isMainFrame || errorCode === -3) return;
    win.show();
    recovery.reportFailure({ kind: "load-failed", errorCode });
  }

  win.on("unresponsive", recovery.unresponsive);
  win.on("responsive", recovery.responsive);
  contents.on("render-process-gone", rendererGone);
  contents.on("did-fail-load", loadFailed);
  win.once("closed", () => {
    recovery.dispose();
    win.removeListener("unresponsive", recovery.unresponsive);
    win.removeListener("responsive", recovery.responsive);
    contents.removeListener("render-process-gone", rendererGone);
    contents.removeListener("did-fail-load", loadFailed);
  });
  return recovery;
}
