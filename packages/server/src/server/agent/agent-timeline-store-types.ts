import type { AgentTimelineItem } from "./agent-sdk-types.js";

export interface AgentTimelineRow {
  seq: number;
  timestamp: string;
  item: AgentTimelineItem;
  readonly providerMessageId?: string;
}

export interface AgentTimelineCursor {
  epoch: string;
  seq: number;
}

export type AgentTimelineFetchDirection = "tail" | "before" | "after";

export interface AgentTimelineFetchOptions {
  direction?: AgentTimelineFetchDirection;
  cursor?: AgentTimelineCursor;
  /**
   * Number of canonical rows to return.
   * - undefined: store default
   * - 0: all rows in the selected window
   */
  limit?: number;
}

export interface AgentTimelineWindow {
  minSeq: number;
  maxSeq: number;
  nextSeq: number;
}

export interface AgentTimelineFetchResult {
  epoch: string;
  direction: AgentTimelineFetchDirection;
  reset: boolean;
  staleCursor: boolean;
  gap: boolean;
  window: AgentTimelineWindow;
  hasOlder: boolean;
  hasNewer: boolean;
  rows: AgentTimelineRow[];
}

export type AgentTimelineGenerationStatus = "building" | "incomplete";

export interface CommittedAgentTimelineGeneration {
  generationId: string;
  timelineRevision: string;
  epoch: string;
  window: AgentTimelineWindow;
  valid: boolean;
}

export interface WorkingAgentTimelineGeneration {
  generationId: string;
  epoch: string;
  status: AgentTimelineGenerationStatus;
}

export interface AgentTimelineCoverage {
  active: CommittedAgentTimelineGeneration | null;
  working: WorkingAgentTimelineGeneration | null;
  eligible: boolean;
}

export interface AgentTimelineGenerationSelection {
  /** Whether durable state exists for this Agent. */
  exists: boolean;
  /** Active generation selected by the Agent state. */
  activeGenerationId: string | null;
  /** Working generation selected by the Agent state. */
  workingGenerationId: string | null;
  /** Generation identities marked invalid by the selected Agent state. */
  invalidGenerationIds: readonly string[];
}

export interface AgentTimelineRegistrationOwnership {
  /** Generation identities allocated by the registration being rolled back. */
  ownedGenerationIds: readonly string[];
}

export interface AgentTimelineGenerationSnapshot {
  /** Stable generation identity restored on rollback. */
  generationId: string;
  /** Revision paired with the generation content. */
  timelineRevision: string;
  /** Timeline epoch owned by the generation. */
  epoch: string;
  /** Complete canonical rows retained by the generation. */
  rows: AgentTimelineRow[];
  /** Sequence allocated after the final retained row. */
  nextSeq: number;
  /** Durable generation lifecycle at snapshot time. */
  status: "building" | "incomplete" | "complete";
  /** Whether the generation was eligible for committed reads. */
  valid: boolean;
}

export interface AgentTimelineRegistrationSnapshot {
  /** Whether an Agent state existed before registration. */
  exists: boolean;
  /** Complete active generation visible before registration. */
  active: AgentTimelineGenerationSnapshot | null;
  /** Complete working generation visible before registration. */
  working: AgentTimelineGenerationSnapshot | null;
  /** Generation identities already marked invalid before registration. */
  invalidGenerationIds: string[];
}

/** Reports whether the selected durable state is still owned by a failed registration. */
export function isAgentTimelineRegistrationSnapshotOwned(
  current: AgentTimelineGenerationSelection,
  snapshot: AgentTimelineRegistrationSnapshot,
  ownership: AgentTimelineRegistrationOwnership,
): boolean {
  /** Generation identities allocated by the registration being rolled back. */
  const ownedGenerationIds = new Set(ownership.ownedGenerationIds);
  /** Active generation identity captured before registration. */
  const baselineActiveGenerationId = snapshot.active?.generationId ?? null;
  /** Working generation identity captured before registration. */
  const baselineWorkingGenerationId = snapshot.working?.generationId ?? null;
  /** Whether the current active pointer is unchanged or registration-owned. */
  const activeOwned =
    current.activeGenerationId === baselineActiveGenerationId ||
    (current.activeGenerationId !== null && ownedGenerationIds.has(current.activeGenerationId));
  /** Whether the current working pointer is unchanged or registration-owned. */
  const workingOwned =
    current.workingGenerationId === baselineWorkingGenerationId ||
    (current.workingGenerationId !== null && ownedGenerationIds.has(current.workingGenerationId));
  /** Whether state existence is unchanged or was created by this registration. */
  const stateExistsOwned =
    current.exists === snapshot.exists ||
    (current.exists &&
      ((current.activeGenerationId !== null &&
        ownedGenerationIds.has(current.activeGenerationId)) ||
        (current.workingGenerationId !== null &&
          ownedGenerationIds.has(current.workingGenerationId))));
  /** Invalid markers expected while an operation-owned active generation is selected. */
  const expectedInvalidGenerationIds =
    current.activeGenerationId !== null && ownedGenerationIds.has(current.activeGenerationId)
      ? []
      : snapshot.invalidGenerationIds;

  return (
    stateExistsOwned &&
    activeOwned &&
    workingOwned &&
    sameGenerationIds(current.invalidGenerationIds, expectedInvalidGenerationIds)
  );
}

export interface AgentTimelineStageInput {
  /** Optional operation-owned identity for a newly created generation. */
  generationId?: string;
  /** Optional compare-and-swap boundary for the currently selected generations. */
  expectedCurrent?: AgentTimelineGenerationSelection;
  epoch: string;
  mode: "append" | "replace";
  rows: readonly AgentTimelineRow[];
}

export interface AgentTimelineStagedRowUpdate {
  epoch: string;
  row: AgentTimelineRow;
}

export interface AgentTimelineCommittedFetchOptions extends Omit<
  AgentTimelineFetchOptions,
  "limit"
> {
  /** Positive upper bound. Durable reads never use the live store's limit=0 convention. */
  limit: number;
}

export interface AgentTimelineStore {
  stageRows(agentId: string, input: AgentTimelineStageInput): Promise<void>;
  updateStagedRow(agentId: string, input: AgentTimelineStagedRowUpdate): Promise<void>;
  commit(
    agentId: string,
    expectedGenerationId?: string,
    expectedCurrent?: AgentTimelineGenerationSelection,
  ): Promise<CommittedAgentTimelineGeneration>;
  markIncomplete(agentId: string): Promise<void>;
  discardWorking(agentId: string, expectedGenerationId: string): Promise<boolean>;
  captureRegistrationSnapshot(agentId: string): Promise<AgentTimelineRegistrationSnapshot>;
  restoreRegistrationSnapshot(
    agentId: string,
    snapshot: AgentTimelineRegistrationSnapshot,
    ownership: AgentTimelineRegistrationOwnership,
  ): Promise<void>;
  getCoverage(
    agentId: string,
    options?: { expectedRevision?: string },
  ): Promise<AgentTimelineCoverage>;
  fetchCommittedPage(
    agentId: string,
    options: AgentTimelineCommittedFetchOptions,
  ): Promise<AgentTimelineFetchResult | null>;
  flush(agentId?: string): Promise<void>;
  cleanup(agentId: string): Promise<void>;
  deleteAgent(agentId: string): Promise<void>;
}

/** Compares generation identity collections as deterministic sets. */
function sameGenerationIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  /** Sorted copy of the first generation identity collection. */
  const sortedLeft = [...left].sort();
  /** Sorted copy of the second generation identity collection. */
  const sortedRight = [...right].sort();
  return sortedLeft.every((generationId, index) => generationId === sortedRight[index]);
}
