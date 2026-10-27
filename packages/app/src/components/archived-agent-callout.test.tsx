/** @vitest-environment jsdom */
import React, { useCallback, useState, type PropsWithChildren } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DaemonClient,
  FetchAgentTimelinePayload,
} from "@getpaseo/client/internal/daemon-client";
import type { HostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useRestoreAgent } from "@/hooks/use-restore-agent";
import { i18n } from "@/i18n/i18next";
import { ArchivedAgentCallout } from "./archived-agent-callout";

/** Provider startup and message synchronization have independent completion gates */
const transport = vi.hoisted(() => ({
  refresh: vi.fn<DaemonClient["refreshAgent"]>(),
  fetch: vi.fn<HostRuntimeStore["fetchAgentTimeline"]>(),
}));

vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({ fetchAgentTimeline: transport.fetch }),
  useHostRuntimeClient: () => ({ refreshAgent: transport.refresh }),
  useHostRuntimeIsConnected: () => true,
}));
vi.mock("react-native-unistyles", () => ({ StyleSheet: { create: () => ({}) } }));
vi.mock("@/constants/layout", () => ({ FOOTER_HEIGHT: 56 }));
vi.mock("@/keyboard/shift", () => ({
  KeyboardTranslateView: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    disabled,
  }: PropsWithChildren<{ onPress(): void; disabled: boolean }>) => (
    <button type="button" onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));

/** Stable identities let the same mutation be observed by independent panes */
const serverId = "restore-host";
/** The restored chat retains its durable identity */
const agentId = "restored-agent";
/** A successful refresh response does not yet certify the displayed messages */
const refreshed = { status: "agent_refreshed", agentId, requestId: "restore" } as const;
/** The runtime adapter applies the authoritative page before returning it */
const page: FetchAgentTimelinePayload = {
  requestId: "sync",
  agentId,
  agent: null,
  direction: "tail",
  projection: "projected",
  epoch: "restored-epoch",
  reset: true,
  staleCursor: false,
  gap: false,
  window: { minSeq: 0, maxSeq: 0, nextSeq: 1 },
  startCursor: null,
  endCursor: null,
  hasOlder: false,
  hasNewer: false,
  entries: [],
  error: null,
};

/** A separate history entry starts recovery before mounting the cached conversation */
function HistoryEntry({ includeOtherChats = false }: { includeOtherChats?: boolean }) {
  /** Visibility changes immediately without awaiting the provider */
  const [opened, setOpened] = useState(false);
  /** This mutation instance is independent of the footer's retry instance */
  const { mutate: restoreAgent } = useRestoreAgent();
  /** Starting the request publishes pending before revealing the restored pane */
  const handleRestore = useCallback(() => {
    restoreAgent({ serverId, agentId });
    setOpened(true);
  }, [restoreAgent]);
  return (
    <>
      <button type="button" onClick={handleRestore}>
        Restore history
      </button>
      {opened ? <ArchivedAgentCallout serverId={serverId} agentId={agentId} /> : null}
      {includeOtherChats ? (
        <>
          <div data-testid="other-host">
            <ArchivedAgentCallout serverId="other-host" agentId={agentId} />
          </div>
          <div data-testid="other-agent">
            <ArchivedAgentCallout serverId={serverId} agentId="other-agent" />
          </div>
        </>
      ) : null}
    </>
  );
}

/** Use the real shared mutation cache with isolated provider transport */
function renderHistory(includeOtherChats = false) {
  /** Query state must not survive into another test */
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <HistoryEntry includeOtherChats={includeOtherChats} />
    </QueryClientProvider>,
  );
  return queryClient;
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  transport.refresh.mockReset().mockResolvedValue(refreshed);
  transport.fetch.mockReset().mockResolvedValue(page);
  useSessionStore
    .getState()
    .initializeSession(serverId, { refreshAgent: transport.refresh } as never);
});

afterEach(() => {
  cleanup();
  useSessionStore.setState({ sessions: {}, agentLastActivity: new Map() });
  vi.unstubAllGlobals();
});

describe("ArchivedAgentCallout restoration", () => {
  it("mounts in restoring state and hides archive actions until message sync finishes", async () => {
    /** Hold provider restoration while the cached conversation opens */
    let finishResume!: (value: typeof refreshed) => void;
    /** The message page is deliberately slower than provider startup */
    let finishSync!: (value: FetchAgentTimelinePayload) => void;
    transport.refresh.mockReturnValueOnce(
      new Promise((resolve) => {
        finishResume = resolve;
      }),
    );
    transport.fetch.mockReturnValueOnce(
      new Promise((resolve) => {
        finishSync = resolve;
      }),
    );
    /** Both mutation instances share this cache */
    const queryClient = renderHistory();

    fireEvent.click(screen.getByText("Restore history"));
    expect(screen.getByTestId("agent-restoring")).toBeTruthy();
    expect(screen.queryByText(i18n.t("agentPanel.archived.callout"))).toBeNull();
    expect(
      screen.queryByRole("button", { name: i18n.t("agentPanel.archived.unarchive") }),
    ).toBeNull();
    await waitFor(() => expect(transport.refresh).toHaveBeenCalledOnce());
    expect(transport.fetch).not.toHaveBeenCalled();

    await act(async () => {
      finishResume(refreshed);
    });
    await waitFor(() => expect(transport.fetch).toHaveBeenCalledOnce());
    expect(screen.getByTestId("agent-restoring")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: i18n.t("agentPanel.archived.unarchive") }),
    ).toBeNull();

    await act(async () => {
      finishSync(page);
    });
    await waitFor(() => expect(screen.queryByTestId("agent-restoring")).toBeNull());
    expect(queryClient.getMutationCache().getAll()[0]?.state.status).toBe("success");
    queryClient.clear();
  });

  it.each(["provider", "timeline"] as const)(
    "shows a failed %s restore and lets the footer retry it",
    async (failureStage) => {
      if (failureStage === "provider") {
        transport.refresh.mockRejectedValueOnce(new Error("Restore failed"));
      } else {
        transport.fetch.mockRejectedValueOnce(new Error("Restore failed"));
      }
      /** Failure belongs to the chat even though History initiated it */
      const queryClient = renderHistory();
      fireEvent.click(screen.getByText("Restore history"));
      await waitFor(() =>
        expect(screen.getByTestId("agent-unarchive-error").textContent).toBe("Restore failed"),
      );
      expect(screen.queryByText(i18n.t("agentPanel.archived.callout"))).toBeNull();

      /** Retrying immediately clears stale error text and prevents a second click */
      let finishRetry!: (value: typeof refreshed) => void;
      transport.refresh.mockReturnValueOnce(
        new Promise((resolve) => {
          finishRetry = resolve;
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: i18n.t("common.actions.retry") }));
      await waitFor(() => expect(screen.getByTestId("agent-restoring")).toBeTruthy());
      expect(screen.queryByTestId("agent-unarchive-error")).toBeNull();
      expect(screen.queryByRole("button", { name: i18n.t("common.actions.retry") })).toBeNull();
      await waitFor(() => expect(transport.refresh).toHaveBeenCalledTimes(2));
      await act(async () => {
        finishRetry(refreshed);
      });
      await waitFor(() => expect(screen.queryByTestId("agent-restoring")).toBeNull());
      expect(screen.queryByTestId("agent-unarchive-error")).toBeNull();
      queryClient.clear();
    },
  );

  it("does not hide archive actions for another host or agent", async () => {
    /** Only the selected host and agent are being restored */
    let finishResume!: (value: typeof refreshed) => void;
    transport.refresh.mockReturnValueOnce(
      new Promise((resolve) => {
        finishResume = resolve;
      }),
    );
    /** Unrelated panes observe the same cache but different restore inputs */
    const queryClient = renderHistory(true);
    fireEvent.click(screen.getByText("Restore history"));
    expect(screen.getByTestId("agent-restoring")).toBeTruthy();
    for (const testId of ["other-host", "other-agent"]) {
      expect(
        within(screen.getByTestId(testId)).getByRole("button", {
          name: i18n.t("agentPanel.archived.unarchive"),
        }),
      ).toBeTruthy();
    }
    await waitFor(() => expect(transport.refresh).toHaveBeenCalledOnce());
    await act(async () => {
      finishResume(refreshed);
    });
    await waitFor(() => expect(screen.queryByTestId("agent-restoring")).toBeNull());
    queryClient.clear();
  });
});
