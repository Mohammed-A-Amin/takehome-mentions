import type { Page, PageSearchResult } from "./types.js";

export type ScoredPage = {
  page: Page;
  score: number;
  titleMatchPosition: number;
  tokenCoverage: number;
};

/** Rank page candidates by title/content relevance and deterministic tie-breakers. */
export function rankPages(pages: Page[], query: string): ScoredPage[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return pages
      .map((page) => ({ page, score: 0, titleMatchPosition: 0, tokenCoverage: 0 }))
      .sort((a, b) => compareRecentPages(a.page, b.page));
  }

  return pages
    .map((page) => scorePage(page, normalizedQuery))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.titleMatchPosition - b.titleMatchPosition ||
        b.tokenCoverage - a.tokenCoverage ||
        comparePages(a.page, b.page),
    );
}

/** Reject short-query content matches that are too broad for the menu. */
export function minimumPageScore(query: string): number {
  const length = normalize(query).length;
  if (length <= 1) return 500;
  if (length === 2) return 350;
  return 100;
}

/** Convert a raw page record into the tagged client result shape. */
export function toPageSearchResult(page: Page): PageSearchResult {
  return { ...page, type: "page" };
}

function scorePage(page: Page, query: string): ScoredPage {
  const title = normalize(page.title);
  const content = normalize(page.content);
  const queryTokens = tokenize(query);
  const titleTokens = tokenize(page.title);
  const contentTokens = tokenize(page.content);
  const titleMatchPosition = title.indexOf(query);
  const titleCoverage = countMatchingTokens(queryTokens, titleTokens);
  const contentCoverage = countMatchingTokens(queryTokens, contentTokens);
  const allTitleTokens = queryTokens.length > 0 && titleCoverage === queryTokens.length;
  const allContentTokens = queryTokens.length > 0 && contentCoverage === queryTokens.length;

  let score = 0;
  if (title === query) score = 1000;
  else if (title.startsWith(query)) score = 800;
  else if (allTitleTokens) score = 650;
  else if (titleMatchPosition >= 0) score = 500;
  else if (content.includes(query)) score = 350;
  else if (allContentTokens) score = 200;
  else if (contentCoverage > 0) score = 100;

  return {
    page,
    score,
    titleMatchPosition: titleMatchPosition < 0 ? Number.MAX_SAFE_INTEGER : titleMatchPosition,
    tokenCoverage: Math.max(titleCoverage, contentCoverage),
  };
}

function countMatchingTokens(queryTokens: string[], candidateTokens: string[]): number {
  return queryTokens.filter((queryToken) =>
    candidateTokens.some((candidateToken) => candidateToken.startsWith(queryToken)),
  ).length;
}

function comparePages(a: Page, b: Page): number {
  return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

function compareRecentPages(a: Page, b: Page): number {
  return (
    b.lastEditedTime.localeCompare(a.lastEditedTime) ||
    b.createdTime.localeCompare(a.createdTime) ||
    comparePages(a, b)
  );
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim();
}

function tokenize(value: string): string[] {
  return normalize(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
