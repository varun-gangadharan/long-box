import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  AmbiguousCharacterError,
  CharacterNotFoundError,
  resolveCharacters,
} from "./repository";

const baseRow = {
  requested_name: "Daredevil",
  id: "40000000-0000-4000-8000-000000000001",
  comicvine_id: 1,
  name: "Daredevil",
  description: null,
  image_url: null,
  publisher_name: "Marvel",
  details_loaded_at: "2026-08-17T00:00:00Z",
};

function databaseReturning(data: unknown): SupabaseClient {
  return {
    rpc: vi.fn().mockResolvedValue({ data, error: null }),
  } as unknown as SupabaseClient;
}

describe("character resolution", () => {
  it("resolves a canonical character", async () => {
    await expect(resolveCharacters(databaseReturning([baseRow]), ["Daredevil"])).resolves.toEqual([
      expect.objectContaining({ name: "Daredevil", comicvineId: 1 }),
    ]);
  });

  it("prefers the one fully ingested record among same-name stubs", async () => {
    const stub = {
      ...baseRow,
      id: "40000000-0000-4000-8000-000000000002",
      comicvine_id: 2,
      details_loaded_at: null,
    };
    const [resolved] = await resolveCharacters(
      databaseReturning([stub, baseRow]),
      ["Daredevil"],
    );
    expect(resolved.comicvineId).toBe(1);
  });

  it("rejects unresolved names", async () => {
    await expect(resolveCharacters(databaseReturning([]), ["Unknown"])).rejects.toBeInstanceOf(
      CharacterNotFoundError,
    );
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
