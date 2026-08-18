import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  AmbiguousCharacterError,
  AmbiguousStoryArcError,
  CharacterNotFoundError,
  resolveCharacters,
  resolveStoryArc,
  StoryArcNotFoundError,
} from "./repository";

const baseRow = {
  requested_name: "Daredevil",
  id: "40000000-0000-4000-8000-000000000001",
  comicvine_id: 1,
  name: "Daredevil",
  description: null,
  image_url: null,
  publisher_name: "Marvel",
  is_canonical: true,
  issue_appearance_count: 500,
  matched_alias: false,
  alias_position: null,
};
const storyArcRow = {
  requested_name: "Civil War",
  id: "40000000-0000-4000-8000-000000000010",
  comicvine_id: 10,
  name: "Civil War",
  description: null,
};

function databaseReturning(data: unknown): SupabaseClient {
  return {
    rpc: vi.fn().mockResolvedValue({ data, error: null }),
  } as unknown as SupabaseClient;
}

describe("character resolution", () => {
  it("resolves a canonical character", async () => {
    await expect(
      resolveCharacters(databaseReturning([baseRow]), ["Daredevil"]),
    ).resolves.toEqual([
      expect.objectContaining({ name: "Daredevil", comicvineId: 1 }),
    ]);
  });

  it("uses the catalog-selected canonical record among same-name choices", async () => {
    const stub = {
      ...baseRow,
      id: "40000000-0000-4000-8000-000000000002",
      comicvine_id: 2,
      is_canonical: false,
      issue_appearance_count: 400,
      matched_alias: false,
      alias_position: null,
    };
    const [resolved] = await resolveCharacters(
      databaseReturning([stub, baseRow]),
      ["Daredevil"],
    );
    expect(resolved.comicvineId).toBe(1);
  });

  it("rejects unresolved names", async () => {
    await expect(
      resolveCharacters(databaseReturning([]), ["Unknown"]),
    ).rejects.toBeInstanceOf(CharacterNotFoundError);
  });

  it("returns ambiguity instead of selecting unrelated same-name records", async () => {
    const second = {
      ...baseRow,
      id: "40000000-0000-4000-8000-000000000002",
      comicvine_id: 2,
    };
    await expect(
      resolveCharacters(databaseReturning([baseRow, second]), ["Daredevil"]),
    ).rejects.toBeInstanceOf(AmbiguousCharacterError);
  });
});

describe("story arc resolution", () => {
  it("resolves one exact normalized match", async () => {
    await expect(
      resolveStoryArc(databaseReturning([storyArcRow]), "Civil War"),
    ).resolves.toEqual(expect.objectContaining({ name: "Civil War", comicvineId: 10 }));
  });

  it("rejects missing or ambiguous story arcs", async () => {
    await expect(
      resolveStoryArc(databaseReturning([]), "Unknown"),
    ).rejects.toBeInstanceOf(StoryArcNotFoundError);
    await expect(
      resolveStoryArc(
        databaseReturning([
          storyArcRow,
          {
            ...storyArcRow,
            id: "40000000-0000-4000-8000-000000000011",
            comicvine_id: 11,
          },
        ]),
        "Civil War",
      ),
    ).rejects.toBeInstanceOf(AmbiguousStoryArcError);
  });
});

describe("character identity precedence", () => {
  it("prefers the character named by the request over one who lists it as an alias", async () => {
    const database = {
      rpc: async () => ({
        data: [
          {
            requested_name: "Batman",
            id: "10000000-0000-4000-8000-000000000001",
            comicvine_id: 1691,
            name: "Dick Grayson",
            description: null,
            image_url: null,
            publisher_name: "DC Comics",
            is_canonical: true,
            issue_appearance_count: 10221,
            matched_alias: true,
            alias_position: 2,
          },
          {
            requested_name: "Batman",
            id: "10000000-0000-4000-8000-000000000002",
            comicvine_id: 1699,
            name: "Batman",
            description: null,
            image_url: null,
            publisher_name: "DC Comics",
            is_canonical: true,
            issue_appearance_count: 26000,
            matched_alias: false,
            alias_position: null,
          },
        ],
        error: null,
      }),
    } as unknown as Parameters<typeof resolveCharacters>[0];

    const [resolved] = await resolveCharacters(database, ["Batman"]);
    expect(resolved.comicvineId).toBe(1699);
    expect(resolved.matchedAlias).toBe(false);
  });

  it("falls back to an alias match when nobody carries the name", async () => {
    const database = {
      rpc: async () => ({
        data: [
          {
            requested_name: "Nightwing",
            id: "10000000-0000-4000-8000-000000000003",
            comicvine_id: 1691,
            name: "Dick Grayson",
            description: null,
            image_url: null,
            publisher_name: "DC Comics",
            is_canonical: true,
            issue_appearance_count: 10221,
            matched_alias: true,
            alias_position: 2,
          },
        ],
        error: null,
      }),
    } as unknown as Parameters<typeof resolveCharacters>[0];

    const [resolved] = await resolveCharacters(database, ["Nightwing"]);
    expect(resolved.comicvineId).toBe(1691);
    expect(resolved.matchedAlias).toBe(true);
  });
});
