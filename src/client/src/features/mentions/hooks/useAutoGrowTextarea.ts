import { useLayoutEffect, type RefObject } from "react";

const MIN_COMPOSER_HEIGHT = 120;

/** Grow the document textarea to fit its content without adding an inner scrollbar. */
export function useAutoGrowTextarea(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  value: string,
) {
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.max(MIN_COMPOSER_HEIGHT, textarea.scrollHeight)}px`;
  }, [textareaRef, value]);
}
