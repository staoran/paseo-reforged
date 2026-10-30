import type { SidebarStateBucket } from "@/hooks/sidebar-workspaces-view-model";

export type SidebarGroupVisibilityPolicy<T> =
  | { kind: "pinned" }
  | {
      kind: "workspaces";
      getStatusBucket: (item: T) => SidebarStateBucket;
      hasUnreadAttention: (item: T) => boolean;
    };

// A placement can outrun its entry: a retained sidebar that is inactive (compact layout with the
// sidebar closed) or still waiting for sessions keeps an empty entry map. A missing entry renders
// no row, so it counts as Done and claims no slot past the limit.
export function createWorkspaceVisibilityPolicy<T extends { workspaceKey: string }>(
  entriesByKey: ReadonlyMap<
    string,
    { statusBucket: SidebarStateBucket; hasUnreadAttention?: boolean }
  >,
): SidebarGroupVisibilityPolicy<T> {
  return {
    kind: "workspaces",
    getStatusBucket: (item) => entriesByKey.get(item.workspaceKey)?.statusBucket ?? "done",
    hasUnreadAttention: (item) => entriesByKey.get(item.workspaceKey)?.hasUnreadAttention ?? false,
  };
}

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
