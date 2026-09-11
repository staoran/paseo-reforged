/**
 * @vitest-environment jsdom
 */
import { act } from "@testing-library/react";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { i18n } from "@/i18n/i18next";
import { SidebarWorkspaceActivityTime } from "./sidebar-workspace-activity-time";
import {
  resolveTrailingActionVisibility,
  SidebarWorkspaceRowContent,
} from "./sidebar-workspace-row-content";
import { SidebarWorkspaceTrailingContent } from "./workspace-trailing";
import type { WorkspaceServiceSummary } from "./workspace-meta-row";

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      addEventListener: () => {},
      addListener: () => {},
      dispatchEvent: () => false,
      matches: false,
      media: "",
      onchange: null,
      removeEventListener: () => {},
      removeListener: () => {},
    }),
  });
});

vi.mock("@/hooks/use-settings", () => ({
  useAppSettings: () => ({ settings: { workspaceTitleSource: "title" } }),
}));

vi.mock("@/components/workspace-hover-card", () => ({
  WorkspaceHoverCard: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/ui/loading-spinner", () => ({ LoadingSpinner: () => null }));
vi.mock("@/components/synced-loader", () => ({ SyncedLoader: () => null }));
vi.mock("@/git/forge-icon", () => ({ ForgeBrandIcon: () => null }));
vi.mock("@/utils/open-external-url", () => ({ openExternalUrl: () => Promise.resolve() }));
vi.mock("lucide-react-native", async () => {
  const { createElement } = await import("react");

  return {
    Bot: ({ uniProps }: { uniProps?: (theme: unknown) => { color?: string } }) =>
      createElement("svg", {
        "data-testid": "workspace-runtime-resident-icon",
        style: {
          color: uniProps?.({
            colors: { statusDotWarning: "#b37824", statusSuccess: "#15803d" },
          }).color,
        },
      }),
    CircleAlert: () => null,
    ExternalLink: () => null,
    Folder: () => null,
    FolderGit2: () => null,
    GitBranch: () => null,
    GitMerge: () => null,
    GitPullRequest: () => null,
    GitPullRequestClosed: () => null,
    Globe: () => null,
    Monitor: () => null,
    Server: () => null,
    SquareTerminal: () => null,
  };
});

const ROW_WORKSPACE: SidebarWorkspaceEntry = {
  workspaceKey: "srv:ws-1",
  serverId: "srv",
  workspaceId: "ws-1",
  projectViewKey: "project",
  projectName: "Project",
  projectRootPath: "/repo",
  workspaceDirectory: "/repo/ws-1",
  workspaceDirectoryLabel: "ws-1",
  projectKind: "git",
  workspaceKind: "worktree",
  name: "feature",
  title: null,
  currentBranch: null,
  statusBucket: "done",
  hasUnreadAttention: false,
  hasLastExitActiveMarker: false,
  statusEnteredAt: null,
  lastActivityAt: new Date("2026-08-03T06:55:00.000Z"),
  defaultAgentId: null,
  residentAgentCount: 0,
  archivingAt: null,
  diffStat: null,
  prHint: null,
  archiveHasUncommittedChanges: null,
  archiveUnpushedCommitCount: null,
  scripts: [],
  hasRunningScripts: false,
};

const ROW_WITHOUT_ACTIVITY: SidebarWorkspaceEntry = {
  ...ROW_WORKSPACE,
  lastActivityAt: null,
};

const ROW_WITH_RESIDENT_AGENTS: SidebarWorkspaceEntry = {
  ...ROW_WORKSPACE,
  residentAgentCount: 2,
};

/** Marked row fixture used to verify the last-exit reminder treatment. */
const ROW_WITH_LAST_EXIT_ACTIVE_MARKER: SidebarWorkspaceEntry = {
  ...ROW_WORKSPACE,
  hasLastExitActiveMarker: true,
};

/** Marked row with live residents used to verify warning-state precedence. */
const ROW_WITH_LAST_EXIT_ACTIVE_MARKER_AND_RESIDENT_AGENTS: SidebarWorkspaceEntry = {
  ...ROW_WITH_RESIDENT_AGENTS,
  hasLastExitActiveMarker: true,
};

/** Stable service metadata fixture used to verify the Agent's trailing position. */
const RUNNING_SERVICE_SUMMARY: WorkspaceServiceSummary = { name: "web", health: null };

describe("resolveTrailingActionVisibility", () => {
  it("uses compact activity time as the workspace menu trigger", () => {
    const visibility = resolveTrailingActionVisibility({
      workspace: ROW_WORKSPACE,
      trailing: "timestamp",
      hasArchiveAction: true,
      isHovered: false,
      isTouchPlatform: true,
      showShortcut: false,
    });

    expect(visibility).toMatchObject({
      showTrailing: true,
      showKebab: false,
      showTrailingMenuTrigger: true,
      showScrim: false,
      renderSlot: true,
      reserveSlotWidth: true,
    });
  });

  it("uses compact diff statistics as the workspace menu trigger", () => {
    const visibility = resolveTrailingActionVisibility({
      workspace: { ...ROW_WORKSPACE, diffStat: { additions: 12, deletions: 3 } },
      trailing: "diff",
      hasArchiveAction: true,
      isHovered: false,
      isTouchPlatform: true,
      showShortcut: false,
    });

    expect(visibility).toMatchObject({
      showTrailing: true,
      showKebab: false,
      showTrailingMenuTrigger: true,
    });
  });

  it("keeps a standalone compact menu when the chosen trailing fact is unavailable", () => {
    const visibility = resolveTrailingActionVisibility({
      workspace: ROW_WITHOUT_ACTIVITY,
      trailing: "timestamp",
      hasArchiveAction: true,
      isHovered: false,
      isTouchPlatform: true,
      showShortcut: false,
    });

    expect(visibility).toMatchObject({
      showTrailing: false,
      showKebab: true,
      showTrailingMenuTrigger: false,
      reserveSlotWidth: true,
    });
  });

  it("keeps the desktop hover overlay behavior", () => {
    const visibility = resolveTrailingActionVisibility({
      workspace: ROW_WORKSPACE,
      trailing: "timestamp",
      hasArchiveAction: true,
      isHovered: true,
      isTouchPlatform: false,
      showShortcut: false,
    });

    expect(visibility).toMatchObject({
      showTrailing: true,
      showKebab: true,
      showTrailingMenuTrigger: false,
      showScrim: true,
    });
  });
});

describe("SidebarWorkspaceActivityTime", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(async () => {
    if (root) {
      act(() => root?.unmount());
    }
    root = null;
    container?.remove();
    container = null;
    vi.useRealTimers();
    await i18n.changeLanguage("en");
  });

  it("shows the workspace's last activity as relative time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T07:00:00.000Z"));
    await i18n.changeLanguage("en");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <I18nextProvider i18n={i18n}>
          <SidebarWorkspaceActivityTime lastActivityAt={new Date("2026-08-03T06:55:00.000Z")} />
        </I18nextProvider>,
      );
    });

    expect(container.textContent).toBe("5m");
  });

  it("shows the compact now label", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T07:00:00.000Z"));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <I18nextProvider i18n={i18n}>
          <SidebarWorkspaceActivityTime lastActivityAt={new Date("2026-08-03T06:59:30.000Z")} />
        </I18nextProvider>,
      );
    });

    expect(container.textContent).toBe("now");
  });

  it("refreshes when elapsed activity crosses a minute boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T07:00:00.000Z"));
    await i18n.changeLanguage("en");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <I18nextProvider i18n={i18n}>
          <SidebarWorkspaceActivityTime lastActivityAt={new Date("2026-08-03T06:59:30.000Z")} />
        </I18nextProvider>,
      );
    });
    expect(container.textContent).toBe("now");

    act(() => {
      vi.advanceTimersByTime(60_001);
    });

    expect(container.textContent).toBe("1m");
  });

  it("renders the activity time before resident Agent status in the shared workspace row", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T07:00:00.000Z"));
    await i18n.changeLanguage("en");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <I18nextProvider i18n={i18n}>
          <SidebarWorkspaceRowContent
            workspace={ROW_WITH_RESIDENT_AGENTS}
            backdrop="surfaceSidebar"
            isHovered={false}
            isLoading={false}
          >
            <SidebarWorkspaceTrailingContent
              workspace={ROW_WITH_RESIDENT_AGENTS}
              trailing="timestamp"
            />
          </SidebarWorkspaceRowContent>
        </I18nextProvider>,
      );
    });

    expect(container.textContent).toContain("5m");
    const activityTime = container.querySelector('[data-testid="sidebar-workspace-activity-time"]');
    const residentIndicator = container.querySelector(
      '[data-testid="workspace-runtime-resident-indicator"]',
    );
    if (!activityTime || !residentIndicator) {
      throw new Error("Expected activity time and resident Agent indicator");
    }
    expect(
      activityTime.compareDocumentPosition(residentIndicator) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("keeps resident Agent status as the final metadata item without a separator", async () => {
    await i18n.changeLanguage("en");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <I18nextProvider i18n={i18n}>
          <SidebarWorkspaceRowContent
            workspace={ROW_WITH_RESIDENT_AGENTS}
            serviceSummary={RUNNING_SERVICE_SUMMARY}
            backdrop="surfaceSidebar"
            isHovered={false}
            isLoading={false}
          />
        </I18nextProvider>,
      );
    });

    const residentIndicator = container.querySelector(
      '[data-testid="workspace-runtime-resident-indicator"]',
    );
    if (!residentIndicator) {
      throw new Error("Expected resident Agent indicator");
    }
    expect(residentIndicator.parentElement?.lastElementChild).toBe(residentIndicator);
    expect(residentIndicator.previousElementSibling?.textContent).toBe("web");
  });

  it("omits the activity time when the workspace has no activity", async () => {
    await i18n.changeLanguage("en");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <I18nextProvider i18n={i18n}>
          <SidebarWorkspaceRowContent
            workspace={ROW_WITHOUT_ACTIVITY}
            backdrop="surfaceSidebar"
            isHovered={false}
            isLoading={false}
          >
            <SidebarWorkspaceTrailingContent
              workspace={ROW_WITHOUT_ACTIVITY}
              trailing="timestamp"
            />
          </SidebarWorkspaceRowContent>
        </I18nextProvider>,
      );
    });

    expect(container.querySelector('[data-testid="sidebar-workspace-activity-time"]')).toBeNull();
  });

  it("shows a warning Bot in the resident Agent position until the workspace is opened", async () => {
    await i18n.changeLanguage("en");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <I18nextProvider i18n={i18n}>
          <SidebarWorkspaceRowContent
            workspace={ROW_WITH_LAST_EXIT_ACTIVE_MARKER}
            backdrop="surfaceSidebar"
            isHovered={false}
            isLoading={false}
          />
        </I18nextProvider>,
      );
    });

    const warningIndicator = container.querySelector<HTMLElement>(
      '[data-testid="workspace-runtime-resident-indicator"]',
    );
    const warningIcon = warningIndicator?.querySelector<HTMLElement>(
      '[data-testid="workspace-runtime-resident-icon"]',
    );
    if (!warningIndicator || !warningIcon) {
      throw new Error("Expected last-exit warning in the resident Agent position");
    }
    expect(window.getComputedStyle(warningIcon).color).toBe("rgb(179, 120, 36)");
    expect(warningIndicator.getAttribute("aria-label")).toBe(
      "Agent was running when Paseo last quit",
    );
    expect(warningIndicator.getAttribute("role")).toBe("img");
    expect(container.querySelector('[data-testid="workspace-last-exit-active-marker"]')).toBeNull();

    act(() => {
      root?.render(
        <I18nextProvider i18n={i18n}>
          <SidebarWorkspaceRowContent
            workspace={ROW_WITH_LAST_EXIT_ACTIVE_MARKER_AND_RESIDENT_AGENTS}
            backdrop="surfaceSidebar"
            isHovered={false}
            isLoading={false}
          />
        </I18nextProvider>,
      );
    });

    const warningIndicatorWithCount = container.querySelector<HTMLElement>(
      '[data-testid="workspace-runtime-resident-indicator"]',
    );
    const warningIconWithCount = warningIndicatorWithCount?.querySelector<HTMLElement>(
      '[data-testid="workspace-runtime-resident-icon"]',
    );
    if (!warningIconWithCount) {
      throw new Error("Expected warning Bot while resident Agents remain");
    }
    expect(window.getComputedStyle(warningIconWithCount).color).toBe("rgb(179, 120, 36)");
    expect(
      warningIndicatorWithCount?.querySelector<HTMLElement>(
        '[data-testid="workspace-runtime-resident-count"]',
      )?.textContent,
    ).toBe("2");

    act(() => {
      root?.render(
        <I18nextProvider i18n={i18n}>
          <SidebarWorkspaceRowContent
            workspace={ROW_WITH_RESIDENT_AGENTS}
            backdrop="surfaceSidebar"
            isHovered={false}
            isLoading={false}
          />
        </I18nextProvider>,
      );
    });

    const restoredIndicator = container.querySelector<HTMLElement>(
      '[data-testid="workspace-runtime-resident-indicator"]',
    );
    const restoredIcon = restoredIndicator?.querySelector<HTMLElement>(
      '[data-testid="workspace-runtime-resident-icon"]',
    );
    if (!restoredIndicator || !restoredIcon) {
      throw new Error("Expected live resident Agent indicator after warning clears");
    }
    expect(window.getComputedStyle(restoredIcon).color).toBe("rgb(21, 128, 61)");
    expect(restoredIndicator.getAttribute("aria-label")).toBe("Resident Agent runtime count: 2");

    act(() => {
      root?.render(
        <I18nextProvider i18n={i18n}>
          <SidebarWorkspaceRowContent
            workspace={ROW_WORKSPACE}
            backdrop="surfaceSidebar"
            isHovered={false}
            isLoading={false}
          />
        </I18nextProvider>,
      );
    });

    expect(
      container.querySelector('[data-testid="workspace-runtime-resident-indicator"]'),
    ).toBeNull();
  });
});
