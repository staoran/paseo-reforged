export type ToolCallExpansionKind = "thinking" | "tool";

export interface ToolCallExpansionPolicy {
  remountKey: "expanded" | "collapsed";
  defaultExpanded: boolean;
  forceInline?: boolean;
}

export interface ToolCallGroupExpansionState {
  defaultExpanded: boolean;
  expandedById: ReadonlyMap<string, boolean>;
}

/** Creates group expansion state from the current setting value. */
export function createToolCallGroupExpansionState(
  defaultExpanded: boolean,
): ToolCallGroupExpansionState {
  return { defaultExpanded, expandedById: new Map() };
}

/** Clears manual group overrides when the setting's default changes. */
export function resetToolCallGroupExpansionState(
  state: ToolCallGroupExpansionState,
  defaultExpanded: boolean,
): ToolCallGroupExpansionState {
  return state.defaultExpanded === defaultExpanded
    ? state
    : createToolCallGroupExpansionState(defaultExpanded);
}

/** Resolves a group's current state from its manual override or the setting default. */
export function isToolCallGroupExpanded(
  state: ToolCallGroupExpansionState,
  groupId: string,
): boolean {
  return state.expandedById.get(groupId) ?? state.defaultExpanded;
}

/** Records a manual group state while omitting values equal to the current default. */
export function setToolCallGroupExpanded(
  state: ToolCallGroupExpansionState,
  groupId: string,
  expanded: boolean,
): ToolCallGroupExpansionState {
  const expandedById = new Map(state.expandedById);
  if (expanded === state.defaultExpanded) {
    expandedById.delete(groupId);
  } else {
    expandedById.set(groupId, expanded);
  }
  return { ...state, expandedById };
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
