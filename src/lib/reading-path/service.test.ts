import { describe, expect, it } from "vitest";

import {
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
