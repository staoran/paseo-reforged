import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { Agent } from "@/stores/session-store";
import { useSessionStore } from "@/stores/session-store";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { isCurrentAgentDirectory } from "@/utils/agent-directory-readiness";
import { canRequestAgentRuntimeClose } from "@/utils/agent-runtime-close-eligibility";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useToast } from "@/contexts/toast-context";

interface CloseIdleAgentRuntimeInput {
  serverId: string;
  agentId: string;
  keepRecord?: boolean;
  afterClose?: (input: { agent: Agent; client: DaemonClient }) => Promise<void> | void;
}

const EMPTY_PENDING_AGENT_IDS: ReadonlySet<string> = new Set();

/** Confirms and closes an idle Agent runtime while retaining its stored record */
export function useCloseIdleAgentRuntime(): {
  pendingAgentIds: ReadonlySet<string>;
  closeIdleAgentRuntime: (input: CloseIdleAgentRuntimeInput) => Promise<void>;
} {
  const { t } = useTranslation();
  const toast = useToast();
  const pendingAgentIdsRef = useRef(new Set<string>());
  const [pendingAgentIds, setPendingAgentIds] =
    useState<ReadonlySet<string>>(EMPTY_PENDING_AGENT_IDS);

  const closeIdleAgentRuntime = useCallback(
    async function closeIdleAgentRuntime(input: CloseIdleAgentRuntimeInput): Promise<void> {
      const { serverId, agentId, keepRecord = false, afterClose } = input;
      if (pendingAgentIdsRef.current.has(agentId)) return;
      pendingAgentIdsRef.current.add(agentId);
      setPendingAgentIds(new Set(pendingAgentIdsRef.current));

      let runtimeClosed = false;
      try {
        const initial = readCloseContext(serverId, agentId);
        if (!initial) {
          toast.error(t("sidebar.workspace.agentRuntime.directoryUnavailable"));
          return;
        }
        if (!initial.client.supportsAgentRuntimeClose()) {
          toast.error(t("sidebar.workspace.agentRuntime.updateHost"));
          return;
        }
        if (!canRequestAgentRuntimeClose(initial.agent, keepRecord)) {
          toast.error(t("sidebar.workspace.agentRuntime.idleRequired"));
          return;
        }

        const title = initial.agent.title?.trim() || t("workspace.tabs.fallback.agent");
        if (initial.agent.status !== "closed") {
          const confirmed = await confirmDialog({
            title: t("sidebar.workspace.agentRuntime.confirmTitle", { title }),
            message: keepRecord
              ? t("sidebar.workspace.agentRuntime.confirmCloseAndKeepMessage", { title })
              : t("sidebar.workspace.agentRuntime.confirmMessage", { title }),
            confirmLabel: t("sidebar.workspace.agentRuntime.confirm"),
            cancelLabel: t("sidebar.workspace.agentRuntime.cancel"),
            destructive: true,
          });
          if (!confirmed) return;
        }

        const current = readCloseContext(serverId, agentId);
        if (!current) {
          toast.error(t("sidebar.workspace.agentRuntime.directoryUnavailable"));
          return;
        }
        if (!current.client.supportsAgentRuntimeClose()) {
          toast.error(t("sidebar.workspace.agentRuntime.updateHost"));
          return;
        }
        if (!canRequestAgentRuntimeClose(current.agent, keepRecord)) {
          toast.error(t("sidebar.workspace.agentRuntime.idleRequired"));
          return;
        }

        toast.show(t("sidebar.workspace.agentRuntime.pending", { title }));
        await current.client.closeIdleAgentRuntime(agentId);
        runtimeClosed = true;
        await afterClose?.({ agent: current.agent, client: current.client });
        toast.show(t("sidebar.workspace.agentRuntime.closed", { title }), { variant: "success" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(
          runtimeClosed
            ? t("sidebar.workspace.agentRuntime.closedButCleanupFailed", { message })
            : message,
        );
      } finally {
        pendingAgentIdsRef.current.delete(agentId);
        setPendingAgentIds(new Set(pendingAgentIdsRef.current));
      }
    },
    [t, toast],
  );

  return { pendingAgentIds, closeIdleAgentRuntime };
}

/** Reads the latest Host connection and Agent state without hydrating stored records */
function readCloseContext(
  serverId: string,
  agentId: string,
): { agent: Agent; client: DaemonClient } | null {
  const snapshot = getHostRuntimeStore().getSnapshot(serverId);
  const session = useSessionStore.getState().sessions[serverId];
  if (
    !snapshot ||
    !session ||
    !isCurrentAgentDirectory({ snapshot, session }) ||
    !snapshot.client
  ) {
    return null;
  }
  const agent = session.agents.get(agentId);
  if (!agent) return null;
  return { agent, client: snapshot.client };
}
