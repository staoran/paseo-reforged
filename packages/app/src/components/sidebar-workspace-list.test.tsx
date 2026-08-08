/**
 * @vitest-environment jsdom
 */
import { act, fireEvent } from "@testing-library/react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { WorkspaceScriptPayload } from "@getpaseo/protocol/messages";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import type { ReactElement } from "react";
import { createProjectViewKey } from "@/projects/workspace-structure";

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

const pathnameState = vi.hoisted(() => ({
  value: "/",
}));
const navigationMocks = vi.hoisted(() => ({
  navigateToWorkspace: vi.fn(),
}));

vi.mock("expo-router", () => ({
  router: {
    dismissTo: vi.fn(),
  },
  useLocalSearchParams: () => ({}),
  usePathname: () => pathnameState.value,
}));

vi.mock("@/stores/navigation-active-workspace-store", () => ({
  navigateToWorkspace: navigationMocks.navigateToWorkspace,
  useActiveWorkspaceSelection: () => {
    const match = pathnameState.value.match(/^\/h\/([^/]+)\/workspace\/([^/?]+)/);
    return match?.[1] && match[2]
      ? { serverId: decodeURIComponent(match[1]), workspaceId: decodeURIComponent(match[2]) }
      : null;
  },
}));

vi.mock("react-native-draggable-flatlist", async () => {
  const ReactModule = await import("react");
  return {
    NestableScrollContainer: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement("div", null, children),
  };
});

vi.mock("@/components/draggable-list", async () => {
  const ReactModule = await import("react");
  return {
    DraggableList: ({
      data,
      keyExtractor,
      renderItem,
    }: {
      data: unknown[];
      keyExtractor: (item: unknown, index: number) => string;
      renderItem: (input: {
        item: unknown;
        index: number;
        drag: () => void;
        isActive: boolean;
      }) => React.ReactNode;
    }) =>
      ReactModule.createElement(
        ReactModule.Fragment,
        null,
        data.map((item, index) =>
          ReactModule.createElement(
            ReactModule.Fragment,
            { key: keyExtractor(item, index) },
            renderItem({ item, index, drag: () => {}, isActive: false }),
          ),
        ),
      ),
  };
});

vi.mock("@/components/rename-modal", () => ({
  AdaptiveRenameModal: () => null,
}));

vi.mock("@/components/workspace-hover-card", () => ({
  WorkspaceHoverCard: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/synced-loader", () => ({
  SyncedLoader: () => null,
}));

vi.mock("@/components/ui/context-menu", () => ({
  ContextMenu: ({ children }: { children: React.ReactNode }) => children,
  ContextMenuContent: () => null,
  ContextMenuItem: () => null,
  ContextMenuTrigger: ({
    children,
    onPress,
    testID,
  }: {
    children: React.ReactNode;
    onPress?: () => void;
    testID?: string;
  }) =>
    React.createElement(
      "button",
      { "data-testid": testID, onClick: onPress, type: "button" },
      children,
    ),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => children,
  DropdownMenuContent: () => null,
  DropdownMenuItem: () => null,
  DropdownMenuTrigger: ({
    children,
  }: {
    children:
      | React.ReactNode
      | ((state: { hovered: boolean; pressed: boolean }) => React.ReactNode);
  }) => (typeof children === "function" ? children({ hovered: false, pressed: false }) : children),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipContent: () => null,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/sidebar/sidebar-workspace-menu", () => ({
  SidebarWorkspaceContextMenuContent: () => null,
  SidebarWorkspaceContextMenu: ({
    children,
    testID,
    onPress,
  }: {
    children: React.ReactNode;
    testID?: string;
    onPress?: () => void;
  }) => (
    <button type="button" data-testid={testID} onClick={onPress}>
      {children}
    </button>
  ),
  SidebarWorkspaceMenu: () => null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: () => null,
}));

vi.mock("@/workspace/open-in-file-manager/menu-item", () => ({
  OpenInFileManagerMenuItem: () => null,
}));

import {
  createSidebarWorkspaceEntry,
  type SidebarProjectEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarWorkspacesList } from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarWorkspaceEntries } from "@/hooks/use-sidebar-workspace-entries";
import { SidebarWorkspaceList } from "@/components/sidebar-workspace-list";
import { buildStatusGroups } from "@/hooks/sidebar-status-view-model";
import type { PinnedSidebarGroups } from "@/hooks/use-sidebar-pins";
import { patchWorkspaceScripts } from "@/contexts/session-workspace-scripts";
import {
  getHostRuntimeStore,
  type HostRuntimeController,
  type HostRuntimeSnapshot,
} from "@/runtime/host-runtime";
import type { HostProfile } from "@/types/host-connection";
import { useSessionStore, type Agent, type WorkspaceDescriptor } from "@/stores/session-store";
import { seedSessionWorkspaces } from "@/test/seed-session";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { defaultHostAppearance } from "@/hosts/appearance";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("expo-clipboard", () => ({
  setStringAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/contexts/toast-context", () => ({
  useToast: () => ({
    copied: vi.fn(),
    error: vi.fn(),
  }),
}));

const SERVER_ID = "sidebar-render-count";
const onToggleProjectCollapsed = () => undefined;

interface RenderCounts {
  frame: number;
  headers: Record<string, number>;
  rows: Record<string, number>;
  projectSelection: Record<string, number>;
  rowSelection: Record<string, number>;
}

const runningScript: WorkspaceScriptPayload = {
  scriptName: "web",
  type: "service",
  hostname: "web.paseo.localhost",
  port: 3000,
  proxyUrl: "http://web.paseo.localhost:6767",
  lifecycle: "running",
  health: "healthy",
  exitCode: null,
  terminalId: null,
};

function workspace(input: {
  id: string;
  projectId: string;
  projectDisplayName: string;
  name: string;
  status?: WorkspaceDescriptor["status"];
  scripts?: WorkspaceDescriptor["scripts"];
  diffStat?: WorkspaceDescriptor["diffStat"];
  defaultAgentId?: string | null;
  archivingAt?: string | null;
}): WorkspaceDescriptor {
  return {
    id: input.id,
    projectId: input.projectId,
    projectDisplayName: input.projectDisplayName,
    projectRootPath: `/repo/${input.projectId}`,
    workspaceDirectory: `/repo/${input.projectId}/${input.id}`,
    projectKind: "git",
    workspaceKind: input.name === "main" ? "local_checkout" : "worktree",
    name: input.name,
    status: input.status ?? "done",
    statusEnteredAt: null,
    archivingAt: input.archivingAt ?? null,
    diffStat: input.diffStat ?? null,
    defaultAgentId: input.defaultAgentId ?? null,
    scripts: input.scripts ?? [],
  };
}

function agent(input: { id: string; workspaceId: string; status?: Agent["status"] }): Agent {
  const timestamp = new Date("2026-08-03T12:00:00.000Z");
  return {
    serverId: SERVER_ID,
    id: input.id,
    provider: "codex",
    status: input.status ?? "closed",
    activeTurn: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastUserMessageAt: null,
    lastMessageAt: null,
    lastActivityAt: timestamp,
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: null,
    cwd: "/repo",
    workspaceId: input.workspaceId,
    model: null,
    providerRetryMessage: null,
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    archivedAt: null,
    parentAgentId: null,
    labels: {},
  };
}

function pinnedGroupsFor(project: SidebarProjectEntry): PinnedSidebarGroups {
  return { pinnedChats: [], unpinnedProjects: [project] };
}

function createWorkspaces(): WorkspaceDescriptor[] {
  return [
    workspace({
      id: "a-main",
      projectId: "project-a",
      projectDisplayName: "Project A",
      name: "main",
      scripts: [runningScript],
    }),
    workspace({
      id: "a-one",
      projectId: "project-a",
      projectDisplayName: "Project A",
      name: "one",
    }),
    workspace({
      id: "a-two",
      projectId: "project-a",
      projectDisplayName: "Project A",
      name: "two",
    }),
    workspace({
      id: "b-main",
      projectId: "project-b",
      projectDisplayName: "Project B",
      name: "main",
    }),
    workspace({
      id: "b-one",
      projectId: "project-b",
      projectDisplayName: "Project B",
      name: "one",
    }),
    workspace({
      id: "b-two",
      projectId: "project-b",
      projectDisplayName: "Project B",
      name: "two",
    }),
  ];
}

function makeHost(): HostProfile {
  const now = "2026-04-19T00:00:00.000Z";
  return {
    serverId: SERVER_ID,
    label: "Render Count Host",
    appearance: defaultHostAppearance(),
    lifecycle: {},
    connections: [],
    preferredConnectionId: null,
    createdAt: now,
    updatedAt: now,
  };
}

function setHostProfiles(hosts: HostProfile[]): void {
  (
    getHostRuntimeStore() as unknown as {
      setHostsAndSync: (hosts: HostProfile[]) => void;
    }
  ).setHostsAndSync(hosts);
}

function initializeSidebarState(workspaces: WorkspaceDescriptor[]): void {
  act(() => {
    setHostProfiles([makeHost()]);
    useSessionStore.getState().initializeSession(SERVER_ID, null as unknown as DaemonClient);
    seedSessionWorkspaces(SERVER_ID, new Map(workspaces.map((entry) => [entry.id, entry])));
    useSessionStore.getState().setHasHydratedWorkspaces(SERVER_ID, true);
    useSidebarOrderStore.setState({
      projectOrder: ["project-a", "project-b"],
      workspaceOrderByProject: {
        ["project-a"]: [`${SERVER_ID}:a-main`, `${SERVER_ID}:a-one`, `${SERVER_ID}:a-two`],
        ["project-b"]: [`${SERVER_ID}:b-main`, `${SERVER_ID}:b-one`, `${SERVER_ID}:b-two`],
      },
    });
  });
}

function resetCounts(counts: RenderCounts): void {
  counts.frame = 0;
  counts.headers = {};
  counts.rows = {};
  counts.projectSelection = {};
  counts.rowSelection = {};
}

function incrementRecord(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function ProjectHeaderProbe({
  project,
  counts,
}: {
  project: SidebarProjectEntry;
  counts: RenderCounts;
}): null {
  incrementRecord(counts.headers, project.viewKey);
  return null;
}

function WorkspaceRowProbe({
  serverId,
  workspaceId,
  counts,
}: {
  serverId: string;
  workspaceId: string;
  counts: RenderCounts;
}): null {
  const workspaceEntry = useWorkspaceFields(serverId, workspaceId, (entry) =>
    createSidebarWorkspaceEntry({ serverId, workspace: entry }),
  );
  if (workspaceEntry) {
    incrementRecord(counts.rows, workspaceEntry.workspaceId);
  }
  return null;
}

function ProjectActiveProbe({
  serverId,
  project,
  counts,
}: {
  serverId: string;
  project: SidebarProjectEntry;
  counts: RenderCounts;
}): null {
  const activeSelection = useActiveWorkspaceSelection();
  const isActive =
    activeSelection?.serverId === serverId &&
    project.workspaces.some((entry) => entry.workspaceId === activeSelection.workspaceId);
  void isActive;
  incrementRecord(counts.projectSelection, project.viewKey);
  return null;
}

function WorkspaceSelectionProbe({
  serverId,
  workspaceId,
  counts,
}: {
  serverId: string;
  workspaceId: string;
  counts: RenderCounts;
}): null {
  const activeSelection = useActiveWorkspaceSelection();
  const selected =
    activeSelection?.serverId === serverId && activeSelection.workspaceId === workspaceId;
  void selected;
  incrementRecord(counts.rowSelection, workspaceId);
  return null;
}

function SidebarFrameProbe({ counts }: { counts: RenderCounts }): ReactElement {
  counts.frame += 1;
  const { projects } = useSidebarWorkspacesList({ hostFilters: [SERVER_ID] });

  return (
    <>
      {projects.map((project) => (
        <div key={project.viewKey}>
          <ProjectHeaderProbe project={project} counts={counts} />
          <ProjectActiveProbe serverId={SERVER_ID} project={project} counts={counts} />
          {project.workspaces.map((entry) => (
            <React.Fragment key={entry.workspaceKey}>
              <WorkspaceRowProbe
                serverId={entry.serverId}
                workspaceId={entry.workspaceId}
                counts={counts}
              />
              <WorkspaceSelectionProbe
                serverId={entry.serverId}
                workspaceId={entry.workspaceId}
                counts={counts}
              />
            </React.Fragment>
          ))}
        </div>
      ))}
    </>
  );
}

function getHostController(): HostRuntimeController {
  const controllers = (
    getHostRuntimeStore() as unknown as {
      controllers: Map<string, HostRuntimeController>;
    }
  ).controllers;
  const controller = controllers.get(SERVER_ID);
  if (!controller) {
    throw new Error("Host runtime controller was not initialized");
  }
  return controller;
}

function updateControllerSnapshot(
  patch: Partial<Omit<HostRuntimeSnapshot, "serverId" | "clientGeneration">>,
): void {
  (
    getHostController() as unknown as {
      updateSnapshot: (
        patch: Partial<Omit<HostRuntimeSnapshot, "serverId" | "clientGeneration">>,
      ) => void;
    }
  ).updateSnapshot(patch);
}

async function renderProbe(counts: RenderCounts): Promise<{ root: Root; container: HTMLElement }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    renderSidebarFrame(root, counts);
  });
  resetCounts(counts);
  return { root, container };
}

function renderSidebarFrame(root: Root, counts: RenderCounts) {
  root.render(<SidebarFrameProbe counts={counts} />);
}

function SidebarWorkspaceListProbe({
  groupMode = "project",
}: {
  groupMode?: "project" | "status";
}): ReactElement {
  const { projects, projectNamesByViewKey } = useSidebarWorkspacesList({
    hostFilters: [SERVER_ID],
  });
  const placements = React.useMemo(
    () => projects.flatMap((project) => project.workspaces),
    [projects],
  );
  const workspaceEntriesByKey = useSidebarWorkspaceEntries(placements);
  const pinnedGroups = React.useMemo(
    () => ({ pinnedChats: [], unpinnedProjects: projects }),
    [projects],
  );
  const handleToggleProjectCollapsed = React.useCallback(() => undefined, []);
  const statusGroups = React.useMemo(
    () => buildStatusGroups(Array.from(workspaceEntriesByKey.values()), projectNamesByViewKey),
    [projectNamesByViewKey, workspaceEntriesByKey],
  );

  return (
    <SidebarWorkspaceList
      statusGroups={statusGroups}
      pinnedGroups={pinnedGroups}
      projects={projects}
      workspaceEntriesByKey={workspaceEntriesByKey}
      collapsedProjectKeys={new Set()}
      onToggleProjectCollapsed={handleToggleProjectCollapsed}
      shortcutIndexByWorkspaceKey={new Map()}
      groupMode={groupMode}
    />
  );
}

describe("sidebar workspace render isolation", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(async () => {
    navigationMocks.navigateToWorkspace.mockReset();
    initializeSidebarState(createWorkspaces());
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
    act(() => {
      pathnameState.value = "/";
      setHostProfiles([]);
      useSessionStore.getState().clearSession(SERVER_ID);
      useSidebarOrderStore.setState({
        projectOrder: [],
        workspaceOrderByProject: {},
      });
    });
  });

  it("re-renders only the changed workspace row for a status update", async () => {
    const counts: RenderCounts = {
      frame: 0,
      headers: {},
      rows: {},
      projectSelection: {},
      rowSelection: {},
    };
    ({ root, container } = await renderProbe(counts));

    act(() => {
      useSessionStore.getState().mergeWorkspaces(SERVER_ID, [
        {
          ...createWorkspaces()[1],
          status: "running",
        },
      ]);
    });

    expect(counts.frame).toBe(0);
    expect(counts.headers).toEqual({});
    expect(counts.rows).toEqual({ "a-one": 1 });
  });

  it("does not re-render the sidebar for a host-runtime probe tick with no content change", async () => {
    const counts: RenderCounts = {
      frame: 0,
      headers: {},
      rows: {},
      projectSelection: {},
      rowSelection: {},
    };
    ({ root, container } = await renderProbe(counts));

    act(() => {
      const probeByConnectionId = getHostController().getSnapshot().probeByConnectionId;
      updateControllerSnapshot({
        probeByConnectionId: new Map(probeByConnectionId),
      });
    });

    expect(counts).toEqual({
      frame: 0,
      headers: {},
      rows: {},
      projectSelection: {},
      rowSelection: {},
    });
  });

  it("does not re-render for a deep-equal scripts patch", async () => {
    const counts: RenderCounts = {
      frame: 0,
      headers: {},
      rows: {},
      projectSelection: {},
      rowSelection: {},
    };
    ({ root, container } = await renderProbe(counts));

    const applyRunningScript = (current: Parameters<typeof patchWorkspaceScripts>[0]) =>
      patchWorkspaceScripts(current, {
        workspaceId: "a-main",
        scripts: [{ ...runningScript }],
      });

    act(() => {
      useSessionStore.getState().setWorkspaces(SERVER_ID, applyRunningScript);
    });

    expect(counts).toEqual({
      frame: 0,
      headers: {},
      rows: {},
      projectSelection: {},
      rowSelection: {},
    });
  });

  it("does not show checkout diff stats in workspace rows", async () => {
    const workspaces = createWorkspaces();
    workspaces[0] = { ...workspaces[0], diffStat: { additions: 17, deletions: 9 } };
    initializeSidebarState(workspaces);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <SidebarWorkspaceListProbe />
        </QueryClientProvider>,
      );
    });

    expect(container.textContent).toContain("main");
    expect(container.textContent).not.toContain("+17");
    expect(container.textContent).not.toContain("-9");
  });

  it("updates active selection probes from the active workspace route", async () => {
    const counts: RenderCounts = {
      frame: 0,
      headers: {},
      rows: {},
      projectSelection: {},
      rowSelection: {},
    };

    act(() => {
      pathnameState.value = `/h/${SERVER_ID}/workspace/a-one`;
    });
    ({ root, container } = await renderProbe(counts));

    act(() => {
      pathnameState.value = `/h/${SERVER_ID}/workspace/b-two`;
      if (root) {
        renderSidebarFrame(root, counts);
      }
    });

    expect(counts.frame).toBe(1);
    expect(counts.projectSelection).toEqual({
      [createProjectViewKey({ kind: "equivalence", projectKey: "project-a" })]: 1,
      [createProjectViewKey({ kind: "equivalence", projectKey: "project-b" })]: 1,
    });
    expect(counts.rowSelection).toEqual({
      "a-main": 1,
      "a-one": 1,
      "a-two": 1,
      "b-main": 1,
      "b-one": 1,
      "b-two": 1,
    });
  });

  it("shows resident agent counts independently from workspace activity", async () => {
    const workspaces = [
      workspace({
        id: "closed",
        projectId: "project-a",
        projectDisplayName: "Project A",
        name: "closed",
        status: "done",
        defaultAgentId: "agent-closed",
      }),
      workspace({
        id: "single",
        projectId: "project-a",
        projectDisplayName: "Project A",
        name: "single",
        status: "done",
        defaultAgentId: "agent-single",
      }),
      workspace({
        id: "running",
        projectId: "project-a",
        projectDisplayName: "Project A",
        name: "running",
        status: "running",
        defaultAgentId: "agent-running",
      }),
    ];
    const workspaceAgents = new Map<string, Agent>([
      ["agent-closed", agent({ id: "agent-closed", workspaceId: "closed", status: "closed" })],
      ["agent-single", agent({ id: "agent-single", workspaceId: "single", status: "idle" })],
      ["agent-running", agent({ id: "agent-running", workspaceId: "running", status: "running" })],
      [
        "agent-running-second",
        agent({ id: "agent-running-second", workspaceId: "running", status: "idle" }),
      ],
    ]);
    initializeSidebarState(workspaces);
    act(() => {
      useSessionStore.getState().setAgents(SERVER_ID, workspaceAgents);
    });

    const queryClient = new QueryClient();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <SidebarWorkspaceListProbe />
        </QueryClientProvider>,
      );
    });

    const closedRow = container.querySelector(
      `[data-testid="sidebar-workspace-row-${SERVER_ID}:closed"]`,
    );
    expect(closedRow).not.toBeNull();
    expect(
      closedRow?.querySelector('[data-testid="workspace-runtime-resident-indicator"]'),
    ).toBeNull();
    expect(
      closedRow?.querySelector('[data-testid^="workspace-status-indicator-runtime-"]'),
    ).toBeNull();

    const singleRow = container.querySelector(
      `[data-testid="sidebar-workspace-row-${SERVER_ID}:single"]`,
    );
    const singleResidentIndicator = singleRow?.querySelector(
      '[data-testid="workspace-runtime-resident-indicator"]',
    );
    expect(singleResidentIndicator?.getAttribute("aria-label")).toBe(
      "Resident Agent runtime count: 1",
    );
    expect(
      singleResidentIndicator?.querySelector('[data-testid="workspace-runtime-resident-count"]'),
    ).toBeNull();

    const runningRow = container.querySelector(
      `[data-testid="sidebar-workspace-row-${SERVER_ID}:running"]`,
    );
    expect(
      runningRow?.querySelector('[data-testid="workspace-status-indicator-running"]'),
    ).not.toBeNull();
    const runningResidentIndicator = runningRow?.querySelector(
      '[data-testid="workspace-runtime-resident-indicator"]',
    );
    expect(runningResidentIndicator?.getAttribute("aria-label")).toBe(
      "Resident Agent runtime count: 2",
    );
    expect(
      runningResidentIndicator?.querySelector('[data-testid="workspace-runtime-resident-count"]')
        ?.textContent,
    ).toBe("2");
  });

  it.each(["project", "status"] as const)(
    "opens the persisted default agent from the %s sidebar entry",
    async (groupMode) => {
      const defaultWorkspace = workspace({
        id: "default-workspace",
        projectId: "project-a",
        projectDisplayName: "Project A",
        name: "default-workspace",
        defaultAgentId: "initial-agent",
      });
      const workspaceEntry = createSidebarWorkspaceEntry({
        serverId: SERVER_ID,
        workspace: defaultWorkspace,
        workspaceAgents: new Map([
          ["initial-agent", { workspaceId: defaultWorkspace.id, archivedAt: null }],
        ]),
        workspaceResidentAgentCounts: new Map(),
      });
      const project: SidebarProjectEntry = {
        viewKey: "project-a",
        projectName: "Project A",
        projectKind: "git",
        iconWorkingDir: "/repo/project-a",
        hosts: [
          {
            serverId: SERVER_ID,
            projectId: "project-a",
            iconWorkingDir: "/repo/project-a",
            worktreeSupport: "supported",
          },
        ],
        workspaces: [workspaceEntry],
      };
      const workspaceEntriesByKey = new Map([[workspaceEntry.workspaceKey, workspaceEntry]]);
      const projectNamesByViewKey = new Map([[project.viewKey, project.projectName]]);
      const statusGroups = buildStatusGroups([workspaceEntry], projectNamesByViewKey);
      const pinnedGroups = pinnedGroupsFor(project);
      const collapsedProjectKeys = new Set<string>();
      const shortcutIndexByWorkspaceKey = new Map<string, number>();

      const queryClient = new QueryClient();
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root?.render(
          <QueryClientProvider client={queryClient}>
            <SidebarWorkspaceList
              statusGroups={statusGroups}
              pinnedGroups={pinnedGroups}
              projects={[project]}
              workspaceEntriesByKey={workspaceEntriesByKey}
              collapsedProjectKeys={collapsedProjectKeys}
              onToggleProjectCollapsed={onToggleProjectCollapsed}
              shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
              groupMode={groupMode}
            />
          </QueryClientProvider>,
        );
      });

      const expectedRowTestId = `sidebar-workspace-row-${SERVER_ID}:default-workspace`;
      const rows = Array.from(
        container.querySelectorAll('[data-testid^="sidebar-workspace-row-"]'),
      );
      const rowTestIds = rows.map((row) => row.getAttribute("data-testid"));
      expect(rowTestIds).toContain(expectedRowTestId);
      const row = rows.find(
        (candidate) => candidate.getAttribute("data-testid") === expectedRowTestId,
      );
      fireEvent.click(row as Element);
      expect(navigationMocks.navigateToWorkspace).toHaveBeenCalledWith({
        serverId: SERVER_ID,
        workspaceId: "default-workspace",
        target: { kind: "agent", agentId: "initial-agent" },
      });
    },
  );
});
