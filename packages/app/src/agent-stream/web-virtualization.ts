import type { StreamItem } from "@/types/stream";
import { estimateAssistantMessageHeightFromCache } from "@/utils/assistant-message-height-estimate";
import type { StreamRenderRow } from "./model";

export const DEFAULT_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD = 100;
export const DEFAULT_WEB_MOUNTED_RECENT_STREAM_ITEMS = 50;
const COLLAPSED_TOOL_SEQUENCE_ROW_HEIGHT_ESTIMATE = 40;

type BottomAnchorE2ETestGlobals = typeof globalThis & {
  __PASEO_E2E_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD?: unknown;
  __PASEO_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS?: unknown;
};

function readPositiveIntegerOverride(value: unknown): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.trunc(value as number);
  return normalized > 0 ? normalized : null;
}

export function getWebPartialVirtualizationThreshold(): number {
  const override = readPositiveIntegerOverride(
    (globalThis as BottomAnchorE2ETestGlobals).__PASEO_E2E_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD,
  );
  return override ?? DEFAULT_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD;
}

export function getWebMountedRecentStreamItems(): number {
  const override = readPositiveIntegerOverride(
    (globalThis as BottomAnchorE2ETestGlobals).__PASEO_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS,
  );
  return override ?? DEFAULT_WEB_MOUNTED_RECENT_STREAM_ITEMS;
}

export interface IndexedStreamItem {
  item: StreamItem;
  index: number;
}

export interface WebVirtualizedHistoryWindow {
  virtualizedEntries: IndexedStreamItem[];
  mountedEntries: IndexedStreamItem[];
}

export function estimateStreamItemHeight(item: StreamItem): number {
  switch (item.kind) {
    case "user_message":
      return item.images && item.images.length > 0 ? 220 : 96;
    case "assistant_message":
      return estimateAssistantMessageHeightFromCache(item.text) ?? 220;
    case "tool_call":
      return COLLAPSED_TOOL_SEQUENCE_ROW_HEIGHT_ESTIMATE;
    case "thought":
      return COLLAPSED_TOOL_SEQUENCE_ROW_HEIGHT_ESTIMATE;
    case "todo_list":
      return 144;
    case "activity_log":
      return 88;
    case "compaction":
      return 72;
    default:
      return 120;
  }
}

export function estimateStreamRenderRowHeight(row: StreamRenderRow): number {
  if (row.kind === "activity") {
    return COLLAPSED_TOOL_SEQUENCE_ROW_HEIGHT_ESTIMATE;
  }
  return estimateStreamItemHeight(row.item);
}

export function findMountedWindowStart(input: {
  items?: StreamItem[];
  rows?: StreamRenderRow[];
  minMountedCount: number;
}): number {
  const length = input.rows?.length ?? input.items?.length ?? 0;
  if (length <= input.minMountedCount) {
    return 0;
  }

  let startIndex = Math.max(length - input.minMountedCount, 0);
  while (startIndex > 0) {
    const item = input.rows?.[startIndex]?.item ?? input.items?.[startIndex];
    if (item?.kind === "user_message") {
      break;
    }
    startIndex -= 1;
  }
  return startIndex;
}

export function splitWebVirtualizedHistory(input: {
  entries: IndexedStreamItem[];
  minMountedCount: number;
}): WebVirtualizedHistoryWindow {
  const startIndex = findMountedWindowStart({
    items: input.entries.map((entry) => entry.item),
    minMountedCount: input.minMountedCount,
  });
  return {
    virtualizedEntries: input.entries.slice(0, startIndex),
    mountedEntries: input.entries.slice(startIndex),
  };
}
