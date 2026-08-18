import type { ComicVineClient } from "@/lib/comicvine/client";
import { describe, expect, it } from "vitest";

import {
  buildReadingPath,
  InvalidReadingPathQueryError,
  parseCharacterQuery,
  parseReadingPathQuery,
  parseStoryArcQuery,
} from "./service";

describe("reading-path query parsing", () => {
  it("requires exactly one query type", () => {
    expect(() => parseReadingPathQuery(new URLSearchParams())).toThrow(/exactly one/i);
    expect(() =>
      parseReadingPathQuery(
        new URLSearchParams({ characters: "Daredevil", storyArc: "Born Again" }),
      ),
    ).toThrow(/exactly one/i);
  });

  it("parses a story arc query", () => {
    expect(parseReadingPathQuery(new URLSearchParams({ storyArc: "Civil War" }))).toEqual({
      type: "story_arc",
      name: "Civil War",
    });
    expect(parseStoryArcQuery("  Civil War  ")).toBe("Civil War");
  });

  it("accepts one character and punctuation-preserving names", () => {
    expect(parseCharacterQuery("Spider-Man")).toEqual(["Spider-Man"]);
  });

  it("accepts comma or plus-separated character queries", () => {
    expect(parseCharacterQuery("Spider-Man, Daredevil")).toEqual([
      "Spider-Man",
      "Daredevil",
    ]);
    expect(parseCharacterQuery("Spider-Man + Daredevil")).toEqual([
      "Spider-Man",
      "Daredevil",
    ]);
  });

  it.each([
    [null, /provide one to three/i],
    ["", /provide one to three/i],
    ["Spider-Man,,Daredevil", /cannot be empty/i],
    ["A,B,C,D", /at most three/i],
    ["---", /letters or numbers/i],
  ])("rejects invalid query %j", (query, message) => {
    expect(() => parseCharacterQuery(query)).toThrow(message);
  });

  it("rejects duplicate characters despite punctuation or case differences", () => {
    expect(() => parseCharacterQuery("Spider-Man, spider man")).toThrow(
      new InvalidReadingPathQueryError("Duplicate characters are not allowed."),
    );
  });
});

describe("character resolution fallback", () => {
  const dickGrayson = {
    requested_name: "Nightwing",
    id: "40000000-0000-4000-8000-000000000001",
    comicvine_id: 1691,
    name: "Dick Grayson",
    description: null,
    image_url: null,
    publisher_name: "DC Comics",
    is_canonical: true,
    issue_appearance_count: 10221,
    matched_alias: true,
    alias_position: 2,
    has_details: true,
  };

  function databaseReturning(rows: unknown[]) {
    return {
      rpc: async (name: string) =>
        name === "resolve_character_names"
          ? { data: rows, error: null }
          : { data: [], error: null },
      from: () => ({
        select: () => ({ in: async () => ({ data: [], error: null }) }),
        upsert: async () => ({ error: null }),
      }),
    } as unknown as Parameters<typeof buildReadingPath>[0];
  }

  it("keeps an alias match when ComicVine cannot be reached", async () => {
    // The alias match is a usable answer already in the catalog. Losing it
    // because an upstream lookup failed turned a working query into a 404.
    const failingComicVine = {
      searchCharacters: async () => {
        throw new Error("ComicVine request failed with HTTP 420");
      },
    } as unknown as ComicVineClient;

    const result = await buildReadingPath(
      databaseReturning([dickGrayson]),
      { type: "characters", names: ["Nightwing"] },
      failingComicVine,
    );

    expect(result.query.characters[0].name).toBe("Dick Grayson");
  });

  it("still reports a name that resolves to nothing at all", async () => {
    const failingComicVine = {
      searchCharacters: async () => {
        throw new Error("ComicVine request failed with HTTP 420");
      },
    } as unknown as ComicVineClient;

    await expect(
      buildReadingPath(
        databaseReturning([]),
        { type: "characters", names: ["Nobody"] },
        failingComicVine,
      ),
    ).rejects.toThrow(/not found/i);
  });
});
