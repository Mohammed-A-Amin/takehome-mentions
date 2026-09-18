import { describe, expect, it } from "vitest";
import {
  buildMenuOptions,
  MAX_COMPACTED,
  sectionView,
  VISIBLE_PER_SECTION,
} from "./mentionMenuModel";
import type { MentionResult } from "./types";

const person = (id: string): MentionResult => ({
  type: "person",
  id,
  name: `Person ${id}`,
  email: `${id}@example.com`,
  title: "Scholar",
  team: "Team",
  avatarUrl: "",
});

const page = (id: string): MentionResult => ({
  type: "page",
  id,
  title: `Page ${id}`,
  icon: "[page]",
  content: "",
  createdTime: "2026-01-01T00:00:00.000Z",
  lastEditedTime: "2026-01-01T00:00:00.000Z",
});

describe("mention menu sections", () => {
  it("shows up to five results without an overflow row", () => {
    const items = Array.from({ length: VISIBLE_PER_SECTION }, (_, index) => index);

    expect(sectionView(items, false)).toEqual({ visible: items, moreCount: 0 });
  });

  it("keeps the overflow count capped at fifteen", () => {
    const items = Array.from(
      { length: VISIBLE_PER_SECTION + MAX_COMPACTED + 3 },
      (_, index) => index,
    );

    expect(sectionView(items, false)).toEqual({
      visible: items.slice(0, VISIBLE_PER_SECTION),
      moreCount: MAX_COMPACTED,
    });
  });

  it("reveals all results when a section is expanded", () => {
    const items = Array.from({ length: 8 }, (_, index) => index);

    expect(sectionView(items, true)).toEqual({ visible: items, moreCount: 0 });
  });

  it("keeps people and pages independently expandable and ordered", () => {
    const results = [
      ...Array.from({ length: 6 }, (_, index) => person(String(index))),
      ...Array.from({ length: 6 }, (_, index) => page(String(index))),
    ];

    const collapsed = buildMenuOptions(results, false, false);
    expect(collapsed.filter((option) => option.kind === "more")).toEqual([
      { kind: "more", section: "people", moreCount: 1 },
      { kind: "more", section: "pages", moreCount: 1 },
    ]);
    expect(collapsed[0]).toEqual({ kind: "result", result: person("0") });

    const peopleExpanded = buildMenuOptions(results, true, false);
    expect(peopleExpanded.filter((option) => option.kind === "more")).toEqual([
      { kind: "more", section: "pages", moreCount: 1 },
    ]);
    expect(peopleExpanded).toHaveLength(6 + 5 + 1);
  });
});

it("appends a create page option when a query has no exact match", () => {
  const results = [page("existing")];
  const options = buildMenuOptions(results, false, false, "New Roadmap");
  const createOption = options.find((o) => o.kind === "create");
  expect(createOption).toEqual({ kind: "create", title: "New Roadmap" });
});
