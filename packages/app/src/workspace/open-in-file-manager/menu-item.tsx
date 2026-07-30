import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { getIsElectron } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import type { Theme } from "@/styles/theme";
import { openDesktopTarget, useDesktopOpenTargets } from "@/workspace/desktop-open-targets";
import { resolveOpenInFileManagerPath } from "./availability";

interface OpenInFileManagerMenuItemProps {
  variant?: "dropdown" | "context";
  serverId?: string | null;
  path?: string | null;
  testID: string;
}

const ThemedFolderOpen = withUnistyles(FolderOpen);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const leadingIcon = <ThemedFolderOpen size={14} uniProps={foregroundMutedColorMapping} />;

export function OpenInFileManagerMenuItem({
  variant = "dropdown",
  serverId,
  path,
  testID,
}: OpenInFileManagerMenuItemProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const isElectron = getIsElectron();
  const isLocalDaemon = useIsLocalDaemon(serverId ?? "");
  const workspacePath = resolveOpenInFileManagerPath({ isElectron, isLocalDaemon, path });
  const { targets } = useDesktopOpenTargets({
    isLocalExecution: workspacePath !== null,
  });
  const fileManagerTarget = targets.find((target) => target.kind === "file-manager");

  const openInFileManager = useCallback(() => {
    if (!fileManagerTarget || workspacePath === null) return;
    void openDesktopTarget({
      editorId: fileManagerTarget.id,
      workspacePath,
    }).catch((error) => {
      console.warn("[open-in-file-manager] open failed", error);
      toast.error(t("sidebar.project.actions.openFolderFailed"));
    });
  }, [fileManagerTarget, t, toast, workspacePath]);

  if (!fileManagerTarget || workspacePath === null) {
    return null;
  }

  const MenuItem = variant === "context" ? ContextMenuItem : DropdownMenuItem;

  return (
    <MenuItem testID={testID} leading={leadingIcon} onSelect={openInFileManager}>
      {t("sidebar.project.actions.openFolder")}
    </MenuItem>
  );
}
