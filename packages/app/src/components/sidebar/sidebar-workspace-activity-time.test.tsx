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
import { SidebarWorkspaceRowContent } from "./sidebar-workspace-row-content";

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

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: () => ({ label: {} }),
  },
  useUnistyles: () => ({ rt: { breakpoint: "md" } }),
  withUnistyles: (component: unknown) => component,
}));

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
vi.mock("lucide-react-native", () => ({
  Bot: () => null,
  CircleAlert: () => null,
  ExternalLink: () => null,
  Folder: () => null,
  FolderGit2: () => null,
  GitPullRequest: () => null,
  Globe: () => null,
  Monitor: () => null,
  SquareTerminal: () => null,
}));

const ROW_WORKSPACE: SidebarWorkspaceEntry = {
  workspaceKey: "srv:ws-1",
  serverId: "srv",
  workspaceId: "ws-1",
  projectKey: "project",
  projectName: "Project",
  projectRootPath: "/repo",
  workspaceDirectory: "/repo/ws-1",
  projectKind: "git",
  workspaceKind: "worktree",
  name: "feature",
  title: null,
  currentBranch: null,
  statusBucket: "done",
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

function disableRelativeTimeFormat(): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, "RelativeTimeFormat");
  Object.defineProperty(Intl, "RelativeTimeFormat", {
    configurable: true,
    value: undefined,
  });

  return () => {
    if (descriptor) {
      Object.defineProperty(Intl, "RelativeTimeFormat", descriptor);
    } else {
      Reflect.deleteProperty(Intl, "RelativeTimeFormat");
    }
  };
}

const FALLBACK_CASES = [
  ["minute", "2026-08-03T06:55:00.000Z", "5分钟前"],
  ["hour", "2026-08-03T05:00:00.000Z", "2小时前"],
  ["day", "2026-08-01T07:00:00.000Z", "2天前"],
  ["week", "2026-07-20T07:00:00.000Z", "2周前"],
] as const;

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

    expect(container.textContent).toBe("5m ago");
  });

  it("shows the localized just-now label", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T07:00:00.000Z"));
    await i18n.changeLanguage("zh-CN");
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

    expect(container.textContent).toBe("刚刚");
  });

  it.each(FALLBACK_CASES)(
    "shows localized %s activity time when RelativeTimeFormat is unavailable",
    async (_unit, lastActivityAt, expected) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-03T07:00:00.000Z"));
      await i18n.changeLanguage("zh-CN");
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      const restoreRelativeTimeFormat = disableRelativeTimeFormat();

      try {
        act(() => {
          root?.render(
            <I18nextProvider i18n={i18n}>
              <SidebarWorkspaceActivityTime lastActivityAt={new Date(lastActivityAt)} />
            </I18nextProvider>,
          );
        });

        expect(container.textContent).toBe(expected);
      } finally {
        restoreRelativeTimeFormat();
      }
    },
  );

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
    expect(container.textContent).toBe("just now");

    act(() => {
      vi.advanceTimersByTime(31_000);
    });

    expect(container.textContent).toBe("1m ago");
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
            isHovered={false}
            isLoading={false}
          />
        </I18nextProvider>,
      );
    });

    expect(container.textContent).toContain("5m ago");
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
            isHovered={false}
            isLoading={false}
          />
        </I18nextProvider>,
      );
    });

    expect(container.querySelector('[data-testid="sidebar-workspace-activity-time"]')).toBeNull();
  });
});
