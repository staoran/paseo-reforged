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

export interface AgentTimelineStageInput {
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
  commit(agentId: string): Promise<CommittedAgentTimelineGeneration>;
  markIncomplete(agentId: string): Promise<void>;
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
