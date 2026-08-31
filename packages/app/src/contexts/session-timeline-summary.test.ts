import { describe, expect, it, vi } from "vitest";
import type { AgentTimelineProjectionPayload } from "@getpaseo/protocol/messages";
import {
  fetchTimelineSummaryWithCanonicalFallback,
  finalizeInstalledTimelineSummary,
} from "./session-timeline-summary";

interface Deferred<T> {
  /** Promise controlled by the test. */
  promise: Promise<T>;
  /** Completes the controlled promise. */
  resolve(value: T): void;
}

interface TestTimelinePage {
  /** Identifies which request produced the page. */
  source: "summary" | "canonical";
  /** Optional summary projection carried by the page. */
  projectionPayload?: AgentTimelineProjectionPayload;
}

/** Creates a controllable promise for deterministic race tests. */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("fetchTimelineSummaryWithCanonicalFallback", () => {
  it("does not fetch canonical when the fallback callback invalidates request ownership", async () => {
    const summaryPage: TestTimelinePage = {
      source: "summary",
      projectionPayload: {
        kind: "summary",
        epoch: "epoch-fallback-owner",
        timelineRevision: "00000000-0000-4000-8000-000000000005",
        entries: [],
        activities: [],
        hasOlderTurns: false,
      },
    };
    let requestCurrent = true;
    const fetchSummary = vi.fn(async () => summaryPage);
    const fetchCanonical = vi.fn(async () => ({ source: "canonical" }) as TestTimelinePage);

    await expect(
      fetchTimelineSummaryWithCanonicalFallback({
        fetchSummary,
        fetchCanonical,
        canInstallSummary: () => false,
        installSummary: () => false,
        onCanonicalFallback: () => {
          requestCurrent = false;
        },
        isRequestCurrent: () => requestCurrent,
      }),
    ).resolves.toEqual({ page: summaryPage, outcome: "discarded" });
    expect(fetchSummary).toHaveBeenCalledOnce();
    expect(fetchCanonical).not.toHaveBeenCalled();
  });

  it("uses the summary response as the canonical page when projection is unavailable", async () => {
    const canonicalSummaryResponse: TestTimelinePage = { source: "summary" };
    const fetchSummary = vi.fn(async () => canonicalSummaryResponse);
    const fetchCanonical = vi.fn(async () => ({ source: "canonical" }) as TestTimelinePage);

    await expect(
      fetchTimelineSummaryWithCanonicalFallback({
        fetchSummary,
        fetchCanonical,
        canInstallSummary: () => false,
        installSummary: () => false,
      }),
    ).resolves.toEqual({ page: canonicalSummaryResponse, outcome: "canonical-page" });
    expect(fetchSummary).toHaveBeenCalledOnce();
    expect(fetchCanonical).not.toHaveBeenCalled();
  });

  it("fetches canonical tail when a live event invalidates an in-flight summary", async () => {
    const summary = createDeferred<TestTimelinePage>();
    const canonicalPage: TestTimelinePage = { source: "canonical" };
    const projection = {
      kind: "summary",
      epoch: "epoch-1",
      timelineRevision: "00000000-0000-4000-8000-000000000001",
      entries: [],
      activities: [],
      hasOlderTurns: false,
    } satisfies Extract<AgentTimelineProjectionPayload, { kind: "summary" }>;
    let activeGeneration = 1;
    const fetchCanonical = vi.fn(async () => canonicalPage);
    const installSummary = vi.fn(() => true);
    const onCanonicalFallback = vi.fn();

    const request = fetchTimelineSummaryWithCanonicalFallback({
      fetchSummary: () => summary.promise,
      fetchCanonical,
      canInstallSummary: () => activeGeneration === 1,
      installSummary,
      onCanonicalFallback,
    });

    activeGeneration = 2;
    summary.resolve({ source: "summary", projectionPayload: projection });

    await expect(request).resolves.toEqual({
      page: canonicalPage,
      outcome: "canonical-page",
    });
    expect(fetchCanonical).toHaveBeenCalledOnce();
    expect(onCanonicalFallback).toHaveBeenCalledOnce();
    expect(installSummary).not.toHaveBeenCalled();
  });

  it("discards a stale summary without starting canonical work after disposal", async () => {
    const summaryPage: TestTimelinePage = {
      source: "summary",
      projectionPayload: {
        kind: "summary",
        epoch: "epoch-1",
        timelineRevision: "00000000-0000-4000-8000-000000000002",
        entries: [],
        activities: [],
        hasOlderTurns: false,
      },
    };
    const fetchCanonical = vi.fn(async () => ({ source: "canonical" }) as TestTimelinePage);
    const onCanonicalFallback = vi.fn();

    await expect(
      fetchTimelineSummaryWithCanonicalFallback({
        fetchSummary: async () => summaryPage,
        fetchCanonical,
        canInstallSummary: () => false,
        installSummary: () => false,
        onCanonicalFallback,
        isRequestCurrent: () => false,
      }),
    ).resolves.toEqual({ page: summaryPage, outcome: "discarded" });
    expect(fetchCanonical).not.toHaveBeenCalled();
    expect(onCanonicalFallback).not.toHaveBeenCalled();
  });

  it("does not install a summary after the viewed-timeline request loses ownership", async () => {
    const summaryPage: TestTimelinePage = {
      source: "summary",
      projectionPayload: {
        kind: "summary",
        epoch: "epoch-1",
        timelineRevision: "00000000-0000-4000-8000-000000000004",
        entries: [],
        activities: [],
        hasOlderTurns: false,
      },
    };
    const installSummary = vi.fn(() => true);
    const fetchCanonical = vi.fn(async () => ({ source: "canonical" }) as TestTimelinePage);

    await expect(
      fetchTimelineSummaryWithCanonicalFallback({
        fetchSummary: async () => summaryPage,
        fetchCanonical,
        canInstallSummary: () => true,
        installSummary,
        isRequestCurrent: () => false,
      }),
    ).resolves.toEqual({ page: summaryPage, outcome: "discarded" });
    expect(installSummary).not.toHaveBeenCalled();
    expect(fetchCanonical).not.toHaveBeenCalled();
  });

  it("skips initialization finalization when summary installation loses ownership", async () => {
    const summaryPage: TestTimelinePage = {
      source: "summary",
      projectionPayload: {
        kind: "summary",
        epoch: "epoch-install-owner",
        timelineRevision: "00000000-0000-4000-8000-000000000006",
        entries: [],
        activities: [],
        hasOlderTurns: false,
      },
    };
    let requestCurrent = true;
    const fetchCanonical = vi.fn(async () => ({ source: "canonical" }) as TestTimelinePage);
    const clearInitializing = vi.fn();
    const markSynchronized = vi.fn();
    const clearCreateFlow = vi.fn();
    const drainQueuedMessage = vi.fn();
    const resolveInitialization = vi.fn();

    const result = await fetchTimelineSummaryWithCanonicalFallback({
      fetchSummary: async () => summaryPage,
      fetchCanonical,
      canInstallSummary: () => true,
      installSummary: () => {
        requestCurrent = false;
        return true;
      },
      isRequestCurrent: () => requestCurrent,
    });
    if (result.outcome === "summary-installed") {
      finalizeInstalledTimelineSummary({
        isCurrent: () => requestCurrent,
        clearInitializing,
        markSynchronized,
        clearCreateFlow,
        drainQueuedMessage,
        resolveInitialization,
      });
    }

    expect(result).toEqual({ page: summaryPage, outcome: "discarded" });
    expect(fetchCanonical).not.toHaveBeenCalled();
    expect({
      clearInitializing: clearInitializing.mock.calls.length,
      markSynchronized: markSynchronized.mock.calls.length,
      clearCreateFlow: clearCreateFlow.mock.calls.length,
      drainQueuedMessage: drainQueuedMessage.mock.calls.length,
      resolveInitialization: resolveInitialization.mock.calls.length,
    }).toEqual({
      clearInitializing: 0,
      markSynchronized: 0,
      clearCreateFlow: 0,
      drainQueuedMessage: 0,
      resolveInitialization: 0,
    });
  });

  it("uses one canonical request when summary installation loses its final race", async () => {
    const summaryPage: TestTimelinePage = {
      source: "summary",
      projectionPayload: {
        kind: "summary",
        epoch: "epoch-1",
        timelineRevision: "00000000-0000-4000-8000-000000000003",
        entries: [],
        activities: [],
        hasOlderTurns: false,
      },
    };
    const canonicalPage: TestTimelinePage = { source: "canonical" };
    const fetchCanonical = vi.fn(async () => canonicalPage);
    const onCanonicalFallback = vi.fn();

    await expect(
      fetchTimelineSummaryWithCanonicalFallback({
        fetchSummary: async () => summaryPage,
        fetchCanonical,
        canInstallSummary: () => true,
        installSummary: () => false,
        onCanonicalFallback,
      }),
    ).resolves.toEqual({ page: canonicalPage, outcome: "canonical-page" });
    expect(fetchCanonical).toHaveBeenCalledOnce();
    expect(onCanonicalFallback).toHaveBeenCalledOnce();
  });
});
