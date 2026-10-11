import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { History } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { HeaderToggleButton } from "@/components/headers/header-toggle-button";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import {
  iconButtonChromeGlyphSize,
  mutedIconColorMapping,
} from "@/components/ui/icon-button-chrome";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import type { ClosedWorkspaceTab } from "@/stores/workspace-layout-storage";
import { WORKSPACE_TAB_HISTORY_LIMIT } from "@/workspace-tabs/history";
import { getIsElectron } from "@/constants/platform";

/** Stable empty history for workspaces without closed views */
const EMPTY_HISTORY: ClosedWorkspaceTab[] = [];
/** Theme-aware header glyph shared by all form factors */
const ThemedHistory = withUnistyles(History);
/** History has no dedicated keyboard chord */
const HISTORY_SHORTCUT_KEYS: ShortcutKey[] = [];

interface WorkspaceTabHistoryButtonProps {
  /** Host-qualified workspace layout identity */
  workspaceKey: string;
  /** Hidden retained workspaces must not leave a modal open */
  isRouteFocused: boolean;
  /** Restores the selected view and resolves only after its resource is ready */
  onRestore: (tab: ClosedWorkspaceTab) => Promise<void>;
}

interface WorkspaceTabHistoryRowProps {
  /** Saved view rendered without another store subscription */
  tab: ClosedWorkspaceTab;
  /** Only the selected row carries a progress label */
  isRestoring: boolean;
  /** Other restores wait until the active host operation settles */
  disabled: boolean;
  /** Mutation entry point shared by the collection */
  onRestore: (tab: ClosedWorkspaceTab) => void;
}

/** A history row uses the shared button and a stable restore callback */
function WorkspaceTabHistoryRow({
  tab,
  isRestoring,
  disabled,
  onRestore,
}: WorkspaceTabHistoryRowProps) {
  const { t, i18n } = useTranslation();
  /** Select the exact persisted snapshot rather than reading mutable global state */
  const restoreTab = useCallback(() => onRestore(tab), [onRestore, tab]);
  return (
    <View style={styles.row} testID={`workspace-tab-history-row-${tab.tabId}`}>
      <View style={styles.details}>
        <Text numberOfLines={2} style={styles.title}>
          {tab.title}
        </Text>
        <Text style={styles.subtitle}>{new Date(tab.closedAt).toLocaleString(i18n.language)}</Text>
        {tab.target.kind === "terminal" ? (
          <Text style={styles.subtitle}>{t("workspace.tabs.history.terminalHint")}</Text>
        ) : null}
      </View>
      <Button
        size="sm"
        variant="ghost"
        testID={`workspace-tab-history-restore-${tab.tabId}`}
        disabled={disabled}
        onPress={restoreTab}
      >
        {isRestoring ? t("workspace.tabs.history.restoring") : t("workspace.tabs.history.restore")}
      </Button>
    </View>
  );
}

/** Keep local workspace recovery one click away from the tab strip */
export function WorkspaceTabHistoryButton({
  workspaceKey,
  isRouteFocused,
  onRestore,
}: WorkspaceTabHistoryButtonProps) {
  const { t } = useTranslation();
  /** User-controlled presentation state */
  const [visible, setVisible] = useState(false);
  /** Search never mutates the recorded history */
  const [search, setSearch] = useState("");
  /** The collection subscribes once rather than attaching subscriptions to each row */
  const history = useWorkspaceLayoutStore(
    (state) => state.closedTabsByWorkspace[workspaceKey] ?? EMPTY_HISTORY,
  );
  /** Host operations own pending and failure feedback in the recovery sheet */
  const restore = useMutation({
    mutationFn: onRestore,
    onSuccess: (_result, tab) => {
      useWorkspaceLayoutStore.getState().forgetClosedTab(workspaceKey, tab.tabId);
      setVisible(false);
    },
  });
  /** Keep browser-only views off native recovery lists */
  const matchingTabs = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return history.filter((tab) => {
      if (tab.target.kind === "browser" && !getIsElectron()) return false;
      return tab.title.toLocaleLowerCase().includes(query);
    });
  }, [history, search]);
  /** React Query exposes a stable reset callback independently of its result object */
  const resetRestore = restore.reset;
  /** Opening a new recovery attempt dismisses feedback from the previous attempt */
  const openHistory = useCallback(() => {
    resetRestore();
    setSearch("");
    setVisible(true);
  }, [resetRestore]);
  /** Closing the sheet leaves all un-restored entries intact */
  const closeHistory = useCallback(() => setVisible(false), []);
  /** The shared header keeps its identity while the user searches */
  const header = useMemo(
    () => ({
      title: t("workspace.tabs.history.title"),
      subtitle: t("workspace.tabs.history.description", { count: WORKSPACE_TAB_HISTORY_LIMIT }),
      search: {
        placeholder: t("workspace.tabs.history.search"),
        onChange: setSearch,
        resetKey: Number(visible),
        testID: "workspace-tab-history-search",
      },
    }),
    [t, visible],
  );
  /** Keep the header chrome expanded state stable between list updates */
  const accessibilityState = useMemo(() => ({ expanded: visible }), [visible]);

  return (
    <>
      <HeaderToggleButton
        testID="workspace-tab-history-button"
        onPress={openHistory}
        tooltipLabel={t("workspace.tabs.history.title")}
        tooltipKeys={HISTORY_SHORTCUT_KEYS}
        tooltipSide="bottom"
        accessibilityLabel={t("workspace.tabs.history.title")}
        accessibilityState={accessibilityState}
        disabled={restore.isPending}
      >
        <ThemedHistory
          size={iconButtonChromeGlyphSize("large")}
          strokeWidth={1.5}
          uniProps={mutedIconColorMapping}
        />
      </HeaderToggleButton>
      <AdaptiveModalSheet
        testID="workspace-tab-history"
        visible={visible && isRouteFocused}
        onClose={closeHistory}
        header={header}
      >
        {restore.isError ? (
          <Alert
            testID="workspace-tab-history-error"
            variant="error"
            title={t("workspace.tabs.history.restoreFailed")}
            description={restore.error.message}
          />
        ) : null}
        {matchingTabs.length === 0 ? (
          <Text style={styles.empty}>
            {search.trim() ? t("common.empty.noResults") : t("workspace.tabs.history.empty")}
          </Text>
        ) : null}
        {matchingTabs.map((tab) => (
          <WorkspaceTabHistoryRow
            key={tab.tabId}
            tab={tab}
            isRestoring={restore.isPending && restore.variables.tabId === tab.tabId}
            disabled={restore.isPending}
            onRestore={restore.mutate}
          />
        ))}
      </AdaptiveModalSheet>
    </>
  );
}

/** History uses the same readable row rhythm as other workspace pickers */
const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
  },
  details: { flex: 1, minWidth: 0, gap: theme.spacing[1] },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  subtitle: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    paddingVertical: theme.spacing[4],
  },
}));
