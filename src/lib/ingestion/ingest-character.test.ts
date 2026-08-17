import { describe, expect, it } from "vitest";

import { dedupeByComicVineId } from "./ingest-character";

describe("ingestion idempotency helpers", () => {
  it("keeps one latest value per ComicVine ID", () => {
    expect(
      dedupeByComicVineId([
        { comicvineId: 1, name: "old" },
        { comicvineId: 2, name: "other" },
        { comicvineId: 1, name: "updated" },
      ]),
    ).toEqual([
      { comicvineId: 1, name: "updated" },
      { comicvineId: 2, name: "other" },
    ]);
  });
});
