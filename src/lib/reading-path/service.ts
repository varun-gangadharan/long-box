import type { SupabaseClient } from "@supabase/supabase-js";

import { comicVineClientFromEnv, type ComicVineClient } from "@/lib/comicvine/client";
import { ingestCharacter } from "@/lib/ingestion/ingest-character";

import { generateCandidates, rankCandidates } from "./engine";
import {
  findCandidateIssues,
  findStoryArcCandidateIssues,
  AmbiguousCharacterError,
  CharacterNotFoundError,
  normalizeEntityName,
  resolveCharacters,
  resolveStoryArc,
} from "./repository";
import type { ReadingPathResult } from "./types";

const MAX_RECOMMENDATIONS = 12;
const ON_DEMAND_ISSUES = 25;

export type ReadingPathQuery =
  | { type: "characters"; names: string[] }
  | { type: "story_arc"; name: string };

export class InvalidReadingPathQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidReadingPathQueryError";
  }
}

export function parseReadingPathQuery(searchParams: URLSearchParams): ReadingPathQuery {
  const characters = searchParams.get("characters");
  const storyArc = searchParams.get("storyArc");
  if (Boolean(characters?.trim()) === Boolean(storyArc?.trim())) {
    throw new InvalidReadingPathQueryError(
      "Provide exactly one of characters or storyArc.",
    );
  }
  return characters
    ? { type: "characters", names: parseCharacterQuery(characters) }
    : { type: "story_arc", name: parseStoryArcQuery(storyArc) };
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

export function parseStoryArcQuery(value: string | null): string {
  const name = value?.trim();
  if (!name) throw new InvalidReadingPathQueryError("Story arc name cannot be empty.");
  if (name.length > 80) {
    throw new InvalidReadingPathQueryError("Story arc name must be 80 characters or fewer.");
  }
  if (!normalizeEntityName(name)) {
    throw new InvalidReadingPathQueryError("Story arc name must contain letters or numbers.");
  }
  return name;
}

export async function buildReadingPath(
  database: SupabaseClient,
  query: ReadingPathQuery,
  comicVine: ComicVineClient | (() => ComicVineClient) = comicVineClientFromEnv,
): Promise<ReadingPathResult> {
  if (query.type === "story_arc") {
    const storyArc = await resolveStoryArc(database, query.name);
    const issues = await findStoryArcCandidateIssues(database, storyArc.id);
    return {
      query: { characters: [], storyArc },
      recommendations: rankCandidates(
        generateCandidates(issues, "story_arc", storyArc.id),
      ).slice(0, MAX_RECOMMENDATIONS),
    };
  }

  const characters = await resolveCharactersWithIngestion(database, query.names, comicVine);
  const issues = await findCandidateIssues(
    database,
    characters.map(({ id }) => id),
  );
  return {
    query: { characters, storyArc: null },
    recommendations: rankCandidates(generateCandidates(issues)).slice(
      0,
      MAX_RECOMMENDATIONS,
    ),
  };
}

async function resolveCharactersWithIngestion(
  database: SupabaseClient,
  names: string[],
  comicVine: ComicVineClient | (() => ComicVineClient),
) {
  let resolved;
  try {
    resolved = await resolveCharacters(database, names);
    if (resolved.every(({ isCanonical }) => isCanonical)) return resolved;
  } catch (error) {
    if (error instanceof AmbiguousCharacterError) {
      if (error.matches.some(({ isCanonical }) => isCanonical)) throw error;
    } else if (!(error instanceof CharacterNotFoundError)) {
      throw error;
    }
  }

  const client = typeof comicVine === "function" ? comicVine() : comicVine;
  for (const name of names) {
    try {
      await ingestCharacter(database, client, name, ON_DEMAND_ISSUES);
    } catch {
      throw new CharacterNotFoundError(name);
    }
  }
  return resolveCharacters(database, names);
}
