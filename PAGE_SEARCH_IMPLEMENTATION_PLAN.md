# Page Search and Ranking

## Summary

Improve the local `/api/pages` endpoint so page mentions are ranked by
relevance instead of relying only on SQLite title-substring order. The endpoint
will search both page titles and body content, rank candidates locally using
observable page metadata, and return at most 15 results by default.

The hosted People API remains unchanged. This plan only changes local page
search and preserves the existing `PageSearchResult` response shape.

## Available page metadata

Each page provides:

- `id`
- `title`
- `icon`
- `content`
- `createdTime`
- `lastEditedTime`

The implementation will not invent page-access, viewer-history,
collaborator, or activity metadata. `id` is used only for stable identity and
deterministic tie-breaking.

## Result limits

- Default limit: 15 pages
- Maximum limit: 50 pages
- Typed queries: return up to the requested bounded limit, but omit pages with
  no meaningful title or content match
- Empty query: return the 15 most recently edited pages

The empty-query behavior should be predictable and useful: People results keep
their existing current-user/recommendation behavior, while Pages show recent
pages ordered by observable edit metadata.

## Typed-query ranking

Search should consider both `title` and `content`, but title relevance should
strongly outweigh body-content relevance.

Suggested score tiers:

```text
Exact full-title match:              +1000
Title prefix match:                  +800
All query tokens in title:            +650
Title substring match:               +500
Exact phrase in content:             +350
All query tokens in content:          +200
Partial content/token match:          +100
Small recent-edit boost:                0–50
```

Pages with no title or content match should receive no relevance score and be
filtered out. The endpoint should return fewer than 15 results when fewer than
15 pages are genuinely relevant; the limit is a ceiling, not a requirement to
fill the menu with weak candidates.

Within a comparable primary-relevance tier, use these tie-breakers:

1. Earlier match position in the title
2. More query tokens matched
3. More recent `lastEditedTime`
4. More recent `createdTime`
5. Alphabetical title
6. Stable page ID

The recency boost must remain small and must not qualify a page by itself. An
exact title match should beat a weakly related page merely because that page was
edited more recently. Secondary metadata should only affect ordering when the
primary title/content scores are already similar.

## Matching behavior

Normalize query and searchable text by:

- Lowercasing
- Removing accents for comparison
- Trimming surrounding whitespace
- Splitting into word tokens

Prefer stronger matches in this order:

- Exact full-title phrase
- Title word boundary or prefix
- Title token coverage
- Content phrase
- Content token coverage
- Arbitrary substring matches

All query tokens matching is stronger than only one token matching. Word-boundary
matches should score higher than characters appearing in the middle of a word.

## Empty-query behavior

For `GET /api/pages?q=`:

- Return up to 15 pages.
- Sort by `lastEditedTime` descending.
- Use `createdTime` descending as the first tie-breaker.
- Then sort by title and stable ID.

No relevance score is fabricated for an empty query. Recency is the clearest
available signal when the user has not typed a page name or phrase.

## API implementation

The route will continue to expose:

```text
GET /api/pages?q=<query>&limit=<n>
```

Implementation sequence:

1. Fetch a broader bounded candidate set from SQLite instead of limiting before
   local relevance ranking.
2. Search both `title` and `content` using escaped literal query matching.
3. Rank candidates in TypeScript with small, testable scoring helpers.
4. Filter zero-relevance candidates before applying the final requested limit.
5. Apply the final requested limit after ranking.
6. Preserve all existing page fields and `type: "page"`.

The endpoint should keep the existing request behavior and remain compatible
with the client API. Page ranking should be isolated from People ranking so the
two domains can evolve independently.

## Responsiveness

- Keep the result limit bounded.
- Avoid loading unbounded content into the client.
- Search locally in SQLite and rank only a bounded candidate set.
- Preserve the existing client debounce and stale-request cancellation.
- Consider a small page-query cache only if profiling shows repeated local
  searches need it; SQLite search should be the baseline fast path.

## Tests

Add page-ranking tests for:

- Exact title match
- Title prefix match
- Title token coverage
- Title substring match
- Exact content phrase
- Content token coverage
- Title matches outranking content-only matches
- Recent-edit boost not overpowering title relevance
- Filtering of irrelevant zero-score pages
- Empty-query recent-page ordering
- `createdTime` and title deterministic tie-breaking
- Stable ID final tie-breaking
- Default limit of 15
- Custom limits and maximum-limit clamping
- Literal handling of `%`, `_`, and backslashes
- Preservation of all page metadata and `type: "page"`

## Tradeoffs and rationale

- **Title over content:** Users usually mention pages by name, so title matches
  should dominate body-content matches and prevent noisy content hits.

- **Local ranking after candidate retrieval:** SQLite can efficiently find
  candidates, while TypeScript scoring keeps product relevance logic explicit,
  readable, and easy to test.

- **Fifteen default results:** This gives the empty menu enough useful recent
  pages without making the menu excessively tall.

- **Recent pages for an empty query:** There is no typed relevance signal, and
  the dataset has no access history. `lastEditedTime` is the most defensible
  observable fallback.

- **Small recency boost:** Recency helps distinguish similar pages but should
  not cause a recent unrelated page to outrank an exact title match or appear
  when it has no meaningful query match.

- **Limit as a ceiling:** Returning fewer than 15 typed-query results is better
  than showing a full page of unrelated results. The menu should communicate
  relevance through both ranking and omission.

- **Primary versus secondary signals:** Title/content evidence determines
  eligibility and the major ordering. Timestamps only refine close scores,
  preventing a secondary freshness signal from overpowering direct text
  relevance.

- **No access-control ranking:** Page permissions and viewer history are not
  present in the starter schema, so the implementation cannot safely filter or
  personalize by access.

- **Stable ID last:** IDs provide consistency rather than relevance. Using them
  only at the end prevents arbitrary database ordering while preserving a
  predictable keyboard experience.

- **Separate People and Page ranking:** The People API is hosted and the Pages
  data is local, so each source keeps its own scoring and failure behavior.

- **Pagination as a production improvement:** The hosted People directory was
  responsive during testing without an explicit upstream limit, so the proxy
  can rank the complete candidate set returned by the API while still limiting
  the UI response. As the directory grows, pagination or cursor-based
  retrieval would bound payload size and latency without changing the local
  ranking behavior.

## Verification target

Before implementation is considered complete:

- All existing page tests pass.
- New ranking tests pass.
- People tests remain unchanged and pass.
- Typecheck, lint, and production build pass.
- The client still renders People before Pages and keeps keyboard indexes
  deterministic.

## Precision Search Addendum

### Result limits

Limits are ceilings, not quotas. Typed searches return only candidates that
meet the relevance threshold, up to the bounded request limit. Returning three
strong matches is preferable to returning twenty weak matches. The mention
menu still shows five results per section and exposes an overflow row only when
additional eligible results exist.

Very short typed queries use a smaller client request ceiling because one-letter
queries create noisy candidate sets. Longer queries retain enough capacity for
the existing in-place expansion behavior. Empty-query people recommendations
and recent pages remain separate from typed-query thresholds.

### People matching

People ranking uses generic normalization, including case/accent folding,
tokenization, and conservative suffix reduction. This allows related forms such
as `engineer` and `engineering` to compare without hardcoded occupation or team
dictionaries. Direct name evidence remains stronger than title/team evidence;
similarity is primarily a tie-breaker for typed searches and the main signal for
empty-query recommendations.

### Page thresholds

Page candidates are ranked before filtering. Short queries require stronger
title evidence, while longer queries can include meaningful content or token
matches. The endpoint returns fewer than the requested limit when fewer pages
meet the threshold, and empty-query recency ordering is unchanged.

### Tradeoffs

- Thresholds improve precision but can hide a legitimate weak match. The
  threshold is intentionally stricter only for short, noisy queries.
- Generic suffix reduction generalizes across unknown roles better than a
  hardcoded alias list, but it is conservative rather than full linguistic
  stemming.
- The current upstream People contract is still queried and cached per query.
  A full 10k-person snapshot/local index or pagination would be more efficient,
  but should wait until the upstream API exposes a reliable complete-directory
  or pagination contract.

### Updated verification

- People tests cover related-token matching without role-specific aliases.
- Client limits, people thresholds, and page thresholds are typechecked and
  linted.
- Server endpoint tests should run under a Node version with a compatible
  `better-sqlite3` binding; native binding failures are environment failures,
  not ranking failures.
