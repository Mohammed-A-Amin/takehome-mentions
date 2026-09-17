import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { searchPages, searchPeople } from "./api";
import { MentionMenu } from "./MentionMenu";
import type { MentionResult } from "./types";
import "./App.css";

// Search the complete phrase after the latest @ so multi-word names work.
const MENTION_RE = /@([^@]*)$/;
const QUERY_DEBOUNCE_MS = 125;

type EmptyResults = { people: MentionResult[]; pages: MentionResult[] };
type CommittedMention = { start: number; end: number; text: string };
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
  const [cursorPosition, setCursorPosition] = useState(0);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const requestId = useRef(0);
  const lastCommittedMention = useRef<CommittedMention | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  const match = value.slice(0, cursorPosition).match(MENTION_RE);
  const rawQuery = match ? match[1] : null;
  const query = rawQuery === null ? null : rawQuery.trim();
  const typedTextAfterMention = lastCommittedMention.current
    ? (() => {
        const mention = lastCommittedMention.current!;
        if (mention.end > cursorPosition) return false;
        const textAfterMention = value.slice(mention.end, cursorPosition);
        return textAfterMention.trim().length > 0 && !textAfterMention.includes("@");
      })()
    : false;
  const isMenuOpen = rawQuery !== null && !/\s$/.test(rawQuery) && !typedTextAfterMention;

  useLayoutEffect(() => {
    if (!isMenuOpen || !textareaRef.current || !composerRef.current) return;

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
    mirror.textContent = value.slice(0, cursorPosition).replace(/\n$/, "\n\u200b");
    marker.textContent = "\u200b";
    mirror.appendChild(marker);
    document.body.appendChild(mirror);

    const markerRect = marker.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    setMenuPosition({
      left: Math.max(0, markerRect.left - composerRect.left),
      top: markerRect.bottom - composerRect.top - textarea.scrollTop + 6,
    });
    mirror.remove();
  }, [cursorPosition, isMenuOpen, value]);

  useEffect(() => {
    void prefetchEmptyResults();
  }, []);

  useEffect(() => {
    if (!isMenuOpen || query === null) {
      setResults([]);
      setActiveIndex(0);
      return;
    }

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
    const label =
      result.type === "page" ? result.title : result.type === "person" ? result.name : result.label;
    const beforeCursor = value.slice(0, cursorPosition);
    const afterCursor = value.slice(cursorPosition);
    const nextBeforeCursor = beforeCursor.replace(MENTION_RE, `@${label} `);
    const nextCursorPosition = nextBeforeCursor.length;
    setValue(nextBeforeCursor + afterCursor);
    setCursorPosition(nextCursorPosition);
    lastCommittedMention.current = {
      start: nextCursorPosition - `@${label} `.length,
      end: nextCursorPosition,
      text: `@${label} `,
    };
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!isMenuOpen || results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSelect(results[activeIndex]);
    }
  }

  function syncCursorPosition(event: React.SyntheticEvent<HTMLTextAreaElement>) {
    setCursorPosition(event.currentTarget.selectionStart);
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
            <textarea
              ref={textareaRef}
              className="composer__input"
              placeholder="Start writing, or type @ to mention…"
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setCursorPosition(event.target.selectionStart);
              }}
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
              aria-activedescendant={isMenuOpen ? `mention-option-${activeIndex}` : undefined}
            />
            {isMenuOpen && (
              <MentionMenu
                results={results}
                activeIndex={activeIndex}
                onActiveIndexChange={setActiveIndex}
                onSelect={handleSelect}
                position={menuPosition}
              />
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
