import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatTextSelection, ChatTextSelectionOptions } from "./types";

const STREAM_SELECTOR = '[data-testid="agent-chat-scroll"]';
const OWNER_ATTRIBUTE = "data-chat-selection-owner";

function closestElement(node: Node | null, selector: string): Element | null {
  if (!node) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element?.closest(selector) ?? null;
}

function readChatSelection(ownerId: string): ChatTextSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const anchorStream = closestElement(selection.anchorNode, STREAM_SELECTOR);
  const focusStream = closestElement(selection.focusNode, STREAM_SELECTOR);
  if (!anchorStream || anchorStream !== focusStream) return null;

  const owner = anchorStream.closest(`[${OWNER_ATTRIBUTE}]`);
  if (owner?.getAttribute(OWNER_ATTRIBUTE) !== ownerId) return null;

  const text = selection.toString().trim();
  if (!text) return null;

  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;

  return {
    text,
    rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
  };
}

export function useChatTextSelection({ enabled, ownerId }: ChatTextSelectionOptions): {
  selection: ChatTextSelection | null;
  clear: () => void;
} {
  const [selection, setSelection] = useState<ChatTextSelection | null>(null);
  const frameRef = useRef<number | null>(null);

  const clear = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }, []);

  useEffect(() => {
    if (!enabled) {
      window.getSelection()?.removeAllRanges();
      setSelection(null);
      return;
    }

    const recompute = () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        setSelection(readChatSelection(ownerId));
      });
    };

    document.addEventListener("selectionchange", recompute);
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      document.removeEventListener("selectionchange", recompute);
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [enabled, ownerId]);

  return { selection, clear };
}
