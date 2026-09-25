import { expect, test, vi } from "vitest";
import { usePromptPresetsStore } from "./prompt-presets-store";

const savedValues = vi.hoisted(() => new Map<string, string>());

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (name: string) => savedValues.get(name) ?? null,
    setItem: async (name: string, value: string) => {
      savedValues.set(name, value);
    },
    removeItem: async (name: string) => {
      savedValues.delete(name);
    },
  },
}));

test("saves, edits, rehydrates, and deletes a prompt without changing its formatting", async () => {
  await usePromptPresetsStore.persist.rehydrate();
  const store = usePromptPresetsStore.getState();
  store.savePreset({ title: "  Review  ", content: "  Check the diff\n  Keep indentation" });

  const created = usePromptPresetsStore.getState().presets[0];
  expect(created).toMatchObject({
    title: "Review",
    content: "  Check the diff\n  Keep indentation",
  });
  store.savePreset({ id: created!.id, title: "Review changes", content: "  Check tests" });
  expect(usePromptPresetsStore.getState().presets).toEqual([
    { id: created!.id, title: "Review changes", content: "  Check tests" },
  ]);

  await vi.waitFor(() =>
    expect(JSON.parse(savedValues.get("paseo-prompt-presets") ?? "null")).toMatchObject({
      state: { presets: [{ id: created!.id, title: "Review changes" }] },
    }),
  );
  const persisted = savedValues.get("paseo-prompt-presets")!;
  usePromptPresetsStore.setState({ presets: [] });
  await vi.waitFor(() =>
    expect(JSON.parse(savedValues.get("paseo-prompt-presets") ?? "null")).toMatchObject({
      state: { presets: [] },
    }),
  );
  savedValues.set("paseo-prompt-presets", persisted);
  await usePromptPresetsStore.persist.rehydrate();
  expect(usePromptPresetsStore.getState().presets).toHaveLength(1);

  store.deletePreset(created!.id);
  expect(usePromptPresetsStore.getState().presets).toEqual([]);
});
