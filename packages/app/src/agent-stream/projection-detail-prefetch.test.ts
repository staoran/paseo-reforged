import { describe, expect, it, vi } from "vitest";
import type { ActivityFold } from "./model";
import { requestIdleProjectionActivityDetails } from "./projection-detail-prefetch";

function fold(id: string, detailStatus: ActivityFold["detailStatus"]): ActivityFold {
  return {
    id,
    completed: true,
    hostItemId: id,
    memberIds: [],
    members: [],
    detailStatus,
    detailError: null,
  };
}

describe("requestIdleProjectionActivityDetails", () => {
  it("does not request detail for an inactive retained panel", () => {
    const requestDetail = vi.fn();

    requestIdleProjectionActivityDetails({
      active: false,
      autoExpand: true,
      folds: [fold("activity", "idle")],
      requestDetail,
    });

    expect(requestDetail).not.toHaveBeenCalled();
  });

  it("requests only idle folds on the active path", () => {
    const requestDetail = vi.fn();

    requestIdleProjectionActivityDetails({
      active: true,
      autoExpand: true,
      folds: [fold("idle", "idle"), fold("ready", "ready")],
      requestDetail,
    });

    expect(requestDetail).toHaveBeenCalledOnce();
    expect(requestDetail).toHaveBeenCalledWith("idle");
  });
});
