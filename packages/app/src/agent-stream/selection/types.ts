export interface ChatTextSelectionRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface ChatTextSelection {
  text: string;
  rect: ChatTextSelectionRect;
}

export interface ChatTextSelectionOptions {
  enabled: boolean;
  ownerId: string;
}

export interface ChatSelectionBubbleProps {
  selection: ChatTextSelection | null;
  onAsk: (text: string) => void;
  onAskInNewWindow: (text: string) => void;
  onSavePreset: (text: string) => void;
}
