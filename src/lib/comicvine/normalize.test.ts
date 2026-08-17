import { describe, expect, it } from "vitest";

import { normalizeCharacter, normalizeIssue, normalizeVolume } from "./normalize";
import { rawCharacterSchema, rawIssueSchema, rawVolumeSchema } from "./schemas";

describe("ComicVine normalization", () => {
  it("normalizes nullable character metadata", () => {
    const raw = rawCharacterSchema.parse({
      id: 1,
      name: " Daredevil ",
      deck: "  The Man Without Fear  ",
      description: null,
      image: { original_url: "https://example.com/daredevil.jpg" },
      publisher: { id: 31, name: "Marvel" },
    });

    expect(normalizeCharacter(raw)).toEqual({
      comicvineId: 1,
      name: "Daredevil",
      description: "The Man Without Fear",
      imageUrl: "https://example.com/daredevil.jpg",
      publisher: { comicvineId: 31, name: "Marvel" },
      issueCredits: [],
    });
  });

  it("normalizes issue relationships", () => {
    const raw = rawIssueSchema.parse({
      id: 10,
      volume: { id: 20, name: "Daredevil" },
      issue_number: 16,
      name: null,
      cover_date: "2016-06-01",
      character_credits: [
        { id: 1, name: "Daredevil" },
        { id: 2, name: "Spider-Man" },
      ],
      story_arc_credits: [{ id: 30, name: "The Dark Art" }],
    });

    expect(normalizeIssue(raw)).toMatchObject({
      comicvineId: 10,
      issueNumber: "16",
      volume: { comicvineId: 20, name: "Daredevil" },
      characters: [
        { comicvineId: 1, name: "Daredevil" },
        { comicvineId: 2, name: "Spider-Man" },
      ],
      storyArcs: [{ comicvineId: 30, name: "The Dark Art" }],
    });
  });

  it("rejects invalid years rather than persisting them", () => {
    const raw = rawVolumeSchema.parse({ id: 20, name: "Daredevil", start_year: "unknown" });
    expect(normalizeVolume(raw).startYear).toBeNull();
  });
});
