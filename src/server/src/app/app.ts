import express, { type Express } from "express";
import cors from "cors";
import type Database from "better-sqlite3";
import { createPagesRouter } from "../features/pages/router.js";
import { createPeopleRouter } from "../features/people/router.js";
import { openDb } from "../shared/db/db.js";

/** Build the Express app. Pass a db handle in tests; defaults to the local one. */
export function createApp(
  db: Database.Database = openDb(),
  fetchPeople: typeof fetch = fetch,
): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/pages", createPagesRouter(db));
  app.use("/api/people", createPeopleRouter(fetchPeople));

  return app;
}
