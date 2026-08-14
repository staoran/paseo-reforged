import { describe, expect, it } from "vitest";

import { resolveToolCallExpansionPolicy } from "./tool-call-expansion";

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
});
