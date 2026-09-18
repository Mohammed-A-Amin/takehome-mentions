import type { ReactNode } from "react";
import type { MentionResult } from "./types";

export const MENTION_RE = /@([^@]*)$/;

export type CommittedMention = {
  start: number;
  end: number;
  text: string;
  type?: "person" | "page" | "date";
};

/**
 * Finds the first index where the previous and next string values diverge.
 * Used to detect the starting point of an edit or deletion in the composer.
 */
export function findEditStart(previousValue: string, nextValue: string): number {
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

/**
 * Finds the length of the matching suffix between previous and next string values.
 * Used alongside findEditStart to calculate the range of deleted or replaced characters.
 */
export function findCommonSuffix(previousValue: string, nextValue: string): number {
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

/**
 * Extracts the user-visible display label for a mention candidate based on its type.
 */
export function resultLabel(result: MentionResult): string {
  if (result.type === "page") return `${result.icon} ${result.title}`;
  if (result.type === "person") return result.name;
  return result.label;
}

/**
 * Returns the exact text to insert into the document when a mention is chosen.
 * Person mentions preserve the leading '@' symbol (e.g. '@Taylor Chen '),
 * whereas page mentions omit the '@' prefix (e.g. '📄 Project Roadmap ').
 */
export function mentionInsertionText(result: MentionResult): string {
  const label = resultLabel(result);
  return result.type === "person" ? `@${label} ` : `${label} `;
}

/**
 * Renders the formatted text backdrop with committed mentions highlighted in styled badge spans.
 */
export function renderFormattedValue(value: string, mentions: CommittedMention[]): ReactNode[] {
  const validMentions = mentions
    .filter((mention) => value.slice(mention.start, mention.end) === mention.text)
    .sort((a, b) => a.start - b.start);
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const mention of validMentions) {
    if (mention.start < cursor) continue;
    parts.push(value.slice(cursor, mention.start));
    const badgeType = mention.type ?? (mention.text.startsWith("@") ? "person" : "page");
    parts.push(
      <span
        key={`${mention.start}-${mention.end}`}
        className={`mention-badge mention-badge--${badgeType}`}
      >
        {value.slice(mention.start, mention.end - 1)}
      </span>,
    );
    parts.push(" ");
    cursor = mention.end;
  }
  parts.push(value.slice(cursor));
  return parts;
}

/**
 * Renders the formatted text backdrop including an inline ghost completion preview
 * for the currently active/selected mention candidate.
 */
export function renderPreviewValue(
  value: string,
  cursorPosition: number,
  result: MentionResult,
  mentions: CommittedMention[],
): ReactNode[] {
  const match = value.slice(0, cursorPosition).match(MENTION_RE);
  if (!match || match.index === undefined) return renderFormattedValue(value, mentions);

  const typedMention = value.slice(match.index, cursorPosition);
  const candidateMention =
    result.type === "person" ? `@${resultLabel(result)}` : resultLabel(result);
  const normalizedTyped = typedMention.toLocaleLowerCase();
  const normalizedCandidate = candidateMention.toLocaleLowerCase();

  let prefix = "";
  let completion = "";

  if (result.type === "person") {
    prefix = typedMention;
    completion = normalizedCandidate.startsWith(normalizedTyped)
      ? candidateMention.slice(typedMention.length)
      : ` ${resultLabel(result)}`;
  } else {
    // For pages, the typed '@' is replaced upon selection, so ghost text displays
    // the page label directly following the '@'
    completion = ` ${candidateMention}`;
  }

  return [
    ...renderFormattedValue(value.slice(0, match.index), mentions),
    prefix,
    <span className="composer__mention-preview" key="mention-preview">
      {completion}
    </span>,
    value.slice(cursorPosition),
  ];
}

/**
 * Appends text with formatted strong tags into a DOM container.
 * Used inside hidden DOM mirror elements to accurately calculate caret pixel coordinates.
 */
export function appendFormattedText(
  container: HTMLElement,
  value: string,
  mentions: CommittedMention[],
) {
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
    const badgeType = mention.type ?? (mention.text.startsWith("@") ? "person" : "page");
    const span = document.createElement("span");
    span.className = `mention-badge mention-badge--${badgeType}`;
    span.textContent = value.slice(mention.start, mention.end - 1);
    container.appendChild(span);
    container.appendChild(document.createTextNode(" "));
    cursor = mention.end;
  }
  container.appendChild(document.createTextNode(value.slice(cursor)));
}
