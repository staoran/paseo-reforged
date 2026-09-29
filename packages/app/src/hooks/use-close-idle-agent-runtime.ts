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

interface CloseIdleAgentRuntimesInput {
  /** Host that owns every requested Agent */
  serverId: string;
  /** Explicit user selection from the Workspace picker */
  agentIds: readonly string[];
}

const EMPTY_PENDING_AGENT_IDS: ReadonlySet<string> = new Set();
const EMPTY_ERRORS: ReadonlyMap<string, string> = new Map();

/** Confirms and closes an idle Agent runtime while retaining its stored record */
export function useCloseIdleAgentRuntime(): {
  pendingAgentIds: ReadonlySet<string>;
  errorByAgentId: ReadonlyMap<string, string>;
  closeIdleAgentRuntime: (input: CloseIdleAgentRuntimeInput) => Promise<void>;
  closeIdleAgentRuntimes: (input: CloseIdleAgentRuntimesInput) => Promise<boolean>;
} {
  const { t } = useTranslation();
  const toast = useToast();
  const pendingAgentIdsRef = useRef(new Set<string>());
  const [pendingAgentIds, setPendingAgentIds] =
    useState<ReadonlySet<string>>(EMPTY_PENDING_AGENT_IDS);
  const [errorByAgentId, setErrorByAgentId] = useState<ReadonlyMap<string, string>>(EMPTY_ERRORS);

  /** Clears only the selected Agent's close error */
  const clearError = useCallback((agentId: string) => {
    setErrorByAgentId((previous) => {
      if (!previous.has(agentId)) return previous;
      const next = new Map(previous);
      next.delete(agentId);
      return next;
    });
  }, []);

  /** Keeps a failed close visible until the user dismisses it or retries */
  const reportError = useCallback(
    (agentId: string, message: string) => {
      setErrorByAgentId((previous) => new Map(previous).set(agentId, message));
      toast.show(message, {
        variant: "error",
        durationMs: null,
        onDismiss: () => clearError(agentId),
      });
    },
    [clearError, toast],
  );

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
          reportError(agentId, t("sidebar.workspace.agentRuntime.directoryUnavailable"));
          return;
        }
        if (!initial.client.supportsAgentRuntimeClose()) {
          reportError(agentId, t("sidebar.workspace.agentRuntime.updateHost"));
          return;
        }
        if (!canRequestAgentRuntimeClose(initial.agent, keepRecord)) {
          reportError(agentId, t("sidebar.workspace.agentRuntime.idleRequired"));
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

        clearError(agentId);
        const current = readCloseContext(serverId, agentId);
        if (!current) {
          reportError(agentId, t("sidebar.workspace.agentRuntime.directoryUnavailable"));
          return;
        }
        if (!current.client.supportsAgentRuntimeClose()) {
          reportError(agentId, t("sidebar.workspace.agentRuntime.updateHost"));
          return;
        }
        if (!canRequestAgentRuntimeClose(current.agent, keepRecord)) {
          reportError(agentId, t("sidebar.workspace.agentRuntime.idleRequired"));
          return;
        }

        toast.show(t("sidebar.workspace.agentRuntime.pending", { title }), { durationMs: null });
        await current.client.closeIdleAgentRuntime(agentId);
        runtimeClosed = true;
        await afterClose?.({ agent: current.agent, client: current.client });
        toast.show(t("sidebar.workspace.agentRuntime.closed", { title }), { variant: "success" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reportError(
          agentId,
          runtimeClosed
            ? t("sidebar.workspace.agentRuntime.closedButCleanupFailed", { message })
            : message,
        );
      } finally {
        pendingAgentIdsRef.current.delete(agentId);
        setPendingAgentIds(new Set(pendingAgentIdsRef.current));
      }
    },
    [clearError, reportError, t, toast],
  );

  /** Confirms a selection once and lets the picker stay open after cancellation or failure */
  const closeIdleAgentRuntimes = useCallback(
    async function closeIdleAgentRuntimes(input: CloseIdleAgentRuntimesInput): Promise<boolean> {
      /** Deduplicates choices before reserving their pending slots */
      const agentIds = [...new Set(input.agentIds)];
      if (agentIds.length === 0 || agentIds.some((id) => pendingAgentIdsRef.current.has(id))) {
        return false;
      }

      /** Reads readiness and eligibility again after the user confirms */
      function readContexts(): { agent: Agent; client: DaemonClient }[] | null {
        const contexts: { agent: Agent; client: DaemonClient }[] = [];
        for (const agentId of agentIds) {
          const context = readCloseContext(input.serverId, agentId);
          if (!context) {
            reportError(agentId, t("sidebar.workspace.agentRuntime.directoryUnavailable"));
            return null;
          }
          if (!context.client.supportsAgentRuntimeClose()) {
            reportError(agentId, t("sidebar.workspace.agentRuntime.updateHost"));
            return null;
          }
          if (!canRequestAgentRuntimeClose(context.agent, false)) {
            reportError(agentId, t("sidebar.workspace.agentRuntime.idleRequired"));
            return null;
          }
          contexts.push(context);
        }
        return contexts;
      }
      if (!readContexts()) return false;
      for (const agentId of agentIds) pendingAgentIdsRef.current.add(agentId);
      setPendingAgentIds(new Set(pendingAgentIdsRef.current));
      try {
        const confirmed = await confirmDialog({
          title: t("sidebar.workspace.agentRuntime.confirmAllTitle", { count: agentIds.length }),
          message: t("sidebar.workspace.agentRuntime.confirmAllMessage"),
          confirmLabel: t("sidebar.workspace.agentRuntime.confirm"),
          cancelLabel: t("sidebar.workspace.agentRuntime.cancel"),
          destructive: true,
        });
        if (!confirmed) return false;
        const current = readContexts();
        if (!current) return false;
        for (const agentId of agentIds) clearError(agentId);
        toast.show(t("sidebar.workspace.agentRuntime.pendingAll", { count: agentIds.length }), {
          durationMs: null,
        });
        let failed = false;
        for (const [index, agentId] of agentIds.entries()) {
          try {
            await current[index]!.client.closeIdleAgentRuntime(agentId);
          } catch (error) {
            failed = true;
            reportError(agentId, error instanceof Error ? error.message : String(error));
          }
        }
        if (!failed) {
          toast.show(t("sidebar.workspace.agentRuntime.closedAll", { count: agentIds.length }), {
            variant: "success",
          });
        }
        return !failed;
      } catch (error) {
        reportError(agentIds[0]!, error instanceof Error ? error.message : String(error));
        return false;
      } finally {
        for (const agentId of agentIds) pendingAgentIdsRef.current.delete(agentId);
        setPendingAgentIds(new Set(pendingAgentIdsRef.current));
      }
    },
    [clearError, reportError, t, toast],
  );

  return { pendingAgentIds, errorByAgentId, closeIdleAgentRuntime, closeIdleAgentRuntimes };
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
