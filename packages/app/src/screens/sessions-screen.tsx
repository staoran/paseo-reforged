import { useMemo, useState, useCallback, useEffect, type ReactElement } from "react";
import { View, Text } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { router } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { ChevronLeft } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { AgentList } from "@/components/agent-list";
import { SearchField } from "@/components/ui/search-field";
import { HostFilter } from "@/components/hosts/host-filter";
import { ALL_HOSTS_OPTION_ID } from "@/components/hosts/host-picker";
import {
  type AgentHistoryHostError,
  type AgentHistoryResult,
  useAgentHistory,
} from "@/hooks/use-agent-history";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useHosts } from "@/runtime/host-runtime";
import { buildOpenProjectRoute } from "@/utils/host-routes";
import { useIsCompactFormFactor } from "@/constants/layout";

/** Long enough that a typed word is one request, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 200;

const sessionsHostOptionTestID = (serverId: string) => `sessions-host-filter-item-${serverId}`;

/**
 * A host that failed while others answered. Without this the list silently
 * under-reports, and under a query "No sessions match" becomes a claim the app
 * has no basis for.
 */
function SessionHostErrorsBanner({
  errors,
  t,
}: {
  errors: AgentHistoryHostError[];
  t: TFunction;
}): ReactElement {
  return (
    <View style={styles.errorsBannerWrap}>
      <View style={styles.errorsBanner} testID="sessions-host-errors">
        {errors.map((error) => (
          <Text key={error.serverId} style={styles.errorsBannerText}>
            {t("sessions.hostLoadFailed", { host: error.serverName })}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** An empty list means something different once a query is narrowing it. */
function resolveEmptyText(input: {
  t: TFunction;
  isSearching: boolean;
  isAllHosts: boolean;
}): string {
  if (input.isSearching) return input.t("sessions.noMatches");
  if (input.isAllHosts) return input.t("sessions.empty");
  return "No sessions for this host";
}

function SessionsFilterRow({
  hosts,
  selectedHost,
  onSelectHost,
  searchInput,
  onChangeSearch,
  isSearchSupported,
  isSearchUpgradeRequired,
  stackFilters,
  t,
}: {
  hosts: ReturnType<typeof useHosts>;
  selectedHost: string;
  onSelectHost: (serverId: string) => void;
  searchInput: string;
  onChangeSearch: (value: string) => void;
  isSearchSupported: boolean;
  isSearchUpgradeRequired: boolean;
  stackFilters: boolean;
  t: TFunction;
}): ReactElement | null {
  const showHostFilter = hosts.length > 1;
  if (!showHostFilter && !isSearchSupported && !isSearchUpgradeRequired) {
    return null;
  }

  let searchControl: ReactElement | null = null;
  if (isSearchSupported) {
    searchControl = (
      <SearchField
        value={searchInput}
        onChangeText={onChangeSearch}
        placeholder={t("sessions.searchPlaceholder")}
        clearAccessibilityLabel={t("sessions.actions.clearSearch")}
        testID="sessions-search-input"
        containerTestID="sessions-search-field"
        clearTestID="sessions-search-clear"
        containerStyle={stackFilters ? styles.searchFieldStacked : styles.searchFieldInline}
      />
    );
  } else if (isSearchUpgradeRequired) {
    searchControl = (
      <View style={styles.searchUpgradeNotice} testID="sessions-search-upgrade">
        <Text style={styles.searchUpgradeText}>{t("sessions.searchRequiresUpgrade")}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.filterContainer, stackFilters && styles.filterContainerStacked]}>
      {searchControl}
      {showHostFilter ? (
        <HostFilter
          hosts={hosts}
          selectedHost={selectedHost}
          onSelectHost={onSelectHost}
          triggerTestID="sessions-host-filter-trigger"
          hostOptionTestID={sessionsHostOptionTestID}
        />
      ) : null}
    </View>
  );
}

function SessionsHistoryContent({
  agents,
  hostErrors,
  isInitialLoad,
  showLoadError,
  isManualRefresh,
  isSearching,
  emptyText,
  loadingColor,
  searchMatchesByAgentKey,
  listFooterComponent,
  onRetry,
  onClearSearch,
  onBack,
  onRefresh,
  t,
}: {
  agents: AgentHistoryResult["agents"];
  hostErrors: AgentHistoryHostError[];
  isInitialLoad: boolean;
  showLoadError: boolean;
  isManualRefresh: boolean;
  isSearching: boolean;
  emptyText: string;
  loadingColor: string;
  searchMatchesByAgentKey: AgentHistoryResult["searchMatchesByAgentKey"];
  listFooterComponent: ReactElement | null;
  onRetry: () => void;
  onClearSearch: () => void;
  onBack: () => void;
  onRefresh: () => void;
  t: TFunction;
}): ReactElement {
  let content: ReactElement;

  if (isInitialLoad) {
    content = (
      <View style={styles.loadingContainer}>
        <LoadingSpinner size="large" color={loadingColor} />
      </View>
    );
  } else if (showLoadError) {
    content = (
      <View style={styles.emptyContainer} testID="sessions-load-error">
        {hostErrors.length > 0 ? (
          hostErrors.map((error) => (
            <Text key={error.serverId} style={styles.loadErrorText}>
              {t("sessions.hostLoadFailed", { host: error.serverName })}
            </Text>
          ))
        ) : (
          <Text style={styles.loadErrorText}>Unable to load sessions</Text>
        )}
        <Button variant="ghost" onPress={onRetry} disabled={isManualRefresh}>
          {isManualRefresh ? "Trying..." : "Try again"}
        </Button>
      </View>
    );
  } else if (agents.length === 0) {
    content = (
      <View style={styles.emptyContainer} testID="sessions-empty">
        <Text style={styles.emptyText}>{emptyText}</Text>
        {isSearching ? (
          <Button variant="ghost" onPress={onClearSearch}>
            {t("sessions.actions.clearSearch")}
          </Button>
        ) : (
          <Button variant="ghost" leftIcon={ChevronLeft} onPress={onBack}>
            Back
          </Button>
        )}
      </View>
    );
  } else {
    content = (
      <AgentList
        agents={agents}
        showCheckoutInfo={false}
        isRefreshing={isManualRefresh}
        onRefresh={onRefresh}
        listFooterComponent={listFooterComponent}
        showAttentionIndicator={false}
        showHostColumn
        searchMatchesByAgentKey={isSearching ? searchMatchesByAgentKey : undefined}
        flat={isSearching}
      />
    );
  }

  return (
    <>
      {hostErrors.length > 0 && !showLoadError ? (
        <SessionHostErrorsBanner errors={hostErrors} t={t} />
      ) : null}
      {content}
    </>
  );
}

export function SessionsScreen() {
  const isFocused = useIsFocused();

  if (!isFocused) {
    return <View style={styles.container} />;
  }

  return <SessionsScreenContent />;
}

function SessionsScreenContent() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const hosts = useHosts();
  const [selectedHost, setSelectedHost] = useState(ALL_HOSTS_OPTION_ID);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS).trim();
  const historyServerId = selectedHost === ALL_HOSTS_OPTION_ID ? null : selectedHost;
  const {
    agents,
    hasMore,
    isInitialLoad,
    isLoadingMore,
    isError,
    isSearchSupported,
    isSearchUpgradeRequired,
    isSearchTruncated,
    searchMatchesByAgentKey,
    hostErrors,
    loadMore,
    refreshAll,
  } = useAgentHistory({
    serverId: historyServerId,
    search,
  });
  const isSearching = isSearchSupported && search.length > 0;
  const stackFilters = hosts.length > 1 && (isCompact || theme.fontSize.sm >= 20);

  useEffect(() => {
    if (
      selectedHost !== ALL_HOSTS_OPTION_ID &&
      !hosts.some((host) => host.serverId === selectedHost)
    ) {
      setSelectedHost(ALL_HOSTS_OPTION_ID);
    }
  }, [hosts, selectedHost]);

  useEffect(() => {
    if (!isSearchSupported && searchInput.length > 0) {
      setSearchInput("");
    }
  }, [isSearchSupported, searchInput]);

  const [isManualRefresh, setIsManualRefresh] = useState(false);

  const handleRefresh = useCallback(() => {
    setIsManualRefresh(true);
    void refreshAll().finally(() => setIsManualRefresh(false));
  }, [refreshAll]);

  const handleRetry = useCallback(() => {
    setIsManualRefresh(true);
    void refreshAll({ retryConnections: true }).finally(() => setIsManualRefresh(false));
  }, [refreshAll]);

  // `useAgentHistory` owns the order: recency at rest, relevance under a query.
  const emptyText = resolveEmptyText({
    t,
    isSearching,
    isAllHosts: selectedHost === ALL_HOSTS_OPTION_ID,
  });
  const showLoadError = isError && agents.length === 0;

  const handleBack = useCallback(() => {
    router.navigate(buildOpenProjectRoute());
  }, []);

  const handleClearSearch = useCallback(() => setSearchInput(""), []);

  const listFooterComponent = useMemo(() => {
    // A ranked result set has no next page — reaching a weaker match means
    // narrowing the query, so the footer says that instead of offering a button.
    if (isSearchTruncated) {
      return (
        <View style={styles.footer}>
          <Text style={styles.footerHint}>{t("sessions.tooManyMatches")}</Text>
        </View>
      );
    }
    if (!hasMore) {
      return null;
    }
    return (
      <View style={styles.footer}>
        <Button variant="ghost" onPress={loadMore} disabled={isLoadingMore}>
          {isLoadingMore ? "Loading..." : t("sessions.actions.loadMore")}
        </Button>
      </View>
    );
  }, [hasMore, isLoadingMore, isSearchTruncated, loadMore, t]);

  return (
    <View style={styles.container}>
      <MenuHeader title={t("sessions.title")} />
      <SessionsFilterRow
        hosts={hosts}
        selectedHost={selectedHost}
        onSelectHost={setSelectedHost}
        searchInput={searchInput}
        onChangeSearch={setSearchInput}
        isSearchSupported={isSearchSupported}
        isSearchUpgradeRequired={isSearchUpgradeRequired}
        stackFilters={stackFilters}
        t={t}
      />
      <SessionsHistoryContent
        agents={agents}
        hostErrors={hostErrors}
        isInitialLoad={isInitialLoad}
        showLoadError={showLoadError}
        isManualRefresh={isManualRefresh}
        isSearching={isSearching}
        emptyText={emptyText}
        loadingColor={theme.colors.foregroundMuted}
        searchMatchesByAgentKey={searchMatchesByAgentKey}
        listFooterComponent={listFooterComponent}
        onRetry={handleRetry}
        onClearSearch={handleClearSearch}
        onBack={handleBack}
        onRefresh={handleRefresh}
        t={t}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  filterContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingTop: theme.spacing[4],
  },
  filterContainerStacked: {
    flexDirection: "column",
    alignItems: "stretch",
  },
  searchFieldInline: {
    flex: 1,
    minWidth: 0,
  },
  searchFieldStacked: {
    alignSelf: "stretch",
    width: "100%",
  },
  searchUpgradeNotice: {
    flex: 1,
    minWidth: 0,
    paddingVertical: theme.spacing[1],
  },
  searchUpgradeText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: Math.round(theme.fontSize.xs * 1.4),
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[6],
    padding: theme.spacing[6],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.lg,
  },
  loadErrorText: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  footer: {
    alignItems: "center",
    paddingVertical: theme.spacing[4],
  },
  footerHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  errorsBannerWrap: {
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingTop: theme.spacing[3],
  },
  errorsBanner: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3],
    gap: theme.spacing[1],
  },
  errorsBannerText: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.xs,
  },
}));
