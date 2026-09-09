import { useMemo } from "react";
import type { StreamRenderRow } from "./model";
import type { StreamHistoryRowRevision } from "./strategy";

interface HistoryRowDisplayVariants {
  regular?: StreamRenderRow;
  compact?: StreamRenderRow;
}

const historyRowDisplayVariants = new WeakMap<StreamRenderRow, HistoryRowDisplayVariants>();

function getHistoryRowDisplayVariant(row: StreamRenderRow, compact: boolean): StreamRenderRow {
  let variants = historyRowDisplayVariants.get(row);
  if (!variants) {
    variants = {};
    historyRowDisplayVariants.set(row, variants);
  }
  const key = compact ? "compact" : "regular";
  variants[key] ??= { ...row };
  return variants[key];
}

function revisionIncludesRow(
  revision: { has(id: string): boolean },
  row: StreamRenderRow,
): boolean {
  return (
    revision.has(row.id) ||
    (row.kind === "activity" && row.fold.memberIds.some((memberId) => revision.has(memberId)))
  );
}

// Item identity is the render signal for history rows: the row boundary in view.tsx bails out
// until its item changes. Every viewport runs its history through this hook so a history host
// whose tool-call group keeps updating from the live head, a group whose expanded state changed,
// or a breakpoint change reaches the row as a fresh identity. Unchanged rows keep their identity,
// which is what limits a live update to the rows it touched.
export function useRevisedHistoryRows(
  rows: StreamRenderRow[],
  revision: StreamHistoryRowRevision | undefined,
): StreamRenderRow[] {
  const globalDisplayState = revision?.globalDisplayState ?? false;
  const displayStateById = revision?.displayStateById;
  const contentById = revision?.contentById;
  const globallyRevisedRows = useMemo(
    () => rows.map((row) => getHistoryRowDisplayVariant(row, globalDisplayState)),
    [rows, globalDisplayState],
  );
  const displayStateRevisedRows = useMemo(
    () =>
      globallyRevisedRows.map((row) =>
        displayStateById && revisionIncludesRow(displayStateById, row) ? { ...row } : row,
      ),
    [globallyRevisedRows, displayStateById],
  );
  return useMemo(
    () =>
      displayStateRevisedRows.map((row) =>
        contentById && revisionIncludesRow(contentById, row) ? { ...row } : row,
      ),
    [displayStateRevisedRows, contentById],
  );
}
