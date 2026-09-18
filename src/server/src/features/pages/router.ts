import { Router } from "express";
import type Database from "better-sqlite3";
import { chaos } from "../../shared/http/chaos.js";
import type { Page, PageSearchResult } from "../../shared/types.js";
import { minimumPageScore, rankPages, toPageSearchResult } from "./search.js";

const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 50;

/**
 * Search titles and body content across all available pages, then delegate
 * relevance ranking and result shaping to pageSearch.ts.
 */
export function createPagesRouter(db: Database.Database): Router {
  const router = Router();
  const search = db.prepare<[string, string]>(`
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
  `);

  const insertPage = db.prepare<[string, string, string, string, string, string]>(`
    INSERT INTO pages (id, title, icon, content, created_time, last_edited_time)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  router.get("/", chaos("pages"), (req, res) => {
    const query = firstString(req.query.q) ?? "";
    const limit = clampLimit(firstString(req.query.limit));
    if (/[\\%_]/.test(query)) {
      res.json({ results: [] });
      return;
    }
    const escapedQuery = escapeLike(query);
    const rows = search.all(escapedQuery, escapedQuery) as Page[];
    const ranked = rankPages(rows, query);
    const filtered = query.trim()
      ? ranked.filter(({ score }) => score >= minimumPageScore(query))
      : ranked;
    const results = filtered.slice(0, limit).map(({ page }) => toPageSearchResult(page));
    res.json({ results });
  });

  router.post("/", (req, res) => {
    const rawTitle = req.body?.title;
    if (typeof rawTitle !== "string" || !rawTitle.trim()) {
      res.status(400).json({ error: "Title is required and must be a non-empty string" });
      return;
    }

    const title = rawTitle.trim();
    const icon =
      typeof req.body?.icon === "string" && req.body.icon.trim() ? req.body.icon.trim() : "📄";
    const content = typeof req.body?.content === "string" ? req.body.content : "";
    const id = `page_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    try {
      insertPage.run(id, title, icon, content, now, now);
      const newPage: PageSearchResult = {
        id,
        title,
        icon,
        content,
        createdTime: now,
        lastEditedTime: now,
        type: "page",
      };
      res.status(201).json(newPage);
    } catch {
      res.status(500).json({ error: "Failed to create page in database" });
    }
  });

  router.delete("/:id", (req, res) => {
    const id = req.params.id;
    if (!id) {
      res.status(400).json({ error: "Page ID is required" });
      return;
    }

    const result = db.prepare("DELETE FROM pages WHERE id = ?").run(id);
    if (result.changes === 0) {
      res.status(404).json({ error: "Page not found" });
      return;
    }
    res.status(204).end();
  });

  return router;
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
