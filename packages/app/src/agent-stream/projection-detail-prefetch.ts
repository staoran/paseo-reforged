import type { ActivityFold } from "./model";

export function requestIdleProjectionActivityDetails(input: {
  active: boolean;
  autoExpand: boolean;
  folds: readonly ActivityFold[];
  requestDetail?: (activityId: string) => void;
}): void {
  if (!input.active || !input.autoExpand || !input.requestDetail) return;
  for (const fold of input.folds) {
    if (fold.detailStatus === "idle") input.requestDetail(fold.id);
  }
}
