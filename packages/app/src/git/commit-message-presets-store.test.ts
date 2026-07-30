import { beforeEach, describe, expect, it } from "vitest";
import { createJSONStorage, type StateStorage } from "zustand/middleware";
import { useCommitMessagePresetsStore } from "./commit-message-presets-store";

const values = new Map<string, string>();
const storage: StateStorage = {
  getItem: (name) => values.get(name) ?? null,
  setItem: (name, value) => {
    values.set(name, value);
  },
  removeItem: (name) => {
    values.delete(name);
  },
};

useCommitMessagePresetsStore.persist.setOptions({
  storage: createJSONStorage(() => storage),
});

describe("prompt presets store", () => {
  beforeEach(() => {
    values.clear();
    useCommitMessagePresetsStore.setState({ presets: [] });
  });

  it("stores trimmed non-empty presets once", () => {
    const store = useCommitMessagePresetsStore.getState();
    store.addPreset("  Selected context  ");
    store.addPreset("Selected context");
    store.addPreset("   ");

    expect(useCommitMessagePresetsStore.getState().presets).toEqual(["Selected context"]);
  });
});
