// @vitest-environment jsdom

import { createElement, Fragment, useEffect } from "react";
import { render, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMountedTabSet } from "./use-mounted-tab-set";

const RETENTION_TAB_IDS = ["modified", "agent", "terminal", "browser", "draft"];
const MODIFIED_RETENTION_REASON = new Map([
  ["modified", "modified-state-not-recoverable" as const],
]);

function MountedPanelProbe({
  tabId,
  onUnmount,
}: {
  tabId: string;
  onUnmount: (id: string) => void;
}) {
  useEffect(() => () => onUnmount(tabId), [onUnmount, tabId]);
  return createElement("div", { "data-testid": `mounted-panel-${tabId}` });
}

function RetentionProbe({
  activeTabId,
  onUnmount,
}: {
  activeTabId: string;
  onUnmount: (id: string) => void;
}) {
  const { mountedTabIds } = useMountedTabSet({
    activeTabId,
    allTabIds: RETENTION_TAB_IDS,
    retainedTabReasons: MODIFIED_RETENTION_REASON,
    cap: 3,
  });
  return createElement(
    Fragment,
    null,
    ...Array.from(mountedTabIds, (tabId) =>
      createElement(MountedPanelProbe, { key: tabId, tabId, onUnmount }),
    ),
  );
}

function mountedIds(result: { current: ReturnType<typeof useMountedTabSet> }): string[] {
  return Array.from(result.current.mountedTabIds);
}

function ordinaryIds(result: { current: ReturnType<typeof useMountedTabSet> }): string[] {
  return Array.from(result.current.ordinaryMountedTabIds);
}

describe("useMountedTabSet", () => {
  it("includes a newly active tab in the same render", () => {
    let renderCount = 0;
    const { result, rerender } = renderHook(
      ({ activeTabId }) => {
        renderCount += 1;
        return useMountedTabSet({
          activeTabId,
          allTabIds: ["first", "second"],
          cap: 3,
        });
      },
      { initialProps: { activeTabId: "first" } },
    );

    expect(mountedIds(result)).toEqual(["first"]);
    expect(renderCount).toBe(1);

    rerender({ activeTabId: "second" });

    expect(mountedIds(result)).toEqual(["second", "first"]);
    expect(renderCount).toBe(2);
  });

  it("preserves the cap while synchronously adding the active tab", () => {
    const { result, rerender } = renderHook(
      ({ activeTabId }) =>
        useMountedTabSet({
          activeTabId,
          allTabIds: ["first", "second", "third"],
          cap: 2,
        }),
      { initialProps: { activeTabId: "first" } },
    );

    rerender({ activeTabId: "second" });
    expect(mountedIds(result)).toEqual(["second", "first"]);

    rerender({ activeTabId: "third" });
    expect(mountedIds(result)).toEqual(["third", "second"]);
  });

  it("keeps retained panels mounted as separately counted exceptions", () => {
    const { result, rerender } = renderHook(
      ({ activeTabId }) =>
        useMountedTabSet({
          activeTabId,
          allTabIds: ["modified", "second", "third", "fourth"],
          retainedTabReasons: new Map([["modified", "modified-state-not-recoverable"]]),
          cap: 2,
        }),
      { initialProps: { activeTabId: "modified" } },
    );

    rerender({ activeTabId: "second" });
    rerender({ activeTabId: "third" });
    rerender({ activeTabId: "fourth" });

    expect(mountedIds(result)).toEqual(["fourth", "modified", "third"]);
    expect(ordinaryIds(result)).toEqual(["fourth", "third"]);
    expect(Array.from(result.current.retainedExceptionTabIds)).toEqual(["modified"]);
    expect(result.current.retainedExceptionCount).toBe(1);
    expect(Array.from(result.current.retainedExceptionReasons.entries())).toEqual([
      ["modified", "modified-state-not-recoverable"],
    ]);
  });

  it("does not consume an ordinary slot when the active tab is modified", () => {
    const { result, rerender } = renderHook(
      ({ activeTabId }) =>
        useMountedTabSet({
          activeTabId,
          allTabIds: ["modified", "ordinary-a", "ordinary-b", "ordinary-c"],
          retainedTabReasons: new Map([["modified", "modified-state-not-recoverable"]]),
          cap: 2,
        }),
      { initialProps: { activeTabId: "modified" } },
    );

    expect(mountedIds(result)).toEqual(["modified"]);
    rerender({ activeTabId: "ordinary-a" });

    expect(mountedIds(result)).toEqual(["ordinary-a", "modified"]);
    expect(ordinaryIds(result)).toEqual(["ordinary-a"]);
    expect(result.current.retainedExceptionCount).toBe(1);
  });

  it("bounds ordinary tabs across repeated switches while retaining exceptions", () => {
    const allTabIds = RETENTION_TAB_IDS;
    const { result, rerender } = renderHook(
      ({ activeTabId }) =>
        useMountedTabSet({
          activeTabId,
          allTabIds,
          retainedTabReasons: new Map([["modified", "modified-state-not-recoverable"]]),
          cap: 3,
        }),
      { initialProps: { activeTabId: "agent" } },
    );

    const switchOrder = Array.from(
      { length: 20 },
      (_, index) => ["terminal", "browser", "draft", "agent"][index % 4]!,
    );
    for (const activeTabId of switchOrder) {
      rerender({ activeTabId });
      expect(result.current.ordinaryMountedTabIds.size).toBeLessThanOrEqual(3);
      expect(result.current.mountedTabIds.has("modified")).toBe(true);
    }

    expect(result.current.ordinaryMountedTabIds.size).toBe(3);
    expect(result.current.retainedExceptionTabIds).toEqual(new Set(["modified"]));
    expect(result.current.mountedTabIds.has("terminal")).toBe(false);
  });

  it("unmounts an evicted ordinary subtree while retaining the modified exception", () => {
    const onUnmount = vi.fn();
    const view = render(
      createElement(RetentionProbe, {
        activeTabId: "agent",
        onUnmount,
      }),
    );

    const switchOrder = Array.from(
      { length: 20 },
      (_, index) => ["terminal", "browser", "draft", "agent"][index % 4]!,
    );
    for (const activeTabId of switchOrder) {
      view.rerender(createElement(RetentionProbe, { activeTabId, onUnmount }));
    }

    expect(view.queryByTestId("mounted-panel-terminal")).toBeNull();
    expect(view.getByTestId("mounted-panel-modified")).toBeTruthy();
    expect(onUnmount).toHaveBeenCalledWith("terminal");
    expect(onUnmount).not.toHaveBeenCalledWith("modified");
  });
});
