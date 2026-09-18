import type { PageResult, PersonResult } from "./types";

const API_BASE = "/api";
const TYPED_LIMIT = 20;
const SHORT_QUERY_LIMIT = 8;

function typedLimit(query: string): number {
  return query.trim().length <= 1 ? SHORT_QUERY_LIMIT : TYPED_LIMIT;
}

function searchUrl(path: string, query: string, limit?: number): string {
  const params = new URLSearchParams({ q: query });
  if (limit !== undefined) params.set("limit", String(limit));
  return `${API_BASE}/${path}?${params}`;
}

/** Search local pages while allowing the caller to cancel stale keystroke work. */
export async function searchPages(query: string, signal?: AbortSignal): Promise<PageResult[]> {
  const limit = query.trim() ? typedLimit(query) : undefined;
  const res = await fetch(searchUrl("pages", query, limit), { signal });
  if (!res.ok) throw new Error(`pages search failed: ${res.status}`);
  const data = (await res.json()) as { results?: PageResult[] };
  return Array.isArray(data.results) ? data.results : [];
}

/** Search the local ranked People proxy with optional stale-request cancellation. */
export async function searchPeople(query: string, signal?: AbortSignal): Promise<PersonResult[]> {
  const limit = query.trim() ? typedLimit(query) : undefined;
  const res = await fetch(searchUrl("people", query, limit), { signal });
  if (!res.ok) throw new Error(`people search failed: ${res.status}`);
  const data = (await res.json()) as { results?: PersonResult[] };
  return Array.isArray(data.results) ? data.results : [];
}

/** Create a new page and persist it in the SQLite database. */
export async function createPage(title: string, icon: string = "📄"): Promise<PageResult> {
  const res = await fetch(`${API_BASE}/pages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, icon }),
  });
  if (!res.ok) {
    const errorBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errorBody.error ?? `Failed to create page: ${res.status}`);
  }
  return (await res.json()) as PageResult;
}

/** Permanently delete a locally created page by its stable ID. */
export async function deletePage(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/pages/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) {
    const errorBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errorBody.error ?? `Failed to delete page: ${res.status}`);
  }
}
