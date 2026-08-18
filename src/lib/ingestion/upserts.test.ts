import { describe, expect, it } from "vitest";

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
