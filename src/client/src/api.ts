import type { PageResult, PersonResult } from "./types";

const API_BASE = "/api";
const TYPED_LIMIT = 20;

function searchUrl(path: string, query: string, limit?: number): string {
  const params = new URLSearchParams({ q: query });
  if (limit !== undefined) params.set("limit", String(limit));
  return `${API_BASE}/${path}?${params}`;
}

/** Search local pages while allowing the caller to cancel stale keystroke work. */
export async function searchPages(query: string, signal?: AbortSignal): Promise<PageResult[]> {
  const limit = query.trim() ? TYPED_LIMIT : undefined;
  const res = await fetch(searchUrl("pages", query, limit), { signal });
  if (!res.ok) throw new Error(`pages search failed: ${res.status}`);
  const data = (await res.json()) as { results?: PageResult[] };
  return Array.isArray(data.results) ? data.results : [];
}

/** Search the local ranked People proxy with optional stale-request cancellation. */
export async function searchPeople(query: string, signal?: AbortSignal): Promise<PersonResult[]> {
  const limit = query.trim() ? TYPED_LIMIT : undefined;
  const res = await fetch(searchUrl("people", query, limit), { signal });
  if (!res.ok) throw new Error(`people search failed: ${res.status}`);
  const data = (await res.json()) as { results?: PersonResult[] };
  return Array.isArray(data.results) ? data.results : [];
}
