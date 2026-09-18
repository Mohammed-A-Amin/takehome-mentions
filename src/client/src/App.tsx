import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { searchPages, searchPeople } from "./api";
import { buildMenuOptions, MentionMenu, type OverflowSection } from "./MentionMenu";
import type { MentionResult } from "./types";
import "./App.css";

// Search the complete phrase after the latest @ so multi-word names work.
const MENTION_RE = /@([^@]*)$/;
const QUERY_DEBOUNCE_MS = 125;
const MENU_MAX_HEIGHT_PX = 320;
const MENU_GAP_PX = 6;

type EmptyResults = { people: MentionResult[]; pages: MentionResult[] };
type CommittedMention = { start: number; end: number; text: string };
type CaretPosition = { left: number; top: number; height: number };
let emptyResultsPromise: Promise<EmptyResults> | undefined;

function findEditStart(previousValue: string, nextValue: string): number {
  let index = 0;
  while (
    index < previousValue.length &&
    index < nextValue.length &&
    previousValue[index] === nextValue[index]
  ) {
    index += 1;
  }
  return index;
}

function findCommonSuffix(previousValue: string, nextValue: string): number {
  let count = 0;
  while (
    count < previousValue.length &&
    count < nextValue.length &&
    previousValue[previousValue.length - count - 1] === nextValue[nextValue.length - count - 1]
  ) {
    count += 1;
  }
  return count;
}

function renderFormattedValue(value: string, mentions: CommittedMention[]): ReactNode[] {
  const validMentions = mentions
    .filter((mention) => value.slice(mention.start, mention.end) === mention.text)
    .sort((a, b) => a.start - b.start);
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const mention of validMentions) {
    if (mention.start < cursor) continue;
    parts.push(value.slice(cursor, mention.start));
    parts.push(
      <strong key={`${mention.start}-${mention.end}`}>
        {value.slice(mention.start, mention.end - 1)}
      </strong>,
    );
    parts.push(" ");
    cursor = mention.end;
  }
  parts.push(value.slice(cursor));
  return parts;
}

function resultLabel(result: MentionResult): string {
  if (result.type === "page") return `${result.icon} ${result.title}`;
  if (result.type === "person") return result.name;
  return result.label;
}

function renderPreviewValue(
  value: string,
  cursorPosition: number,
  result: MentionResult,
  mentions: CommittedMention[],
): ReactNode[] {
  const match = value.slice(0, cursorPosition).match(MENTION_RE);
  if (!match || match.index === undefined) return renderFormattedValue(value, mentions);

  return [
    ...renderFormattedValue(value.slice(0, match.index), mentions),
    <span className="composer__mention-preview" key="mention-preview">
      @{resultLabel(result)}
    </span>,
    value.slice(cursorPosition),
  ];
}

function appendFormattedText(container: HTMLElement, value: string, mentions: CommittedMention[]) {
  const validMentions = mentions
    .filter(
      (mention) =>
        mention.end <= value.length && value.slice(mention.start, mention.end) === mention.text,
    )
    .sort((a, b) => a.start - b.start);
  let cursor = 0;

  for (const mention of validMentions) {
    if (mention.start < cursor) continue;
    container.appendChild(document.createTextNode(value.slice(cursor, mention.start)));
    const strong = document.createElement("strong");
    strong.textContent = value.slice(mention.start, mention.end - 1);
    container.appendChild(strong);
    container.appendChild(document.createTextNode(" "));
    cursor = mention.end;
  }
  container.appendChild(document.createTextNode(value.slice(cursor)));
}

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
  const [caretPosition, setCaretPosition] = useState<CaretPosition | null>(null);
  const [previewResult, setPreviewResult] = useState<MentionResult | null>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
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

  useEffect(() => {
    const option = menuOptions[activeIndex];
    setPreviewResult(option?.kind === "result" ? option.result : null);
  }, [activeIndex, expandedPages, expandedPeople, results]);

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
    appendFormattedText(mirror, value.slice(0, cursorPosition), committedMentions.current);
    marker.textContent = "\u200b";
    mirror.appendChild(marker);
    document.body.appendChild(mirror);

    const markerRect = marker.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    const left = Math.max(0, markerRect.left - composerRect.left);
    const lineTop = markerRect.top - composerRect.top - textarea.scrollTop;
    const lineBottom = markerRect.bottom - composerRect.top - textarea.scrollTop;
    const enoughSpaceBelow = window.innerHeight - markerRect.bottom >= MENU_MAX_HEIGHT_PX + MENU_GAP_PX;
    const enoughSpaceAbove = markerRect.top >= MENU_MAX_HEIGHT_PX + MENU_GAP_PX;
    const menuTop = enoughSpaceBelow || !enoughSpaceAbove
      ? lineBottom + MENU_GAP_PX
      : lineTop - MENU_MAX_HEIGHT_PX - MENU_GAP_PX;
    if (isMenuOpen) setMenuPosition({ left, top: menuTop });
    if (isEditorFocused && cursorPosition === selectionEnd) {
      setCaretPosition({ left, top: lineTop, height: markerRect.height || 24 });
    } else {
      setCaretPosition(null);
    }
    mirror.remove();
  }, [cursorPosition, isMenuOpen, value, isEditorFocused, selectionEnd]);

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
  }

  return (
    <main className="app">
      <section className="document" aria-label="Blank document">
        <div className="document__topbar">
          <span className="document__icon">▱</span>
          <span className="document__title">Untitled</span>
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
