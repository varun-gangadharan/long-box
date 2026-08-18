import { describe, expect, it } from "vitest";

import { selectCharacterMatch } from "./ingest-character";
import type { ComicVineCharacter } from "@/lib/comicvine/types";

function character(
  comicvineId: number,
  name: string,
  aliases: string[],
  issueAppearanceCount: number | null,
): ComicVineCharacter {
  return {
    comicvineId,
    name,
    description: null,
    imageUrl: null,
    publisher: null,
    issueCredits: [],
    aliases,
    issueAppearanceCount,
  };
}

// The real ComicVine results for "Nightwing": the character actually named
// Nightwing has one appearance, while the one people mean is filed under his
// civilian name with Nightwing as an alias.
const nightwingSearch = [
  character(191414, "Nightwing", [], 1),
  character(146057, "Nightwing ", [], 21),
  character(
    1807,
    "Superman",
    ["Kal-El", "Clark Kent", "Clark Jerome Kent", "Clark Joseph Kent", "Gangbuster", "Nightwing"],
    19865,
  ),
  character(1691, "Dick Grayson", ["Robin", "Nightwing", "Batman"], 10221),
  character(1699, "Batman", ["Bruce Wayne", "The Dark Knight"], 26000),
  character(5368, "Barbara Gordon", ["Amy Beddoes", "Batgirl", "Oracle", "Babs", "Nightwing"], 4644),
];

describe("selectCharacterMatch", () => {
  it("prefers the character the name actually belongs to", () => {
    // Not the one literally named Nightwing (1 appearance), and not Superman,
    // who outnumbers Dick Grayson but carries "Nightwing" as a sixth alias.
    expect(selectCharacterMatch(nightwingSearch, "Nightwing")?.comicvineId).toBe(1691);
  });

  it("does not let a bigger character steal a name that is peripheral to it", () => {
    const superman = nightwingSearch.find((c) => c.comicvineId === 1807)!;
    const dickGrayson = nightwingSearch.find((c) => c.comicvineId === 1691)!;
    expect(superman.issueAppearanceCount).toBeGreaterThan(dickGrayson.issueAppearanceCount!);
    expect(selectCharacterMatch([superman, dickGrayson], "Nightwing")?.comicvineId).toBe(1691);
  });

  it("gives a character its own name over anyone who lists it as an alias", () => {
    // Dick Grayson has worn the cowl, so "Batman" is one of his aliases — but
    // the name belongs to Bruce Wayne.
    expect(selectCharacterMatch(nightwingSearch, "Batman")?.comicvineId).toBe(1699);
  });

  it("matches on aliases, not only on the published name", () => {
    expect(selectCharacterMatch(nightwingSearch, "Dick Grayson")?.comicvineId).toBe(1691);
    expect(selectCharacterMatch(nightwingSearch, "Oracle")?.comicvineId).toBe(5368);
  });

  it("ignores characters that match neither name nor alias", () => {
    expect(selectCharacterMatch(nightwingSearch, "Superman")?.comicvineId).toBe(1807);
    expect(selectCharacterMatch(nightwingSearch, "Aquaman")).toBeNull();
  });

  it("is punctuation- and case-insensitive", () => {
    const results = [character(2389, "Starfire", ["Princess Koriand'r", "Kory Anders"], 2345)];
    expect(selectCharacterMatch(results, "starfire")?.comicvineId).toBe(2389);
    expect(selectCharacterMatch(results, "kory anders")?.comicvineId).toBe(2389);
    expect(selectCharacterMatch(results, "Princess Koriandr")?.comicvineId).toBe(2389);
  });

  it("still returns a match when appearance counts are unknown", () => {
    const results = [character(1, "Nightwing", [], null)];
    expect(selectCharacterMatch(results, "Nightwing")?.comicvineId).toBe(1);
  });

  it("returns null when nothing matches", () => {
    expect(selectCharacterMatch([], "Nightwing")).toBeNull();
  });
});
