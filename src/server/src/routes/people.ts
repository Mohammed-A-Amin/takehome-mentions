import { Router } from "express";
import type { Person } from "../types.js";
import { CURRENT_USER, recommendPeople, rankPeople } from "../peopleSearch.js";

const PEOPLE_ENDPOINT = "https://takehome.notion.dev/people";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 20;
const UPSTREAM_LIMIT = 100;
const UPSTREAM_TIMEOUT_MS = 1_500;
const TYPED_TTL_MS = 45_000;
const EMPTY_TTL_MS = 20_000;
const STALE_MAX_AGE_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 200;

type FetchLike = typeof fetch;
type PeopleResponse = { results: Array<ReturnType<typeof rankPeople>[number]> };
type CacheEntry = { response: PeopleResponse; fetchedAt: number };

/**
 * Build the local People API.
 *
 * This router owns the product behavior around the hosted directory: it
 * validates upstream records, ranks them, limits the response, and protects
 * the UI from directory latency with caching, request deduplication, timeout
 * handling, and stale-result fallback.
 */
export function createPeopleRouter(fetchPeople: FetchLike = fetch): Router {
  const router = Router();
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<PeopleResponse>>();

  router.get("/", async (req, res) => {
    // Cache entries are keyed by normalized query, so whitespace/case changes
    // do not create duplicate upstream work.
    const query = firstString(req.query.q) ?? "";
    const limit = clampLimit(firstString(req.query.limit));
    const cacheKey = normalizeQuery(query);
    const cached = cache.get(cacheKey);
    const ttl = query.trim() ? TYPED_TTL_MS : EMPTY_TTL_MS;

    if (cached && Date.now() - cached.fetchedAt <= ttl) {
      res.json({ results: cached.response.results.slice(0, limit) });
      return;
    }

    let request = inFlight.get(cacheKey);
    if (!request) {
      request = fetchAndRank(query, fetchPeople);
      inFlight.set(cacheKey, request);
      void request.finally(() => inFlight.delete(cacheKey)).catch(() => undefined);
    }

    try {
      const response = await request;
      cacheResponse(cache, cacheKey, response);
      res.json({ results: response.results.slice(0, limit) });
    } catch (error) {
      if (cached && Date.now() - cached.fetchedAt <= STALE_MAX_AGE_MS) {
        res.setHeader("X-People-Results-Stale", "true");
        res.json({ results: cached.response.results.slice(0, limit) });
        return;
      }

      const isTimeout = error instanceof DOMException && error.name === "AbortError";
      res.status(isTimeout ? 504 : 502).json({
        error: isTimeout ? "People directory timed out" : "People directory unavailable",
      });
    }
  });

  return router;
}

/** Fetch candidates for a query and apply the appropriate ranking strategy. */
async function fetchAndRank(query: string, fetchPeople: FetchLike): Promise<PeopleResponse> {
  if (!query.trim()) {
    // Query both
    // local fixture attributes, merge the candidate pools, and recommend three
    // people who are most similar to the current user.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const responses = await Promise.allSettled([
        fetchDirectory(CURRENT_USER.team, fetchPeople, controller.signal),
        fetchDirectory(CURRENT_USER.title, fetchPeople, controller.signal),
      ]);
      const people = responses.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      );
      if (people.length === 0 && responses.every((result) => result.status === "rejected")) {
        throw responses.find((result) => result.status === "rejected")?.reason;
      }
      const unique = deduplicatePeople(people);
      return {
        results: [{ ...CURRENT_USER, type: "person" }, ...recommendPeople(unique).slice(0, 3)],
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const people = await fetchDirectory(query, fetchPeople, controller.signal);
    return { results: rankPeople(people, query).slice(0, MAX_LIMIT) };
  } finally {
    clearTimeout(timeout);
  }
}

/** Fetch and validate one bounded candidate set from the hosted directory. */
async function fetchDirectory(
  query: string,
  fetchPeople: FetchLike,
  signal: AbortSignal,
): Promise<Person[]> {
  const url = new URL(PEOPLE_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(UPSTREAM_LIMIT));
  const response = await fetchPeople(url, { signal });
  if (!response.ok) throw new Error(`People directory returned ${response.status}`);
  const body = (await response.json()) as { results?: unknown };
  return Array.isArray(body.results) ? body.results.filter(isPerson) : [];
}

/** Insert a response into the LRU cache and evict the oldest entry if needed. */
function cacheResponse(
  cache: Map<string, CacheEntry>,
  key: string,
  response: PeopleResponse,
): void {
  cache.delete(key);
  cache.set(key, { response, fetchedAt: Date.now() });
  while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
}

/** Merge the team/title candidate pools without duplicating people by ID. */
function deduplicatePeople(people: Person[]): Person[] {
  const unique = new Map<string, Person>();
  for (const person of people) unique.set(person.id, person);
  return [...unique.values()];
}

/** Reject malformed upstream rows before they enter ranking or the UI. */
function isPerson(value: unknown): value is Person {
  if (!value || typeof value !== "object") return false;
  const person = value as Partial<Person>;
  return ["id", "name", "email", "avatarUrl", "title", "team"].every(
    (field) => typeof person[field as keyof Person] === "string",
  );
}

/** Read a query parameter safely when Express receives repeated values. */
function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

/** Keep client-controlled limits within the intentionally small menu size. */
function clampLimit(raw: string | undefined): number {
  const parsed = raw !== undefined ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

/** Build a stable cache key from user-entered query text. */
function normalizeQuery(query: string): string {
  return query
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase();
}
