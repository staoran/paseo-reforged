import { describe, expect, it } from "vitest";
import { buildRecoveryTrayMenu } from "./recovery-tray.js";

describe("recovery tray", () => {
  it("targets the single host window and exposes logs independently", () => {
    // Actions invoked by native menu clicks
    const calls: string[] = [];
    // Native menu for a single white-screen window
    const menu = buildRecoveryTrayMenu(
      [{ id: 7, recovering: false, recover: () => calls.push("host-7") }],
      () => calls.push("logs"),
    );
    expect(menu[0].label).toBe("Recover Paseo window");
    expect(menu[0].enabled).toBe(true);
    expect(menu[0].submenu).toBeUndefined();
    menu[0].click?.();
    menu[2].click?.();
    expect(calls).toEqual(["host-7", "logs"]);
  });

  it("keeps multi-window recovery targets separate and disables pending recovery", () => {
    // Menu for two independently owned windows
    const menu = buildRecoveryTrayMenu(
      [
        { id: 1, recovering: true, recover: () => {} },
        { id: 2, recovering: false, recover: () => {} },
      ],
      () => {},
    );
    // Submenu generated as plain constructor options
    const submenu = menu[0].submenu;
    if (!Array.isArray(submenu)) throw new Error("Expected window submenu");
    expect(submenu.map(({ label, enabled }) => ({ label, enabled }))).toEqual([
      { label: "Window 1 — recovering…", enabled: false },
      { label: "Window 2", enabled: true },
    ]);
  });

  it("removes closed windows and leaves logs available", () => {
    // Menu after the last host closes during teardown
    const menu = buildRecoveryTrayMenu([], () => {});
    expect(menu[0].enabled).toBe(false);
    expect(menu[0].submenu).toBeUndefined();
    expect(menu[2].label).toBe("Open logs");
  });
});
