import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const CDP_PORT = process.env.PASEO_ELECTRON_REMOTE_DEBUGGING_PORT ?? "9223";
const EXPO_PORT = process.env.EXPO_PORT ?? "8082";
const CDP_URL = process.env.CDP_URL ?? `http://127.0.0.1:${CDP_PORT}`;
const OUTPUT_DIR = process.env.ELECTRON_VERIFY_OUTPUT_DIR ?? "/tmp/electron-verification";
const APP_URL_FRAGMENT = process.env.ELECTRON_VERIFY_APP_URL_FRAGMENT ?? `localhost:${EXPO_PORT}`;
const WORKSPACE_ID = process.env.ELECTRON_VERIFY_WORKSPACE_ID?.trim() || null;
// Windows native menu-drag stress settings; omitted values leave the full verifier portable.
const WINDOW_PROCESS_ID = Number.parseInt(process.env.ELECTRON_VERIFY_WINDOW_PID ?? "", 10) || null;
const WORKSPACE_MENU_DRAG_ONLY = process.env.ELECTRON_VERIFY_WORKSPACE_MENU_DRAG_ONLY === "1";
const WORKSPACE_MENU_TOGGLE_ITERATIONS =
  Number.parseInt(process.env.ELECTRON_VERIFY_MENU_TOGGLE_ITERATIONS ?? "", 10) || 80;
const WINDOW_HIT_TEST_SCRIPT = fileURLToPath(
  new URL("./monitor-window-hit-test.ps1", import.meta.url),
);
const TITLEBAR_UPPER_SAMPLE_Y = 22;
const TITLEBAR_LOWER_SAMPLE_Y = 60;
const REQUIRED_DESKTOP_KEYS = ["invoke", "events", "window", "dialog", "notification", "opener"];
const INTERACTIVE_SELECTOR = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "[role='button']",
  "[role='link']",
  "[role='textbox']",
  "[role='combobox']",
  "[role='tab']",
  "[role='switch']",
  "[role='checkbox']",
  "[role='slider']",
  "[role='menuitem']",
  "[tabindex]",
  "[contenteditable='true']",
].join(", ");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function captureScreenshot(page, fileName) {
  const filePath = path.join(OUTPUT_DIR, fileName);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

function rectsIntersect(left, right) {
  return (
    left.left < right.left + right.width &&
    left.left + left.width > right.left &&
    left.top < right.top + right.height &&
    left.top + left.height > right.top
  );
}

function getWindowChromeObstruction(platform, innerWidth) {
  if (platform === "darwin") {
    return { corner: "top-left", left: 0, top: 0, width: 78, height: 45 };
  }
  return {
    corner: "top-right",
    left: innerWidth - 140,
    top: 0,
    width: 140,
    height: 48,
  };
}

async function inspectSettingsGeometry(page) {
  return page.evaluate(() => {
    function rect(selector) {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) return null;
      const bounds = element.getBoundingClientRect();
      return {
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
      };
    }

    const title = document.querySelector('[data-testid="settings-detail-header-title"]');
    const headerLeft = title instanceof HTMLElement ? title.parentElement : null;
    const headerLeftBounds = headerLeft?.getBoundingClientRect() ?? null;

    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      sidebarRect: rect('[data-testid="settings-sidebar"]'),
      detailPaneRect: rect('[data-testid="settings-detail-pane"]'),
      outerAppSidebarSettingsRect: rect('[data-testid="sidebar-settings"]'),
      backButtonRect: rect('[data-testid="settings-back-to-workspace"]'),
      detailTitleRect: rect('[data-testid="settings-detail-header-title"]'),
      detailHeaderLeftRect: headerLeftBounds
        ? {
            left: headerLeftBounds.left,
            top: headerLeftBounds.top,
            width: headerLeftBounds.width,
            height: headerLeftBounds.height,
          }
        : null,
    };
  });
}

function settingsGeometryClearsWindowChrome(geometry, platform) {
  const obstruction = getWindowChromeObstruction(platform, geometry.innerWidth);
  const consumer = platform === "darwin" ? geometry.backButtonRect : geometry.detailHeaderLeftRect;
  return Boolean(consumer && !rectsIntersect(consumer, obstruction));
}

function rectHasArea(rect) {
  return Boolean(rect && rect.width > 0 && rect.height > 0);
}

async function readBridgeFullscreen(page) {
  return page.evaluate(
    async () =>
      (await window.paseoDesktop?.window?.getCurrentWindow?.()?.isFullscreen?.()) === true,
  );
}

async function setNativeFullscreen(page, fullscreen) {
  await page.evaluate(async (nextFullscreen) => {
    const win = window.paseoDesktop?.window?.getCurrentWindow?.();
    if (typeof win?.setFullscreen !== "function") throw new Error("setFullscreen is unavailable");
    await win.setFullscreen(nextFullscreen);
  }, fullscreen);
}

async function waitForBridgeFullscreen(page, expected) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if ((await readBridgeFullscreen(page)) === expected) return;
    await page.waitForTimeout(200);
  }
  throw new Error(`Timed out waiting for fullscreen=${expected}`);
}

async function inspectTitlebarRegions(page) {
  return page.evaluate((interactiveSelector) => {
    const nodes = Array.from(document.querySelectorAll("*"));
    const annotationId = "electron-verify-titlebar-style";
    const existingAnnotation = document.getElementById(annotationId);
    existingAnnotation?.remove();

    const annotationStyle = document.createElement("style");
    annotationStyle.id = annotationId;
    annotationStyle.textContent = `
      [data-electron-verify-drag="true"] {
        outline: 3px solid #ff4d4f !important;
        outline-offset: -3px !important;
      }
      [data-electron-verify-resizer="true"] {
        outline: 3px solid #52c41a !important;
        outline-offset: -3px !important;
      }
      [data-electron-verify-interactive="true"] {
        outline: 3px solid #1677ff !important;
        outline-offset: -3px !important;
      }
    `;
    document.head.appendChild(annotationStyle);

    function isVisible(element) {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0"
      );
    }

    function summarizeText(element) {
      return (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    }

    function readAppRegion(element) {
      const style = window.getComputedStyle(element);
      return style.webkitAppRegion || style.getPropertyValue("-webkit-app-region") || "none";
    }

    function rectInfo(element) {
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };
    }

    function summarizeElement(element) {
      const style = window.getComputedStyle(element);
      return {
        tagName: element.tagName.toLowerCase(),
        text: summarizeText(element),
        appRegion: readAppRegion(element),
        position: style.position,
        zIndex: style.zIndex,
        paddingLeft: Number.parseFloat(style.paddingLeft || "0"),
        paddingTop: Number.parseFloat(style.paddingTop || "0"),
        ...rectInfo(element),
      };
    }

    function isNearTop(summary) {
      return summary.top < 220;
    }

    function isTopResizer(element, overlayRect) {
      if (!(element instanceof HTMLElement) || !isVisible(element)) {
        return false;
      }
      const summary = summarizeElement(element);
      return (
        summary.appRegion === "no-drag" &&
        summary.position === "absolute" &&
        Math.abs(summary.height - 4) <= 1 &&
        Math.abs(summary.top - overlayRect.top) <= 2 &&
        Math.abs(summary.left - overlayRect.left) <= 2 &&
        Math.abs(summary.width - overlayRect.width) <= 2
      );
    }

    function summarizeInteractive(element) {
      const summary = summarizeElement(element);
      return {
        ...summary,
        testId: element.getAttribute("data-testid"),
        role: element.getAttribute("role"),
      };
    }

    function buildDragRecord(node, summary) {
      const parent = node.parentElement instanceof HTMLElement ? node.parentElement : null;
      const parentSummary = parent ? summarizeElement(parent) : null;
      const interactiveDescendants = Array.from(node.querySelectorAll(interactiveSelector))
        .filter((child) => child instanceof HTMLElement)
        .filter((child) => isVisible(child))
        .map((child) => summarizeInteractive(child));
      const siblingResizers = parent
        ? Array.from(parent.children)
            .filter((child) => child !== node)
            .filter((child) => child instanceof HTMLElement)
            .filter((child) => isTopResizer(child, summary))
            .map((child) => summarizeElement(child))
        : [];
      const parentInteractive = parent
        ? Array.from(parent.querySelectorAll(interactiveSelector))
            .filter((child) => child instanceof HTMLElement)
            .filter((child) => isVisible(child))
            .map((child) => summarizeInteractive(child))
        : [];
      const explicitNoDragInteractive = parentInteractive.filter(
        (child) => child.appRegion === "no-drag",
      );
      const record = {
        ...summary,
        parent: parentSummary,
        interactiveDescendants: interactiveDescendants.slice(0, 5),
        siblingResizers: siblingResizers.slice(0, 3),
        explicitNoDragInteractive: explicitNoDragInteractive.slice(0, 5),
        parentInteractiveCount: parentInteractive.length,
      };
      const looksLikeHostShortcut =
        isNearTop(summary) &&
        (summary.position !== "absolute" ||
          summary.text.length > 0 ||
          interactiveDescendants.length > 0 ||
          parentSummary?.appRegion === "drag");
      return { record, looksLikeHostShortcut };
    }

    const dragSummaries = [];
    const suspiciousDragHosts = [];

    for (const node of nodes) {
      if (!(node instanceof HTMLElement) || !isVisible(node)) continue;
      const summary = summarizeElement(node);
      if (summary.appRegion !== "drag") continue;
      const { record, looksLikeHostShortcut } = buildDragRecord(node, summary);
      dragSummaries.push(record);
      if (looksLikeHostShortcut) suspiciousDragHosts.push(record);
    }

    const verifiedRegions = dragSummaries
      .filter((entry) => isNearTop(entry))
      .filter((entry) => entry.position === "absolute")
      .filter((entry) => entry.text.length === 0)
      .filter((entry) => entry.parent?.appRegion !== "drag")
      .filter((entry) => entry.siblingResizers.length > 0)
      .sort(
        (left, right) =>
          right.explicitNoDragInteractive.length - left.explicitNoDragInteractive.length ||
          left.top - right.top ||
          right.width - left.width,
      );

    const candidate = verifiedRegions[0] ?? null;
    if (candidate) {
      const matchingDragNode = nodes.find((node) => {
        if (!(node instanceof HTMLElement) || !isVisible(node)) {
          return false;
        }
        const summary = summarizeElement(node);
        return (
          summary.appRegion === "drag" &&
          Math.abs(summary.top - candidate.top) <= 1 &&
          Math.abs(summary.left - candidate.left) <= 1 &&
          Math.abs(summary.width - candidate.width) <= 1 &&
          Math.abs(summary.height - candidate.height) <= 1
        );
      });
      function annotateMatchingParent(parent) {
        if (!(parent instanceof HTMLElement)) return;
        const resizers = Array.from(parent.children).filter(
          (child) => child instanceof HTMLElement && isTopResizer(child, candidate),
        );
        for (const child of resizers) {
          child.setAttribute("data-electron-verify-resizer", "true");
        }
        const interactiveChildren = Array.from(parent.querySelectorAll(interactiveSelector))
          .filter((child) => child instanceof HTMLElement)
          .filter((child) => isVisible(child))
          .filter((child) => summarizeElement(child).appRegion === "no-drag")
          .slice(0, 3);
        for (const child of interactiveChildren) {
          child.setAttribute("data-electron-verify-interactive", "true");
        }
      }

      if (matchingDragNode instanceof HTMLElement) {
        matchingDragNode.setAttribute("data-electron-verify-drag", "true");
        annotateMatchingParent(matchingDragNode.parentElement);
      }
    }

    return {
      interactiveSelector,
      dragRegionCount: dragSummaries.length,
      verifiedRegionCount: verifiedRegions.length,
      topEdgeResizers: dragSummaries
        .flatMap((entry) => entry.siblingResizers)
        .filter(
          (entry, index, entries) =>
            entries.findIndex(
              (existingEntry) =>
                Math.abs(existingEntry.top - entry.top) <= 1 &&
                Math.abs(existingEntry.left - entry.left) <= 1 &&
                Math.abs(existingEntry.width - entry.width) <= 1 &&
                Math.abs(existingEntry.height - entry.height) <= 1,
            ) === index,
        ),
      candidate,
      suspiciousDragHosts: suspiciousDragHosts.slice(0, 10),
      dragRegions: dragSummaries.slice(0, 10),
    };
  }, INTERACTIVE_SELECTOR);
}

async function inspectFullscreenWindowChrome(page, platform) {
  const initiallyFullscreen = await readBridgeFullscreen(page);

  try {
    assert(!initiallyFullscreen, "Electron verifier requires a non-fullscreen QA window");
    const before = await inspectSettingsGeometry(page);
    await setNativeFullscreen(page, true);
    await waitForBridgeFullscreen(page, true);

    const details = await page.evaluate(async () => {
      const bridge = window.paseoDesktop?.window?.getCurrentWindow?.();
      const bridgeFullscreen =
        typeof bridge?.isFullscreen === "function" ? await bridge.isFullscreen() : null;
      return { bridgeFullscreen };
    });
    const fullscreen = await inspectSettingsGeometry(page);
    const screenshot = await captureScreenshot(page, "04-fullscreen-window-chrome.png");
    const clearanceRemoved =
      platform === "darwin"
        ? Boolean(
            before.backButtonRect &&
            fullscreen.backButtonRect &&
            before.backButtonRect.top >= 45 &&
            fullscreen.backButtonRect.top < 45 &&
            fullscreen.backButtonRect.top < before.backButtonRect.top,
          )
        : Boolean(
            before.detailHeaderLeftRect &&
            fullscreen.detailHeaderLeftRect &&
            before.innerWidth -
              (before.detailHeaderLeftRect.left + before.detailHeaderLeftRect.width) >=
              140 &&
            fullscreen.innerWidth -
              (fullscreen.detailHeaderLeftRect.left + fullscreen.detailHeaderLeftRect.width) <
              40,
          );

    return {
      supported: true,
      initiallyFullscreen,
      before,
      fullscreen,
      clearanceRemoved,
      screenshot,
      ...details,
      passed: details.bridgeFullscreen === true && clearanceRemoved,
    };
  } catch (error) {
    return {
      supported: false,
      error: String(error),
      initiallyFullscreen,
    };
  } finally {
    if (await readBridgeFullscreen(page)) {
      await setNativeFullscreen(page, false);
      await waitForBridgeFullscreen(page, false);
    }
  }
}

async function inspectHalfScreenSettingsLayout(page, platform) {
  const initialBounds = await page.evaluate(() => ({
    width: window.outerWidth,
    height: window.outerHeight,
  }));

  try {
    await page.evaluate(() => {
      // Electron applies resizeTo to the native BrowserWindow. Unlike
      // page.setViewportSize, this exercises the real window/layout boundary.
      window.resizeTo(751, Math.max(window.outerHeight, 700));
    });
    await page.waitForFunction(() => window.innerWidth === 751, undefined, { timeout: 10_000 });

    const sidebar = page.getByTestId("settings-sidebar");
    const detail = page.getByTestId("settings-detail-pane");
    const outerAppSidebarSettings = page.getByTestId("sidebar-settings");
    await sidebar.waitFor({ state: "visible", timeout: 10_000 });
    await detail.waitFor({ state: "visible", timeout: 10_000 });
    await outerAppSidebarSettings.waitFor({ state: "hidden", timeout: 10_000 });

    const details = await inspectSettingsGeometry(page);
    const obstruction = getWindowChromeObstruction(platform, details.innerWidth);
    const clearsWindowChrome = settingsGeometryClearsWindowChrome(details, platform);
    const sidebarRight = details.sidebarRect
      ? details.sidebarRect.left + details.sidebarRect.width
      : null;
    const detailRight = details.detailPaneRect
      ? details.detailPaneRect.left + details.detailPaneRect.width
      : null;
    const screenshot = await captureScreenshot(page, "06-half-screen-settings.png");

    return {
      supported: true,
      initialBounds,
      ...details,
      obstruction,
      clearsWindowChrome,
      screenshot,
      passed:
        details.innerWidth === 751 &&
        details.sidebarRect !== null &&
        details.sidebarRect.width >= 300 &&
        details.detailPaneRect !== null &&
        details.detailPaneRect.width >= 400 &&
        !rectHasArea(details.outerAppSidebarSettingsRect) &&
        Math.abs(details.sidebarRect.left) <= 1 &&
        sidebarRight !== null &&
        Math.abs(sidebarRight - details.detailPaneRect.left) <= 1 &&
        detailRight !== null &&
        Math.abs(detailRight - details.innerWidth) <= 1 &&
        clearsWindowChrome,
    };
  } catch (error) {
    return { supported: false, initialBounds, error: String(error) };
  } finally {
    await page.evaluate((bounds) => window.resizeTo(bounds.width, bounds.height), initialBounds);
    await page.waitForFunction(
      (width) => Math.abs(window.outerWidth - width) <= 1,
      initialBounds.width,
      { timeout: 10_000 },
    );
  }
}

async function findAppPage(browser) {
  function findMatchingPages() {
    const matches = [];
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (page.url().includes(APP_URL_FRAGMENT) && !page.url().startsWith("devtools://")) {
          matches.push(page);
        }
      }
    }
    return matches;
  }
  async function poll(attempt) {
    const pages = findMatchingPages();
    if (pages.length > 1) {
      throw new Error(
        `Expected one Electron QA page for ${APP_URL_FRAGMENT}, found ${pages.length}`,
      );
    }
    if (pages.length === 1) return pages[0];
    if (attempt >= 29) {
      throw new Error(`Unable to find Electron app page for ${APP_URL_FRAGMENT}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    return poll(attempt + 1);
  }
  return poll(0);
}

function attachConsoleCollector(page, consoleMessages) {
  page.on("console", (message) => {
    consoleMessages.push({ type: message.type(), text: message.text() });
  });
  page.on("pageerror", (error) => {
    consoleMessages.push({ type: "pageerror", text: String(error) });
  });
}

async function navigateToWelcome(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1000);
  if (!page.url().endsWith("/welcome")) {
    await page.goto(`http://${APP_URL_FRAGMENT}/welcome`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
  }
}

/** Keeps the focused menu regression on the existing workspace page when possible. */
async function prepareVerifierPage(page) {
  if (WORKSPACE_MENU_DRAG_ONLY) {
    await page.waitForLoadState("domcontentloaded");
    return;
  }
  await navigateToWelcome(page);
}

/** Appends the native workspace-menu result using the same shape in focused and full runs. */
async function collectWorkspaceMenuDragResult(page, serverId, results) {
  const details = await inspectWorkspaceMenuDragStability(page, serverId);
  results.push({
    check: "workspace-menu-titlebar-drag-stability",
    pass: details.skipped || details.passed,
    skipped: details.skipped,
    details,
    screenshot: details.screenshot ?? null,
  });
}

/** Writes one verifier report and preserves the process exit status for failed checks. */
async function writeVerificationReport({ page, desktopStatus, results, consoleMessages }) {
  const report = {
    cdpUrl: CDP_URL,
    outputDir: OUTPUT_DIR,
    pageUrl: page.url(),
    desktopStatus,
    results,
    consoleMessages,
  };
  const reportPath = path.join(OUTPUT_DIR, "report.json");
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (results.some((result) => !result.pass)) process.exitCode = 1;
}

async function detectDesktopBridge(page) {
  return page.evaluate(() => {
    const bridge = window.paseoDesktop;
    const keys = bridge && typeof bridge === "object" ? Object.keys(bridge) : [];
    const keyTypes =
      bridge && typeof bridge === "object"
        ? Object.fromEntries(Object.entries(bridge).map(([key, value]) => [key, typeof value]))
        : {};
    return {
      exists: Boolean(bridge && typeof bridge === "object"),
      keys,
      keyTypes,
      platform: bridge?.platform ?? null,
    };
  });
}

async function navigateToSettings(page, serverId) {
  await page.evaluate((nextServerId) => {
    window.location.href = `/h/${nextServerId}/settings`;
  }, serverId);
  await page.getByTestId("settings-sidebar").waitFor({ state: "visible", timeout: 30_000 });
  await page
    .getByTestId("settings-detail-header-title")
    .waitFor({ state: "visible", timeout: 30_000 });
}

/** Navigates the real Electron renderer to the workspace used by titlebar checks. */
async function navigateToWorkspace(page, serverId) {
  assert(WORKSPACE_ID, "ELECTRON_VERIFY_WORKSPACE_ID is required for workspace checks");
  const workspacePath = `/h/${serverId}/workspace/${WORKSPACE_ID}`;
  if (new URL(page.url()).pathname !== workspacePath) {
    await page.evaluate((nextPath) => {
      window.location.href = nextPath;
    }, workspacePath);
  }
  await page
    .getByTestId("workspace-tabs-row")
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });
  await page.getByTestId("workspace-header-title").waitFor({ state: "visible", timeout: 30_000 });
}

/** Finds one horizontal point that belongs to both titlebar drag rows while the menu is closed. */
async function findWorkspaceHitTestPoint(page) {
  return page.evaluate(
    ({ upperY, lowerY }) => {
      /** Reads Chromium's computed native window hit-test region. */
      function readAppRegion(element) {
        const style = window.getComputedStyle(element);
        return style.webkitAppRegion || style.getPropertyValue("-webkit-app-region") || "none";
      }

      /** Reports whether one CSS point falls inside a client rectangle. */
      function contains(rect, x, y) {
        return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
      }

      const visibleRegions = Array.from(document.querySelectorAll("*"))
        .filter((node) => node instanceof HTMLElement)
        .map((node) => ({
          node,
          rect: node.getBoundingClientRect(),
          appRegion: readAppRegion(node),
        }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0)
        .filter(({ appRegion }) => appRegion === "drag" || appRegion === "no-drag");
      const dragRects = visibleRegions
        .filter(({ appRegion }) => appRegion === "drag")
        .map(({ rect }) => rect);
      const noDragRects = visibleRegions
        .filter(({ appRegion }) => appRegion === "no-drag")
        .map(({ rect }) => rect);
      const rightLimit = Math.max(16, window.innerWidth - 156);
      const preferredX = Math.min(rightLimit, Math.round(window.innerWidth * 0.6));
      const candidateXs = Array.from(
        { length: Math.floor((rightLimit - 16) / 4) + 1 },
        (_, index) => 16 + index * 4,
      ).sort((left, right) => Math.abs(left - preferredX) - Math.abs(right - preferredX));

      for (const x of candidateXs) {
        const upperIsDrag = dragRects.some((rect) => contains(rect, x, upperY));
        const lowerIsDrag = dragRects.some((rect) => contains(rect, x, lowerY));
        const upperIsNoDrag = noDragRects.some((rect) => contains(rect, x, upperY));
        const lowerIsNoDrag = noDragRects.some((rect) => contains(rect, x, lowerY));
        if (upperIsDrag && lowerIsDrag && !upperIsNoDrag && !lowerIsNoDrag) {
          return {
            cssX: x,
            upperY,
            lowerY,
            devicePixelRatio: window.devicePixelRatio,
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
          };
        }
      }

      return null;
    },
    { upperY: TITLEBAR_UPPER_SAMPLE_Y, lowerY: TITLEBAR_LOWER_SAMPLE_Y },
  );
}

/** Starts the external User32 observer and returns a one-shot stop/read handle. */
async function startWindowHitTestMonitor({ processId, clientX, devicePixelRatio }) {
  const physicalX = Math.round(clientX * devicePixelRatio);
  const stopFile = path.join(OUTPUT_DIR, `window-hit-test-${process.pid}-${randomUUID()}.stop`);
  await fs.rm(stopFile, { force: true });
  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      WINDOW_HIT_TEST_SCRIPT,
      "-ProcessId",
      String(processId),
      "-ClientX",
      String(physicalX),
      "-StopFile",
      stopFile,
      "-TopClientY",
      String(Math.round(2 * devicePixelRatio)),
      "-UpperClientY",
      String(Math.round(TITLEBAR_UPPER_SAMPLE_Y * devicePixelRatio)),
      "-LowerClientY",
      String(Math.round(TITLEBAR_LOWER_SAMPLE_Y * devicePixelRatio)),
    ],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  let stdout = "";
  let stderr = "";
  let ready = false;
  let resolveReady;
  let rejectReady;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const exitPromise = new Promise((resolve) => {
    child.once("close", (code, signal) => {
      if (!ready) {
        rejectReady(
          new Error(
            `Window hit-test monitor exited before READY (code=${code}, signal=${signal}): ${stderr}`,
          ),
        );
      }
      resolve({ code, signal });
    });
  });

  child.once("error", (error) => rejectReady(error));
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (!ready && /(?:^|\r?\n)READY\r?\n/.test(stdout)) {
      ready = true;
      resolveReady();
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const readyTimeout = setTimeout(() => {
    rejectReady(new Error(`Timed out waiting for window hit-test monitor: ${stderr}`));
  }, 10_000);
  try {
    await readyPromise;
  } catch (error) {
    child.kill();
    await fs.rm(stopFile, { force: true });
    throw error;
  } finally {
    clearTimeout(readyTimeout);
  }

  let stopPromise = null;
  return {
    physicalX,
    stop() {
      if (stopPromise) return stopPromise;
      stopPromise = (async () => {
        await fs.writeFile(stopFile, "stop\n", "utf8");
        try {
          const exit = await exitPromise;
          assert(
            exit.code === 0,
            `Window hit-test monitor failed (code=${exit.code}, signal=${exit.signal}): ${stderr}`,
          );
          const resultLine = stdout
            .trim()
            .split(/\r?\n/)
            .toReversed()
            .find((line) => line.startsWith("{"));
          assert(resultLine, `Window hit-test monitor returned no JSON result: ${stdout}`);
          return JSON.parse(resultLine);
        } finally {
          await fs.rm(stopFile, { force: true });
        }
      })();
      return stopPromise;
    },
  };
}

/** Returns true only when every native sample has the expected hit-test result. */
function histogramContainsOnly(histogram, expectedHit) {
  const entries = Object.entries(histogram ?? {}).filter(([, count]) => count > 0);
  return entries.length === 1 && entries[0][0] === String(expectedHit);
}

/** Captures the native-region geometry contributed by the currently open menu backdrop. */
async function inspectWorkspaceMenuBackdrop(page) {
  return page.evaluate(() => {
    /** Reduces one backdrop node to the geometry relevant to native hit testing. */
    function summarize(element) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        tagName: element.tagName.toLowerCase(),
        appRegion: style.webkitAppRegion || style.getPropertyValue("-webkit-app-region") || "none",
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };
    }

    const backdrop = document.querySelector('[data-testid="workspace-header-menu-backdrop"]');
    const titlebarBand = document.querySelector(
      '[data-testid="workspace-header-menu-titlebar-drag"]',
    );
    if (!(backdrop instanceof HTMLElement)) {
      throw new Error("Workspace menu backdrop is not mounted");
    }

    return {
      backdrop: summarize(backdrop),
      titlebarBand: titlebarBand instanceof HTMLElement ? summarize(titlebarBand) : null,
      titlebarRegions: Array.from(titlebarBand?.querySelectorAll("*") ?? [])
        .filter((node) => node instanceof HTMLElement)
        .map((node) => summarize(node))
        .filter((entry) => entry.appRegion !== "none"),
    };
  });
}

/** Repeatedly opens and closes the real workspace menu while User32 samples both drag rows. */
async function inspectWorkspaceMenuDragStability(page, serverId) {
  if (process.platform !== "win32") {
    return { skipped: true, reason: "WM_NCHITTEST is only available on Windows" };
  }
  if (!WORKSPACE_ID) {
    return { skipped: true, reason: "ELECTRON_VERIFY_WORKSPACE_ID is not set" };
  }
  if (!WINDOW_PROCESS_ID) {
    return { skipped: true, reason: "ELECTRON_VERIFY_WINDOW_PID is not set" };
  }

  await navigateToWorkspace(page, serverId);
  const trigger = page.getByTestId("workspace-header-menu-trigger");
  const backdrop = page.getByTestId("workspace-header-menu-backdrop");
  await trigger.waitFor({ state: "visible", timeout: 10_000 });
  if ((await backdrop.count()) > 0) {
    await backdrop.evaluate((node) => node.click());
    await backdrop.waitFor({ state: "detached", timeout: 10_000 });
  }

  const point = await findWorkspaceHitTestPoint(page);
  assert(point, "Unable to find one unobstructed drag point shared by both workspace header rows");

  await trigger.evaluate((node) => node.click());
  await backdrop.waitFor({ state: "attached", timeout: 10_000 });
  const backdropRegions = await inspectWorkspaceMenuBackdrop(page);
  const openStateMonitor = await startWindowHitTestMonitor({
    processId: WINDOW_PROCESS_ID,
    clientX: point.cssX,
    devicePixelRatio: point.devicePixelRatio,
  });
  await page.waitForTimeout(250);
  const openStateHitTests = await openStateMonitor.stop();
  await backdrop.evaluate((node) => node.click());
  await backdrop.waitFor({ state: "detached", timeout: 10_000 });
  await page.waitForTimeout(20);

  const transitionMonitor = await startWindowHitTestMonitor({
    processId: WINDOW_PROCESS_ID,
    clientX: point.cssX,
    devicePixelRatio: point.devicePixelRatio,
  });
  let toggleError = null;
  try {
    for (let iteration = 0; iteration < WORKSPACE_MENU_TOGGLE_ITERATIONS; iteration += 1) {
      await trigger.evaluate((node) => node.click());
      await backdrop.waitFor({ state: "attached", timeout: 2_000 });
      await page.waitForTimeout(1);
      await backdrop.evaluate((node) => node.click());
      await backdrop.waitFor({ state: "detached", timeout: 2_000 });
      await page.waitForTimeout(1);
    }
  } catch (error) {
    toggleError = String(error);
  } finally {
    if ((await backdrop.count()) > 0) {
      await backdrop.evaluate((node) => node.click()).catch(() => undefined);
      await backdrop.waitFor({ state: "detached", timeout: 2_000 }).catch(() => undefined);
    }
  }
  const transitionHitTests = await transitionMonitor.stop();
  const closedStateMonitor = await startWindowHitTestMonitor({
    processId: WINDOW_PROCESS_ID,
    clientX: point.cssX,
    devicePixelRatio: point.devicePixelRatio,
  });
  await page.waitForTimeout(250);
  const closedStateHitTests = await closedStateMonitor.stop();
  const screenshot = await captureScreenshot(page, "09-workspace-menu-drag-stability.png");
  const openStatePassed =
    histogramContainsOnly(openStateHitTests.topHistogram, 12) &&
    histogramContainsOnly(openStateHitTests.upperHistogram, 2) &&
    histogramContainsOnly(openStateHitTests.lowerHistogram, 1);
  const closedStatePassed =
    histogramContainsOnly(closedStateHitTests.topHistogram, 12) &&
    histogramContainsOnly(closedStateHitTests.upperHistogram, 2) &&
    histogramContainsOnly(closedStateHitTests.lowerHistogram, 2);

  return {
    skipped: false,
    route: page.url(),
    iterations: WORKSPACE_MENU_TOGGLE_ITERATIONS,
    point,
    backdropRegions,
    openStateHitTests,
    transitionHitTests,
    closedStateHitTests,
    toggleError,
    screenshot,
    passed:
      toggleError === null &&
      openStatePassed &&
      closedStatePassed &&
      transitionHitTests.sampleCount > 0 &&
      transitionHitTests.deadZoneCount === 0,
  };
}

async function inspectWorkspaceDragContinuity(page, serverId) {
  if (!WORKSPACE_ID) {
    return { skipped: true, reason: "ELECTRON_VERIFY_WORKSPACE_ID is not set" };
  }

  await navigateToWorkspace(page, serverId);

  const dragRegions = await inspectTitlebarRegions(page);
  const continuity = measureWorkspaceDragContinuity(dragRegions);
  const screenshot = await captureScreenshot(page, "08-workspace-drag-continuity.png");
  return {
    skipped: false,
    route: page.url(),
    dragRegions,
    continuity,
    screenshot,
    // Ownership is already checked on the settings route; this slice only owns row continuity.
    passed: continuity.passed,
  };
}

async function dismissOuterAppSidebarIfVisible(page) {
  const sidebarSettingsButton = page.locator('[data-testid="sidebar-settings"]').first();
  const menuToggle = page.locator('[data-testid="menu-button"]').first();
  const bothVisible =
    (await sidebarSettingsButton.isVisible().catch(() => false)) &&
    (await menuToggle.isVisible().catch(() => false));
  if (!bothVisible) return false;
  await menuToggle.click();
  await sidebarSettingsButton.waitFor({ state: "hidden", timeout: 10_000 });
  await page.waitForTimeout(500);
  return true;
}

async function restoreOuterAppSidebar(page, wasDismissed) {
  if (!wasDismissed) return;
  const menuToggle = page.locator('[data-testid="menu-button"]').first();
  const sidebarSettingsButton = page.locator('[data-testid="sidebar-settings"]').first();
  await menuToggle.click();
  await sidebarSettingsButton.waitFor({ state: "visible", timeout: 10_000 });
}

async function clearTitlebarAnnotations(page) {
  await page.evaluate(() => {
    document.getElementById("electron-verify-titlebar-style")?.remove();
    for (const attribute of [
      "data-electron-verify-drag",
      "data-electron-verify-resizer",
      "data-electron-verify-interactive",
    ]) {
      for (const element of document.querySelectorAll(`[${attribute}]`)) {
        element.removeAttribute(attribute);
      }
    }
  });
}

function evaluateDragRegionCheck(dragRegionCheck) {
  return (
    dragRegionCheck.dragRegionCount > 0 &&
    dragRegionCheck.verifiedRegionCount > 0 &&
    Boolean(dragRegionCheck.candidate) &&
    dragRegionCheck.candidate.top < 220 &&
    dragRegionCheck.candidate.parent?.appRegion !== "drag" &&
    dragRegionCheck.candidate.siblingResizers.length > 0 &&
    dragRegionCheck.suspiciousDragHosts.length === 0
  );
}

function evaluateTopEdgeResizerOwnership(dragRegionCheck) {
  return (
    dragRegionCheck.topEdgeResizers.length > 0 &&
    dragRegionCheck.topEdgeResizers.every((resizer) => Math.abs(resizer.top) <= 1)
  );
}

function measureWorkspaceDragContinuity(dragRegionCheck) {
  const regions = dragRegionCheck.dragRegions
    .filter((region) => region.top >= 0 && region.top < 220)
    .map((region) => ({
      top: region.top,
      left: region.left,
      width: region.width,
      height: region.height,
      right: region.left + region.width,
      bottom: region.top + region.height,
    }));
  const adjacentPairs = [];

  for (const lower of regions) {
    const upper = regions
      .filter((candidate) => candidate.top < lower.top)
      .filter((candidate) => {
        const horizontalOverlap = Math.max(
          0,
          Math.min(candidate.right, lower.right) - Math.max(candidate.left, lower.left),
        );
        return horizontalOverlap >= Math.min(candidate.width, lower.width) * 0.9;
      })
      .filter((candidate) => lower.top - candidate.bottom >= -1)
      .filter((candidate) => lower.top - candidate.bottom <= 4)
      .sort((left, right) => right.bottom - left.bottom)[0];

    if (upper) {
      adjacentPairs.push({ upper, lower, gap: lower.top - upper.bottom });
    }
  }

  return {
    adjacentPairs,
    passed: adjacentPairs.length > 0 && adjacentPairs.every((pair) => pair.gap <= 0),
  };
}

function evaluateTrafficLightAvoidance(dragRegionCheck) {
  const firstInteractive = dragRegionCheck.candidate?.explicitNoDragInteractive?.find(
    (entry) => entry.testId === "settings-back-to-workspace",
  );
  return Boolean(
    firstInteractive &&
    !rectsIntersect(firstInteractive, { left: 0, top: 0, width: 78, height: 45 }),
  );
}

async function collectDragRegionResults(page, dragRegionCheck, dragScreenshot, results) {
  results.push({
    check: "titlebar-drag-structure",
    pass: evaluateDragRegionCheck(dragRegionCheck),
    details: dragRegionCheck,
    screenshot: dragScreenshot,
  });

  results.push({
    check: "titlebar-top-edge-resizer-ownership",
    pass: evaluateTopEdgeResizerOwnership(dragRegionCheck),
    details: {
      topEdgeResizers: dragRegionCheck.topEdgeResizers,
      note: "Every 4px no-drag resize strip must belong to the physical viewport top edge.",
    },
    screenshot: dragScreenshot,
  });

  const trafficLightScreenshot = await captureScreenshot(page, "04-traffic-light-avoidance.png");
  const firstInteractive = dragRegionCheck.candidate?.explicitNoDragInteractive?.find(
    (entry) => entry.testId === "settings-back-to-workspace",
  );
  results.push({
    check: "traffic-light-avoidance",
    pass: process.platform === "darwin" ? evaluateTrafficLightAvoidance(dragRegionCheck) : true,
    skipped: process.platform !== "darwin",
    details: {
      platform: process.platform,
      obstruction: process.platform === "darwin" ? { width: 78, height: 45 } : null,
      firstInteractive: firstInteractive ?? null,
      note:
        process.platform === "darwin"
          ? "The first interactive sidebar row must not intersect the traffic-light rectangle."
          : "Skipped here; the half-screen check exercises the right-side obstruction on Windows/Linux.",
      candidate: dragRegionCheck.candidate,
    },
    screenshot: trafficLightScreenshot,
  });

  results.push({
    check: "interactive-no-drag-layering",
    pass:
      Boolean(dragRegionCheck.candidate) &&
      Array.isArray(dragRegionCheck.candidate.explicitNoDragInteractive) &&
      dragRegionCheck.candidate.explicitNoDragInteractive.length > 0,
    details: {
      candidate: dragRegionCheck.candidate,
      explicitNoDragInteractive: dragRegionCheck.candidate?.explicitNoDragInteractive ?? [],
    },
    screenshot: dragScreenshot,
  });
}

async function collectSettingsSplitResult(page, serverId, desktopStatus, results) {
  const geometry = await inspectSettingsGeometry(page);
  const sidebarRight = geometry.sidebarRect
    ? geometry.sidebarRect.left + geometry.sidebarRect.width
    : null;
  const settingsScreenshot = await captureScreenshot(page, "05-settings-split.png");
  results.push({
    check: "settings-split",
    pass: Boolean(
      geometry.sidebarRect &&
      geometry.detailPaneRect &&
      geometry.detailTitleRect &&
      sidebarRight !== null &&
      Math.abs(sidebarRight - geometry.detailPaneRect.left) <= 1,
    ),
    details: {
      route: page.url(),
      serverId,
      desktopStatus,
      geometry,
    },
    screenshot: settingsScreenshot,
  });
}

async function main() {
  await ensureDir(OUTPUT_DIR);

  const browser = await chromium.connectOverCDP(CDP_URL);
  let page = null;
  let initialPageUrl = null;
  let outerSidebarDismissed = false;

  try {
    page = await findAppPage(browser);
    initialPageUrl = page.url();
    const consoleMessages = [];
    const results = [];

    attachConsoleCollector(page, consoleMessages);
    await prepareVerifierPage(page);

    const welcomeScreenshot = await captureScreenshot(page, "01-welcome.png");
    const desktopDetection = await detectDesktopBridge(page);

    const hasExpectedDesktopShape =
      desktopDetection.exists &&
      REQUIRED_DESKTOP_KEYS.every((key) => desktopDetection.keys.includes(key));
    assert(
      ["darwin", "win32", "linux"].includes(desktopDetection.platform),
      `Unexpected Electron platform: ${desktopDetection.platform}`,
    );

    results.push({
      check: "desktop-detection",
      pass: hasExpectedDesktopShape,
      details: desktopDetection,
      screenshot: welcomeScreenshot,
    });

    const desktopStatus = await page.evaluate(() =>
      window.paseoDesktop.invoke("desktop_daemon_status"),
    );
    assert(
      typeof desktopStatus?.serverId === "string" && desktopStatus.serverId.trim().length > 0,
      "desktop_daemon_status did not return a serverId",
    );

    const serverId = desktopStatus.serverId.trim();
    if (WORKSPACE_MENU_DRAG_ONLY) {
      assert(WORKSPACE_ID, "ELECTRON_VERIFY_WORKSPACE_ID is required in menu-drag-only mode");
      assert(WINDOW_PROCESS_ID, "ELECTRON_VERIFY_WINDOW_PID is required in menu-drag-only mode");
      await collectWorkspaceMenuDragResult(page, serverId, results);
      await writeVerificationReport({ page, desktopStatus, results, consoleMessages });
      return;
    }

    await navigateToSettings(page, serverId);

    await captureScreenshot(page, "02-settings-page.png");
    outerSidebarDismissed = await dismissOuterAppSidebarIfVisible(page);

    const dragRegionCheck = await inspectTitlebarRegions(page);
    const dragScreenshot = await captureScreenshot(page, "03-drag-region.png");
    await collectDragRegionResults(page, dragRegionCheck, dragScreenshot, results);

    const fullscreenDetails = await inspectFullscreenWindowChrome(page, desktopDetection.platform);
    results.push({
      check: "fullscreen-window-chrome",
      pass: fullscreenDetails.supported && fullscreenDetails.passed,
      details: fullscreenDetails,
      screenshot: fullscreenDetails.screenshot ?? null,
    });

    await collectSettingsSplitResult(page, serverId, desktopStatus, results);

    if (outerSidebarDismissed) {
      await restoreOuterAppSidebar(page, outerSidebarDismissed);
      outerSidebarDismissed = false;
    }

    const halfScreenDetails = await inspectHalfScreenSettingsLayout(
      page,
      desktopDetection.platform,
    );
    results.push({
      check: "half-screen-settings-layout",
      pass: halfScreenDetails.supported && halfScreenDetails.passed,
      details: halfScreenDetails,
      screenshot: halfScreenDetails.screenshot ?? null,
    });

    const workspaceDragContinuity = await inspectWorkspaceDragContinuity(page, serverId);
    results.push({
      check: "workspace-titlebar-drag-continuity",
      pass: workspaceDragContinuity.skipped || workspaceDragContinuity.passed,
      skipped: workspaceDragContinuity.skipped,
      details: workspaceDragContinuity,
      screenshot: workspaceDragContinuity.screenshot ?? null,
    });

    await collectWorkspaceMenuDragResult(page, serverId, results);

    const desktopDetectionScreenshot = await captureScreenshot(page, "07-desktop-detection.png");
    results[0].screenshot = desktopDetectionScreenshot;

    await writeVerificationReport({ page, desktopStatus, results, consoleMessages });
  } finally {
    if (page && !page.isClosed()) {
      await clearTitlebarAnnotations(page);
      await restoreOuterAppSidebar(page, outerSidebarDismissed);
      if (initialPageUrl && page.url() !== initialPageUrl) {
        await page.goto(initialPageUrl, { waitUntil: "domcontentloaded" });
      }
    }
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
