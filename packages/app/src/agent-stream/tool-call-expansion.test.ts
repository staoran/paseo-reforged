import { describe, expect, it } from "vitest";

import {
  createToolCallGroupExpansionState,
  isToolCallGroupExpanded,
  resetToolCallGroupExpansionState,
  resolveToolCallExpansionPolicy,
  setToolCallGroupExpanded,
} from "./tool-call-expansion";

describe("tool-call expansion policy", () => {
  it.each([false, true])(
    "applies autoExpandReasoning=%s to thinking and its compact inline mode",
    (autoExpandReasoning) => {
      expect(resolveToolCallExpansionPolicy(autoExpandReasoning, "thinking")).toEqual({
        remountKey: autoExpandReasoning ? "expanded" : "collapsed",
        defaultExpanded: autoExpandReasoning,
        forceInline: autoExpandReasoning,
      });
    },
  );

  it.each([false, true])(
    "applies autoExpandReasoning=%s to ordinary tool details without forcing inline mode",
    (autoExpandReasoning) => {
      expect(resolveToolCallExpansionPolicy(autoExpandReasoning, "tool")).toEqual({
        remountKey: autoExpandReasoning ? "expanded" : "collapsed",
        defaultExpanded: autoExpandReasoning,
      });
    },
  );

  it("resets manual group overrides whenever the setting changes", () => {
    let state = createToolCallGroupExpansionState(false);
    expect(isToolCallGroupExpanded(state, "group-1")).toBe(false);

    state = setToolCallGroupExpanded(state, "group-1", true);
    expect(isToolCallGroupExpanded(state, "group-1")).toBe(true);

    state = resetToolCallGroupExpansionState(state, true);
    expect(state.expandedById.size).toBe(0);
    expect(isToolCallGroupExpanded(state, "group-1")).toBe(true);

    state = setToolCallGroupExpanded(state, "group-1", false);
    expect(isToolCallGroupExpanded(state, "group-1")).toBe(false);

    state = resetToolCallGroupExpansionState(state, false);
    expect(state.expandedById.size).toBe(0);
    expect(isToolCallGroupExpanded(state, "group-1")).toBe(false);

    state = resetToolCallGroupExpansionState(state, true);
    expect(isToolCallGroupExpanded(state, "group-1")).toBe(true);
  });
});
