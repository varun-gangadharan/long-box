import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  AmbiguousCharacterError,
  CharacterNotFoundError,
} from "@/lib/reading-path/repository";

import { handleReadingPathRequest } from "./route";

const database = {} as SupabaseClient;
const character = {
  id: "50000000-0000-4000-8000-000000000001",
  comicvineId: 1,
  name: "Daredevil",
  description: null,
  imageUrl: null,
  publisherName: "Marvel",
};

describe("GET /api/reading-path", () => {
  it("returns a reading path for a valid query", async () => {
    const build = vi.fn().mockResolvedValue({
      query: { characters: [character] },
      recommendations: [],
    });

    const response = await handleReadingPathRequest(
      new Request("http://localhost/api/reading-path?characters=Daredevil"),
      database,
      build,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      query: { characters: [character] },
      recommendations: [],
    });
    expect(build).toHaveBeenCalledWith(database, ["Daredevil"]);
  });

  it("returns 400 for an invalid or duplicate query", async () => {
    const build = vi.fn();
    const response = await handleReadingPathRequest(
      new Request(
        "http://localhost/api/reading-path?characters=Spider-Man%2Cspider%20man",
      ),
      database,
      build,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_query" } });
    expect(build).not.toHaveBeenCalled();
  });

  it("keeps configuration failures inside the API error contract", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await handleReadingPathRequest(
      new Request("http://localhost/api/reading-path?characters=Daredevil"),
      () => {
        throw new Error("missing environment");
      },
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: "internal_error",
        message: "The reading path could not be generated.",
      },
    });
    consoleError.mockRestore();
  });

  it("returns 404 when a character is not found", async () => {
    const build = vi.fn().mockRejectedValue(new CharacterNotFoundError("Unknown"));
    const response = await handleReadingPathRequest(
      new Request("http://localhost/api/reading-path?characters=Unknown"),
      database,
      build,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "character_not_found", details: { requestedName: "Unknown" } },
    });
  });

  it("returns 409 with choices for an ambiguous character", async () => {
    const build = vi
      .fn()
      .mockRejectedValue(
        new AmbiguousCharacterError("Daredevil", [
          character,
          { ...character, comicvineId: 2 },
        ]),
      );
    const response = await handleReadingPathRequest(
      new Request("http://localhost/api/reading-path?characters=Daredevil"),
      database,
      build,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: {
        code: "ambiguous_character",
        details: { requestedName: "Daredevil", matches: expect.any(Array) },
      },
    });
  });
});
