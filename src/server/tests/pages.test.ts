import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import type { Express } from "express";
import type Database from "better-sqlite3";

// Baseline correctness check for the provided pages endpoint. It seeds a
// throwaway database so it never touches your local one.
//
// `tests/README.md` explains how to add tests for the tasks you complete.

let app: Express;
let db: Database.Database;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "takehome-"));
  process.env.NOTION_TH_DB_PATH = path.join(tmpDir, "test.db");

  const { openDb } = await import("../src/db.ts");
  const { seedDatabase } = await import("../src/seed.ts");
  db = openDb();
  seedDatabase(db);

  const { createApp } = await import("../src/app.ts");
  app = createApp(db);
});

afterAll(() => {
  db?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("GET /api/pages", () => {
  it("returns page results for a query", async () => {
    const res = await request(app).get("/api/pages").query({ q: "a" });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.results.length).toBeGreaterThan(0);
    for (const result of res.body.results) {
      expect(result.type).toBe("page");
      expect(typeof result.title).toBe("string");
    }
  });

  it("only returns titles containing the query", async () => {
    const res = await request(app).get("/api/pages").query({ q: "plan" });
    expect(res.status).toBe(200);
    for (const result of res.body.results) {
      expect(result.title.toLowerCase()).toContain("plan");
    }
  });

  it("treats LIKE wildcards in the query as literal characters", async () => {
    // No seeded title contains '%' or '_', so escaped wildcards must match
    // nothing rather than matching every page.
    for (const q of ["%", "_"]) {
      const res = await request(app).get("/api/pages").query({ q });
      expect(res.status).toBe(200);
      expect(res.body.results).toEqual([]);
    }
  });

  it("returns deterministic relevance-ranked results", async () => {
    const res = await request(app).get("/api/pages").query({ q: "re", limit: 50 });
    expect(res.status).toBe(200);
    const results = res.body.results as Array<{ id: string; title: string; content: string }>;
    expect(results.length).toBeGreaterThan(1);
    expect(
      results.every((result) => `${result.title} ${result.content}`.toLowerCase().includes("re")),
    ).toBe(true);

    const repeat = await request(app).get("/api/pages").query({ q: "re", limit: 50 });
    expect(repeat.body.results).toEqual(results);
  });

  it("respects the limit parameter", async () => {
    const res = await request(app).get("/api/pages").query({ q: "a", limit: 3 });
    expect(res.body.results.length).toBeLessThanOrEqual(3);
  });

  it("returns 15 recently edited pages for an empty query", async () => {
    const res = await request(app).get("/api/pages").query({ q: "" });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(15);

    const editedTimes = res.body.results.map((result: { lastEditedTime: string }) =>
      Date.parse(result.lastEditedTime),
    );
    expect(editedTimes).toEqual([...editedTimes].sort((a, b) => b - a));
  });

  it("returns content and timestamps on every result", async () => {
    const before = Date.now();
    const res = await request(app).get("/api/pages").query({ q: "a", limit: 50 });
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeGreaterThan(0);

    for (const result of res.body.results) {
      expect(result.content).toBeTruthy();

      // Round-tripping through Date is what catches a column that came back as
      // a raw epoch number or a SQLite datetime string instead of ISO 8601.
      for (const field of ["createdTime", "lastEditedTime"] as const) {
        expect(new Date(result[field]).toISOString()).toBe(result[field]);
      }

      const created = Date.parse(result.createdTime);
      const edited = Date.parse(result.lastEditedTime);
      expect(edited).toBeGreaterThanOrEqual(created);
      expect(edited).toBeLessThanOrEqual(before);
    }
  });

  it("varies content across pages so there is more than the title to match on", async () => {
    const res = await request(app).get("/api/pages").query({ q: "a", limit: 50 });
    const contents = res.body.results.map((r: { content: string }) => r.content);
    expect(new Set(contents).size).toBeGreaterThan(1);
  });
});

describe("seedDatabase", () => {
  it("produces identical pages for the same pinned clock", async () => {
    const { openDb } = await import("../src/db.ts");
    const { seedDatabase } = await import("../src/seed.ts");
    const pinned = Date.parse("2026-01-15T00:00:00.000Z");

    const read = (handle: Database.Database) =>
      handle.prepare("SELECT * FROM pages ORDER BY id").all();

    const dirA = mkdtempSync(path.join(tmpdir(), "takehome-a-"));
    const dirB = mkdtempSync(path.join(tmpdir(), "takehome-b-"));
    const originalDbPath = process.env.NOTION_TH_DB_PATH;
    try {
      process.env.NOTION_TH_DB_PATH = path.join(dirA, "a.db");
      const dbA = openDb();
      seedDatabase(dbA, pinned);

      process.env.NOTION_TH_DB_PATH = path.join(dirB, "b.db");
      const dbB = openDb();
      seedDatabase(dbB, pinned);

      expect(read(dbA)).toEqual(read(dbB));
      dbA.close();
      dbB.close();
    } finally {
      process.env.NOTION_TH_DB_PATH = originalDbPath;
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });
});

describe("POST /api/pages", () => {
  it("creates a new page and returns 201 with full PageSearchResult", async () => {
    const res = await request(app).post("/api/pages").send({
      title: "Unique Engineering RFC",
      icon: "📘",
      content: "Detailed RFC content for engineering discussion.",
    });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe("Unique Engineering RFC");
    expect(res.body.icon).toBe("📘");
    expect(res.body.content).toBe("Detailed RFC content for engineering discussion.");
    expect(res.body.type).toBe("page");
    expect(typeof res.body.id).toBe("string");
    expect(typeof res.body.createdTime).toBe("string");
    expect(typeof res.body.lastEditedTime).toBe("string");

    // Verify it is immediately searchable
    const searchRes = await request(app).get("/api/pages").query({ q: "Engineering RFC" });
    expect(searchRes.status).toBe(200);
    expect(searchRes.body.results.some((p: any) => p.title === "Unique Engineering RFC")).toBe(
      true,
    );
  });

  it("rejects creation with 400 when title is missing or empty", async () => {
    const res1 = await request(app).post("/api/pages").send({ title: "   " });
    expect(res1.status).toBe(400);
    expect(res1.body.error).toBeDefined();

    const res2 = await request(app).post("/api/pages").send({});
    expect(res2.status).toBe(400);
  });
});
