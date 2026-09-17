import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { CURRENT_USER, recommendPeople, rankPeople } from "../src/peopleSearch.js";
import type { Person } from "../src/types.js";

const alex: Person = {
  id: "alex",
  name: "Alex Kim",
  email: "alex@example.com",
  avatarUrl: "https://example.com/alex.png",
  title: "Software Engineer",
  team: "Engineering",
};

const alexandra: Person = {
  id: "alexandra",
  name: "Alexandra Chen",
  email: "alexandra@example.com",
  avatarUrl: "https://example.com/alexandra.png",
  title: "Designer",
  team: "Product",
};

const samAlex: Person = {
  id: "sam-alex",
  name: "Sam Alex",
  email: "sam@example.com",
  avatarUrl: "https://example.com/sam.png",
  title: "Recruiter",
  team: "People",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("people ranking", () => {
  it("prioritizes exact and prefix name matches", () => {
    const results = rankPeople([samAlex, alexandra, alex], "alex");
    expect(results.map((person) => person.name)).toEqual([
      "Alex Kim",
      "Alexandra Chen",
      "Sam Alex",
    ]);
  });

  it("uses user similarity to break lexical ties", () => {
    const results = rankPeople(
      [
        { ...alex, id: "different-team", name: "Alex One", team: "Product" },
        { ...alex, id: "same-team", name: "Alex Two", team: CURRENT_USER.team },
      ],
      "alex",
    );
    expect(results.map((person) => person.name)).toEqual(["Alex Two", "Alex One"]);
  });

  it("prioritizes same team over same title for empty-query recommendations", () => {
    const results = recommendPeople([
      { ...alexandra, id: "same-team", name: "Taylor Chen", team: CURRENT_USER.team },
      { ...alex, id: "same-title", name: "Jordan Kim", team: "Product" },
      { ...samAlex, id: "unrelated", name: "Sam Alex", team: "People" },
    ]);
    expect(results.map((person) => person.name)).toEqual(["Taylor Chen", "Jordan Kim", "Sam Alex"]);
  });
});

describe("GET /api/people", () => {
  it("returns at most 20 tagged, ranked results and caches repeat queries", async () => {
    const people = Array.from({ length: 25 }, (_, index) => ({
      ...alex,
      id: `alex-${index}`,
      name: `Alex ${String.fromCharCode(65 + index)} Kim`,
    }));
    const fetchPeople: typeof fetch = vi.fn(async () => jsonResponse({ results: people }));
    const app = createApp(undefined, fetchPeople);

    const first = await request(app).get("/api/people?q=alex");
    const second = await request(app).get("/api/people?q=alex");

    expect(first.status).toBe(200);
    expect(first.body.results).toHaveLength(20);
    expect(
      first.body.results.every((person: Person & { type: string }) => person.type === "person"),
    ).toBe(true);
    expect(second.status).toBe(200);
    expect(fetchPeople).toHaveBeenCalledTimes(1);
  });

  it("pins the current user and adds three empty-query recommendations", async () => {
    const fetchPeople: typeof fetch = vi.fn(async (input) => {
      const query = new URL(String(input)).searchParams.get("q");
      const results =
        query === CURRENT_USER.team
          ? [
              { ...alex, id: "team-match", name: "Team Match", team: CURRENT_USER.team },
              { ...alex, id: "team-match-2", name: "Team Match Two", team: CURRENT_USER.team },
            ]
          : [{ ...alex, id: "title-match", name: "Title Match", title: CURRENT_USER.title }];
      return jsonResponse({ results });
    });
    const app = createApp(undefined, fetchPeople);

    const result = await request(app).get("/api/people?q=");

    expect(result.status).toBe(200);
    expect(result.body.results).toHaveLength(4);
    expect(result.body.results[0]).toMatchObject({
      name: CURRENT_USER.name,
      type: "person",
    });
    expect(result.body.results.some((person: Person) => person.name === CURRENT_USER.name)).toBe(
      true,
    );
    expect(result.body.results.some((person: Person) => person.name === "Team Match")).toBe(true);
    expect(result.body.results.some((person: Person) => person.name === "Team Match Two")).toBe(
      true,
    );
    expect(result.body.results.some((person: Person) => person.name === "Title Match")).toBe(true);
  });

  it("returns a gateway error when the directory fails", async () => {
    const fetchPeople: typeof fetch = vi.fn(async () => jsonResponse({}, 503));
    const app = createApp(undefined, fetchPeople);

    const result = await request(app).get("/api/people?q=alex");

    expect(result.status).toBe(502);
    expect(result.body).toEqual({ error: "People directory unavailable" });
  });
});
