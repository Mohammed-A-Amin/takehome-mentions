import type { MentionResult, PersonResult } from "./types";

type MentionMenuProps = {
  results: MentionResult[];
  hiddenPeopleCount: number;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onHover: (result: MentionResult) => void;
  onClearHover: () => void;
  onSelect: (result: MentionResult) => void;
  onExpandPeople: () => void;
  position: { left: number; top: number };
};

/**
 * Render one accessible, flat suggestion list.
 *
 * People are placed before pages so the richer People experience is immediately
 * useful, while each option keeps one index for mouse and keyboard selection.
 */
export function MentionMenu({
  results,
  hiddenPeopleCount,
  activeIndex,
  onActiveIndexChange,
  onHover,
  onClearHover,
  onSelect,
  onExpandPeople,
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
  const otherResults = results.filter((result) => result.type === "date");

  const renderResult = (result: MentionResult, index: number) => (
    <div
      key={result.id}
      id={`mention-option-${index}`}
      className={`menu__item ${index === activeIndex ? "menu__item--active" : ""}`}
      role="option"
      aria-selected={index === activeIndex}
      onMouseEnter={() => {
        onActiveIndexChange(index);
        onHover(result);
      }}
    >
      <button type="button" className="menu__button" onClick={() => onSelect(result)}>
        <MentionLabel result={result} />
      </button>
    </div>
  );

  return (
    <div
      className="menu"
      id="mention-menu"
      role="listbox"
      aria-label="Mention suggestions"
      style={{ left: position.left, top: position.top }}
      onMouseLeave={onClearHover}
    >
      {people.length > 0 && <div className="menu__section-label">People</div>}
      {people.map(renderResult)}
      {hiddenPeopleCount > 0 && (
        <button
          type="button"
          className="menu__more"
          aria-label={`Show ${hiddenPeopleCount} more ${hiddenPeopleCount === 1 ? "person" : "people"}`}
          onClick={onExpandPeople}
        >
          <span className="menu__more-dots" aria-hidden="true">
            •••
          </span>
          <span>{hiddenPeopleCount} more results</span>
        </button>
      )}
      {pages.length > 0 && (
        <>
          {people.length > 0 && <div className="menu__divider" />}
          <div className="menu__section-label">Link to page</div>
          {pages.map((result, index) => renderResult(result, people.length + index))}
        </>
      )}
      {otherResults.map((result, index) =>
        renderResult(result, people.length + pages.length + index),
      )}
    </div>
  );
}

/** Render the type-specific primary label and optional person metadata. */
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
            <span className="menu__meta">{formatPersonMeta(result)}</span>
          </span>
        </span>
      );
    case "date":
      return <span className="menu__content">{result.label}</span>;
  }
}

/** Keep metadata compact while omitting missing fields and stray separators. */
function formatPersonMeta(person: PersonResult): string {
  return [person.title, person.team].filter(Boolean).join(" · ");
}
