import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { ComicVineClient } from "@/lib/comicvine/client";
import type { ComicVineIssueSummary, ComicVineVolume } from "@/lib/comicvine/types";

import {
  dedupeByComicVineId,
  replaceCharacterIssueCredits,
  replaceVolumeCharacters,
  upsertCharacterStubs,
  upsertCreatorLinks,
  upsertCreators,
  upsertIssues,
  upsertPublishers,
  upsertRelationships,
  upsertStoryArcs,
  upsertVolumes,
} from "./upserts";

/**
 * Ingestion driven by what two characters actually share.
 *
 * The previous approach took whatever issues ComicVine listed first for each
 * character, capped at a couple of dozen, and intersected those arbitrary
 * samples. For characters with hundreds of appearances the overlap that survived
 * was an accident, which is why a well-known duo could return a book one of them
 * merely passes through.
 *
 * This pipeline inverts the order: work out the true set of shared issues first
 * from the cached credit index, then spend the request budget on that set and on
 * the volumes it concentrates in. It is shaped around two hard ComicVine limits —
 * credits exist only on the issue *detail* endpoint, and each resource allows
 * roughly 200 requests per hour — so bulk metadata comes from the batched list
 * endpoint and per-issue detail is reserved for the issues we might recommend.
 */

/**
 * Shared issues hydrated with metadata, at 100 per request. Set high because
 * truncating this list is not a neutral sample: the ids come back in ComicVine
 * id order, which tracks when an issue was catalogued, so cutting the list
 * discards the oldest entries — exactly the classic runs worth recommending.
 */
const MAX_CO_APPEARANCE_ISSUES = 1200;
/** Volumes we fetch detail for, ordered by how much of the pair they carry. */
const MAX_ENRICHED_VOLUMES = 12;
/** Issues we spend detail requests on, for arcs, cast, and creative team. */
const MAX_DETAILED_ISSUES = 60;
/** Detail requests per volume, taken from its earliest shared issues. */
const MAX_DETAILED_ISSUES_PER_VOLUME = 8;

const REINGEST_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export type CoAppearanceIngestionResult = {
  sharedIssues: number;
  hydratedIssues: number;
  enrichedVolumes: number;
  detailedIssues: number;
  skipped: boolean;
};

const coAppearanceRowSchema = z.object({ comicvine_issue_id: z.coerce.number().int().positive() });
const pairRowSchema = z.object({ ingested_at: z.string() });

/**
 * Fills the local database with the issues two or three characters genuinely
 * share. Safe to call on every request: it returns early when the same set was
 * ingested recently.
 */
export async function ingestCoAppearances(
  database: SupabaseClient,
  comicVine: ComicVineClient,
  characterIds: string[],
): Promise<CoAppearanceIngestionResult> {
  const empty = {
    sharedIssues: 0,
    hydratedIssues: 0,
    enrichedVolumes: 0,
    detailedIssues: 0,
  };
  if (characterIds.length < 2) return { ...empty, skipped: true };

  const key = pairKey(characterIds);
  if (await recentlyIngested(database, key)) return { ...empty, skipped: true };

  const sharedIssueIds = await sharedComicVineIssueIds(database, characterIds);
  if (!sharedIssueIds.length) {
    await recordIngestion(database, key);
    return { ...empty, skipped: false };
  }

  // Spread the cap across the whole range rather than taking one end of it, so
  // an over-long list still keeps its earliest issues.
  const targeted = evenlySampled(sharedIssueIds, MAX_CO_APPEARANCE_ISSUES);
  const summaries = await comicVine.getIssueSummaries(targeted);
  if (!summaries.length) {
    await recordIngestion(database, key);
    return { ...empty, sharedIssues: sharedIssueIds.length, skipped: false };
  }

  // Only now is each shared issue's volume known, so this is the first point at
  // which the request budget can be aimed at the books that matter.
  const rankedVolumeIds = volumesByShare(summaries).slice(0, MAX_ENRICHED_VOLUMES);
  const volumes = await fetchVolumes(comicVine, rankedVolumeIds);

  const publisherIds = await upsertPublishers(database, volumes.map(({ publisher }) => publisher));
  const volumeIds = await upsertVolumes(database, volumes, publisherIds);
  const hydrated = summaries.filter((issue) => volumeIds.has(issue.volume.comicvineId));
  const issueIds = await upsertIssues(database, hydrated, volumeIds);

  await recordVolumeCasts(database, volumes, volumeIds);
  const detailedIssues = await enrichIssueDetail(
    database,
    comicVine,
    hydrated,
    volumeIds,
    issueIds,
  );

  await recordIngestion(database, key);

  return {
    sharedIssues: sharedIssueIds.length,
    hydratedIssues: hydrated.length,
    enrichedVolumes: volumes.length,
    detailedIssues,
    skipped: false,
  };
}

function pairKey(characterIds: string[]): string {
  return [...characterIds].sort().join("|");
}

async function recentlyIngested(database: SupabaseClient, key: string): Promise<boolean> {
  const { data, error } = await database
    .from("pair_ingestions")
    .select("ingested_at")
    .eq("character_key", key)
    .maybeSingle();
  if (error) throw new Error(`Pair ingestion lookup failed: ${error.message}`);
  if (!data) return false;

  const row = pairRowSchema.safeParse(data);
  if (!row.success) return false;
  return Date.now() - Date.parse(row.data.ingested_at) < REINGEST_AFTER_MS;
}

async function recordIngestion(database: SupabaseClient, key: string): Promise<void> {
  const { error } = await database
    .from("pair_ingestions")
    .upsert(
      { character_key: key, ingested_at: new Date().toISOString() },
      { onConflict: "character_key" },
    );
  if (error) throw new Error(`Pair ingestion record failed: ${error.message}`);
}

async function sharedComicVineIssueIds(
  database: SupabaseClient,
  characterIds: string[],
): Promise<number[]> {
  const { data, error } = await database.rpc("co_appearance_issue_ids", {
    requested_character_ids: characterIds,
  });
  if (error) throw new Error(`Co-appearance lookup failed: ${error.message}`);
  return z.array(coAppearanceRowSchema).parse(data ?? []).map((row) => row.comicvine_issue_id);
}

/** Volume ComicVine IDs ordered by how many shared issues they hold. */
function volumesByShare(summaries: ComicVineIssueSummary[]): number[] {
  const counts = new Map<number, number>();
  for (const issue of summaries) {
    counts.set(issue.volume.comicvineId, (counts.get(issue.volume.comicvineId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([leftId, left], [rightId, right]) => right - left || leftId - rightId)
    .map(([volumeId]) => volumeId);
}

async function fetchVolumes(
  comicVine: ComicVineClient,
  comicvineIds: number[],
): Promise<ComicVineVolume[]> {
  const volumes: ComicVineVolume[] = [];
  for (const comicvineId of comicvineIds) {
    volumes.push(await comicVine.getVolume(comicvineId));
  }
  return dedupeByComicVineId(volumes);
}

/**
 * Stores ComicVine's per-character appearance counts. This is the core-cast
 * signal, and a volume that reports it costs one request instead of one per
 * issue.
 */
async function recordVolumeCasts(
  database: SupabaseClient,
  volumes: ComicVineVolume[],
  volumeIds: Map<number, string>,
): Promise<void> {
  const castCredits = volumes.flatMap(({ characterCounts }) =>
    characterCounts.map(({ comicvineId, name }) => ({ comicvineId, name })),
  );
  const characterIds = await upsertCharacterStubs(database, castCredits);

  for (const volume of volumes) {
    const volumeId = volumeIds.get(volume.comicvineId);
    if (!volumeId || !volume.characterCounts.length) continue;

    await replaceVolumeCharacters(
      database,
      volumeId,
      volume.characterCounts.flatMap(({ comicvineId, appearances }) => {
        const characterId = characterIds.get(comicvineId);
        return characterId ? [{ characterId, appearances }] : [];
      }),
    );
  }
}

/**
 * Spends the issue-detail budget where it changes what we can say: the earliest
 * shared issues of each leading volume, which are the ones most likely to be
 * recommended as a starting point and the only source of story arcs, full cast,
 * and creative team.
 */
async function enrichIssueDetail(
  database: SupabaseClient,
  comicVine: ComicVineClient,
  summaries: ComicVineIssueSummary[],
  volumeIds: Map<number, string>,
  issueIds: Map<number, string>,
): Promise<number> {
  const byVolume = Map.groupBy(summaries, (issue) => issue.volume.comicvineId);
  const targets: ComicVineIssueSummary[] = [];

  for (const volumeIssues of byVolume.values()) {
    targets.push(
      ...[...volumeIssues]
        .sort(
          (left, right) =>
            (left.coverDate ?? "9999").localeCompare(right.coverDate ?? "9999") ||
            left.issueNumber.localeCompare(right.issueNumber, undefined, { numeric: true }),
        )
        .slice(0, MAX_DETAILED_ISSUES_PER_VOLUME),
    );
  }

  const budgeted = targets.slice(0, MAX_DETAILED_ISSUES);
  if (!budgeted.length) return 0;

  const detailed = [];
  for (const summary of budgeted) {
    detailed.push(await comicVine.getIssue(summary.comicvineId));
  }

  const characterIds = await upsertCharacterStubs(
    database,
    detailed.flatMap(({ characters }) => characters),
  );
  const storyArcs = dedupeByComicVineId(detailed.flatMap(({ storyArcs: arcs }) => arcs));
  const storyArcIds = await upsertStoryArcs(
    database,
    storyArcs.map((arc) => ({ ...arc, description: null })),
  );
  const creatorIds = await upsertCreators(
    database,
    detailed.flatMap(({ creators }) => creators),
  );

  // Re-upsert so detail-only fields land on rows the list endpoint created.
  const detailedIssueIds = await upsertIssues(database, detailed, volumeIds);
  const merged = new Map([...issueIds, ...detailedIssueIds]);

  await upsertRelationships(database, detailed, merged, characterIds, storyArcIds);
  await upsertCreatorLinks(database, detailed, merged, creatorIds);

  return detailed.length;
}

const creditsLoadedRowSchema = z.object({
  id: z.string().uuid(),
  comicvine_id: z.coerce.number().int().positive(),
  credits_loaded_at: z.string().nullable(),
});

/**
 * Guarantees every requested character has its full appearance list cached.
 * A character already in the catalog may have been ingested before the index
 * existed, or by the old sampling path, and without it the co-appearance
 * intersection silently sees nothing.
 *
 * One ComicVine request per missing character, regardless of how many thousands
 * of appearances it covers.
 */
export async function ensureCreditIndex(
  database: SupabaseClient,
  comicVine: ComicVineClient,
  characterIds: string[],
): Promise<number> {
  const { data, error } = await database
    .from("characters")
    .select("id,comicvine_id,credits_loaded_at")
    .in("id", characterIds);
  if (error) throw new Error(`Credit index lookup failed: ${error.message}`);

  const rows = z.array(creditsLoadedRowSchema).parse(data ?? []);
  const missing = rows.filter((row) => row.credits_loaded_at === null);

  for (const row of missing) {
    const character = await comicVine.getCharacter(row.comicvine_id);
    await replaceCharacterIssueCredits(
      database,
      row.id,
      character.issueCredits.map(({ comicvineId }) => comicvineId),
    );
  }

  return missing.length;
}

/**
 * Every id when the list fits, otherwise an even spread across it. Taking a
 * contiguous slice would drop one whole era of the characters' shared history.
 */
function evenlySampled(ids: number[], limit: number): number[] {
  if (ids.length <= limit) return ids;
  const step = ids.length / limit;
  return Array.from({ length: limit }, (_, index) => ids[Math.floor(index * step)]);
}
