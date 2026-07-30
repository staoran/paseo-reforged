import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface PromptPresetsState {
  presets: string[];
  addPreset: (text: string) => void;
  removePreset: (text: string) => void;
}

export const useCommitMessagePresetsStore = create<PromptPresetsState>()(
  persist(
    (set) => ({
      presets: [],
      addPreset: (text) => {
        const preset = text.trim();
        if (!preset) return;
        set((state) =>
          state.presets.includes(preset) ? state : { presets: [...state.presets, preset] },
        );
      },
      removePreset: (text) => {
        set((state) => ({ presets: state.presets.filter((preset) => preset !== text) }));
      },
    }),
    {
      name: "commit-message-presets",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
