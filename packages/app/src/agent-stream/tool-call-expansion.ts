export type ToolCallExpansionKind = "thinking" | "tool";

export interface ToolCallExpansionPolicy {
  remountKey: "expanded" | "collapsed";
  defaultExpanded: boolean;
  forceInline?: boolean;
}

/**
 * Projects the reasoning detail preference into the initial state of a timeline tool call
 */
export function resolveToolCallExpansionPolicy(
  autoExpandReasoning: boolean,
  kind: ToolCallExpansionKind,
): ToolCallExpansionPolicy {
  if (kind === "thinking") {
    return {
      remountKey: autoExpandReasoning ? "expanded" : "collapsed",
      defaultExpanded: autoExpandReasoning,
      forceInline: autoExpandReasoning,
    };
  }

  return {
    remountKey: autoExpandReasoning ? "expanded" : "collapsed",
    defaultExpanded: autoExpandReasoning,
  };
}
