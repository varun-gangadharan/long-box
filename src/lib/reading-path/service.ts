import type { SupabaseClient } from "@supabase/supabase-js";

import { generateCandidates, rankCandidates } from "./engine";
import {
  findCandidateIssues,
  normalizeEntityName,
  resolveCharacters,
} from "./repository";
import type { ReadingPathResult } from "./types";

export class InvalidReadingPathQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidReadingPathQueryError";
  }
}

export function parseCharacterQuery(value: string | null): string[] {
  if (!value?.trim()) {
    throw new InvalidReadingPathQueryError(
      "Provide one to three character names in the characters parameter.",
    );
  }

  const names = value.split(/\s*(?:,|\+)\s*/).map((name) => name.trim());
  if (names.some((name) => !name)) {
    throw new InvalidReadingPathQueryError("Character names cannot be empty.");
  }
  if (names.length > 3) {
    throw new InvalidReadingPathQueryError("A reading path supports at most three characters.");
  }
  if (names.some((name) => name.length > 80)) {
    throw new InvalidReadingPathQueryError("Character names must be 80 characters or fewer.");
  }

  const normalized = names.map(normalizeEntityName);
  if (normalized.some((name) => !name)) {
    throw new InvalidReadingPathQueryError("Character names must contain letters or numbers.");
  }
  if (new Set(normalized).size !== names.length) {
    throw new InvalidReadingPathQueryError("Duplicate characters are not allowed.");
  }

  return names;
}

export async function buildReadingPath(
  database: SupabaseClient,
  characterNames: string[],
): Promise<ReadingPathResult> {
  const characters = await resolveCharacters(database, characterNames);
  const issues = await findCandidateIssues(
    database,
    characters.map(({ id }) => id),
  );
  return {
    query: { characters },
    recommendations: rankCandidates(generateCandidates(issues)),
  };
}
