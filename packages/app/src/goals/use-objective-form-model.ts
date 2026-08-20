import { useEffect, useState, useSyncExternalStore } from "react";
import {
  openGoalObjectiveForm,
  type GoalObjectiveFormModel,
  type GoalObjectiveFormSnapshot,
  type GoalObjectiveFormState,
} from "./objective-form-model";

/** Owns one fresh plain Goal form model for the mounted editor lifetime. */
export function useGoalObjectiveFormModel(
  snapshot: GoalObjectiveFormSnapshot,
): GoalObjectiveFormModel {
  const [model] = useState(() => openGoalObjectiveForm(snapshot));

  useEffect(() => {
    /** Closes the plain form model when its editor unmounts. */
    return function closeGoalObjectiveForm(): void {
      model.close();
    };
  }, [model]);

  return model;
}

/** Bridges one Goal objective form model into React rendering. */
export function useGoalObjectiveFormState(model: GoalObjectiveFormModel): GoalObjectiveFormState {
  return useSyncExternalStore(model.subscribe, model.getState, model.getState);
}
