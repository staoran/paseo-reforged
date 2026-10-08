import {
  useCallback,
  useMemo,
  useState,
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
import { useCloseIdleAgentRuntime } from "@/hooks/use-close-idle-agent-runtime";
import { canCloseIdleAgentRuntime } from "@/utils/agent-runtime-close-eligibility";
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
import { WorkspaceAgentRuntimeDialog } from "./workspace-agent-runtime-dialog";
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
/** Gives detached historical Agents the same warning color as the sidebar indicator */
const warningColorMapping = (theme: Theme) => ({ color: theme.colors.statusWarning });

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
/** Historical records use the same orange Agent glyph as the metadata row */
const agentRuntimeWarningIcon = <ThemedBot size={14} uniProps={warningColorMapping} />;

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
  agentRuntimeActions: AgentRuntimeCloseActions;
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
  /** Selection dialog state belongs to the row that retains the trigger */
  dialogOpen?: boolean;
  onDialogOpenChange?: (open: boolean) => void;
}

interface SidebarWorkspaceMenuItemsProps extends Omit<
  SidebarWorkspaceMenuProps,
  "onArchive" | "open" | "onOpenChange"
> {
  onArchive?: () => void;
  /** Opens the multi-Agent selection dialog after the menu dismisses */
  onCloseAgentsRequest?: () => void;
}

type MenuSurface = "context" | "dropdown";
export type AgentRuntimeCloseActions = ReturnType<typeof useCloseIdleAgentRuntime>;

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
  agentRuntimeActions,
  onCloseAgentsRequest,
}: SidebarWorkspaceMenuItemsProps & {
  surface: MenuSurface;
  agentRuntimeActions: AgentRuntimeCloseActions;
}): ReactNode {
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
          actions={agentRuntimeActions}
          onCloseAgentsRequest={onCloseAgentsRequest}
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

/** Adds one close command that opens a dialog when multiple Agents need cleanup */
function AgentRuntimeMenuEntry({
  surface,
  serverId,
  managedAgents,
  agentDirectoryCurrent,
  supportsAgentRuntimeClose,
  disabledReason,
  actions,
  onCloseAgentsRequest,
}: {
  surface: MenuSurface;
  serverId: string;
  managedAgents: readonly Agent[];
  agentDirectoryCurrent: boolean;
  supportsAgentRuntimeClose: boolean;
  disabledReason: "offline" | "syncing" | "sync_failed" | "update_host";
  actions: AgentRuntimeCloseActions;
  onCloseAgentsRequest?: () => void;
}) {
  const { t } = useTranslation();
  /** Closed records do not contribute a sidebar Agent marker */
  const residentAgents = managedAgents.filter((agent) => agent.status !== "closed");
  if (!agentDirectoryCurrent) {
    return (
      <WorkspaceMenuItem
        surface={surface}
        disabled
        leading={agentRuntimeLeadingIcon}
        tooltip={agentRuntimeUnavailableLabel(t, disabledReason)}
        testID="sidebar-workspace-menu-close-agent-runtime-unavailable"
      >
        {t("sidebar.workspace.agentRuntime.closeAgent")}
      </WorkspaceMenuItem>
    );
  }
  if (residentAgents.length === 0) return null;
  if (residentAgents.length === 1) {
    const agent = residentAgents[0];
    return agent ? (
      <AgentRuntimeMenuItem
        surface={surface}
        serverId={serverId}
        agent={agent}
        supportsAgentRuntimeClose={supportsAgentRuntimeClose}
        actions={actions}
      />
    ) : null;
  }
  return (
    <WorkspaceMenuItem
      surface={surface}
      disabled={!supportsAgentRuntimeClose}
      leading={agentRuntimeLeadingIcon}
      tooltip={
        !supportsAgentRuntimeClose ? agentRuntimeUnavailableLabel(t, "update_host") : undefined
      }
      onSelect={onCloseAgentsRequest}
      testID="sidebar-workspace-menu-close-agent-runtime"
    >
      {t("sidebar.workspace.agentRuntime.closeAgent")}
    </WorkspaceMenuItem>
  );
}

/** Renders a resident Agent close action with pending feedback */
function AgentRuntimeMenuItem({
  surface,
  serverId,
  agent,
  supportsAgentRuntimeClose,
  actions,
}: {
  surface: MenuSurface;
  serverId: string;
  agent: Agent;
  supportsAgentRuntimeClose: boolean;
  actions: AgentRuntimeCloseActions;
}) {
  const { t } = useTranslation();
  const { closeIdleAgentRuntime } = actions;
  const pending = actions.pendingAgentIds.has(agent.id);
  /** Historical runtime ownership is separate from Agent status */
  const isDetached = agent.runtimeAttached === false;
  /** Explains disabled or detached state without adding a menu subtitle */
  let tooltip: string | undefined;
  if (!supportsAgentRuntimeClose) tooltip = agentRuntimeUnavailableLabel(t, "update_host");
  else if (isDetached) tooltip = t("sidebar.workspace.agentRuntime.runtimeNotRestored");
  const handleSelect = useCallback(() => {
    void closeIdleAgentRuntime({ serverId, agentId: agent.id });
  }, [agent.id, closeIdleAgentRuntime, serverId]);

  return (
    <WorkspaceMenuItem
      surface={surface}
      disabled={!supportsAgentRuntimeClose || (!canCloseIdleAgentRuntime(agent) && !pending)}
      destructive
      leading={isDetached ? agentRuntimeWarningIcon : agentRuntimeLeadingIcon}
      tooltip={tooltip}
      status={pending ? "pending" : "idle"}
      testID={`sidebar-workspace-menu-close-agent-runtime-${agent.id}`}
      onSelect={handleSelect}
    >
      {t("sidebar.workspace.agentRuntime.closeAgent")}
    </WorkspaceMenuItem>
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
  agentRuntimeActions,
  open,
  onOpenChange,
  dialogOpen = false,
  onDialogOpenChange,
}: SidebarWorkspaceMenuProps) {
  const { t } = useTranslation();
  /** Opens the picker through the menu's platform-aware dismissal callback */
  const openAgentPicker = useCallback(() => onDialogOpenChange?.(true), [onDialogOpenChange]);
  /** Dismisses the independent picker surface */
  const closeAgentPicker = useCallback(() => onDialogOpenChange?.(false), [onDialogOpenChange]);
  const workspaceTarget = useMemo<WorkspaceLabelTarget | null>(
    () =>
      serverId && workspaceId ? { serverId, workspaceId, labels: workspaceLabels ?? [] } : null,
    [serverId, workspaceId, workspaceLabels],
  );
  const pages = useWorkspaceLabelMenuPages(workspaceTarget);
  return (
    <>
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
            agentRuntimeActions={agentRuntimeActions}
            onCloseAgentsRequest={openAgentPicker}
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
      {dialogOpen && serverId ? (
        <WorkspaceAgentRuntimeDialog
          serverId={serverId}
          agents={managedAgents ?? []}
          directoryCurrent={agentDirectoryCurrent}
          supportsClose={supportsAgentRuntimeClose}
          actions={agentRuntimeActions}
          onClose={closeAgentPicker}
        />
      ) : null}
    </>
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
  agentRuntimeActions,
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
  /** Keeps the Agent picker independent from the right-click surface */
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  /** Opens the focused selection task after menu dismissal */
  const openAgentPicker = useCallback(() => setAgentPickerOpen(true), []);
  /** Releases the picker after completion or cancellation */
  const closeAgentPicker = useCallback(() => setAgentPickerOpen(false), []);
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
    t,
  });
  const workspaceTarget = useMemo<WorkspaceLabelTarget>(
    () => ({
      serverId: workspace.serverId,
      workspaceId: workspace.workspaceId,
      labels: workspace.labels ?? [],
    }),
    [workspace],
  );
  const pages = useWorkspaceLabelMenuPages(workspaceTarget);
  const closeDisabledReason =
    agentRuntimeCloseDisabledReason ?? workspace.agentRuntimeCloseDisabledReason ?? "syncing";

  return (
    <>
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
            agentRuntimeActions={agentRuntimeActions}
            onCloseAgentsRequest={openAgentPicker}
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
      {agentPickerOpen ? (
        <WorkspaceAgentRuntimeDialog
          serverId={workspace.serverId}
          agents={workspace.managedAgents ?? []}
          directoryCurrent={workspace.agentDirectoryCurrent ?? false}
          supportsClose={workspace.supportsAgentRuntimeClose ?? false}
          actions={agentRuntimeActions}
          onClose={closeAgentPicker}
        />
      ) : null}
    </>
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
