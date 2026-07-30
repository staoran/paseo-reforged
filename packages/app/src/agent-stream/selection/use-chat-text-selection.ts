import type { ChatTextSelection, ChatTextSelectionOptions } from "./types";

const NOOP = () => {};

export function useChatTextSelection(_options: ChatTextSelectionOptions): {
  selection: ChatTextSelection | null;
  clear: () => void;
} {
  return { selection: null, clear: NOOP };
}
