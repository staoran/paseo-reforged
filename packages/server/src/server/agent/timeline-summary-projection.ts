import { createHash } from "node:crypto";

import type { AgentTimelineActivityDescriptorPayload } from "@getpaseo/protocol/messages";
import type {
  AgentTimelineCommittedFetchOptions,
  AgentTimelineFetchResult,
  AgentTimelineRow,
  AgentTimelineWindow,
} from "./agent-timeline-store-types.js";
import { projectTimelineRows, type TimelineProjectionEntry } from "./timeline-projection.js";

export const SUMMARY_SCAN_PAGE_ROWS = 256;
export const SUMMARY_SCAN_MAX_ROWS = 4_096;
export const SUMMARY_MAX_TURNS = 20;
export const DETAIL_MAX_PAGE_ROWS = 200;

export interface TimelineSeqRange {
  startSeq: number;
  endSeq: number;
}

export type FetchCommittedTimelinePage = (
  agentId: string,
  options: AgentTimelineCommittedFetchOptions,
) => Promise<AgentTimelineFetchResult | null>;

export interface TimelineSummaryProjection {
  entries: TimelineProjectionEntry[];
  activities: AgentTimelineActivityDescriptorPayload[];
  hasOlderTurns: boolean;
}

export interface TimelineActivityDetailProjection {
  entries: TimelineProjectionEntry[];
  nextCursor: { epoch: string; seq: number } | null;
  hasMore: boolean;
  error: string | null;
}

export function normalizeTimelineSeqRanges(
  ranges: readonly TimelineSeqRange[],
): TimelineSeqRange[] | null {
  if (ranges.length === 0) return null;
  const sorted = ranges
    .map((range) => ({ startSeq: range.startSeq, endSeq: range.endSeq }))
    .sort((left, right) => left.startSeq - right.startSeq || left.endSeq - right.endSeq);
  const normalized: TimelineSeqRange[] = [];
  for (const range of sorted) {
    if (
      !Number.isSafeInteger(range.startSeq) ||
      !Number.isSafeInteger(range.endSeq) ||
      range.startSeq < 1 ||
      range.endSeq < range.startSeq
    ) {
      return null;
    }
    const previous = normalized.at(-1);
    if (!previous || range.startSeq > previous.endSeq + 1) {
      normalized.push(range);
      continue;
    }
    previous.endSeq = Math.max(previous.endSeq, range.endSeq);
  }
  return normalized;
}

export function buildTimelineActivityId(input: {
  epoch: string;
  timelineRevision: string;
  sourceSeqRanges: readonly TimelineSeqRange[];
}): string {
  const normalized = normalizeTimelineSeqRanges(input.sourceSeqRanges);
  if (!normalized) {
    throw new Error("Activity source ranges are invalid");
  }
  const digest = createHash("sha256")
    .update(`${input.epoch}\n${input.timelineRevision}\n${JSON.stringify(normalized)}`)
    .digest("hex");
  return `activity:${digest}`;
}

function isValidPage(
  page: AgentTimelineFetchResult | null,
  epoch: string,
  window: AgentTimelineWindow,
  direction: AgentTimelineFetchResult["direction"],
): page is AgentTimelineFetchResult {
  if (
    !page ||
    page.epoch !== epoch ||
    page.direction !== direction ||
    page.reset ||
    page.staleCursor ||
    page.gap ||
    page.window.minSeq !== window.minSeq ||
    page.window.maxSeq !== window.maxSeq ||
    page.window.nextSeq !== window.nextSeq
  ) {
    return false;
  }
  return page.rows.every((row, index) => {
    const previous = page.rows[index - 1];
    return (
      Number.isSafeInteger(row.seq) &&
      row.seq >= window.minSeq &&
      row.seq <= window.maxSeq &&
      (!previous || row.seq === previous.seq + 1)
    );
  });
}

function countUserRows(rows: readonly AgentTimelineRow[]): number {
  let count = 0;
  for (const row of rows) {
    if (row.item.type === "user_message") count += 1;
  }
  return count;
}

async function readSummaryRows(input: {
  agentId: string;
  epoch: string;
  window: AgentTimelineWindow;
  fetchPage: FetchCommittedTimelinePage;
}): Promise<AgentTimelineRow[] | null> {
  let page = await input.fetchPage(input.agentId, {
    direction: "tail",
    limit: Math.min(SUMMARY_SCAN_PAGE_ROWS, SUMMARY_SCAN_MAX_ROWS),
  });
  if (
    !isValidPage(page, input.epoch, input.window, "tail") ||
    page.rows.at(-1)?.seq !== input.window.maxSeq
  ) {
    return null;
  }
  let rows = page.rows;
  let hasOlder = page.hasOlder;

  while (
    hasOlder &&
    rows.length < SUMMARY_SCAN_MAX_ROWS &&
    countUserRows(rows) < SUMMARY_MAX_TURNS
  ) {
    const first = rows[0];
    if (!first) return null;
    const remaining = SUMMARY_SCAN_MAX_ROWS - rows.length;
    const previousStartSeq = first.seq;
    page = await input.fetchPage(input.agentId, {
      direction: "before",
      cursor: { epoch: input.epoch, seq: previousStartSeq },
      limit: Math.min(SUMMARY_SCAN_PAGE_ROWS, remaining),
    });
    if (!isValidPage(page, input.epoch, input.window, "before")) return null;
    const olderRows = page.rows;
    if (olderRows.length === 0 || olderRows.at(-1)!.seq !== previousStartSeq - 1) return null;
    rows = olderRows.concat(rows);
    hasOlder = page.hasOlder;
  }

  if (hasOlder && countUserRows(rows) < SUMMARY_MAX_TURNS) {
    return null;
  }

  const userIndexes: number[] = [];
  for (const [index, timelineRow] of rows.entries()) {
    if (timelineRow.item.type === "user_message") userIndexes.push(index);
  }
  if (userIndexes.length === 0) return null;
  const selectedUserIndex = userIndexes[Math.max(0, userIndexes.length - SUMMARY_MAX_TURNS)];
  if (selectedUserIndex === undefined) return null;
  return rows.slice(selectedUserIndex);
}

function buildSummaryProjection(input: {
  rows: readonly AgentTimelineRow[];
  epoch: string;
  timelineRevision: string;
  window: AgentTimelineWindow;
}): TimelineSummaryProjection | null {
  const projected = projectTimelineRows({ rows: input.rows, mode: "projected" });
  const turns: Array<{ user: TimelineProjectionEntry; body: TimelineProjectionEntry[] }> = [];
  for (const entry of projected) {
    if (entry.item.type === "user_message") {
      turns.push({ user: entry, body: [] });
      continue;
    }
    const turn = turns.at(-1);
    if (!turn) return null;
    turn.body.push(entry);
  }
  if (turns.length === 0) return null;

  const entries: TimelineProjectionEntry[] = [];
  const activities: AgentTimelineActivityDescriptorPayload[] = [];
  for (const turn of turns) {
    const finals = turn.body.filter(
      (entry) => entry.item.type === "assistant_message" && entry.item.phase === "final_answer",
    );
    if (finals.length === 0) return null;
    entries.push(turn.user, ...finals);
    const activityEntries = turn.body.filter((entry) => !finals.includes(entry));
    const sourceSeqRanges = normalizeTimelineSeqRanges(
      activityEntries.flatMap((entry) => entry.sourceSeqRanges),
    );
    if (!sourceSeqRanges) continue;
    const seqStart = sourceSeqRanges[0]!.startSeq;
    const seqEnd = sourceSeqRanges.at(-1)!.endSeq;
    activities.push({
      activityId: buildTimelineActivityId({
        epoch: input.epoch,
        timelineRevision: input.timelineRevision,
        sourceSeqRanges,
      }),
      timestamp: activityEntries[0]!.timestamp,
      seqStart,
      seqEnd,
      sourceSeqRanges,
    });
  }

  entries.sort((left, right) => left.seqStart - right.seqStart || left.seqEnd - right.seqEnd);
  activities.sort((left, right) => left.seqStart - right.seqStart || left.seqEnd - right.seqEnd);
  return {
    entries,
    activities,
    hasOlderTurns: input.rows[0]!.seq > input.window.minSeq,
  };
}

export async function readTimelineSummary(input: {
  agentId: string;
  epoch: string;
  timelineRevision: string;
  window: AgentTimelineWindow;
  fetchPage: FetchCommittedTimelinePage;
}): Promise<TimelineSummaryProjection | null> {
  const rows = await readSummaryRows(input);
  if (!rows) return null;
  return buildSummaryProjection({ ...input, rows });
}

function activityDetailError(message: string): TimelineActivityDetailProjection {
  return { entries: [], nextCursor: null, hasMore: false, error: message };
}

function rangeContains(ranges: readonly TimelineSeqRange[], seq: number): boolean {
  return ranges.some((range) => seq >= range.startSeq && seq <= range.endSeq);
}

function hasSeqAfter(ranges: readonly TimelineSeqRange[], seq: number): boolean {
  return ranges.some((range) => range.endSeq > seq);
}

function toCanonicalProjectionEntry(row: AgentTimelineRow): TimelineProjectionEntry {
  return {
    item: row.item,
    timestamp: row.timestamp,
    seqStart: row.seq,
    seqEnd: row.seq,
    sourceSeqRanges: [{ startSeq: row.seq, endSeq: row.seq }],
    collapsed: [],
  };
}

// Descriptor validation and bounded paging stay together to make every rejection path explicit.
// eslint-disable-next-line complexity
export async function readTimelineActivityDetail(input: {
  agentId: string;
  epoch: string;
  timelineRevision: string;
  window: AgentTimelineWindow;
  activityId: string;
  sourceSeqRanges: readonly TimelineSeqRange[];
  cursor?: { epoch: string; seq: number };
  limit: number;
  fetchPage: FetchCommittedTimelinePage;
}): Promise<TimelineActivityDetailProjection> {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > DETAIL_MAX_PAGE_ROWS) {
    return activityDetailError("Activity detail limit is invalid");
  }
  const ranges = normalizeTimelineSeqRanges(input.sourceSeqRanges);
  if (!ranges) return activityDetailError("Activity ranges are invalid");
  if (ranges[0]!.startSeq < input.window.minSeq || ranges.at(-1)!.endSeq > input.window.maxSeq) {
    return activityDetailError("Activity ranges are outside durable coverage");
  }
  const expectedActivityId = buildTimelineActivityId({
    epoch: input.epoch,
    timelineRevision: input.timelineRevision,
    sourceSeqRanges: ranges,
  });
  if (input.activityId !== expectedActivityId) {
    return activityDetailError("Activity identity changed");
  }
  if (
    input.cursor &&
    (input.cursor.epoch !== input.epoch || !rangeContains(ranges, input.cursor.seq))
  ) {
    return activityDetailError("Activity cursor is outside descriptor ranges");
  }

  let cursorSeq = input.cursor?.seq ?? ranges[0]!.startSeq - 1;
  let remaining = input.limit;
  const rows: AgentTimelineRow[] = [];
  for (const range of ranges) {
    if (remaining === 0 || range.endSeq <= cursorSeq) continue;
    const startSeq = Math.max(range.startSeq, cursorSeq + 1);
    const requested = Math.min(remaining, range.endSeq - startSeq + 1);
    const page = await input.fetchPage(input.agentId, {
      direction: "after",
      cursor: { epoch: input.epoch, seq: startSeq - 1 },
      limit: requested,
    });
    if (!isValidPage(page, input.epoch, input.window, "after")) {
      return activityDetailError("Durable Activity page is unavailable");
    }
    if (
      page.rows.length !== requested ||
      page.rows[0]?.seq !== startSeq ||
      page.rows.at(-1)?.seq !== startSeq + requested - 1 ||
      page.rows.some((row) => row.seq < range.startSeq || row.seq > range.endSeq)
    ) {
      return activityDetailError("Durable Activity page is incomplete");
    }
    for (const timelineRow of page.rows) {
      if (
        timelineRow.item.type === "user_message" ||
        (timelineRow.item.type === "assistant_message" && timelineRow.item.phase === "final_answer")
      ) {
        return activityDetailError("Activity ranges include summary content");
      }
      rows.push(timelineRow);
    }
    cursorSeq = page.rows.at(-1)!.seq;
    remaining -= page.rows.length;
  }

  const hasMore = hasSeqAfter(ranges, cursorSeq);
  if (rows.length === 0 && hasMore) {
    return activityDetailError("Activity cursor did not advance");
  }
  return {
    entries: rows.map(toCanonicalProjectionEntry),
    nextCursor: hasMore ? { epoch: input.epoch, seq: cursorSeq } : null,
    hasMore,
    error: null,
  };
}
