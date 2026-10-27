import { useCallback } from "react";
import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { FOOTER_HEIGHT } from "@/constants/layout";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { KeyboardTranslateView } from "@/keyboard/shift";
import { Button } from "@/components/ui/button";
import type { Theme } from "@/styles/theme";
import { toErrorMessage } from "@/utils/error-messages";
import { useAgentRestoreState, useRestoreAgent } from "@/hooks/use-restore-agent";

interface ArchivedAgentCalloutProps {
  serverId: string;
  agentId: string;
}

/** Show restoration progress in place of archived actions until the chat is ready */
export function ArchivedAgentCallout({ serverId, agentId }: ArchivedAgentCalloutProps) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  /** Both History and this footer publish into the same mutation cache */
  const restoreState = useAgentRestoreState(serverId, agentId);
  /** The footer can retry a failure from either entry point */
  const { mutate: restoreAgent } = useRestoreAgent();
  /** Pending covers provider startup and the following message synchronization */
  const isRestoring = restoreState?.status === "pending";
  /** Keep failures visible until the next restore attempt */
  const restoreError = restoreState?.error;
  /** Archived wording applies only while no restore attempt is in flight */
  let label = t("agentPanel.archived.callout");
  if (isRestoring) label = t("workspace.tabs.history.restoring");
  else if (restoreError) label = t("workspace.tabs.history.restoreFailed");

  /** Dispatching through React Query keeps retries and failures visible across panes */
  const handleUnarchive = useCallback(() => {
    if (!client || !isConnected || isRestoring) return;
    restoreAgent({ serverId, agentId });
  }, [client, isConnected, isRestoring, restoreAgent, serverId, agentId]);

  return (
    <KeyboardTranslateView style={styles.container}>
      <View style={styles.inputAreaContainer}>
        <View style={styles.inputAreaContent}>
          <View style={styles.calloutStack}>
            <View style={styles.callout} testID={isRestoring ? "agent-restoring" : undefined}>
              <Text style={styles.calloutText}>{label}</Text>
              {isRestoring ? null : (
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={handleUnarchive}
                  disabled={!isConnected}
                >
                  {restoreError ? t("common.actions.retry") : t("agentPanel.archived.unarchive")}
                </Button>
              )}
            </View>
            {restoreError ? (
              <Text style={styles.errorText} testID="agent-unarchive-error">
                {toErrorMessage(restoreError)}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </KeyboardTranslateView>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  container: {
    flexDirection: "column",
    position: "relative",
  },
  inputAreaContainer: {
    position: "relative",
    minHeight: FOOTER_HEIGHT,
    marginHorizontal: "auto",
    alignItems: "center",
    width: "100%",
    overflow: "visible",
    padding: theme.spacing[4],
  },
  inputAreaContent: {
    width: "100%",
    maxWidth: theme.contentMaxWidth,
  },
  callout: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius["2xl"],
    paddingVertical: {
      xs: theme.spacing[3],
      md: theme.spacing[4],
    },
    paddingHorizontal: {
      xs: theme.spacing[4],
      md: theme.spacing[6],
    },
  },
  calloutStack: {
    gap: theme.spacing[2],
  },
  calloutText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  errorText: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
})) as unknown as Record<string, object>;
