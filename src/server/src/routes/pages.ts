import { Router } from "express";
import type Database from "better-sqlite3";
import { chaos } from "../chaos.js";
import type { Page, PageSearchResult } from "../types.js";

const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 50;
const CANDIDATE_LIMIT = 100;

type ScoredPage = { page: Page; score: number; titleMatchPosition: number; tokenCoverage: number };

/**
 * Search titles and body content, then rank candidates locally. Title matches
 * deliberately outweigh content-only matches so an exact page name remains
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
    const results = ranked.slice(0, limit).map(({ page }) => toSearchResult(page));
    res.json({ results });
  });

  return router;
}

/** Rank typed page candidates and remove pages with no meaningful match. */
export function rankPages(pages: Page[], query: string): ScoredPage[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery)
    return pages.map((page) => ({ page, score: 0, titleMatchPosition: 0, tokenCoverage: 0 }));

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

function toSearchResult(page: Page): PageSearchResult {
  return { ...page, type: "page" };
}

function countMatchingTokens(queryTokens: string[], candidateTokens: string[]): number {
  return queryTokens.filter((queryToken) =>
    candidateTokens.some((candidateToken) => candidateToken.startsWith(queryToken)),
  ).length;
}

function comparePages(a: Page, b: Page): number {
  return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
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

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function clampLimit(raw: string | undefined): number {
  const parsed = raw !== undefined ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}
