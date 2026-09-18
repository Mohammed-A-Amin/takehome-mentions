import { useEffect, useRef, useState } from "react";
import { createPage, deletePage } from "./api";
import { MentionMenu } from "./MentionMenu";
import { buildMenuOptions, type OverflowSection } from "./mentionMenuModel";
import {
  findCommonSuffix,
  findEditStart,
  MENTION_RE,
  mentionInsertionText,
  renderFormattedValue,
  renderPreviewValue,
  type CommittedMention,
} from "./mentionUtils";
import { useCaretPosition } from "./useCaretPosition";
import { prefetchEmptyResults, useMentionSearch } from "./useMentionSearch";
import type { MentionResult, PageResult } from "./types";
import "./App.css";

export function App() {
  const [value, setValue] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [expandedPeople, setExpandedPeople] = useState(false);
  const [expandedPages, setExpandedPages] = useState(false);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [selectionEnd, setSelectionEnd] = useState(0);
  const [isEditorFocused, setIsEditorFocused] = useState(false);
  const [previewResult, setPreviewResult] = useState<MentionResult | null>(null);
  const [pagePendingDeletion, setPagePendingDeletion] = useState<PageResult | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeletingPage, setIsDeletingPage] = useState(false);

  const committedMentions = useRef<CommittedMention[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  const activeCommittedMention = committedMentions.current.find(
    (mention) =>
      mention.start <= cursorPosition &&
      cursorPosition <= mention.end &&
      value.slice(mention.start, mention.end) === mention.text,
  );
  const candidateMatch = activeCommittedMention
    ? null
    : value.slice(0, cursorPosition).match(MENTION_RE);
  const matchingCommittedMention = candidateMatch
    ? committedMentions.current.find(
        (mention) =>
          mention.start === candidateMatch.index &&
          mention.end <= cursorPosition &&
          value.slice(mention.start, mention.end) === mention.text,
      )
    : undefined;
  const match = matchingCommittedMention ? null : candidateMatch;
  const rawQuery = match ? match[1] : null;
  const query = rawQuery === null ? null : rawQuery.trim();
  const isMenuOpen = rawQuery !== null && !/\s$/.test(rawQuery);
  const { results, refresh: refreshMentionResults } = useMentionSearch({ isMenuOpen, query });
  const menuOptions = buildMenuOptions(results, expandedPeople, expandedPages, query ?? undefined);

  const { caretPosition, menuPosition } = useCaretPosition({
    textareaRef,
    composerRef,
    value,
    cursorPosition,
    selectionEnd,
    isEditorFocused,
    isMenuOpen,
    committedMentions: committedMentions.current,
  });

  useEffect(() => {
    const option = menuOptions[activeIndex];
    setPreviewResult(option?.kind === "result" ? option.result : null);
  }, [activeIndex, expandedPages, expandedPeople, results, menuOptions]);

  useEffect(() => {
    setExpandedPeople(false);
    setExpandedPages(false);
    setActiveIndex(0);
  }, [isMenuOpen, query]);

  function handleSelect(result: MentionResult) {
    const beforeCursor = value.slice(0, cursorPosition);
    const afterCursor = value.slice(cursorPosition);
    const mentionMatch = beforeCursor.match(MENTION_RE);
    if (!mentionMatch || mentionMatch.index === undefined) return;
    const mentionStart = mentionMatch.index;
    const mentionText = mentionInsertionText(result);
    const nextBeforeCursor = beforeCursor.slice(0, mentionStart) + mentionText;
    const nextCursorPosition = nextBeforeCursor.length;
    setValue(nextBeforeCursor + afterCursor);
    setCursorPosition(nextCursorPosition);
    setSelectionEnd(nextCursorPosition);
    setPreviewResult(null);
    const insertedMention: CommittedMention = {
      start: mentionStart,
      end: nextCursorPosition,
      text: mentionText,
      type: result.type,
    };
    committedMentions.current = [
      ...committedMentions.current.filter((mention) => mention.end <= mentionStart),
      insertedMention,
    ];
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  }

  async function handleCreatePage(title: string) {
    try {
      const newPage = await createPage(title);
      void prefetchEmptyResults(true);
      handleSelect(newPage);
    } catch {
      // Fallback: insert page tag locally if network/backend failed
      const fallbackPage: PageResult = {
        id: `page_${Date.now()}`,
        title,
        icon: "📄",
        content: "",
        createdTime: new Date().toISOString(),
        lastEditedTime: new Date().toISOString(),
        type: "page",
      };
      handleSelect(fallbackPage);
    }
  }

  function handleExpand(section: OverflowSection) {
    setPreviewResult(null);
    if (section === "people") setExpandedPeople(true);
    else setExpandedPages(true);
  }

  async function handleConfirmPageDeletion() {
    if (!pagePendingDeletion) return;
    setIsDeletingPage(true);
    setDeleteError(null);
    try {
      await deletePage(pagePendingDeletion.id);
      void prefetchEmptyResults(true);
      refreshMentionResults();
      setPagePendingDeletion(null);
    } catch {
      setDeleteError("Could not delete this page. Please try again.");
    } finally {
      setIsDeletingPage(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Backspace" &&
      event.currentTarget.selectionStart === event.currentTarget.selectionEnd
    ) {
      const cursor = event.currentTarget.selectionStart;
      const mention = committedMentions.current.find(
        (candidate) =>
          candidate.end === cursor &&
          value.slice(candidate.start, candidate.end) === candidate.text,
      );
      if (mention) {
        event.preventDefault();
        const nextValue = value.slice(0, mention.start) + value.slice(mention.end);
        setValue(nextValue);
        setCursorPosition(mention.start);
        setSelectionEnd(mention.start);
        committedMentions.current = committedMentions.current
          .filter((candidate) => candidate !== mention)
          .map((candidate) => ({
            ...candidate,
            start:
              candidate.start > mention.end
                ? candidate.start - mention.text.length
                : candidate.start,
            end: candidate.end > mention.end ? candidate.end - mention.text.length : candidate.end,
          }));
        requestAnimationFrame(() => {
          textareaRef.current?.setSelectionRange(mention.start, mention.start);
        });
        return;
      }
    }
    if (!isMenuOpen || menuOptions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % menuOptions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + menuOptions.length) % menuOptions.length);
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const option = menuOptions[activeIndex];
      if (option.kind === "more") handleExpand(option.section);
      else if (option.kind === "create") void handleCreatePage(option.title);
      else handleSelect(option.result);
    }
  }

  function syncCursorPosition(event: React.SyntheticEvent<HTMLTextAreaElement>) {
    setCursorPosition(event.currentTarget.selectionStart);
    setSelectionEnd(event.currentTarget.selectionEnd);
  }

  function handleActiveIndexChange(index: number) {
    setActiveIndex(index);
    const option = menuOptions[index];
    setPreviewResult(option?.kind === "result" ? option.result : null);
  }

  function handleChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const nextValue = event.target.value;
    const previousValue = value;
    const editStart = findEditStart(previousValue, nextValue);
    const oldEditEnd = previousValue.length - findCommonSuffix(previousValue, nextValue);
    const delta = nextValue.length - previousValue.length;

    committedMentions.current = committedMentions.current
      .filter((mention) => mention.end <= editStart || mention.start >= oldEditEnd)
      .map((mention) =>
        mention.start >= oldEditEnd
          ? { ...mention, start: mention.start + delta, end: mention.end + delta }
          : mention,
      );
    setValue(nextValue);
    setCursorPosition(event.target.selectionStart);
    setSelectionEnd(event.target.selectionEnd);
    setPreviewResult(null);
  }

  return (
    <main className="app">
      <div className="composer" ref={composerRef}>
        <div className="composer__formatted-value" aria-hidden="true">
          {previewResult
            ? renderPreviewValue(value, cursorPosition, previewResult, committedMentions.current)
            : renderFormattedValue(value, committedMentions.current)}
        </div>
        {caretPosition && (
          <span
            className="composer__caret"
            aria-hidden="true"
            style={{
              left: caretPosition.left,
              top: caretPosition.top,
              height: caretPosition.height,
            }}
          />
        )}
        <textarea
          ref={textareaRef}
          className="composer__input"
          placeholder="Type @ to mention a page, person, or date…"
          value={value}
          onChange={handleChange}
          onFocus={() => setIsEditorFocused(true)}
          onBlur={() => setIsEditorFocused(false)}
          onClick={syncCursorPosition}
          onKeyUp={syncCursorPosition}
          onSelect={syncCursorPosition}
          onScroll={syncCursorPosition}
          onKeyDown={handleKeyDown}
          rows={3}
          autoFocus
          aria-label="Document content"
          aria-autocomplete="list"
          aria-controls={isMenuOpen ? "mention-menu" : undefined}
          aria-activedescendant={
            isMenuOpen && menuOptions.length > 0 ? `mention-option-${activeIndex}` : undefined
          }
        />
        {isMenuOpen && (
          <MentionMenu
            options={menuOptions}
            activeIndex={activeIndex}
            onActiveIndexChange={handleActiveIndexChange}
            onSelect={handleSelect}
            onExpand={handleExpand}
            onCreatePage={handleCreatePage}
            onDeletePage={setPagePendingDeletion}
            position={menuPosition}
          />
        )}
      </div>
      {pagePendingDeletion && (
        <div className="delete-modal__backdrop" role="presentation">
          <section
            className="delete-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-modal-title"
          >
            <h2 id="delete-modal-title">Delete page?</h2>
            <p>
              This will permanently delete <strong>{pagePendingDeletion.title}</strong>. This action
              cannot be undone.
            </p>
            {deleteError && <p className="delete-modal__error">{deleteError}</p>}
            <div className="delete-modal__actions">
              <button
                type="button"
                className="delete-modal__cancel"
                disabled={isDeletingPage}
                onClick={() => setPagePendingDeletion(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="delete-modal__confirm"
                disabled={isDeletingPage}
                onClick={() => void handleConfirmPageDeletion()}
              >
                {isDeletingPage ? "Deleting…" : "Delete page"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
