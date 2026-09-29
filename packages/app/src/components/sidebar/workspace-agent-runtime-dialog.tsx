import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Bot, Square, SquareCheck } from "lucide-react-native";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Agent } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import { canCloseIdleAgentRuntime } from "@/utils/agent-runtime-close-eligibility";
import type { AgentRuntimeCloseActions } from "./sidebar-workspace-menu";

/** Checkbox glyphs follow the row's themed foreground */
const ThemedSquare = withUnistyles(Square);
const ThemedSquareCheck = withUnistyles(SquareCheck);
/** Detached runtimes share the sidebar warning glyph */
const ThemedBot = withUnistyles(Bot);

/** Resolves option glyph color from the active theme */
function foregroundMapping(theme: Theme) {
  return { color: theme.colors.foregroundMuted };
}

/** Identifies a historical Agent whose runtime has not resumed */
function warningMapping(theme: Theme) {
  return { color: theme.colors.statusWarning };
}

/** Selects specific Agents or every Agent without opening their provider sessions */
export function WorkspaceAgentRuntimeDialog({
  serverId,
  agents,
  directoryCurrent,
  supportsClose,
  actions,
  onClose,
}: {
  /** Host that owns all Agents in the picker */
  serverId: string;
  /** Current managed Agent directory for this Workspace */
  agents: readonly Agent[];
  /** Prevents closing from a stale directory */
  directoryCurrent: boolean;
  /** Host capability for runtime closure */
  supportsClose: boolean;
  /** Shared pending state and lifecycle commands */
  actions: AgentRuntimeCloseActions;
  /** Dismisses the picker after successful closure or cancellation */
  onClose: () => void;
}) {
  const { t } = useTranslation();
  /** Shared command identity stays stable while the hook's pending state changes */
  const { closeIdleAgentRuntimes } = actions;
  /** Explicit user choices are retained while Agent states update */
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  /** Closed and archived records no longer need runtime cleanup */
  const candidates = useMemo(
    () =>
      agents
        .filter((agent) => !agent.archivedAt && agent.status !== "closed")
        .sort((left, right) =>
          (left.title?.trim() || left.id).localeCompare(right.title?.trim() || right.id),
        ),
    [agents],
  );
  /** Any pending Agent keeps the picker from accepting another command */
  const pending = agents.some((agent) => actions.pendingAgentIds.has(agent.id));
  /** Current eligibility is rechecked when submitting */
  const selected = useMemo(
    () => candidates.filter((agent) => selectedIds.has(agent.id)),
    [candidates, selectedIds],
  );
  /** Host readiness gates every destructive command */
  const ready = directoryCurrent && supportsClose && !pending;

  /** Toggles one explicit selection */
  const toggleAgent = useCallback((agentId: string): void => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }, []);

  /** Confirms once for the requested Agents and preserves failed choices for retry */
  const closeAgents = useCallback(
    async (chosen: readonly Agent[]): Promise<void> => {
      if (!ready || chosen.length === 0) return;
      const closed = await closeIdleAgentRuntimes({
        serverId,
        agentIds: chosen.map((agent) => agent.id),
      });
      if (closed) onClose();
    },
    [closeIdleAgentRuntimes, onClose, ready, serverId],
  );

  /** Prevents dismissal while the close request is in flight */
  const dismiss = useCallback((): void => {
    if (!pending) onClose();
  }, [onClose, pending]);

  /** Sends the whole current directory selection to the same close workflow */
  const closeAll = useCallback(() => void closeAgents(candidates), [candidates, closeAgents]);
  /** Sends only the checked records to the close workflow */
  const closeSelected = useCallback(() => void closeAgents(selected), [closeAgents, selected]);
  /** Keeps the modal header stable while checkbox state changes */
  const header = useMemo(() => ({ title: t("sidebar.workspace.agentRuntime.closeAgent") }), [t]);

  return (
    <AdaptiveModalSheet
      visible
      header={header}
      onClose={dismiss}
      testID="workspace-agent-runtime-dialog"
      contentStyle={styles.content}
      footerContainerStyle={styles.footer}
      footer={
        <>
          <Button size="sm" variant="ghost" onPress={dismiss} disabled={pending}>
            {t("common.actions.cancel")}
          </Button>
          <Button
            size="sm"
            style={styles.action}
            disabled={
              !ready || candidates.length === 0 || !candidates.every(canCloseIdleAgentRuntime)
            }
            onPress={closeAll}
            testID="sidebar-workspace-menu-close-all-agents"
          >
            {t("sidebar.workspace.agentRuntime.closeAll")}
          </Button>
          <Button
            size="sm"
            variant="default"
            style={styles.action}
            disabled={!ready || selected.length === 0 || !selected.every(canCloseIdleAgentRuntime)}
            onPress={closeSelected}
            testID="workspace-agent-runtime-close-selected"
          >
            {t("sidebar.workspace.agentRuntime.closeSelected", { count: selected.length })}
          </Button>
        </>
      }
    >
      {candidates.map((agent) => (
        <WorkspaceAgentRuntimeChoice
          key={agent.id}
          agent={agent}
          checked={selectedIds.has(agent.id)}
          disabled={!ready || !canCloseIdleAgentRuntime(agent)}
          onToggle={toggleAgent}
        />
      ))}
    </AdaptiveModalSheet>
  );
}

/** Shows one stable checkbox row with its current runtime warning */
function WorkspaceAgentRuntimeChoice({
  agent,
  checked,
  disabled,
  onToggle,
}: {
  agent: Agent;
  checked: boolean;
  disabled: boolean;
  onToggle: (id: string) => void;
}) {
  const { t } = useTranslation();
  /** Names and IDs distinguish otherwise identical sessions */
  const title = agent.title?.trim() || t("workspace.tabs.fallback.agent");
  /** Announces both the selection and current command availability */
  const accessibilityState = useMemo(() => ({ checked, disabled }), [checked, disabled]);
  /** Toggles this row without rebuilding the callback on unrelated selections */
  const handlePress = useCallback(() => onToggle(agent.id), [agent.id, onToggle]);
  /** Hover and disabled feedback reuse the current theme */
  const rowStyle = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      hovered && styles.hovered,
      disabled && styles.disabled,
    ],
    [disabled],
  );
  /** Explains the record's lifecycle without crowding its title */
  let tooltip = title;
  if (agent.runtimeAttached === false)
    tooltip = t("sidebar.workspace.agentRuntime.runtimeNotRestored");
  else if (disabled) tooltip = t("sidebar.workspace.agentRuntime.idleRequired");

  return (
    <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={`${title} (${agent.id.slice(0, 7)})`}
          accessibilityState={accessibilityState}
          aria-checked={checked}
          disabled={disabled}
          onPress={handlePress}
          style={rowStyle}
          testID={`workspace-agent-runtime-select-${agent.id}`}
        >
          {checked ? (
            <ThemedSquareCheck size={16} uniProps={foregroundMapping} />
          ) : (
            <ThemedSquare size={16} uniProps={foregroundMapping} />
          )}
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          <Text style={styles.id}>{agent.id.slice(0, 7)}</Text>
          <ThemedBot
            size={16}
            uniProps={agent.runtimeAttached === false ? warningMapping : foregroundMapping}
          />
        </Pressable>
      </TooltipTrigger>
      <TooltipContent>
        <Text>{tooltip}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

/** Compact rows and wrapping actions fit both desktop dialogs and mobile sheets */
const styles = StyleSheet.create((theme) => ({
  content: { gap: theme.spacing[1] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.sm,
  },
  hovered: { backgroundColor: theme.colors.surface2 },
  disabled: { opacity: theme.opacity[50] },
  title: { flex: 1, minWidth: 0, color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  id: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  footer: { flexWrap: "wrap", justifyContent: "flex-end" },
  action: { flexShrink: 1 },
}));
