import type { PageResult, PersonResult } from "./types";

const API_BASE = "/api";

/** Search local pages while allowing the caller to cancel stale keystroke work. */
export async function searchPages(query: string, signal?: AbortSignal): Promise<PageResult[]> {
  const res = await fetch(`${API_BASE}/pages?q=${encodeURIComponent(query)}`, { signal });
  if (!res.ok) throw new Error(`pages search failed: ${res.status}`);
  const data = (await res.json()) as { results?: PageResult[] };
  return Array.isArray(data.results) ? data.results : [];
}

/** Search the local ranked People proxy with optional stale-request cancellation. */
export async function searchPeople(query: string, signal?: AbortSignal): Promise<PersonResult[]> {
  const res = await fetch(`${API_BASE}/people?q=${encodeURIComponent(query)}`, { signal });
  if (!res.ok) throw new Error(`people search failed: ${res.status}`);
  const data = (await res.json()) as { results?: PersonResult[] };
  return Array.isArray(data.results) ? data.results : [];
}
