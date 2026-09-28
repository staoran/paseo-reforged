import {
  useCallback,
  useMemo,
  type ComponentProps,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  Archive,
  Bot,
  Circle,
  CircleCheck,
  Copy,
  MoreVertical,
  Pencil,
  Pin,
  PinOff,
  Tag,
} from "lucide-react-native";
import { isWeb } from "@/constants/platform";
import { getForgePresentation, normalizeForge } from "@/git/forge";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { AgentRuntimeCloseDisabledReason } from "@/hooks/sidebar-workspaces-view-model";
import type { Agent } from "@/stores/session-store";
import {
  canCloseIdleAgentRuntime,
  useCloseIdleAgentRuntime,
} from "@/hooks/use-close-idle-agent-runtime";
import { useAppSettings } from "@/hooks/use-settings";
import type { Theme } from "@/styles/theme";
import type { ShortcutKey } from "@/utils/format-shortcut";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Shortcut } from "@/components/ui/shortcut";
import type { MenuPageDefinition } from "@/components/ui/menu";
import { OpenInFileManagerMenuItem } from "@/workspace/open-in-file-manager/menu-item";
import { resolveSidebarWorkspaceAccessibilityLabel } from "@/components/sidebar/sidebar-workspace-title";
import {
  workspaceServiceLabelKey,
  type WorkspaceServiceSummary,
} from "@/components/sidebar/workspace-meta-row";
import {
  useWorkspaceLabelMenuPages,
  WORKSPACE_LABEL_PAGE_ID,
  type WorkspaceLabelTarget,
} from "@/workspace-labels/picker";

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const ThemedMoreVertical = withUnistyles(MoreVertical);
const ThemedBot = withUnistyles(Bot);
const ThemedCopy = withUnistyles(Copy);
const ThemedArchive = withUnistyles(Archive);
const ThemedCircle = withUnistyles(Circle);
const ThemedPencil = withUnistyles(Pencil);
const ThemedCircleCheck = withUnistyles(CircleCheck);
const ThemedPin = withUnistyles(Pin);
const ThemedPinOff = withUnistyles(PinOff);
const ThemedTag = withUnistyles(Tag);

const copyLeadingIcon = <ThemedCopy size={14} uniProps={foregroundMutedColorMapping} />;
const renameLeadingIcon = <ThemedPencil size={14} uniProps={foregroundMutedColorMapping} />;
const markAsReadLeadingIcon = (
  <ThemedCircleCheck size={14} uniProps={foregroundMutedColorMapping} />
);
const markAsUnreadLeadingIcon = <ThemedCircle size={14} uniProps={foregroundMutedColorMapping} />;
const archiveLeadingIcon = <ThemedArchive size={14} uniProps={foregroundMutedColorMapping} />;
const pinLeadingIcon = <ThemedPin size={14} uniProps={foregroundMutedColorMapping} />;
const unpinLeadingIcon = <ThemedPinOff size={14} uniProps={foregroundMutedColorMapping} />;
const agentRuntimeLeadingIcon = <ThemedBot size={14} uniProps={foregroundMutedColorMapping} />;

function renderTriggerIcon({ hovered }: { hovered?: boolean }) {
  return (
    <ThemedMoreVertical
      size={14}
      uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
    />
  );
}

export interface SidebarWorkspaceMenuProps {
  workspaceKey: string;
  serverId?: string;
  workspaceId?: string;
  workspaceLabels?: readonly string[];
  managedAgents?: readonly Agent[] | null;
  agentDirectoryCurrent?: boolean;
  supportsAgentRuntimeClose?: boolean;
  agentRuntimeCloseDisabledReason?: AgentRuntimeCloseDisabledReason;
  onCopyPath?: () => void;
  onCopyBranchName?: () => void;
  onRename?: () => void;
  onMarkAsRead?: () => void;
  onMarkAsUnread?: () => void;
  onArchive: () => void;
  archiveLabel?: string;
  archiveStatus?: "idle" | "pending" | "success";
  archivePendingLabel?: string;
  archiveShortcutKeys?: ShortcutKey[][] | null;
  isPinned?: boolean;
  onTogglePin?: () => void;
  openInFileManagerPath?: string | null;
  /**
   * Lifted so the row that reveals the kebab can keep it mounted while its menu is up. See
   * `useOpenKebabMenuVisibility`.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface SidebarWorkspaceMenuItemsProps extends Omit<
  SidebarWorkspaceMenuProps,
  "onArchive" | "open" | "onOpenChange"
> {
  onArchive?: () => void;
}

type MenuSurface = "context" | "dropdown";
/** Local page id for selecting one managed Agent in a Workspace menu */
const AGENT_RUNTIME_MENU_PAGE_ID = "workspace-agent-runtime";

function WorkspaceMenuItem({
  surface,
  children,
  ...props
}: PropsWithChildren<
  Omit<ComponentProps<typeof DropdownMenuItem>, "children"> & { surface: MenuSurface }
>) {
  if (surface === "context") {
    return <ContextMenuItem {...props}>{children}</ContextMenuItem>;
  }
  return <DropdownMenuItem {...props}>{children}</DropdownMenuItem>;
}

function SidebarWorkspaceMenuItems({
  surface,
  workspaceKey,
  serverId,
  workspaceId,
  onCopyPath,
  onCopyBranchName,
  onRename,
  onMarkAsRead,
  onMarkAsUnread,
  onArchive,
  archiveLabel,
  archiveStatus,
  archivePendingLabel,
  archiveShortcutKeys,
  isPinned,
  onTogglePin,
  openInFileManagerPath,
  managedAgents,
  agentDirectoryCurrent = false,
  supportsAgentRuntimeClose = false,
  agentRuntimeCloseDisabledReason = "syncing",
}: SidebarWorkspaceMenuItemsProps & { surface: MenuSurface }): ReactNode {
  const { t } = useTranslation();
  const archiveTrailing = useMemo(
    () => (archiveShortcutKeys ? <Shortcut chord={archiveShortcutKeys} /> : null),
    [archiveShortcutKeys],
  );
  const labelLeading = useMemo(
    () => <ThemedTag size={14} uniProps={foregroundMutedColorMapping} />,
    [],
  );

  return (
    <>
      {onCopyPath ? (
        <WorkspaceMenuItem
          surface={surface}
          testID={`sidebar-workspace-menu-copy-path-${workspaceKey}`}
          leading={copyLeadingIcon}
          onSelect={onCopyPath}
        >
          {t("sidebar.workspace.actions.copyPath")}
        </WorkspaceMenuItem>
      ) : null}
      {onCopyBranchName ? (
        <WorkspaceMenuItem
          surface={surface}
          testID={`sidebar-workspace-menu-copy-branch-name-${workspaceKey}`}
          leading={copyLeadingIcon}
          onSelect={onCopyBranchName}
        >
          {t("sidebar.workspace.actions.copyBranchName")}
        </WorkspaceMenuItem>
      ) : null}
      {onRename ? (
        <WorkspaceMenuItem
          surface={surface}
          testID={`sidebar-workspace-menu-rename-${workspaceKey}`}
          leading={renameLeadingIcon}
          onSelect={onRename}
        >
          {t("sidebar.workspace.actions.rename")}
        </WorkspaceMenuItem>
      ) : null}
      {onMarkAsRead ? (
        <WorkspaceMenuItem
          surface={surface}
          testID={`sidebar-workspace-menu-mark-as-read-${workspaceKey}`}
          leading={markAsReadLeadingIcon}
          onSelect={onMarkAsRead}
        >
          Mark as read
        </WorkspaceMenuItem>
      ) : null}
      {onMarkAsUnread ? (
        <WorkspaceMenuItem
          surface={surface}
          testID={`sidebar-workspace-menu-mark-as-unread-${workspaceKey}`}
          leading={markAsUnreadLeadingIcon}
          onSelect={onMarkAsUnread}
        >
          Mark as unread
        </WorkspaceMenuItem>
      ) : null}
      {serverId && workspaceId ? (
        <AgentRuntimeMenuEntry
          surface={surface}
          serverId={serverId}
          managedAgents={managedAgents ?? []}
          agentDirectoryCurrent={agentDirectoryCurrent}
          supportsAgentRuntimeClose={supportsAgentRuntimeClose}
          disabledReason={agentRuntimeCloseDisabledReason}
        />
      ) : null}
      {onTogglePin ? (
        <WorkspaceMenuItem
          surface={surface}
          testID={`sidebar-workspace-menu-pin-${workspaceKey}`}
          leading={isPinned ? unpinLeadingIcon : pinLeadingIcon}
          onSelect={onTogglePin}
        >
          {isPinned ? t("sidebar.workspace.actions.unpin") : t("sidebar.workspace.actions.pin")}
        </WorkspaceMenuItem>
      ) : null}
      {serverId && workspaceId ? (
        <DropdownMenuSubTrigger
          id={WORKSPACE_LABEL_PAGE_ID}
          leading={labelLeading}
          testID={`sidebar-workspace-menu-labels-${workspaceKey}`}
        >
          {t("workspaceLabels.title")}
        </DropdownMenuSubTrigger>
      ) : null}
      <OpenInFileManagerMenuItem
        surface={surface}
        path={openInFileManagerPath}
        testID={`sidebar-workspace-menu-open-folder-${workspaceKey}`}
      />
      {onArchive ? (
        <WorkspaceMenuItem
          surface={surface}
          testID={`sidebar-workspace-menu-archive-${workspaceKey}`}
          leading={archiveLeadingIcon}
          trailing={archiveTrailing}
          status={archiveStatus}
          pendingLabel={archivePendingLabel}
          onSelect={onArchive}
        >
          {archiveLabel ?? t("sidebar.workspace.actions.archive")}
        </WorkspaceMenuItem>
      ) : null}
    </>
  );
}

/** Adds the direct close action or the explicit Agent picker to a Workspace menu */
function AgentRuntimeMenuEntry({
  surface,
  serverId,
  managedAgents,
  agentDirectoryCurrent,
  supportsAgentRuntimeClose,
  disabledReason,
}: {
  surface: MenuSurface;
  serverId: string;
  managedAgents: readonly Agent[];
  agentDirectoryCurrent: boolean;
  supportsAgentRuntimeClose: boolean;
  disabledReason: "offline" | "syncing" | "sync_failed" | "update_host";
}) {
  const { t } = useTranslation();
  if (!agentDirectoryCurrent) {
    return (
      <WorkspaceMenuItem
        surface={surface}
        disabled
        leading={agentRuntimeLeadingIcon}
        description={agentRuntimeUnavailableLabel(t, disabledReason)}
        testID="sidebar-workspace-menu-close-agent-runtime-unavailable"
      >
        {t("sidebar.workspace.agentRuntime.closeIdle")}
      </WorkspaceMenuItem>
    );
  }
  if (managedAgents.length === 0) return null;
  if (managedAgents.length === 1) {
    const agent = managedAgents[0];
    return agent ? (
      <AgentRuntimeMenuItem
        surface={surface}
        serverId={serverId}
        agent={agent}
        supportsAgentRuntimeClose={supportsAgentRuntimeClose}
      />
    ) : null;
  }
  return (
    <DropdownMenuSubTrigger
      id={AGENT_RUNTIME_MENU_PAGE_ID}
      leading={agentRuntimeLeadingIcon}
      value={String(managedAgents.length)}
      testID="sidebar-workspace-menu-close-agent-runtime"
    >
      {t("sidebar.workspace.agentRuntime.closeIdle")}
    </DropdownMenuSubTrigger>
  );
}

/** Renders a managed Agent action with current status and pending feedback */
function AgentRuntimeMenuItem({
  surface,
  serverId,
  agent,
  supportsAgentRuntimeClose,
}: {
  surface: MenuSurface;
  serverId: string;
  agent: Agent;
  supportsAgentRuntimeClose: boolean;
}) {
  const { t } = useTranslation();
  const { pendingAgentIds, closeIdleAgentRuntime } = useCloseIdleAgentRuntime();
  const pending = pendingAgentIds.has(agent.id);
  const title = agent.title?.trim() || agent.id.slice(0, 7);
  let description: string;
  if (!supportsAgentRuntimeClose) {
    description = agentRuntimeUnavailableLabel(t, "update_host");
  } else if (agent.pendingPermissions.length > 0) {
    description = t("sidebar.workspace.agentRuntime.pendingPermissions");
  } else {
    description = agentRuntimeStatusLabel(agent, t);
  }
  const handleSelect = useCallback(() => {
    void closeIdleAgentRuntime({ serverId, agentId: agent.id });
  }, [agent.id, closeIdleAgentRuntime, serverId]);

  return (
    <WorkspaceMenuItem
      surface={surface}
      disabled={!supportsAgentRuntimeClose || (!canCloseIdleAgentRuntime(agent) && !pending)}
      destructive
      closeOnSelect={false}
      leading={agentRuntimeLeadingIcon}
      description={description}
      status={pending ? "pending" : "idle"}
      pendingLabel={t("sidebar.workspace.agentRuntime.pending", { title })}
      testID={`sidebar-workspace-menu-close-agent-runtime-${agent.id}`}
      onSelect={handleSelect}
    >
      {t("sidebar.workspace.agentRuntime.closeAgent", { title })}
    </WorkspaceMenuItem>
  );
}

/** Lists the current Workspace's managed Agents on the nested picker page */
function WorkspaceAgentRuntimeMenuPage({
  serverId,
  managedAgents,
  supportsAgentRuntimeClose,
}: {
  serverId: string;
  managedAgents: readonly Agent[];
  supportsAgentRuntimeClose: boolean;
}) {
  const agents = useMemo(
    () =>
      [...managedAgents].sort((left, right) => {
        const leftTitle = left.title?.trim() || left.id;
        const rightTitle = right.title?.trim() || right.id;
        return leftTitle.localeCompare(rightTitle) || left.id.localeCompare(right.id);
      }),
    [managedAgents],
  );
  return (
    <>
      {agents.map((agent) => (
        <AgentRuntimeMenuItem
          key={agent.id}
          surface="dropdown"
          serverId={serverId}
          agent={agent}
          supportsAgentRuntimeClose={supportsAgentRuntimeClose}
        />
      ))}
    </>
  );
}

/** Combines the label picker and managed Agent picker pages for both Workspace menu surfaces */
function useSidebarWorkspaceMenuPages(input: {
  workspaceTarget: WorkspaceLabelTarget | null;
  serverId?: string;
  workspaceId?: string;
  managedAgents: readonly Agent[];
  agentDirectoryCurrent: boolean;
  supportsAgentRuntimeClose: boolean;
}): readonly MenuPageDefinition[] {
  const { t } = useTranslation();
  const labelPages = useWorkspaceLabelMenuPages(input.workspaceTarget);
  const agentPage = useMemo<MenuPageDefinition | null>(() => {
    if (
      !input.serverId ||
      !input.workspaceId ||
      !input.agentDirectoryCurrent ||
      input.managedAgents.length < 2
    ) {
      return null;
    }
    return {
      id: AGENT_RUNTIME_MENU_PAGE_ID,
      title: t("sidebar.workspace.agentRuntime.closeIdle"),
      content: (
        <WorkspaceAgentRuntimeMenuPage
          serverId={input.serverId}
          managedAgents={input.managedAgents}
          supportsAgentRuntimeClose={input.supportsAgentRuntimeClose}
        />
      ),
    };
  }, [
    input.agentDirectoryCurrent,
    input.managedAgents,
    input.serverId,
    input.supportsAgentRuntimeClose,
    input.workspaceId,
    t,
  ]);
  return useMemo(
    () => (agentPage ? [...labelPages, agentPage] : labelPages),
    [agentPage, labelPages],
  );
}

/** Maps a known Host readiness failure to the action's localized explanation */
function agentRuntimeUnavailableLabel(
  t: ReturnType<typeof useTranslation>["t"],
  reason: "offline" | "syncing" | "sync_failed" | "update_host",
): string {
  if (reason === "offline") return t("sidebar.workspace.agentRuntime.hostOffline");
  if (reason === "sync_failed") return t("sidebar.workspace.agentRuntime.directoryFailed");
  if (reason === "update_host") return t("sidebar.workspace.agentRuntime.updateHost");
  return t("sidebar.workspace.agentRuntime.syncingDirectory");
}

/** Shows Agent status without treating an open turn as idle */
function agentRuntimeStatusLabel(agent: Agent, t: ReturnType<typeof useTranslation>["t"]): string {
  if (agent.turn.phase === "open") return t("agents.status.running");
  switch (agent.status) {
    case "initializing":
      return t("agents.status.initializing");
    case "idle":
      return t("agents.status.idle");
    case "running":
      return t("agents.status.running");
    case "error":
      return t("agents.status.error");
    case "closed":
      return t("agents.status.closed");
  }
}

export function SidebarWorkspaceMenu({
  workspaceKey,
  serverId,
  workspaceId,
  workspaceLabels,
  onCopyPath,
  onCopyBranchName,
  onRename,
  onMarkAsRead,
  onMarkAsUnread,
  onArchive,
  archiveLabel,
  archiveStatus,
  archivePendingLabel,
  archiveShortcutKeys,
  isPinned,
  onTogglePin,
  openInFileManagerPath,
  managedAgents,
  agentDirectoryCurrent = false,
  supportsAgentRuntimeClose = false,
  agentRuntimeCloseDisabledReason = "syncing",
  open,
  onOpenChange,
}: SidebarWorkspaceMenuProps) {
  const { t } = useTranslation();
  const workspaceTarget = useMemo<WorkspaceLabelTarget | null>(
    () =>
      serverId && workspaceId ? { serverId, workspaceId, labels: workspaceLabels ?? [] } : null,
    [serverId, workspaceId, workspaceLabels],
  );
  const pages = useSidebarWorkspaceMenuPages({
    workspaceTarget,
    serverId,
    workspaceId,
    managedAgents: managedAgents ?? [],
    agentDirectoryCurrent,
    supportsAgentRuntimeClose,
  });
  return (
    <DropdownMenu compactMode="sheet" open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        hitSlop={8}
        style={triggerStyle}
        accessibilityRole={isWeb ? undefined : "button"}
        accessibilityLabel={t("sidebar.workspace.actions.menu")}
        testID={`sidebar-workspace-kebab-${workspaceKey}`}
      >
        {renderTriggerIcon}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        width={260}
        pages={pages}
        sheetTitle={t("sidebar.workspace.actions.menu")}
      >
        <SidebarWorkspaceMenuItems
          surface="dropdown"
          workspaceKey={workspaceKey}
          serverId={serverId}
          workspaceId={workspaceId}
          workspaceLabels={workspaceLabels}
          managedAgents={managedAgents}
          agentDirectoryCurrent={agentDirectoryCurrent}
          supportsAgentRuntimeClose={supportsAgentRuntimeClose}
          agentRuntimeCloseDisabledReason={agentRuntimeCloseDisabledReason}
          onCopyPath={onCopyPath}
          onCopyBranchName={onCopyBranchName}
          onRename={onRename}
          onMarkAsRead={onMarkAsRead}
          onMarkAsUnread={onMarkAsUnread}
          onArchive={onArchive}
          archiveLabel={archiveLabel}
          archiveStatus={archiveStatus}
          archivePendingLabel={archivePendingLabel}
          archiveShortcutKeys={archiveShortcutKeys}
          isPinned={isPinned}
          onTogglePin={onTogglePin}
          openInFileManagerPath={openInFileManagerPath}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type ContextTriggerProps = Omit<
  ComponentProps<typeof ContextMenuTrigger>,
  "children" | "enabledOnMobile" | "highlightStyle"
>;

export function SidebarWorkspaceContextMenu({
  children,
  contextMenuOpen,
  onContextMenuOpenChange,
  workspace,
  leadingProjectName,
  hostBadgeLabel,
  serviceSummary,
  workspaceKey,
  onCopyPath,
  onCopyBranchName,
  onRename,
  onMarkAsRead,
  onMarkAsUnread,
  onArchive,
  archiveLabel,
  archiveStatus,
  archivePendingLabel,
  archiveShortcutKeys,
  isPinned,
  onTogglePin,
  openInFileManagerPath,
  agentRuntimeCloseDisabledReason,
  accessibilityLabel,
  highlightStyle,
  ...triggerProps
}: PropsWithChildren<
  SidebarWorkspaceMenuItemsProps &
    ContextTriggerProps & {
      contextMenuOpen: boolean;
      onContextMenuOpenChange: (open: boolean) => void;
      workspace: SidebarWorkspaceEntry;
      leadingProjectName?: string | null;
      hostBadgeLabel?: string | null;
      serviceSummary?: WorkspaceServiceSummary | null;
      highlightStyle: ComponentProps<typeof ContextMenuTrigger>["highlightStyle"];
    }
>) {
  const {
    settings: { workspaceTitleSource },
  } = useAppSettings();
  const { t } = useTranslation();
  const pullRequestLabel = workspace.prHint
    ? t("workspace.git.pr.accessibility.pullRequest", {
        number: workspace.prHint.number,
        context: getForgePresentation(normalizeForge(workspace.prHint.forge)).changeRequestContext,
      })
    : null;
  const rowAccessibilityLabel = resolveSidebarWorkspaceAccessibilityLabel({
    workspace,
    workspaceTitleSource,
    leadingProjectName,
    hostBadgeLabel,
    pullRequestLabel,
    serviceLabel: serviceSummary
      ? t(workspaceServiceLabelKey(serviceSummary), { name: serviceSummary.name })
      : null,
  });
  const workspaceTarget = useMemo<WorkspaceLabelTarget>(
    () => ({
      serverId: workspace.serverId,
      workspaceId: workspace.workspaceId,
      labels: workspace.labels ?? [],
    }),
    [workspace],
  );
  const pages = useSidebarWorkspaceMenuPages({
    workspaceTarget,
    serverId: workspace.serverId,
    workspaceId: workspace.workspaceId,
    managedAgents: workspace.managedAgents ?? [],
    agentDirectoryCurrent: workspace.agentDirectoryCurrent ?? false,
    supportsAgentRuntimeClose: workspace.supportsAgentRuntimeClose ?? false,
  });
  const closeDisabledReason =
    agentRuntimeCloseDisabledReason ?? workspace.agentRuntimeCloseDisabledReason ?? "syncing";

  return (
    <ContextMenu open={contextMenuOpen} onOpenChange={onContextMenuOpenChange}>
      <ContextMenuTrigger
        {...triggerProps}
        enabledOnMobile={false}
        accessibilityLabel={accessibilityLabel ?? rowAccessibilityLabel}
        highlightStyle={highlightStyle}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        align="start"
        width={260}
        testID={`sidebar-workspace-context-menu-${workspaceKey}`}
        pages={pages}
      >
        <SidebarWorkspaceMenuItems
          surface="context"
          workspaceKey={workspaceKey}
          serverId={workspaceTarget.serverId}
          workspaceId={workspaceTarget.workspaceId}
          workspaceLabels={workspaceTarget.labels}
          managedAgents={workspace.managedAgents}
          agentDirectoryCurrent={workspace.agentDirectoryCurrent}
          supportsAgentRuntimeClose={workspace.supportsAgentRuntimeClose}
          agentRuntimeCloseDisabledReason={closeDisabledReason}
          onCopyPath={onCopyPath}
          onCopyBranchName={onCopyBranchName}
          onRename={onRename}
          onMarkAsRead={onMarkAsRead}
          onMarkAsUnread={onMarkAsUnread}
          onArchive={onArchive}
          archiveLabel={archiveLabel}
          archiveStatus={archiveStatus}
          archivePendingLabel={archivePendingLabel}
          archiveShortcutKeys={archiveShortcutKeys}
          isPinned={isPinned}
          onTogglePin={onTogglePin}
          openInFileManagerPath={openInFileManagerPath}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function triggerStyle({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.trigger, hovered && styles.triggerHovered];
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    padding: 2,
    borderRadius: 4,
    marginLeft: 2,
    // MoreVertical paints only around the center of its SVG. Keep the padded hit box, but
    // pull the painted dots through that unused view-box space onto the trailing-content rail.
    marginRight: -7,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
}));
