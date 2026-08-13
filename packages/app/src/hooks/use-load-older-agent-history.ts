import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { ToastApi } from "@/components/toast-host";
import { i18n } from "@/i18n/i18next";
import {
  selectAgentTimelineState,
  useSessionStore,
  type AgentTimelineCursorState,
} from "@/stores/session-store";
import { planTimelineOlderFetch } from "@/timeline/timeline-sync-plan";
import { getHostRuntimeStore } from "@/runtime/host-runtime";

export interface LoadOlderAgentHistoryClient {
  fetchAgentTimeline: (
    agentId: string,
    request: {
      direction: "before";
      cursor: { epoch: string; seq: number };
      limit: number;
      projection: "projected";
    },
  ) => Promise<unknown>;
}

export interface LoadOlderAgentHistoryLogger {
  warn: (...args: unknown[]) => void;
}

export interface LoadOlderAgentHistoryDeps {
  active?: boolean;
  client: LoadOlderAgentHistoryClient | null;
  cursor: AgentTimelineCursorState | undefined;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  setInFlight: (value: boolean) => void;
  toast?: ToastApi | null;
  logger?: LoadOlderAgentHistoryLogger;
  failedMessage?: string;
}

export async function loadOlderAgentHistory(
  agentId: string,
  deps: LoadOlderAgentHistoryDeps,
): Promise<boolean> {
  const { client, cursor, hasOlder, isLoadingOlder, setInFlight, toast, logger, failedMessage } =
    deps;
  if (deps.active === false) {
    return false;
  }
  if (isLoadingOlder) {
    return true;
  }
  if (!client || !cursor || !hasOlder) {
    return false;
  }

  setInFlight(true);
  try {
    await client.fetchAgentTimeline(
      agentId,
      planTimelineOlderFetch({ epoch: cursor.epoch, seq: cursor.startSeq }),
    );
  } catch (error) {
    (logger ?? console).warn("[Timeline] failed to load older agent history", agentId, error);
    toast?.show(failedMessage ?? i18n.t("loadOlderHistory.failed"), {
      durationMs: 2200,
      testID: "agent-load-older-history-toast",
    });
  } finally {
    setInFlight(false);
  }
  return true;
}

export function useLoadOlderAgentHistory({
  serverId,
  agentId,
  toast,
  active = true,
}: {
  serverId: string;
  agentId: string;
  toast?: ToastApi | null;
  active?: boolean;
}) {
  const { t } = useTranslation();
  const hasOlder = useSessionStore((state) => {
    if (!active) return false;
    const timeline = selectAgentTimelineState(state.sessions[serverId], agentId);
    return timeline.status === "synced" && timeline.older === "available";
  });
  const isLoadingOlder =
    useSessionStore((state) =>
      active ? state.sessions[serverId]?.agentTimelineOlderFetchInFlight.get(agentId) : false,
    ) === true;
  const progressKey = useSessionStore((state) => {
    if (!active) return null;
    const timeline = selectAgentTimelineState(state.sessions[serverId], agentId);
    const cursor = timeline.status === "synced" ? timeline.range : null;
    return cursor ? `${cursor.epoch}:${cursor.startSeq}` : null;
  });
  const setOlderFetchInFlight = useSessionStore(
    (state) => state.setAgentTimelineOlderFetchInFlight,
  );

  const setInFlight = useCallback(
    (value: boolean) => {
      setOlderFetchInFlight(serverId, (prev) => {
        if (prev.get(agentId) === value) {
          return prev;
        }
        const next = new Map(prev);
        next.set(agentId, value);
        return next;
      });
    },
    [agentId, serverId, setOlderFetchInFlight],
  );

  const loadOlder = useCallback(async (): Promise<boolean> => {
    if (!active) return false;
    const session = useSessionStore.getState().sessions[serverId];
    const timeline = selectAgentTimelineState(session, agentId);
    return await loadOlderAgentHistory(agentId, {
      active,
      client: session?.client
        ? {
            fetchAgentTimeline: (timelineAgentId, request) =>
              getHostRuntimeStore().fetchAgentTimeline(serverId, timelineAgentId, request),
          }
        : null,
      cursor: timeline.status === "synced" ? (timeline.range ?? undefined) : undefined,
      hasOlder: timeline.status === "synced" && timeline.older === "available",
      isLoadingOlder: session?.agentTimelineOlderFetchInFlight.get(agentId) === true,
      setInFlight,
      toast,
      failedMessage: t("loadOlderHistory.failed"),
    });
  }, [active, agentId, serverId, setInFlight, toast, t]);

  return {
    isLoadingOlder,
    hasOlder,
    progressKey,
    loadOlder,
  };
}
