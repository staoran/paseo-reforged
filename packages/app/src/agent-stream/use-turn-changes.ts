import { useMemo } from "react";
import { useCheckoutDiffQuery } from "@/git/use-diff-query";
import type { TurnFooterHost } from "./layout";
import type { StreamStrategy } from "./strategy";
import { projectTurnChanges, type TurnChangesModel } from "./turn-changes";

interface UseTurnChangesInput {
  active: boolean;
  enabled: boolean;
  serverId?: string;
  workspaceRoot: string;
  host: TurnFooterHost | null;
  isTurnRunning: boolean;
  strategy: StreamStrategy;
}

export function useTurnChanges({
  active,
  enabled,
  serverId,
  workspaceRoot,
  host,
  isTurnRunning,
  strategy,
}: UseTurnChangesInput): TurnChangesModel | null {
  const diff = useCheckoutDiffQuery({
    serverId: serverId ?? "",
    cwd: workspaceRoot,
    mode: "uncommitted",
    enabled: Boolean(active && enabled && serverId && workspaceRoot && host && !isTurnRunning),
  });

  return useMemo(
    () =>
      host && !isTurnRunning && !diff.isError && !diff.payloadError
        ? projectTurnChanges({
            items: host.items,
            startIndex: host.startIndex,
            strategy,
            workspaceRoot,
            diffFiles: diff.files,
          })
        : null,
    [diff.files, diff.isError, diff.payloadError, host, isTurnRunning, strategy, workspaceRoot],
  );
}
