import type { SupabaseClient } from "@supabase/supabase-js";

import { comicVineClientFromEnv, type ComicVineClient } from "@/lib/comicvine/client";
import { ingestCharacter } from "@/lib/ingestion/ingest-character";
import {
  ensureCreditIndex,
  ingestCoAppearances,
} from "@/lib/ingestion/ingest-co-appearances";
import { logError, logInfo } from "@/lib/observability/logger";

import { generateCandidates, rankCandidates } from "./engine";
import {
  findCandidateIssues,
  findStoryArcCandidateIssues,
  findVolumeAffinities,
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
        generateCandidates(issues, {
          queryType: "story_arc",
          requestedStoryArcId: storyArc.id,
        }),
      ).slice(0, MAX_RECOMMENDATIONS),
    };
  }

  const characters = await resolveCharactersWithIngestion(database, query.names, comicVine);
  const characterIds = characters.map(({ id }) => id);
  await loadCoAppearances(database, characterIds, comicVine);

  // The affinity profile is what lets the engine rank a book the characters
  // co-star in above one that merely credits them both once.
  const [issues, affinities] = await Promise.all([
    findCandidateIssues(database, characterIds),
    findVolumeAffinities(database, characterIds),
  ]);

  return {
    query: { characters, storyArc: null },
    recommendations: rankCandidates(generateCandidates(issues, { affinities }), {
      characterNames: characters.map(({ name }) => name),
      characterPublishers: characters.flatMap(({ publisherName }) =>
        publisherName ? [publisherName] : [],
      ),
    }).slice(0, MAX_RECOMMENDATIONS),
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
    // An alias-only match is not settled: the character who actually carries the
    // name may simply not be in the catalog yet. Searching ComicVine is what
    // stops "Batman" resolving to Dick Grayson because he once wore the cowl.
    if (resolved.every(isSettledIdentity)) return resolved;
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
      // An alias match already in the catalog is a usable answer, so a failed
      // lookup for a better one is not fatal.
      if (!resolved?.some((character) => matchesRequest(character, name))) {
        throw new CharacterNotFoundError(name);
      }
    }
  }
  return resolveCharacters(database, names);
}

/**
 * Whether a resolved character can be trusted without checking ComicVine.
 *
 * An alias-only match may be standing in for a character who is simply not in
 * the catalog yet, and a row with no appearance count was created as a credit
 * stub rather than looked up — an obscure "Superman" with a handful of credits
 * can hold the name against the real one.
 */
function isSettledIdentity(character: {
  isCanonical?: boolean;
  matchedAlias?: boolean;
  issueAppearanceCount?: number | null;
}): boolean {
  return Boolean(
    character.isCanonical &&
      !character.matchedAlias &&
      character.issueAppearanceCount !== null &&
      character.issueAppearanceCount !== undefined,
  );
}

function matchesRequest(character: { name: string }, requestedName: string): boolean {
  return normalizeEntityName(character.name) === normalizeEntityName(requestedName);
}

/**
 * Fills in what these characters actually share before ranking. Enrichment is
 * best-effort: if ComicVine is unavailable or rate-limited, the reading path is
 * still built from whatever is already stored rather than failing the request.
 */
async function loadCoAppearances(
  database: SupabaseClient,
  characterIds: string[],
  comicVine: ComicVineClient | (() => ComicVineClient),
): Promise<void> {
  if (characterIds.length < 2) return;

  try {
    const client = typeof comicVine === "function" ? comicVine() : comicVine;
    await ensureCreditIndex(database, client, characterIds);
    const result = await ingestCoAppearances(database, client, characterIds);
    if (!result.skipped) {
      logInfo("Co-appearance ingestion completed", { ...result });
    }
  } catch (error) {
    logError("Co-appearance ingestion failed", error, { characterCount: characterIds.length });
  }
}
