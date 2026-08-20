import { validateGoalObjective } from "./model";

/** Immutable render state exposed by one Goal objective form instance. */
export interface GoalObjectiveFormState {
  /** Current user-entered objective. */
  draft: string;
  /** Stable validation reason translated by the component. */
  validationReason: "empty" | "too_long" | null;
}

/** Inputs captured when a fresh Goal objective form opens. */
export interface GoalObjectiveFormSnapshot {
  /** Provider objective used to seed the draft. */
  objective: string;
}

/** Plain TypeScript form model owned by one mounted Goal editor. */
export interface GoalObjectiveFormModel {
  /** Subscribes one render adapter to state publications. */
  subscribe(listener: () => void): () => void;
  /** Returns the current immutable render state. */
  getState(): GoalObjectiveFormState;
  /** Replaces the draft and clears prior local validation. */
  setDraft(value: string): void;
  /** Validates the draft and returns its normalized objective when valid. */
  submit(): string | null;
  /** Releases all subscribers when the editor unmounts. */
  close(): void;
}

/** Constructs one fresh Goal objective form from the provider snapshot. */
export function openGoalObjectiveForm(snapshot: GoalObjectiveFormSnapshot): GoalObjectiveFormModel {
  let state: GoalObjectiveFormState = { draft: snapshot.objective, validationReason: null };
  const listeners = new Set<() => void>();

  /** Publishes one immutable state replacement to current subscribers. */
  function publish(next: GoalObjectiveFormState): void {
    state = next;
    for (const listener of listeners) listener();
  }

  /** Registers one state subscriber. */
  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return function unsubscribe(): void {
      listeners.delete(listener);
    };
  }

  /** Returns the current form state. */
  function getState(): GoalObjectiveFormState {
    return state;
  }

  /** Applies user input and clears stale validation. */
  function setDraft(value: string): void {
    publish({ draft: value, validationReason: null });
  }

  /** Validates the current draft and returns its normalized objective. */
  function submit(): string | null {
    const validation = validateGoalObjective(state.draft);
    if (!validation.ok) {
      publish({ ...state, validationReason: validation.reason });
      return null;
    }
    return validation.objective;
  }

  /** Clears form subscribers during component teardown. */
  function close(): void {
    listeners.clear();
  }

  return { subscribe, getState, setDraft, submit, close };
}
