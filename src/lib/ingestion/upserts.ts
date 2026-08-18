import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ComicVineCharacter,
  ComicVineCredit,
  ComicVineIssue,
  ComicVineIssueSummary,
  ComicVineStoryArc,
  ComicVineVolume,
} from "@/lib/comicvine/types";

/**
 * Idempotent writes shared by every ingestion path. Everything here keys on
 * ComicVine IDs and uses conflict-aware upserts, so a repeated run updates rows
 * rather than duplicating them.
 */

export type DatabaseId = { id: string; comicvine_id: number };

export function dedupeByComicVineId<T extends { comicvineId: number }>(values: T[]): T[] {
  return [...new Map(values.map((value) => [value.comicvineId, value])).values()];
}

export function idMap(rows: DatabaseId[]): Map<number, string> {
  return new Map(rows.map(({ comicvine_id, id }) => [Number(comicvine_id), id]));
}

export async function upsertPublishers(
  database: SupabaseClient,
  values: Array<ComicVineCharacter["publisher"] | ComicVineVolume["publisher"]>,
): Promise<Map<number, string>> {
  const publishers = dedupeByComicVineId(values.filter((value) => value !== null));
  if (!publishers.length) return new Map();

  const { data, error } = await database
    .from("publishers")
    .upsert(
      publishers.map(({ comicvineId, name }) => ({ comicvine_id: comicvineId, name })),
      { onConflict: "comicvine_id" },
    )
    .select("id,comicvine_id");
  if (error) throw new Error(`Publisher upsert failed: ${error.message}`);
  return idMap(data as DatabaseId[]);
}

/** The character the user actually asked about, with full details. */
export async function upsertCanonicalCharacter(
  database: SupabaseClient,
  character: ComicVineCharacter,
  publisherIds: Map<number, string>,
): Promise<void> {
  const { error } = await database.from("characters").upsert(
    {
      comicvine_id: character.comicvineId,
      name: character.name,
      description: character.description,
      image_url: character.imageUrl,
      aliases: character.aliases,
      issue_appearance_count: character.issueAppearanceCount,
      publisher_id: character.publisher
        ? publisherIds.get(character.publisher.comicvineId)
        : null,
      details_loaded_at: new Date().toISOString(),
    },
    { onConflict: "comicvine_id" },
  );
  if (error) throw new Error(`Character upsert failed: ${error.message}`);

  // Claiming the name is a separate, atomic step: only one row may be canonical
  // for a normalized name, and the claim may currently be held by a stub.
  const { error: promoteError } = await database.rpc("promote_canonical_character", {
    p_comicvine_id: character.comicvineId,
  });
  if (promoteError) {
    throw new Error(`Character promotion failed: ${promoteError.message}`);
  }
}

/**
 * Name-only rows for everyone else credited, so relationships have something to
 * point at. These stay non-canonical until their own details are fetched.
 */
export async function upsertCharacterStubs(
  database: SupabaseClient,
  credits: ComicVineCredit[],
): Promise<Map<number, string>> {
  const unique = dedupeByComicVineId(credits);
  if (!unique.length) return new Map();

  const ids = new Map<number, string>();

  // A long-running title's cast runs to thousands of names, and PostgREST sends
  // both the rows and the `in` filter in the URL — unchunked, the request is
  // rejected outright as a bad request.
  for (const batch of chunk(unique, CHARACTER_BATCH_SIZE)) {
    const { error } = await database.from("characters").upsert(
      batch.map(({ comicvineId, name }) => ({ comicvine_id: comicvineId, name })),
      { onConflict: "comicvine_id" },
    );
    if (error) throw new Error(`Character credit upsert failed: ${error.message}`);

    const { data, error: lookupError } = await database
      .from("characters")
      .select("id,comicvine_id")
      .in("comicvine_id", batch.map(({ comicvineId }) => comicvineId));
    if (lookupError) throw new Error(`Character ID lookup failed: ${lookupError.message}`);
    for (const [comicvineId, id] of idMap(data as DatabaseId[])) ids.set(comicvineId, id);
  }

  return ids;
}

/** Keeps PostgREST URLs and payloads inside their limits. */
const CHARACTER_BATCH_SIZE = 200;

export function chunk<T>(values: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    batches.push(values.slice(start, start + size));
  }
  return batches;
}

export async function upsertVolumes(
  database: SupabaseClient,
  volumes: ComicVineVolume[],
  publisherIds: Map<number, string>,
): Promise<Map<number, string>> {
  if (!volumes.length) return new Map();
  const { data, error } = await database
    .from("volumes")
    .upsert(
      volumes.map((volume) => ({
        comicvine_id: volume.comicvineId,
        name: volume.name,
        start_year: volume.startYear,
        issue_count: volume.issueCount,
        publisher_id: volume.publisher
          ? publisherIds.get(volume.publisher.comicvineId)
          : null,
      })),
      { onConflict: "comicvine_id" },
    )
    .select("id,comicvine_id");
  if (error) throw new Error(`Volume upsert failed: ${error.message}`);
  return idMap(data as DatabaseId[]);
}

export async function upsertIssues(
  database: SupabaseClient,
  issues: Array<ComicVineIssue | ComicVineIssueSummary>,
  volumeIds: Map<number, string>,
): Promise<Map<number, string>> {
  if (!issues.length) return new Map();
  const rows = issues.map((issue) => {
    const volumeId = volumeIds.get(issue.volume.comicvineId);
    if (!volumeId) throw new Error(`Missing volume ${issue.volume.comicvineId}`);
    return {
      comicvine_id: issue.comicvineId,
      volume_id: volumeId,
      issue_number: issue.issueNumber,
      name: issue.name,
      cover_date: issue.coverDate,
      description: issue.description,
      image_url: issue.imageUrl,
    };
  });
  const ids = new Map<number, string>();
  for (const batch of chunk(rows, CHARACTER_BATCH_SIZE)) {
    const { data, error } = await database
      .from("issues")
      .upsert(batch, { onConflict: "comicvine_id" })
      .select("id,comicvine_id");
    if (error) throw new Error(`Issue upsert failed: ${error.message}`);
    for (const [comicvineId, id] of idMap(data as DatabaseId[])) ids.set(comicvineId, id);
  }
  return ids;
}

export async function upsertStoryArcs(
  database: SupabaseClient,
  arcs: ComicVineStoryArc[],
): Promise<Map<number, string>> {
  if (!arcs.length) return new Map();
  const { data, error } = await database
    .from("story_arcs")
    .upsert(
      arcs.map(({ comicvineId, name, description }) => ({
        comicvine_id: comicvineId,
        name,
        description,
      })),
      { onConflict: "comicvine_id" },
    )
    .select("id,comicvine_id");
  if (error) throw new Error(`Story arc upsert failed: ${error.message}`);
  return idMap(data as DatabaseId[]);
}

export async function upsertCreators(
  database: SupabaseClient,
  credits: ComicVineCredit[],
): Promise<Map<number, string>> {
  const unique = dedupeByComicVineId(credits);
  if (!unique.length) return new Map();

  const { data, error } = await database
    .from("creators")
    .upsert(
      unique.map(({ comicvineId, name }) => ({ comicvine_id: comicvineId, name })),
      { onConflict: "comicvine_id" },
    )
    .select("id,comicvine_id");
  if (error) throw new Error(`Creator upsert failed: ${error.message}`);
  return idMap(data as DatabaseId[]);
}

export async function upsertRelationships(
  database: SupabaseClient,
  issues: ComicVineIssue[],
  issueIds: Map<number, string>,
  characterIds: Map<number, string>,
  storyArcIds: Map<number, string>,
): Promise<number> {
  const ingestedIssueIds = issues
    .map((issue) => issueIds.get(issue.comicvineId))
    .filter((id): id is string => Boolean(id));
  if (!ingestedIssueIds.length) return 0;

  const characterRows = issues.flatMap((issue) =>
    issue.characters.flatMap((character) => {
      const issueId = issueIds.get(issue.comicvineId);
      const characterId = characterIds.get(character.comicvineId);
      return issueId && characterId ? [{ issue_id: issueId, character_id: characterId }] : [];
    }),
  );
  const storyArcRows = issues.flatMap((issue) =>
    issue.storyArcs.flatMap((storyArc) => {
      const issueId = issueIds.get(issue.comicvineId);
      const storyArcId = storyArcIds.get(storyArc.comicvineId);
      return issueId && storyArcId ? [{ issue_id: issueId, story_arc_id: storyArcId }] : [];
    }),
  );

  const { error } = await database.rpc("replace_issue_relationships", {
    p_issue_ids: ingestedIssueIds,
    p_character_links: characterRows,
    p_story_arc_links: storyArcRows,
  });
  if (error) throw new Error(`Issue relationship replacement failed: ${error.message}`);

  return characterRows.length + storyArcRows.length;
}

export async function upsertCreatorLinks(
  database: SupabaseClient,
  issues: ComicVineIssue[],
  issueIds: Map<number, string>,
  creatorIds: Map<number, string>,
): Promise<number> {
  const ingestedIssueIds = issues
    .map((issue) => issueIds.get(issue.comicvineId))
    .filter((id): id is string => Boolean(id));
  if (!ingestedIssueIds.length) return 0;

  const rows = issues.flatMap((issue) =>
    issue.creators.flatMap((credit) => {
      const issueId = issueIds.get(issue.comicvineId);
      const creatorId = creatorIds.get(credit.comicvineId);
      return issueId && creatorId
        ? [{ issue_id: issueId, creator_id: creatorId, role: credit.role }]
        : [];
    }),
  );

  const { error } = await database.rpc("replace_issue_creators", {
    p_issue_ids: ingestedIssueIds,
    p_creator_links: rows,
  });
  if (error) throw new Error(`Issue creator replacement failed: ${error.message}`);
  return rows.length;
}

/**
 * Caches a character's whole appearance list. One ComicVine request fills this
 * however many thousands of issues it covers, and it is what makes a complete
 * co-appearance intersection possible without fetching every issue.
 */
export async function replaceCharacterIssueCredits(
  database: SupabaseClient,
  characterId: string,
  comicvineIssueIds: number[],
): Promise<void> {
  const { error } = await database.rpc("replace_character_issue_credits", {
    p_character_id: characterId,
    p_comicvine_issue_ids: [...new Set(comicvineIssueIds)],
  });
  if (error) throw new Error(`Character credit index replacement failed: ${error.message}`);
}

export async function replaceVolumeCharacters(
  database: SupabaseClient,
  volumeId: string,
  counts: Array<{ characterId: string; appearances: number }>,
): Promise<void> {
  const { error } = await database.rpc("replace_volume_characters", {
    p_volume_id: volumeId,
    p_character_counts: counts.map(({ characterId, appearances }) => ({
      character_id: characterId,
      appearance_count: appearances,
    })),
  });
  if (error) throw new Error(`Volume character replacement failed: ${error.message}`);
}
