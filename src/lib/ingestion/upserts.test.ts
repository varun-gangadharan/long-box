import { describe, expect, it } from "vitest";

import { evenlySampled } from "./ingest-co-appearances";
import { chunk } from "./upserts";

describe("chunk", () => {
  it("splits a list into batches of the requested size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns a single batch when the list already fits", () => {
    expect(chunk([1, 2], 10)).toEqual([[1, 2]]);
  });

  it("returns nothing for an empty list", () => {
    expect(chunk([], 10)).toEqual([]);
  });
});

describe("evenlySampled", () => {
  it("keeps everything when the list already fits", () => {
    expect(evenlySampled([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });

  it("spreads the sample across the whole range rather than taking a prefix", () => {
    const sampled = evenlySampled(Array.from({ length: 100 }, (_, i) => i), 5);
    expect(sampled).toEqual([0, 20, 40, 60, 80]);
  });

  it("keeps the earliest entry, which a truncated prefix would have kept alone", () => {
    const sampled = evenlySampled(Array.from({ length: 25000 }, (_, i) => i), 1200);
    expect(sampled[0]).toBe(0);
    expect(sampled.at(-1)).toBeGreaterThan(24000);
    expect(sampled).toHaveLength(1200);
  });
});
