import type { Person, PersonSearchResult } from "./types.js";

/** Local identity used for the empty-query recommendation experience. */
export type CurrentUser = Person;

/**
 * Demo-only current user. The starter has no authentication/session context,
 * so this explicit fixture makes the empty `@` state deterministic without
 * pretending that the hosted directory knows who is signed in.
 */
export const CURRENT_USER: CurrentUser = {
  id: "current-user",
  name: "Mohammed Ashfak Amin",
  email: "mohammed.ashfak.amin@example.com",
  avatarUrl: "https://api.dicebear.com/9.x/initials/svg?seed=Mohammed%20Ashfak%20Amin",
  title: "Software Engineer",
  team: "Engineering",
};

/**
 * Rank upstream substring matches for a typed query.
 *
 * The hosted service deliberately returns unranked substring matches. Lexical
 * quality is the primary signal, while similarity to the current user breaks
 * ties between similarly relevant people. Candidates with no local lexical
 * match are removed so the result limit is a ceiling rather than a quota.
 */
export function rankPeople(
  people: Person[],
  query: string,
  currentUser: CurrentUser = CURRENT_USER,
): PersonSearchResult[] {
  const normalizedQuery = normalize(query);
  return people
    .map((person) => ({
      person,
      lexicalScore: typedScore(person, normalizedQuery),
      similarity: similarityScore(person, currentUser),
    }))
    .filter(({ lexicalScore }) => lexicalScore >= minimumTypedScore(normalizedQuery))
    .sort(
      (a, b) =>
        b.lexicalScore - a.lexicalScore ||
        b.similarity - a.similarity ||
        comparePeople(a.person, b.person),
    )
    .map(({ person }) => toSearchResult(person));
}

/**
 * Rank empty-query recommendations against the current user's team and title.
 * The current user is removed before scoring because they are pinned separately
 * at the top of the People list.
 */
export function recommendPeople(
  people: Person[],
  currentUser: CurrentUser = CURRENT_USER,
): PersonSearchResult[] {
  return people
    .filter((person) => person.id !== currentUser.id && person.name !== currentUser.name)
    .map((person) => ({
      person,
      score: similarityScore(person, currentUser),
    }))
    .sort((a, b) => b.score - a.score || comparePeople(a.person, b.person))
    .map(({ person }) => toSearchResult(person));
}

/**
 * Calculate a transparent similarity score for the empty-query state.
 * Team similarity is intentionally weighted more heavily than title similarity
 * because same-team people are the strongest available collaboration signal.
 */
export function similarityScore(person: Person, currentUser: CurrentUser): number {
  const personTeam = tokenize(person.team);
  const userTeam = tokenize(currentUser.team);
  const personTitle = tokenize(person.title);
  const userTitle = tokenize(currentUser.title);
  const sharedTeamTokens = intersectionSize(personTeam, userTeam);
  const sharedTitleTokens = intersectionSize(personTitle, userTitle);
  const sharedCrossFieldTokens =
    intersectionSize(personTeam, userTitle) + intersectionSize(personTitle, userTeam);

  let score = 0;
  if (normalize(person.team) === normalize(currentUser.team) && person.team) score += 100;
  else if (sharedTeamTokens > 0) score += 50;

  if (normalize(person.title) === normalize(currentUser.title) && person.title) score += 60;
  else score += Math.min(sharedTitleTokens * 20, 40);

  score += Math.min(sharedCrossFieldTokens * 20, 20);

  return score;
}

/** Return a descending-priority score for one typed-query candidate. */
function typedScore(person: Person, query: string): number {
  if (!query) return 0;

  const name = normalize(person.name);
  const email = normalize(person.email);
  const title = normalize(person.title);
  const team = normalize(person.team);
  const queryTokens = tokenize(query);
  const nameTokens = tokenize(person.name);
  const titleTokens = tokenize(person.title);
  const teamTokens = tokenize(person.team);

  if (name === query) return 1000;
  if (name.startsWith(query)) return 900 - query.length;
  if (queryTokens.length > 0 && tokensMatch(queryTokens, nameTokens)) {
    return 800 - query.length;
  }

  const nameIndex = name.indexOf(query);
  if (nameIndex >= 0) return 700 - nameIndex;
  if (team === query) return 600;
  if (title.startsWith(query)) return 500 - query.length;
  if (queryTokens.length > 0 && tokensMatch(queryTokens, titleTokens)) return 500 - query.length;
  if (email.includes(query)) return 400 - email.indexOf(query);
  if (
    (queryTokens.length > 0 && tokensMatch(queryTokens, teamTokens)) ||
    team.includes(query) ||
    title.includes(query)
  ) {
    return 300;
  }
  return 0;
}

function minimumTypedScore(query: string): number {
  if (query.length <= 1) return 500;
  if (query.length === 2) return 400;
  return 300;
}

function tokensMatch(queryTokens: string[], candidateTokens: string[]): boolean {
  return queryTokens.every((queryToken) =>
    candidateTokens.some((candidateToken) => candidateToken.startsWith(queryToken)),
  );
}

/** Add the discriminant required by the client's MentionResult union. */
function toSearchResult(person: Person): PersonSearchResult {
  return { ...person, type: "person" };
}

/** Stable final ordering used whenever two candidates have equal relevance. */
function comparePeople(a: Person, b: Person): number {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/** Normalize accents, casing, and surrounding whitespace before comparison. */
function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim();
}

/** Split names, titles, and teams into comparable word tokens. */
function tokenize(value: string): string[] {
  return normalize(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(stemToken);
}

function stemToken(token: string): string {
  if (token.length > 6 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 5 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  return token;
}

/** Count distinct tokens shared by two normalized token lists. */
function intersectionSize(a: string[], b: string[]): number {
  const bSet = new Set(b);
  return new Set(a).size === 0 ? 0 : new Set(a.filter((token) => bSet.has(token))).size;
}
