import { useEffect, useRef, useState } from "react";
import { searchPages, searchPeople } from "./api";
import { buildMenuOptions, MentionMenu, type OverflowSection } from "./MentionMenu";
import {
  findCommonSuffix,
  findEditStart,
  MENTION_RE,
  renderFormattedValue,
  renderPreviewValue,
  resultLabel,
  type CommittedMention,
} from "./mentionUtils";
import { useCaretPosition } from "./useCaretPosition";
import type { MentionResult } from "./types";
import "./App.css";

const QUERY_DEBOUNCE_MS = 125;

type EmptyResults = { people: MentionResult[]; pages: MentionResult[] };
let emptyResultsPromise: Promise<EmptyResults> | undefined;

/** Warm the blank-document menu so the first empty @ can render immediately. */
function prefetchEmptyResults(): Promise<EmptyResults> {
  if (!emptyResultsPromise) {
    emptyResultsPromise = Promise.allSettled([searchPeople(""), searchPages("")]).then(
      ([people, pages]) => ({
        people: people.status === "fulfilled" ? people.value : [],
        pages: pages.status === "fulfilled" ? pages.value : [],
      }),
    );
  }
  return emptyResultsPromise;
}

export function App() {
  const [value, setValue] = useState("");
  const [results, setResults] = useState<MentionResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [expandedPeople, setExpandedPeople] = useState(false);
  const [expandedPages, setExpandedPages] = useState(false);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [selectionEnd, setSelectionEnd] = useState(0);
  const [isEditorFocused, setIsEditorFocused] = useState(false);
  const [previewResult, setPreviewResult] = useState<MentionResult | null>(null);

  const requestId = useRef(0);
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
  const menuOptions = buildMenuOptions(results, expandedPeople, expandedPages);

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
    void prefetchEmptyResults();
  }, []);

  useEffect(() => {
    if (!isMenuOpen || query === null) {
      setResults([]);
      setActiveIndex(0);
      setExpandedPeople(false);
      setExpandedPages(false);
      return;
    }

    setExpandedPeople(false);
    setExpandedPages(false);
    setActiveIndex(0);

    const currentRequestId = ++requestId.current;
    if (query === "") {
      void prefetchEmptyResults().then(({ people, pages }) => {
        if (currentRequestId !== requestId.current) return;
        setResults([...people, ...pages]);
        setActiveIndex(0);
      });
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      let nextPeople: MentionResult[] = [];
      let nextPages: MentionResult[] = [];
      const publish = () => {
        if (controller.signal.aborted || currentRequestId !== requestId.current) return;
        setResults([...nextPeople, ...nextPages]);
        setActiveIndex(0);
      };

      void searchPeople(query, controller.signal)
        .then((people) => {
          nextPeople = people;
          publish();
        })
        .catch(() => undefined);
      void searchPages(query, controller.signal)
        .then((pages) => {
          nextPages = pages;
          publish();
        })
        .catch(() => undefined);
    }, QUERY_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [isMenuOpen, query]);

  function handleSelect(result: MentionResult) {
    const label = resultLabel(result);
    const beforeCursor = value.slice(0, cursorPosition);
    const afterCursor = value.slice(cursorPosition);
    const mentionMatch = beforeCursor.match(MENTION_RE);
    if (!mentionMatch || mentionMatch.index === undefined) return;
    const mentionStart = mentionMatch.index;
    const mentionText = `@${label} `;
    const nextBeforeCursor = beforeCursor.slice(0, mentionStart) + mentionText;
    const nextCursorPosition = nextBeforeCursor.length;
    setValue(nextBeforeCursor + afterCursor);
    setCursorPosition(nextCursorPosition);
    setSelectionEnd(nextCursorPosition);
    setPreviewResult(null);
    const insertedMention = { start: mentionStart, end: nextCursorPosition, text: mentionText };
    committedMentions.current = [
      ...committedMentions.current.filter((mention) => mention.end <= mentionStart),
      insertedMention,
    ];
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  }

  function handleExpand(section: OverflowSection) {
    setPreviewResult(null);
    if (section === "people") setExpandedPeople(true);
    else setExpandedPages(true);
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
      <section className="document" aria-label="Blank document">
        <div className="document__topbar">
          <button type="button" className="document__close" aria-label="Close new page">
            x
          </button>
          <span className="document__title">New page</span>
        </div>
        <div className="document__page">
          <div className="composer" ref={composerRef}>
            <div className="composer__formatted-value" aria-hidden="true">
              {previewResult
                ? renderPreviewValue(
                    value,
                    cursorPosition,
                    previewResult,
                    committedMentions.current,
                  )
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
              placeholder="Start writing, or type @ to mention…"
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
                results={results}
                activeIndex={activeIndex}
                expandedPeople={expandedPeople}
                expandedPages={expandedPages}
                onActiveIndexChange={handleActiveIndexChange}
                onSelect={handleSelect}
                onExpand={handleExpand}
                position={menuPosition}
              />
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
