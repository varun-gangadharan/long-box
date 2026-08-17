import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type {
  CandidateIssue,
  ResolvedCharacter,
  ResolvedStoryArc,
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
  character_count: z.number().int().nonnegative(),
  requested_character_count: z.number().int().nonnegative(),
  story_arcs: z.array(
    z.object({
      id: z.string().uuid(),
      comicvineId: z.coerce.number().int().positive(),
      name: z.string(),
    }),
  ),
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

export function normalizeEntityName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
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

    const canonical = matches.filter((row) => row.is_canonical);
    const selected = matches.length === 1 ? matches[0] : canonical.length === 1 ? canonical[0] : null;
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
    },
    characterCount: row.character_count,
    requestedCharacterCount: row.requested_character_count,
    storyArcs: row.story_arcs,
  }));
}

function toResolvedStoryArc(row: z.infer<typeof storyArcRowSchema>): ResolvedStoryArc {
  return {
    id: row.id,
    comicvineId: row.comicvine_id,
    name: row.name,
    description: row.description,
  };
}

function toResolvedCharacter(row: z.infer<typeof resolvedRowSchema>): ResolvedCharacter {
  return {
    id: row.id,
    comicvineId: row.comicvine_id,
    name: row.name,
    description: row.description,
    imageUrl: row.image_url,
    publisherName: row.publisher_name,
  };
}
