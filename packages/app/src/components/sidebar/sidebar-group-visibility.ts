import type { SidebarStateBucket } from "@/hooks/sidebar-workspaces-view-model";

export type SidebarGroupVisibilityPolicy<T> =
  | { kind: "pinned" }
  | {
      kind: "workspaces";
      getStatusBucket: (item: T) => SidebarStateBucket;
      hasUnreadAttention: (item: T) => boolean;
    };

/** Folds read Ready rows while preserving work and unread attention beyond the baseline */
export function selectSidebarGroupVisibility<T>(
  items: readonly T[],
  expanded: boolean,
  policy: SidebarGroupVisibilityPolicy<T>,
) {
  /** Pinned groups retain their independent twenty-row policy */
  const limit = policy.kind === "pinned" ? 20 : 7;
  /** The baseline keeps original ordering and does not fill gaps between exempt rows */
  const baseline = items.filter((item, index) => {
    if (index < limit) return true;
    if (policy.kind === "pinned") return false;
    /** Ready membership and unread visibility are independent */
    const status = policy.getStatusBucket(item);
    if (status === "attention") return policy.hasUnreadAttention(item);
    return status !== "done";
  });
  return {
    visibleItems: expanded ? items.slice() : baseline,
    canToggle: baseline.length < items.length,
  };
}
