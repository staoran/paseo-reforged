import { app, Menu, Tray, type MenuItemConstructorOptions, type NativeImage } from "electron";

export interface RecoveryTrayWindow {
  // Stable native window id used when its renderer title is missing
  id: number;
  // Main-process indication that recovery is already pending
  recovering: boolean;
  /** Start recovery without asking the broken renderer to dispatch an action */
  recover(): void;
}

export interface RecoveryTray {
  /** Rebuild native actions after window membership or recovery state changes */
  refresh(): void;
  /** Release the tray when the application exits */
  dispose(): void;
}

export interface RecoveryTrayMenuItem extends Pick<
  MenuItemConstructorOptions,
  "label" | "enabled" | "type"
> {
  // Native recovery submenu targeting individual host windows
  submenu?: RecoveryTrayMenuItem[];
  /** Dispatch a main-process action without requiring a focused renderer */
  click?: () => void;
}

/** Build tray actions with an explicit target for every native host window */
export function buildRecoveryTrayMenu(
  windows: RecoveryTrayWindow[],
  openLogs: () => void,
): RecoveryTrayMenuItem[] {
  // Recovery items identify native windows without consulting their renderer
  const recoveryItems: RecoveryTrayMenuItem[] = windows.map((window) => ({
    label: window.recovering ? `Window ${window.id} — recovering…` : `Window ${window.id}`,
    enabled: !window.recovering,
    click: window.recover,
  }));
  // A single window needs no submenu to reach the recovery action
  const recover: RecoveryTrayMenuItem = {
    label: "Recover Paseo window",
    enabled: windows.length > 0,
  };
  if (windows.length === 1) {
    recover.enabled = !windows[0].recovering;
    recover.label = windows[0].recovering ? "Recovering Paseo window…" : "Recover Paseo window";
    recover.click = windows[0].recover;
  } else if (windows.length > 1) {
    recover.submenu = recoveryItems;
  }
  return [recover, { type: "separator" }, { label: "Open logs", click: openLogs }];
}

/** Keep a Windows recovery entry available even when every renderer is blank */
export function setupRecoveryTray(input: {
  // Existing application icon included in the Windows package
  icon: NativeImage;
  /** List only owned host windows rather than browser popups */
  windows(): RecoveryTrayWindow[];
  /** Open desktop logs from the main process */
  openLogs(): void;
}): RecoveryTray {
  // Retained native tray must live for the entire GUI session
  const tray = new Tray(input.icon);
  tray.setToolTip(app.name);

  /** Publish operation state without depending on frontend rendering */
  function refresh(): void {
    if (tray.isDestroyed()) return;
    tray.setContextMenu(
      Menu.buildFromTemplate(buildRecoveryTrayMenu(input.windows(), input.openLogs)),
    );
  }

  /** Destroy the tray exactly once during application teardown */
  function dispose(): void {
    app.removeListener("before-quit", dispose);
    if (!tray.isDestroyed()) tray.destroy();
  }

  refresh();
  app.once("before-quit", dispose);
  return { refresh, dispose };
}
