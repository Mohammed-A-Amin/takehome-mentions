import { describe, expect, it } from "vitest";
import { QueryCache } from "../src/queryCache.js";

describe("QueryCache", () => {
  it("deduplicates concurrent loads and caches a successful result", async () => {
    const cache = new QueryCache<string>(2);
    let loads = 0;
    let resolve!: (value: string) => void;
    const load = () => {
      loads += 1;
      return new Promise<string>((done) => {
        resolve = done;
      });
    };

    const first = cache.getOrLoad("people:alex", load);
    const second = cache.getOrLoad("people:alex", load);
    resolve("Alex Kim");

    await expect(Promise.all([first, second])).resolves.toEqual(["Alex Kim", "Alex Kim"]);
    expect(loads).toBe(1);
    expect(cache.getFresh("people:alex", 1_000)).toBe("Alex Kim");
  });

  it("expires values by the caller-provided TTL and keeps most-recent entries", async () => {
    let now = 0;
    const cache = new QueryCache<string>(2, () => now);
    await cache.getOrLoad("a", async () => "A");
    now = 1;
    await cache.getOrLoad("b", async () => "B");
    expect(cache.getFresh("a", 10)).toBe("A");
    now = 2;
    await cache.getOrLoad("c", async () => "C");

    expect(cache.getFresh("b", 10)).toBeUndefined();
    expect(cache.getFresh("a", 10)).toBe("A");
    expect(cache.getFresh("c", 10)).toBe("C");
    now = 20;
    expect(cache.getFresh("a", 10)).toBeUndefined();
  });
});
