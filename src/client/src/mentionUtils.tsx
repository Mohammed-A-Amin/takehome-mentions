import type { ReactNode } from "react";
import type { MentionResult } from "./types";

export const MENTION_RE = /@([^@]*)$/;

export type CommittedMention = {
  start: number;
  end: number;
  text: string;
};

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

export function resultLabel(result: MentionResult): string {
  if (result.type === "page") return `${result.icon} ${result.title}`;
  if (result.type === "person") return result.name;
  return result.label;
}

export function renderFormattedValue(value: string, mentions: CommittedMention[]): ReactNode[] {
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

export function renderPreviewValue(
  value: string,
  cursorPosition: number,
  result: MentionResult,
  mentions: CommittedMention[],
): ReactNode[] {
  const match = value.slice(0, cursorPosition).match(MENTION_RE);
  if (!match || match.index === undefined) return renderFormattedValue(value, mentions);

  const typedMention = value.slice(match.index, cursorPosition);
  const candidateMention = `@${resultLabel(result)}`;
  const normalizedTyped = typedMention.toLocaleLowerCase();
  const normalizedCandidate = candidateMention.toLocaleLowerCase();
  const completion = normalizedCandidate.startsWith(normalizedTyped)
    ? candidateMention.slice(typedMention.length)
    : ` ${resultLabel(result)}`;

  return [
    ...renderFormattedValue(value.slice(0, match.index), mentions),
    typedMention,
    <span className="composer__mention-preview" key="mention-preview">
      {completion}
    </span>,
    value.slice(cursorPosition),
  ];
}

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
    const strong = document.createElement("strong");
    strong.textContent = value.slice(mention.start, mention.end - 1);
    container.appendChild(strong);
    container.appendChild(document.createTextNode(" "));
    cursor = mention.end;
  }
  container.appendChild(document.createTextNode(value.slice(cursor)));
}
