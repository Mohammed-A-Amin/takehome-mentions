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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("people ranking core", () => {
  it("prioritizes exact and prefix name matches", () => {
    const results = rankPeople([alexandra, alex], "alex");
    expect(results.map((person) => person.name)).toEqual(["Alex Kim", "Alexandra Chen"]);
  });

  it("uses team and title similarity for empty recommendations", () => {
    const results = recommendPeople([
      { ...alexandra, id: "same-team", name: "Taylor Chen", team: CURRENT_USER.team },
      { ...alex, id: "same-title", name: "Jordan Kim", team: "Product" },
    ]);
    expect(results.map((person) => person.name)).toEqual(["Taylor Chen", "Jordan Kim"]);
  });
});

describe("GET /api/people core", () => {
  it("returns ranked tagged results", async () => {
    const fetchPeople: typeof fetch = vi.fn(async () =>
      jsonResponse({ results: [alexandra, alex] }),
    );
    const app = createApp(undefined, fetchPeople);
    const result = await request(app).get("/api/people?q=alex");

    expect(result.status).toBe(200);
    expect(result.body.results.map((person: Person) => person.name)).toEqual([
      "Alex Kim",
      "Alexandra Chen",
    ]);
    expect(
      result.body.results.every((person: Person & { type: string }) => person.type === "person"),
    ).toBe(true);
  });

  it("pins the current user in the empty-query state", async () => {
    const fetchPeople: typeof fetch = vi.fn(async () => jsonResponse({ results: [alex] }));
    const app = createApp(undefined, fetchPeople);
    const result = await request(app).get("/api/people?q=");

    expect(result.status).toBe(200);
    expect(result.body.results[0]).toMatchObject({ name: CURRENT_USER.name, type: "person" });
  });
});
