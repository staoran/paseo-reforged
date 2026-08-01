import type { ParsedDiffFile } from "@/git/use-diff-query";
import type { StreamItem } from "@/types/stream";
import { resolveWorkspaceFilePaths } from "@/workspace/file-open";
import type { StreamStrategy } from "./strategy";

export interface TurnChangeFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface TurnChangesModel {
  turnId: string;
  fileCount: number;
  additions: number;
  deletions: number;
  files: TurnChangeFile[];
}

interface ProjectTurnChangesInput {
  items: StreamItem[];
  startIndex: number;
  strategy: StreamStrategy;
  workspaceRoot: string;
  diffFiles: ParsedDiffFile[];
}

function pathKey(path: string, windowsWorkspace: boolean): string {
  return windowsWorkspace ? path.toLowerCase() : path;
}

function resolveRelativePath(path: string, workspaceRoot: string): string | null {
  return resolveWorkspaceFilePaths({ path, workspaceRoot })?.relativePath ?? null;
}

export function projectTurnChanges({
  items,
  startIndex,
  strategy,
  workspaceRoot,
  diffFiles,
}: ProjectTurnChangesInput): TurnChangesModel | null {
  const turnHost = items[startIndex];
  if (!turnHost) {
    return null;
  }

  const windowsWorkspace = /^[A-Za-z]:[\\/]/.test(workspaceRoot);
  const diffByPath = new Map<string, ParsedDiffFile>();
  for (const file of diffFiles) {
    const relativePath = resolveRelativePath(file.path, workspaceRoot);
    if (relativePath) {
      diffByPath.set(pathKey(relativePath, windowsWorkspace), file);
    }
  }

  const editedPaths: string[] = [];
  const seenPaths = new Set<string>();
  for (let index = startIndex; index >= 0 && index < items.length; ) {
    const item = items[index];
    if (index !== startIndex && item.kind === "user_message") {
      break;
    }
    if (
      item.kind === "tool_call" &&
      item.payload.source === "agent" &&
      item.payload.data.status === "completed" &&
      (item.payload.data.detail.type === "edit" || item.payload.data.detail.type === "write")
    ) {
      const relativePath = resolveRelativePath(item.payload.data.detail.filePath, workspaceRoot);
      if (relativePath) {
        const key = pathKey(relativePath, windowsWorkspace);
        if (!seenPaths.has(key)) {
          seenPaths.add(key);
          editedPaths.push(key);
        }
      }
    }

    const nextIndex = strategy.getNeighborIndex(index, "above");
    if (nextIndex === index) {
      break;
    }
    index = nextIndex;
  }

  const files: TurnChangeFile[] = [];
  for (const key of editedPaths.toReversed()) {
    const file = diffByPath.get(key);
    if (file) {
      files.push({ path: file.path, additions: file.additions, deletions: file.deletions });
    }
  }
  if (files.length === 0) {
    return null;
  }

  return {
    turnId: turnHost.id,
    fileCount: files.length,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
    files,
  };
}
