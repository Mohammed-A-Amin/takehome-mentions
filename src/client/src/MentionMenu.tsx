import type { MentionResult, PersonResult } from "./types";

type MentionMenuProps = {
  results: MentionResult[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (result: MentionResult) => void;
  position: { left: number; top: number };
};

/** Render the flat caret-positioned suggestion list. */
export function MentionMenu({
  results,
  activeIndex,
  onActiveIndexChange,
  onSelect,
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
  const dates = results.filter((result) => result.type === "date");

  const renderResult = (result: MentionResult, index: number) => (
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

  return (
    <div
      className="menu"
      id="mention-menu"
      role="listbox"
      aria-label="Mention suggestions"
      style={{ left: position.left, top: position.top }}
    >
      {people.length > 0 && <div className="menu__section-label">People</div>}
      {people.map(renderResult)}
      {pages.length > 0 && (
        <>
          {people.length > 0 && <div className="menu__divider" />}
          <div className="menu__section-label">Link to page</div>
          {pages.map((result, index) => renderResult(result, people.length + index))}
        </>
      )}
      {dates.map((result, index) => renderResult(result, people.length + pages.length + index))}
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
