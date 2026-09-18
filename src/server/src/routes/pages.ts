import { Router } from "express";
import type Database from "better-sqlite3";
import { chaos } from "../chaos.js";
import type { Page, PageSearchResult } from "../types.js";

const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 50;
const CANDIDATE_LIMIT = 10_000;

type ScoredPage = { page: Page; score: number; titleMatchPosition: number; tokenCoverage: number };

/**
 * Search titles and body content across all available pages, then rank candidates locally.
 * Title matches deliberately outweigh content-only matches so an exact page name remains
 * easy to find among broad body-text results.
 */
export function createPagesRouter(db: Database.Database): Router {
  const router = Router();
  const search = db.prepare<[string, string, number]>(`
    SELECT
      id,
      title,
      icon,
      content,
      created_time     AS createdTime,
      last_edited_time AS lastEditedTime
    FROM pages
    WHERE lower(title) LIKE '%' || lower(?) || '%' ESCAPE char(92)
       OR lower(content) LIKE '%' || lower(?) || '%' ESCAPE char(92)
    LIMIT ?
  `);

  router.get("/", chaos("pages"), (req, res) => {
    const query = firstString(req.query.q) ?? "";
    const limit = clampLimit(firstString(req.query.limit));
    if (/[\\%_]/.test(query)) {
      res.json({ results: [] });
      return;
    }
    const escapedQuery = escapeLike(query);
    const rows = search.all(escapedQuery, escapedQuery, CANDIDATE_LIMIT) as Page[];
    const ranked = rankPages(rows, query);
    const filtered = query.trim()
      ? ranked.filter(({ score }) => score >= minimumPageScore(query))
      : ranked;
    const results = filtered.slice(0, limit).map(({ page }) => toSearchResult(page));
    res.json({ results });
  });

  return router;
}

/**
 * Calculates the minimum score required for a page candidate to be returned,
 * preventing noisy low-relevance results on short queries.
 */
function minimumPageScore(query: string): number {
  const length = normalize(query).length;
  if (length <= 1) return 500;
  if (length === 2) return 350;
  return 100;
}

/**
 * Rank typed page candidates and remove pages with no meaningful match.
 * For empty queries, orders pages by observable edit freshness.
 */
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

/**
 * Computes a tiered relevance score and match metrics for an individual page candidate.
 */
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

/** Converts a raw Page record to a typed PageSearchResult. */
function toSearchResult(page: Page): PageSearchResult {
  return { ...page, type: "page" };
}

/** Counts how many query tokens match the prefix of any token in the candidate text. */
function countMatchingTokens(queryTokens: string[], candidateTokens: string[]): number {
  return queryTokens.filter((queryToken) =>
    candidateTokens.some((candidateToken) => candidateToken.startsWith(queryToken)),
  ).length;
}

/** Deterministic comparator for stable ordering by title and page ID. */
function comparePages(a: Page, b: Page): number {
  return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

/** Order the empty-query page menu by observable freshness, then stable fields. */
function compareRecentPages(a: Page, b: Page): number {
  return (
    b.lastEditedTime.localeCompare(a.lastEditedTime) ||
    b.createdTime.localeCompare(a.createdTime) ||
    comparePages(a, b)
  );
}

/** Normalizes a string by lowercasing, stripping accents, and trimming whitespace. */
function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim();
}

/** Tokenizes input text into alphanumeric word tokens. */
function tokenize(value: string): string[] {
  return normalize(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Extracts a single string from a query parameter. */
function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

/** Escapes SQLite LIKE wildcards (% and _) and the backslash escape character. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/** Clamps client-requested limits to a valid positive range up to MAX_LIMIT. */
function clampLimit(raw: string | undefined): number {
  const parsed = raw !== undefined ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}
