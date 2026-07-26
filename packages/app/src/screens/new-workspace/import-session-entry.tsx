import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { Inbox } from "lucide-react-native";
import { ImportSessionSheet } from "@/components/import-session-sheet";
import { Button } from "@/components/ui/button";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import {
  buildImportedSessionWorkspaceNavigation,
  isNewWorkspaceImportSessionDisabled,
} from "./import-session-entry-model";

type ImportSessionClient = Pick<DaemonClient, "fetchRecentProviderSessions" | "importAgent">;

interface NewWorkspaceImportSessionEntryProps {
  serverId: string;
  client: ImportSessionClient | null;
  cwd: string | null;
  blocked: boolean;
}

export function NewWorkspaceImportSessionEntry({
  serverId,
  client,
  cwd,
  blocked,
}: NewWorkspaceImportSessionEntryProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);
  const handleImported = useCallback(
    (agent: { id: string; workspaceId?: string }) => {
      navigateToWorkspace(buildImportedSessionWorkspaceNavigation({ serverId, agent }));
    },
    [serverId],
  );
  const label = t("importSession.title");
  const disabled = isNewWorkspaceImportSessionDisabled({
    blocked,
    hasClient: client !== null,
    cwd,
  });

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        leftIcon={Inbox}
        onPress={open}
        disabled={disabled}
        accessibilityLabel={label}
        testID="new-workspace-import-session"
      >
        {label}
      </Button>
      <ImportSessionSheet
        visible={visible}
        client={client}
        serverId={serverId}
        cwd={cwd}
        onClose={close}
        onImported={handleImported}
      />
    </>
  );
}
