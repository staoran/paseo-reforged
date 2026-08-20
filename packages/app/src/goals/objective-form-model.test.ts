import { describe, expect, it, vi } from "vitest";
import { openGoalObjectiveForm } from "./objective-form-model";

describe("Goal objective form model", () => {
  it("owns draft and validation transitions outside React", () => {
    const model = openGoalObjectiveForm({ objective: "Initial objective" });
    const subscriber = vi.fn();
    const unsubscribe = model.subscribe(subscriber);

    model.setDraft("   ");
    expect(model.submit()).toBeNull();
    expect(model.getState()).toEqual({ draft: "   ", validationReason: "empty" });

    model.setDraft("  Replacement objective  ");
    expect(model.getState()).toEqual({
      draft: "  Replacement objective  ",
      validationReason: null,
    });
    expect(model.submit()).toBe("Replacement objective");
    expect(subscriber).toHaveBeenCalledTimes(3);

    unsubscribe();
    model.close();
  });
});
