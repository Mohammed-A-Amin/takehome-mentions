import type { MentionResult, PageResult, PersonResult } from "./types";

export const VISIBLE_PER_SECTION = 5;
export const MAX_COMPACTED = 15;

export type OverflowSection = "people" | "pages";

export type MenuOption =
  | { kind: "result"; result: MentionResult }
  | { kind: "more"; section: OverflowSection; moreCount: number }
  | { kind: "create"; title: string };

/** Split a section into visible rows and one compact overflow row. */
export function sectionView<T>(items: T[], expanded: boolean): { visible: T[]; moreCount: number } {
  if (expanded || items.length <= VISIBLE_PER_SECTION) {
    return { visible: items, moreCount: 0 };
  }
  const hidden = Math.min(MAX_COMPACTED, items.length - VISIBLE_PER_SECTION);
  return { visible: items.slice(0, VISIBLE_PER_SECTION), moreCount: hidden };
}

/** Build the ordered rows shown by the mention menu. */
export function buildMenuOptions(
  results: MentionResult[],
  expandedPeople: boolean,
  expandedPages: boolean,
  query?: string,
): MenuOption[] {
  const people = results.filter((result): result is PersonResult => result.type === "person");
  const pages = results.filter((result): result is PageResult => result.type === "page");
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

  const trimmedQuery = query?.trim();
  const hasExactPageMatch = trimmedQuery
    ? pages.some((page) => page.title.toLowerCase() === trimmedQuery.toLowerCase())
    : false;
  if (trimmedQuery && !hasExactPageMatch) {
    options.push({ kind: "create", title: trimmedQuery });
  }

  for (const result of dates) options.push({ kind: "result", result });
  return options;
}
