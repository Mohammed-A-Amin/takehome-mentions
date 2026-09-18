import { useEffect, useRef } from "react";
import type { MenuOption, OverflowSection } from "../model/mentionMenuModel";
import type { MentionResult, PageResult, PersonResult } from "../types";

type MentionMenuProps = {
  options: MenuOption[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (result: MentionResult) => void;
  onExpand: (section: OverflowSection) => void;
  onCreatePage?: (title: string) => void;
  onDeletePage: (page: PageResult) => void;
  position: { left: number; top: number };
};

/** Render the caret-positioned suggestion list with per-section overflow. */
export function MentionMenu({
  options,
  activeIndex,
  onActiveIndexChange,
  onSelect,
  onExpand,
  onCreatePage,
  onDeletePage,
  position,
}: MentionMenuProps) {
  if (options.length === 0) {
    return (
      <div className="menu menu--empty" style={{ left: position.left, top: position.top }}>
        No results
      </div>
    );
  }

  const people = options.filter(
    (option): option is { kind: "result"; result: PersonResult } =>
      option.kind === "result" && option.result.type === "person",
  );
  const pages = options.filter(
    (option) => option.kind === "result" && option.result.type === "page",
  );
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

    if (option.kind === "create") {
      return (
        <div
          key={`create-${option.title}`}
          id={`mention-option-${index}`}
          className={`menu__item ${index === activeIndex ? "menu__item--active" : ""}`}
          role="option"
          aria-selected={index === activeIndex}
          onMouseEnter={() => onActiveIndexChange(index)}
        >
          <button
            type="button"
            className="menu__button"
            onClick={() => onCreatePage?.(option.title)}
          >
            <span className="menu__content">
              <span className="menu__icon">➕</span>
              <span>New page &ldquo;{option.title}&rdquo;</span>
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
        {result.type === "page" && (
          <button
            type="button"
            className="menu__delete-page"
            aria-label={`Delete ${result.title}`}
            onClick={(event) => {
              event.stopPropagation();
              onDeletePage(result);
            }}
          >
            ×
          </button>
        )}
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
      (option.kind === "more" && option.section === "pages") ||
      option.kind === "create",
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
      {(pages.length > 0 || pageOptions.some((o) => o.kind === "create")) && (
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
