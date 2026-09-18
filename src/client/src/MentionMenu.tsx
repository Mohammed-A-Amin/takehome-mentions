import { useEffect, useRef } from "react";
import type { MentionResult, PersonResult } from "./types";

export const VISIBLE_PER_SECTION = 5;
export const MAX_COMPACTED = 15;

type MentionMenuProps = {
  results: MentionResult[];
  activeIndex: number;
  expandedPeople: boolean;
  expandedPages: boolean;
  onActiveIndexChange: (index: number) => void;
  onSelect: (result: MentionResult) => void;
  onExpand: (section: OverflowSection) => void;
  position: { left: number; top: number };
};

export type OverflowSection = "people" | "pages";

export type MenuOption =
  | { kind: "result"; result: MentionResult }
  | { kind: "more"; section: OverflowSection; moreCount: number };

/** Split a section into the rows shown now and the compacted leftover count. */
export function sectionView<T>(items: T[], expanded: boolean): { visible: T[]; moreCount: number } {
  if (expanded || items.length <= VISIBLE_PER_SECTION) {
    return { visible: items, moreCount: 0 };
  }
  const hidden = Math.min(MAX_COMPACTED, items.length - VISIBLE_PER_SECTION);
  return { visible: items.slice(0, VISIBLE_PER_SECTION), moreCount: hidden };
}

/** Flatten people, optional people overflow, pages, optional pages overflow, then dates. */
export function buildMenuOptions(
  results: MentionResult[],
  expandedPeople: boolean,
  expandedPages: boolean,
): MenuOption[] {
  const people = results.filter((result): result is PersonResult => result.type === "person");
  const pages = results.filter((result) => result.type === "page");
  const dates = results.filter((result) => result.type === "date");
  const peopleView = sectionView(people, expandedPeople);
  const pagesView = sectionView(pages, expandedPages);
  const options: MenuOption[] = [];

  for (const result of peopleView.visible) options.push({ kind: "result", result });
  if (peopleView.moreCount > 0) {
    options.push({ kind: "more", section: "people", moreCount: peopleView.moreCount });
  }
  for (const result of pagesView.visible) options.push({ kind: "result", result });
  if (pagesView.moreCount > 0) {
    options.push({ kind: "more", section: "pages", moreCount: pagesView.moreCount });
  }
  for (const result of dates) options.push({ kind: "result", result });
  return options;
}

/** Render the caret-positioned suggestion list with per-section overflow. */
export function MentionMenu({
  results,
  activeIndex,
  expandedPeople,
  expandedPages,
  onActiveIndexChange,
  onSelect,
  onExpand,
  position,
}: MentionMenuProps) {
  if (results.length === 0) {
    return (
      <div className="menu menu--empty" style={{ left: position.left, top: position.top }}>
        No results
      </div>
    );
  }

  const people = results.filter((result): result is PersonResult => result.type === "person");
  const pages = results.filter((result) => result.type === "page");
  const options = buildMenuOptions(results, expandedPeople, expandedPages);
  const menuRef = useRef<HTMLDivElement>(null);
  let nextIndex = 0;

  useEffect(() => {
    const activeOption = menuRef.current?.querySelector<HTMLElement>(
      `#mention-option-${activeIndex}`,
    );
    activeOption?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, options.length]);

  const renderOption = (option: MenuOption) => {
    const index = nextIndex++;
    if (option.kind === "more") {
      return (
        <div
          key={`more-${option.section}`}
          id={`mention-option-${index}`}
          className={`menu__item ${index === activeIndex ? "menu__item--active" : ""}`}
          role="option"
          aria-selected={index === activeIndex}
          onMouseEnter={() => onActiveIndexChange(index)}
        >
          <button
            type="button"
            className="menu__button menu__button--more"
            onClick={() => onExpand(option.section)}
          >
            <span className="menu__more">
              <span className="menu__more-ellipsis" aria-hidden="true">
                …
              </span>
              <span>
                {option.moreCount} more result{option.moreCount === 1 ? "" : "s"}
              </span>
            </span>
          </button>
        </div>
      );
    }

    const result = option.result;
    return (
      <div
        key={result.id}
        id={`mention-option-${index}`}
        className={`menu__item ${index === activeIndex ? "menu__item--active" : ""}`}
        role="option"
        aria-selected={index === activeIndex}
        onMouseEnter={() => onActiveIndexChange(index)}
      >
        <button type="button" className="menu__button" onClick={() => onSelect(result)}>
          <MentionLabel result={result} />
        </button>
      </div>
    );
  };

  const peopleOptions = options.filter(
    (option) =>
      (option.kind === "result" && option.result.type === "person") ||
      (option.kind === "more" && option.section === "people"),
  );
  const pageOptions = options.filter(
    (option) =>
      (option.kind === "result" && option.result.type === "page") ||
      (option.kind === "more" && option.section === "pages"),
  );
  const dateOptions = options.filter(
    (option) => option.kind === "result" && option.result.type === "date",
  );

  return (
    <div
      ref={menuRef}
      className="menu"
      id="mention-menu"
      role="listbox"
      aria-label="Mention suggestions"
      style={{ left: position.left, top: position.top }}
    >
      {people.length > 0 && <div className="menu__section-label">People</div>}
      {peopleOptions.map(renderOption)}
      {pages.length > 0 && (
        <>
          {people.length > 0 && <div className="menu__divider" />}
          <div className="menu__section-label">Link to page</div>
          {pageOptions.map(renderOption)}
        </>
      )}
      {dateOptions.map(renderOption)}
    </div>
  );
}

/** Render the primary label and compact metadata for each result type. */
function MentionLabel({ result }: { result: MentionResult }) {
  switch (result.type) {
    case "page":
      return (
        <span className="menu__content">
          <span className="menu__icon">{result.icon}</span>
          <span>{result.title}</span>
        </span>
      );
    case "person":
      return (
        <span className="menu__content">
          <img className="menu__avatar" src={result.avatarUrl} alt="" />
          <span className="menu__text">
            <span className="menu__name">
              {result.name}
              {result.id === "current-user" && <span className="menu__you"> (You)</span>}
            </span>
            <span className="menu__meta">
              {[result.title, result.team].filter(Boolean).join(" · ")}
            </span>
          </span>
        </span>
      );
    case "date":
      return <span className="menu__content">{result.label}</span>;
  }
}
