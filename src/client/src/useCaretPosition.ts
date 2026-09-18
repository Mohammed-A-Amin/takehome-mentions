import { useLayoutEffect, useState, type RefObject } from "react";
import { appendFormattedText, type CommittedMention } from "./mentionUtils";

const MENU_MAX_HEIGHT_PX = 320;
const MENU_GAP_PX = 6;

export type CaretPosition = { left: number; top: number; height: number };
export type MenuPosition = { left: number; top: number };

type UseCaretPositionOptions = {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  composerRef: RefObject<HTMLDivElement | null>;
  value: string;
  cursorPosition: number;
  selectionEnd: number;
  isEditorFocused: boolean;
  isMenuOpen: boolean;
  committedMentions: CommittedMention[];
};

export function useCaretPosition({
  textareaRef,
  composerRef,
  value,
  cursorPosition,
  selectionEnd,
  isEditorFocused,
  isMenuOpen,
  committedMentions,
}: UseCaretPositionOptions) {
  const [caretPosition, setCaretPosition] = useState<CaretPosition | null>(null);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!textareaRef.current || !composerRef.current) return;

    const textarea = textareaRef.current;
    const composer = composerRef.current;
    const computed = window.getComputedStyle(textarea);
    const textareaRect = textarea.getBoundingClientRect();
    const mirror = document.createElement("div");
    const marker = document.createElement("span");

    // Match the textarea's typography and width so the marker follows wrapped
    // lines and the menu can be positioned below the actual caret.
    mirror.style.position = "fixed";
    mirror.style.left = `${textareaRect.left}px`;
    mirror.style.top = `${textareaRect.top}px`;
    mirror.style.visibility = "hidden";
    mirror.style.boxSizing = computed.boxSizing;
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.overflowWrap = "break-word";
    mirror.style.width = `${textarea.clientWidth}px`;
    mirror.style.font = computed.font;
    mirror.style.letterSpacing = computed.letterSpacing;
    mirror.style.lineHeight = computed.lineHeight;
    mirror.style.padding = computed.padding;
    mirror.style.border = computed.border;
    appendFormattedText(mirror, value.slice(0, cursorPosition), committedMentions);
    marker.textContent = "\u200b";
    mirror.appendChild(marker);
    document.body.appendChild(mirror);

    const markerRect = marker.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    const left = Math.max(0, markerRect.left - composerRect.left);
    const lineTop = markerRect.top - composerRect.top - textarea.scrollTop;
    const lineBottom = markerRect.bottom - composerRect.top - textarea.scrollTop;
    const enoughSpaceBelow =
      window.innerHeight - markerRect.bottom >= MENU_MAX_HEIGHT_PX + MENU_GAP_PX;
    const enoughSpaceAbove = markerRect.top >= MENU_MAX_HEIGHT_PX + MENU_GAP_PX;
    const menuTop =
      enoughSpaceBelow || !enoughSpaceAbove
        ? lineBottom + MENU_GAP_PX
        : lineTop - MENU_MAX_HEIGHT_PX - MENU_GAP_PX;

    if (isMenuOpen) setMenuPosition({ left, top: menuTop });
    if (isEditorFocused && cursorPosition === selectionEnd) {
      setCaretPosition({ left, top: lineTop, height: markerRect.height || 24 });
    } else {
      setCaretPosition(null);
    }
    mirror.remove();
  }, [
    cursorPosition,
    isMenuOpen,
    value,
    isEditorFocused,
    selectionEnd,
    textareaRef,
    composerRef,
    committedMentions,
  ]);

  return { caretPosition, menuPosition };
}
