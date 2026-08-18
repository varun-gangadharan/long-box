import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { bestClaim } from "@/lib/characters/identity";

export { normalizeEntityName } from "./names";

import type {
  CandidateIssue,
  ResolvedCharacter,
  ResolvedStoryArc,
  VolumeAffinity,
} from "./types";

const resolvedRowSchema = z.object({
  requested_name: z.string(),
  id: z.string().uuid(),
  comicvine_id: z.coerce.number().int().positive(),
  name: z.string(),
  description: z.string().nullable(),
  image_url: z.string().nullable(),
  publisher_name: z.string().nullable(),
  is_canonical: z.boolean(),
  issue_appearance_count: z.number().int().nullable(),
  matched_alias: z.boolean(),
  alias_position: z.number().int().nullable(),
  has_details: z.boolean(),
});

const storyArcRowSchema = z.object({
  requested_name: z.string(),
  id: z.string().uuid(),
  comicvine_id: z.coerce.number().int().positive(),
  name: z.string(),
  description: z.string().nullable(),
});

const candidateRowSchema = z.object({
  issue_id: z.string().uuid(),
  comicvine_id: z.coerce.number().int().positive(),
  issue_number: z.string(),
  issue_name: z.string().nullable(),
  cover_date: z.string().nullable(),
  image_url: z.string().nullable(),
  volume_id: z.string().uuid(),
  volume_name: z.string(),
  volume_start_year: z.number().int().nullable(),
  volume_issue_count: z.number().int().nullable(),
  character_count: z.number().int().nonnegative(),
  requested_character_count: z.number().int().nonnegative(),
  story_arcs: z.array(
    z.object({
      id: z.string().uuid(),
      comicvineId: z.coerce.number().int().positive(),
      name: z.string(),
    }),
  ),
  creators: z.array(z.object({ name: z.string(), role: z.string() })),
});

const volumeAffinityRowSchema = z.object({
  volume_id: z.string().uuid(),
  volume_name: z.string(),
  volume_start_year: z.number().int().nullable(),
  volume_issue_count: z.number().int().nullable(),
  volume_publisher_name: z.string().nullable(),
  local_issue_count: z.number().int().nonnegative(),
  co_issue_count: z.number().int().nonnegative(),
  min_character_appearances: z.number().int().nullable(),
  longest_co_streak: z.number().int().nonnegative(),
  first_co_issue_number: z.string(),
  last_co_issue_number: z.string(),
  first_co_date: z.string().nullable(),
  last_co_date: z.string().nullable(),
  top_writer: z.string().nullable(),
  top_artist: z.string().nullable(),
});

export class CharacterNotFoundError extends Error {
  constructor(readonly requestedName: string) {
    super(`Character not found: ${requestedName}`);
    this.name = "CharacterNotFoundError";
  }
}

export class AmbiguousCharacterError extends Error {
  constructor(
    readonly requestedName: string,
    readonly matches: ResolvedCharacter[],
  ) {
    super(`Character name is ambiguous: ${requestedName}`);
    this.name = "AmbiguousCharacterError";
  }
}

export class StoryArcNotFoundError extends Error {
  constructor(readonly requestedName: string) {
    super(`Story arc not found: ${requestedName}`);
    this.name = "StoryArcNotFoundError";
  }
}

export class AmbiguousStoryArcError extends Error {
  constructor(
    readonly requestedName: string,
    readonly matches: ResolvedStoryArc[],
  ) {
    super(`Story arc name is ambiguous: ${requestedName}`);
    this.name = "AmbiguousStoryArcError";
  }
}


export async function resolveCharacters(
  database: SupabaseClient,
  requestedNames: string[],
): Promise<ResolvedCharacter[]> {
  const { data, error } = await database.rpc("resolve_character_names", {
    requested_names: requestedNames,
  });
  if (error) throw new Error(`Character resolution failed: ${error.message}`);
  const rows = z.array(resolvedRowSchema).parse(data ?? []);

  return requestedNames.map((requestedName) => {
    const matches = rows.filter((row) => row.requested_name === requestedName);
    if (!matches.length) throw new CharacterNotFoundError(requestedName);

    const selected = preferredMatch(matches);
    if (!selected) {
      throw new AmbiguousCharacterError(requestedName, matches.map(toResolvedCharacter));
    }
    return toResolvedCharacter(selected);
  });
}

export async function resolveStoryArc(
  database: SupabaseClient,
  requestedName: string,
): Promise<ResolvedStoryArc> {
  const { data, error } = await database.rpc("resolve_story_arc_names", {
    requested_names: [requestedName],
  });
  if (error) throw new Error(`Story arc resolution failed: ${error.message}`);
  const rows = z.array(storyArcRowSchema).parse(data ?? []);
  if (!rows.length) throw new StoryArcNotFoundError(requestedName);
  if (rows.length > 1) {
    throw new AmbiguousStoryArcError(requestedName, rows.map(toResolvedStoryArc));
  }
  return toResolvedStoryArc(rows[0]);
}

export async function findCandidateIssues(
  database: SupabaseClient,
  characterIds: string[],
): Promise<CandidateIssue[]> {
  const { data, error } = await database.rpc("reading_path_issue_candidates", {
    requested_character_ids: characterIds,
  });
  if (error) throw new Error(`Candidate lookup failed: ${error.message}`);
  return mapCandidateRows(data);
}

export async function findStoryArcCandidateIssues(
  database: SupabaseClient,
  storyArcId: string,
): Promise<CandidateIssue[]> {
  const { data, error } = await database.rpc("reading_path_story_arc_issues", {
    requested_story_arc_id: storyArcId,
  });
  if (error) throw new Error(`Story arc candidate lookup failed: ${error.message}`);
  return mapCandidateRows(data);
}

function mapCandidateRows(data: unknown): CandidateIssue[] {
  return z.array(candidateRowSchema).parse(data ?? []).map((row) => ({
    id: row.issue_id,
    comicvineId: row.comicvine_id,
    issueNumber: row.issue_number,
    name: row.issue_name,
    coverDate: row.cover_date,
    imageUrl: row.image_url,
    volume: {
      id: row.volume_id,
      name: row.volume_name,
      startYear: row.volume_start_year,
      issueCount: row.volume_issue_count,
    },
    characterCount: row.character_count,
    requestedCharacterCount: row.requested_character_count,
    storyArcs: row.story_arcs,
    creators: row.creators,
  }));
}

/**
 * Chooses between characters who answer to the same name.
 *
 * Canonical status comes first: a row the catalog has already rejected as the
 * owner of a name must not win it back. Within that pool the shared identity
 * scoring decides, so a lookup agrees with what ingestion chose.
 */
function preferredMatch(
  matches: Array<z.infer<typeof resolvedRowSchema>>,
): z.infer<typeof resolvedRowSchema> | null {
  if (matches.length === 1) return matches[0];

  const canonical = matches.filter((row) => row.is_canonical);
  const pool = canonical.length ? canonical : matches;
  if (pool.length === 1) return pool[0];

  return bestClaim(pool, (row) => ({
    isNameMatch: !row.matched_alias,
    // SQL reports a 1-based position; the scorer expects 0-based.
    aliasPosition: row.alias_position === null ? null : row.alias_position - 1,
    appearanceCount: row.issue_appearance_count,
  }));
}

/**
 * Per-volume co-appearance profile for the requested characters. This is the
 * evidence the engine needs to tell co-starring apart from co-occurrence, and
 * it is fetched alongside the candidate issues rather than derived from them.
 */
export async function findVolumeAffinities(
  database: SupabaseClient,
  characterIds: string[],
): Promise<VolumeAffinity[]> {
  const { data, error } = await database.rpc("volume_pair_affinity", {
    requested_character_ids: characterIds,
  });
  if (error) throw new Error(`Volume affinity lookup failed: ${error.message}`);
  return z.array(volumeAffinityRowSchema).parse(data ?? []).map((row) => ({
    volumeId: row.volume_id,
    volumeName: row.volume_name,
    volumeStartYear: row.volume_start_year,
    volumeIssueCount: row.volume_issue_count,
    publisherName: row.volume_publisher_name,
    localIssueCount: row.local_issue_count,
    coIssueCount: row.co_issue_count,
    minCharacterAppearances: row.min_character_appearances,
    longestCoStreak: row.longest_co_streak,
    firstCoIssueNumber: row.first_co_issue_number,
    lastCoIssueNumber: row.last_co_issue_number,
    firstCoDate: row.first_co_date,
    lastCoDate: row.last_co_date,
    topWriter: row.top_writer,
    topArtist: row.top_artist,
  }));
}

function toResolvedStoryArc(row: z.infer<typeof storyArcRowSchema>): ResolvedStoryArc {
  return {
    id: row.id,
    comicvineId: row.comicvine_id,
    name: row.name,
    description: null,
  };
}

function toResolvedCharacter(row: z.infer<typeof resolvedRowSchema>): ResolvedCharacter {
  return {
    id: row.id,
    comicvineId: row.comicvine_id,
    name: row.name,
    description: null,
    imageUrl: row.image_url,
    publisherName: row.publisher_name,
    isCanonical: row.is_canonical,
    matchedAlias: row.matched_alias,
    issueAppearanceCount: row.issue_appearance_count,
    hasDetails: row.has_details,
  };
}
