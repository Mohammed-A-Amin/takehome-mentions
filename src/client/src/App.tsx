import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { searchPages, searchPeople } from "./api";
import { MentionMenu } from "./MentionMenu";
import type { MentionResult } from "./types";
import "./App.css";

// Capture the complete query after the latest @ so multi-word names such as
// "@alex kim" are searched as one phrase.
const MENTION_RE = /@([^@]*)$/;
const QUERY_DEBOUNCE_MS = 125;

type EmptyResults = {
  people: MentionResult[];
  pages: MentionResult[];
};

type MentionRange = {
  start: number;
  end: number;
  text: string;
};

let emptyResultsPromise: Promise<EmptyResults> | undefined;

/**
 * Warm the blank-document menu before the user types. The first `@` can then
 * render the current user and recommendations without waiting on the network.
 */
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
  const [peopleExpanded, setPeopleExpanded] = useState(false);
  const [completedMentions, setCompletedMentions] = useState<MentionRange[]>([]);
  const [hoverPreview, setHoverPreview] = useState<MentionResult | null>(null);
  const requestId = useRef(0);
  const lastMention = useRef<MentionRange | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  const match = value.slice(0, cursorPosition).match(MENTION_RE);
  const rawQuery = match ? match[1] : null;
  const query = rawQuery === null ? null : rawQuery.trim();
  const typedTextAfterMention = completedMentions.some((mention) => {
    if (mention.end > cursorPosition) return false;
    const textAfterMention = value.slice(mention.end, cursorPosition);
    return textAfterMention.trim().length > 0 && !textAfterMention.includes("@");
  });
  const isMenuOpen = rawQuery !== null && !/\s$/.test(rawQuery) && !typedTextAfterMention;
  const allPeople = results.filter((result) => result.type === "person");
  const nonPeople = results.filter((result) => result.type !== "person");
  const visiblePeople = peopleExpanded ? allPeople : allPeople.slice(0, 5);
  const visibleResults = [...visiblePeople, ...nonPeople];
  const hiddenPeopleCount = allPeople.length - visiblePeople.length;
  const previewValue = hoverPreview
    ? value
        .slice(0, cursorPosition)
        .replace(
          MENTION_RE,
          `@${
            hoverPreview.type === "page"
              ? hoverPreview.title
              : hoverPreview.type === "person"
                ? hoverPreview.name
                : hoverPreview.label
          }`,
        ) + value.slice(cursorPosition)
    : value;

  useLayoutEffect(() => {
    if (!isMenuOpen || !textareaRef.current || !composerRef.current) return;

    const textarea = textareaRef.current;
    const composer = composerRef.current;
    const computed = window.getComputedStyle(textarea);
    const mirror = document.createElement("div");
    const marker = document.createElement("span");

    // Mirror the textarea's typography and width so the marker lands on the
    // same wrapped line as the real caret.
    const textareaRect = textarea.getBoundingClientRect();
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
    // A blank document has no content to search yet, so warm the exact menu
    // that appears after the first `@` while the editor is still idle.
    void prefetchEmptyResults();
  }, []);

  useEffect(() => {
    if (!isMenuOpen || query === null) {
      setResults([]);
      setActiveIndex(0);
      setPeopleExpanded(false);
      setHoverPreview(null);
      return;
    }

    const currentRequestId = ++requestId.current;
    setPeopleExpanded(false);

    // Empty-query data is prefetched on mount and should be shown immediately.
    if (query === "") {
      void prefetchEmptyResults().then(({ people, pages }) => {
        if (currentRequestId !== requestId.current) return;
        setResults([...people, ...pages]);
        setActiveIndex(0);
      });
      return;
    }

    // Debounce typed queries and abort the previous query so a slow response
    // can never overwrite results for a newer query.
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      let nextPeople: MentionResult[] = [];
      let nextPages: MentionResult[] = [];

      const publish = () => {
        if (controller.signal.aborted || currentRequestId !== requestId.current) return;
        setResults([...nextPeople, ...nextPages]);
        setActiveIndex(0);
      };

      // Publish each result independently. A slow Pages search no longer
      // blocks faster People results from appearing in the menu.
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
    const nextValue = nextBeforeCursor + afterCursor;
    setValue(nextValue);
    const nextCursorPosition = nextBeforeCursor.length;
    setCursorPosition(nextCursorPosition);
    lastMention.current = {
      start: nextBeforeCursor.length - `@${label} `.length,
      end: nextCursorPosition,
      text: `@${label} `,
    };
    setCompletedMentions((mentions) => [
      ...mentions.filter((mention) => mention.end <= nextBeforeCursor.length - `@${label} `.length),
      {
        start: nextBeforeCursor.length - `@${label} `.length,
        end: nextCursorPosition,
        text: `@${label} `,
      },
    ]);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  }

  function handleHover(result: MentionResult) {
    // Hover previews only in the visual mirror. The actual textarea value is
    // changed only by Enter or an explicit click.
    setHoverPreview(result);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Backspace" && lastMention.current) {
      const mention = lastMention.current;
      if (
        cursorPosition === mention.end &&
        value.slice(mention.start, mention.end) === mention.text
      ) {
        event.preventDefault();
        const nextValue = value.slice(0, mention.start) + value.slice(mention.end);
        setValue(nextValue);
        setCursorPosition(mention.start);
        lastMention.current = null;
        setCompletedMentions((mentions) =>
          mentions.filter((candidate) => candidate.start !== mention.start),
        );
        requestAnimationFrame(() => {
          textareaRef.current?.focus();
          textareaRef.current?.setSelectionRange(mention.start, mention.start);
        });
        return;
      }
    }

    // Keep keyboard navigation on the textarea so focus never leaves the
    // composer while the suggestion menu is open.
    if (!isMenuOpen || visibleResults.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % visibleResults.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + visibleResults.length) % visibleResults.length);
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSelect(visibleResults[activeIndex]);
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
            <div className="composer__mirror" aria-hidden="true">
              {renderMentionText(previewValue, completedMentions)}
            </div>
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
                results={visibleResults}
                hiddenPeopleCount={hiddenPeopleCount}
                activeIndex={activeIndex}
                onActiveIndexChange={setActiveIndex}
                onHover={handleHover}
                onClearHover={() => setHoverPreview(null)}
                onSelect={handleSelect}
                onExpandPeople={() => setPeopleExpanded(true)}
                position={menuPosition}
              />
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

/** Mirror the textarea content so committed mentions can render in bold. */
function renderMentionText(value: string, mentions: MentionRange[]) {
  const validMentions = mentions
    .filter((mention) => value.slice(mention.start, mention.end) === mention.text)
    .sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (const mention of validMentions) {
    if (mention.start < cursor) continue;
    parts.push(value.slice(cursor, mention.start));
    parts.push(<strong key={`${mention.start}-${mention.end}`}>{mention.text}</strong>);
    cursor = mention.end;
  }

  parts.push(value.slice(cursor));
  return parts;
}
