import { Fragment, useMemo, type ReactElement, type ReactNode } from "react";
import { type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  Copy,
  CopyPlus,
  Download,
  FilePlus,
  FileText,
  FolderMinus,
  FolderOpen,
  FolderPlus,
  MessageSquarePlus,
  MoreVertical,
  Pencil,
  Trash2,
  Undo2,
  type LucideIcon,
} from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { ICON_SIZE, SPACING, type Theme } from "@/styles/theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const destructiveColorMapping = (theme: Theme) => ({
  color: theme.colors.destructive,
});
const ThemedMoreVertical = withUnistyles(MoreVertical);

/** Width occupied by a file action trigger, including its visual padding. */
export const FILE_ACTIONS_MENU_WIDTH = ICON_SIZE.sm + 2 * SPACING[1];

interface FileAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  destructive?: boolean;
  separatorBefore?: boolean;
  testID?: string;
}

interface FileActionsContentProps {
  fileKind: "file" | "directory";
  fileExists?: boolean;
  onOpenFile?: () => void;
  onCopyPath?: () => void;
  onCopyRelativePath?: () => void;
  onReveal?: () => void;
  revealTargetName?: string;
  onDownload?: () => void;
  onAddToChat?: () => void;
  onNewFile?: () => void;
  onNewFolder?: () => void;
  onCollapseFolder?: () => void;
  onRename?: () => void;
  onDuplicate?: () => void;
  onRevert?: () => void;
  onDelete?: () => void;
  /** Optional metadata block rendered above the actions, such as size and modified time. */
  header?: ReactNode;
  testIDPrefix?: string;
}

interface FileActionsMenuProps extends FileActionsContentProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hitSlop?: number;
  accessibilityLabel: string;
}

function stopTriggerPropagation(event: { stopPropagation?: () => void }) {
  event.stopPropagation?.();
}

function triggerStyle({
  hovered,
  pressed,
  open,
}: PressableStateCallbackType & { hovered?: boolean; open?: boolean }) {
  return [styles.trigger, (Boolean(hovered) || pressed || Boolean(open)) && styles.triggerActive];
}

/** Shared kebab menu for file actions in the explorer and diff pane. */
export function FileActionsMenu({
  fileKind,
  fileExists = true,
  onOpenFile,
  onCopyPath,
  onCopyRelativePath,
  onReveal,
  revealTargetName,
  onDownload,
  onAddToChat,
  onNewFile,
  onNewFolder,
  onCollapseFolder,
  onRename,
  onDuplicate,
  onRevert,
  onDelete,
  header,
  open,
  onOpenChange,
  hitSlop = 12,
  accessibilityLabel,
  testIDPrefix,
}: FileActionsMenuProps): ReactElement | null {
  const actions = useFileActions({
    fileKind,
    fileExists,
    onOpenFile,
    onCopyPath,
    onCopyRelativePath,
    onReveal,
    revealTargetName,
    onDownload,
    onAddToChat,
    onNewFile,
    onNewFolder,
    onCollapseFolder,
    onRename,
    onDuplicate,
    onRevert,
    onDelete,
    testIDPrefix,
  });

  if (actions.length === 0) return null;

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        hitSlop={hitSlop}
        onPressIn={stopTriggerPropagation}
        style={triggerStyle}
        accessibilityLabel={accessibilityLabel}
        testID={testIDPrefix ? `${testIDPrefix}-actions` : undefined}
      >
        <ThemedMoreVertical size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={220}>
        {header ? (
          <>
            {header}
            <DropdownMenuSeparator />
          </>
        ) : null}
        {actions.map((action) => (
          <Fragment key={action.key}>
            {action.separatorBefore ? <DropdownMenuSeparator /> : null}
            <FileActionMenuItem action={action} variant="dropdown" />
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Context-menu presentation of the same file action model. */
export function FileActionsContextMenuContent({
  fileKind,
  fileExists = true,
  onOpenFile,
  onCopyPath,
  onCopyRelativePath,
  onReveal,
  revealTargetName,
  onDownload,
  onAddToChat,
  onNewFile,
  onNewFolder,
  onCollapseFolder,
  onRename,
  onDuplicate,
  onRevert,
  onDelete,
  header,
  testIDPrefix,
}: FileActionsContentProps): ReactElement | null {
  const actions = useFileActions({
    fileKind,
    fileExists,
    onOpenFile,
    onCopyPath,
    onCopyRelativePath,
    onReveal,
    revealTargetName,
    onDownload,
    onAddToChat,
    onNewFile,
    onNewFolder,
    onCollapseFolder,
    onRename,
    onDuplicate,
    onRevert,
    onDelete,
    testIDPrefix,
  });

  if (actions.length === 0) return null;

  return (
    <ContextMenuContent
      align="start"
      width={220}
      testID={testIDPrefix ? `${testIDPrefix}-context-menu` : undefined}
    >
      {header ? (
        <>
          {header}
          <ContextMenuSeparator />
        </>
      ) : null}
      {actions.map((action) => (
        <Fragment key={action.key}>
          {action.separatorBefore ? <ContextMenuSeparator /> : null}
          <FileActionMenuItem action={action} variant="context" />
        </Fragment>
      ))}
    </ContextMenuContent>
  );
}

function useFileActions({
  fileKind,
  fileExists = true,
  onOpenFile,
  onCopyPath,
  onCopyRelativePath,
  onReveal,
  revealTargetName,
  onDownload,
  onAddToChat,
  onNewFile,
  onNewFolder,
  onCollapseFolder,
  onRename,
  onDuplicate,
  onRevert,
  onDelete,
  testIDPrefix,
}: FileActionsContentProps): FileAction[] {
  const { t } = useTranslation();
  return useMemo<FileAction[]>(() => {
    const availableFile = fileKind === "file" && fileExists;
    const specs: Array<FileAction | null> = [
      onNewFile
        ? {
            key: "new-file",
            label: t("workspace.fileActions.newFile"),
            icon: FilePlus,
            onSelect: onNewFile,
          }
        : null,
      onNewFolder
        ? {
            key: "new-folder",
            label: t("workspace.fileActions.newFolder"),
            icon: FolderPlus,
            onSelect: onNewFolder,
          }
        : null,
      onCollapseFolder
        ? {
            key: "collapse-folder",
            label: t("workspace.fileActions.collapseFolder"),
            icon: FolderMinus,
            onSelect: onCollapseFolder,
          }
        : null,
      availableFile && onOpenFile
        ? {
            key: "open-file",
            label: t("workspace.fileActions.openFile"),
            icon: FileText,
            onSelect: onOpenFile,
          }
        : null,
      onRename
        ? {
            key: "rename",
            label: t("workspace.fileActions.rename"),
            icon: Pencil,
            onSelect: onRename,
          }
        : null,
      onDuplicate
        ? {
            key: "duplicate",
            label: t("workspace.fileActions.duplicate"),
            icon: CopyPlus,
            onSelect: onDuplicate,
          }
        : null,
      onCopyPath
        ? {
            key: "copy-path",
            label: t("workspace.fileActions.copyPath"),
            icon: Copy,
            onSelect: onCopyPath,
          }
        : null,
      onCopyRelativePath
        ? {
            key: "copy-relative-path",
            label: t("workspace.fileActions.copyRelativePath"),
            icon: Copy,
            onSelect: onCopyRelativePath,
          }
        : null,
      onReveal && revealTargetName
        ? {
            key: "reveal",
            label: t("workspace.fileActions.revealIn", {
              target: revealTargetName,
            }),
            icon: FolderOpen,
            onSelect: onReveal,
          }
        : null,
      availableFile && onDownload
        ? {
            key: "download",
            label: t("workspace.fileActions.download"),
            icon: Download,
            onSelect: onDownload,
          }
        : null,
      availableFile && onAddToChat
        ? {
            key: "add-to-chat",
            label: t("workspace.fileActions.addToChat"),
            icon: MessageSquarePlus,
            onSelect: onAddToChat,
          }
        : null,
      onRevert
        ? {
            key: "revert",
            label: t("workspace.fileActions.revert"),
            icon: Undo2,
            onSelect: onRevert,
            destructive: true,
          }
        : null,
      onDelete
        ? {
            key: "delete",
            label: t("workspace.fileActions.delete"),
            icon: Trash2,
            onSelect: onDelete,
            destructive: true,
          }
        : null,
    ];
    const actions = specs.filter((action): action is FileAction => action !== null);
    return actions.map((action, index) =>
      Object.assign(action, {
        separatorBefore: Boolean(
          action.destructive && index > 0 && !actions[index - 1].destructive,
        ),
        testID: testIDPrefix ? `${testIDPrefix}-${action.key}` : undefined,
      }),
    );
  }, [
    fileExists,
    fileKind,
    onAddToChat,
    onCollapseFolder,
    onCopyPath,
    onCopyRelativePath,
    onDelete,
    onDownload,
    onDuplicate,
    onNewFile,
    onNewFolder,
    onOpenFile,
    onRename,
    onReveal,
    onRevert,
    revealTargetName,
    t,
    testIDPrefix,
  ]);
}

function FileActionMenuItem({
  action,
  variant,
}: {
  action: FileAction;
  variant: "dropdown" | "context";
}): ReactElement {
  const Icon = action.icon;
  const ThemedIcon = useMemo(() => withUnistyles(Icon), [Icon]);
  const leading = useMemo(
    () => (
      <ThemedIcon
        size={ICON_SIZE.sm}
        uniProps={action.destructive ? destructiveColorMapping : foregroundMutedColorMapping}
      />
    ),
    [ThemedIcon, action.destructive],
  );
  const MenuItem = variant === "context" ? ContextMenuItem : DropdownMenuItem;
  return (
    <MenuItem
      leading={leading}
      onSelect={action.onSelect}
      destructive={action.destructive}
      testID={action.testID}
    >
      {action.label}
    </MenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    padding: theme.spacing[1],
    width: FILE_ACTIONS_MENU_WIDTH,
    marginVertical: -theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  triggerActive: {
    backgroundColor: theme.colors.surface2,
  },
}));
