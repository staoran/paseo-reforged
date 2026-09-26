import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { generateMessageId } from "@/types/stream";

const PromptPresetSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
});

const PersistedPromptPresetsSchema = z.object({
  presets: z.array(PromptPresetSchema),
});

export type PromptPreset = z.infer<typeof PromptPresetSchema>;

interface PromptPresetsState {
  presets: PromptPreset[];
  savePreset: (input: { id?: string; title: string; content: string }) => void;
  saveSelectionPreset: (content: string) => void;
  deletePreset: (id: string) => void;
}

/** Keep user-authored prompt text local to the client */
export const usePromptPresetsStore = create<PromptPresetsState>()(
  persist<PromptPresetsState, [], [], z.infer<typeof PersistedPromptPresetsSchema>>(
    (set) => ({
      presets: [],
      savePreset: ({ id, title, content }) =>
        set((state) => {
          const next = { id: id ?? generateMessageId(), title: title.trim(), content };
          if (!next.title || !next.content.trim()) return state;
          return {
            presets:
              id && state.presets.some((preset) => preset.id === id)
                ? state.presets.map((preset) => (preset.id === id ? next : preset))
                : [...state.presets, next],
          };
        }),
      saveSelectionPreset: (content) =>
        set((state) => {
          const text = content.trim();
          if (!text || state.presets.some((preset) => preset.content === text)) return state;
          const title = text
            .split(/\r?\n/u)
            .find((line) => line.trim())!
            .trim()
            .slice(0, 60);
          return {
            presets: [...state.presets, { id: generateMessageId(), title, content: text }],
          };
        }),
      deletePreset: (id) =>
        set((state) => ({ presets: state.presets.filter((preset) => preset.id !== id) })),
    }),
    {
      name: "paseo-prompt-presets",
      storage: createValidatedPersistStorage(AsyncStorage, PersistedPromptPresetsSchema),
      partialize: (state) => ({ presets: state.presets }),
      merge: (persisted, current) => {
        const parsed = PersistedPromptPresetsSchema.safeParse(persisted);
        return parsed.success ? { ...current, presets: parsed.data.presets } : current;
      },
    },
  ),
);
