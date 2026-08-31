import type { AgentTimelineProjectionPayload } from "@getpaseo/protocol/messages";

type TimelineSummaryProjection = Extract<AgentTimelineProjectionPayload, { kind: "summary" }>;

interface TimelineSummaryPageLike {
  /** Optional projection returned for a summary request. */
  projectionPayload?: AgentTimelineProjectionPayload;
}

interface TimelineSummaryFetchPorts<TPage extends TimelineSummaryPageLike> {
  /** Fetches the optimistic summary projection. */
  fetchSummary(): Promise<TPage>;
  /** Fetches the authoritative bounded canonical tail. */
  fetchCanonical(): Promise<TPage>;
  /** Reports whether the returned summary still owns the projection lane. */
  canInstallSummary(): boolean;
  /** Installs the summary only while the Agent remains projection-compatible. */
  installSummary(projection: TimelineSummaryProjection): boolean;
  /** Refreshes any initialization deadline before a canonical fallback begins. */
  onCanonicalFallback?(): void;
  /** Reports whether this request may still install or start fallback work. */
  isRequestCurrent?(): boolean;
}

type TimelineSummaryFetchOutcome = "summary-installed" | "canonical-page" | "discarded";

interface TimelineSummaryFetchResult<TPage extends TimelineSummaryPageLike> {
  /** Page that completes the viewed-timeline request boundary. */
  page: TPage;
  /** How the summary request completed. */
  outcome: TimelineSummaryFetchOutcome;
}

interface TimelineSummaryFinalizationPorts {
  /** Reports whether the viewed request and its original initialization still own finalization. */
  isCurrent(): boolean;
  /** Clears the visible initialization marker. */
  clearInitializing(): void;
  /** Marks canonical history as synchronized. */
  markSynchronized(): void;
  /** Releases any create-flow state waiting for history. */
  clearCreateFlow(): void;
  /** Delivers a queued message after history is coherent. */
  drainQueuedMessage(): void;
  /** Resolves the original initialization deferred. */
  resolveInitialization(): void;
}

/** Runs summary-install finalization while the same request owns every side effect. */
export function finalizeInstalledTimelineSummary(ports: TimelineSummaryFinalizationPorts): boolean {
  /** Ordered finalization effects guarded independently against synchronous invalidation. */
  const effects = [
    ports.clearInitializing,
    ports.markSynchronized,
    ports.clearCreateFlow,
    ports.drainQueuedMessage,
    ports.resolveInitialization,
  ];
  for (const effect of effects) {
    if (!ports.isCurrent()) return false;
    effect();
  }
  return true;
}

/** Installs a valid summary or falls back to the authoritative canonical tail. */
export async function fetchTimelineSummaryWithCanonicalFallback<
  TPage extends TimelineSummaryPageLike,
>(ports: TimelineSummaryFetchPorts<TPage>): Promise<TimelineSummaryFetchResult<TPage>> {
  /** Returns the stale page without starting work after disconnect or disposal. */
  const discardOrFetchCanonical = async (
    page: TPage,
  ): Promise<TimelineSummaryFetchResult<TPage>> => {
    if (ports.isRequestCurrent?.() === false) {
      return { page, outcome: "discarded" };
    }
    ports.onCanonicalFallback?.();
    if (ports.isRequestCurrent?.() === false) {
      return { page, outcome: "discarded" };
    }
    return { page: await ports.fetchCanonical(), outcome: "canonical-page" };
  };
  const page = await ports.fetchSummary();
  if (ports.isRequestCurrent?.() === false) {
    return { page, outcome: "discarded" };
  }
  const projection = page.projectionPayload;
  if (!projection) {
    return { page, outcome: "canonical-page" };
  }
  if (projection.kind !== "summary") {
    throw new Error("Timeline summary projection was not returned");
  }
  if (!ports.canInstallSummary()) {
    return await discardOrFetchCanonical(page);
  }
  if (ports.installSummary(projection)) {
    if (ports.isRequestCurrent?.() === false) {
      return { page, outcome: "discarded" };
    }
    return { page, outcome: "summary-installed" };
  }
  return await discardOrFetchCanonical(page);
}
