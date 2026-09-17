import { Router } from "express";
import type { Person } from "../types.js";
import { CURRENT_USER, recommendPeople, rankPeople } from "../peopleSearch.js";

const PEOPLE_ENDPOINT = "https://takehome.notion.dev/people";
const MAX_LIMIT = 20;
const UPSTREAM_LIMIT = 100;

type FetchLike = typeof fetch;

/**
 * Build the core People proxy. This first layer owns validation, local
 * relevance ranking, and the empty-query recommendation behavior.
 */
export function createPeopleRouter(fetchPeople: FetchLike = fetch): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const query = firstString(req.query.q) ?? "";
    const limit = clampLimit(firstString(req.query.limit));

    try {
      const results = await searchDirectory(query, fetchPeople);
      res.json({ results: results.slice(0, limit) });
    } catch {
      res.status(502).json({ error: "People directory unavailable" });
    }
  });

  return router;
}

/** Fetch candidates and apply the product ranking strategy locally. */
async function searchDirectory(query: string, fetchPeople: FetchLike) {
  if (!query.trim()) {
    const [teamPeople, titlePeople] = await Promise.all([
      fetchDirectory(CURRENT_USER.team, fetchPeople),
      fetchDirectory(CURRENT_USER.title, fetchPeople),
    ]);
    const unique = deduplicatePeople([...teamPeople, ...titlePeople]);
    return [{ ...CURRENT_USER, type: "person" as const }, ...recommendPeople(unique).slice(0, 3)];
  }

  const people = await fetchDirectory(query, fetchPeople);
  return rankPeople(people, query).slice(0, MAX_LIMIT);
}

/** Fetch and validate the bounded candidate set from the hosted directory. */
async function fetchDirectory(query: string, fetchPeople: FetchLike): Promise<Person[]> {
  const url = new URL(PEOPLE_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(UPSTREAM_LIMIT));
  const response = await fetchPeople(url);
  if (!response.ok) throw new Error(`People directory returned ${response.status}`);
  const body = (await response.json()) as { results?: unknown };
  return Array.isArray(body.results) ? body.results.filter(isPerson) : [];
}

/** Remove duplicate people when team and title recommendation queries overlap. */
function deduplicatePeople(people: Person[]): Person[] {
  const unique = new Map<string, Person>();
  for (const person of people) unique.set(person.id, person);
  return [...unique.values()];
}

/** Reject malformed upstream records before ranking or returning them. */
function isPerson(value: unknown): value is Person {
  if (!value || typeof value !== "object") return false;
  const person = value as Partial<Person>;
  return ["id", "name", "email", "avatarUrl", "title", "team"].every(
    (field) => typeof person[field as keyof Person] === "string",
  );
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function clampLimit(raw: string | undefined): number {
  const parsed = raw !== undefined ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return MAX_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}
