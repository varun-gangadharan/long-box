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
const MAX_DETAILED_ISSUES = 90;
/** Detail requests per volume, taken from its earliest shared issues. */
const MAX_DETAILED_ISSUES_PER_VOLUME = 8;

const REINGEST_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export type CoAppearanceIngestionResult = {
  sharedIssues: number;
  hydratedIssues: number;
  enrichedVolumes: number;
  detailedIssues: number;
  /** Volumes titled after the character, ingested for a single-character query. */
  titledVolumes: number;
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
    titledVolumes: 0,
  };
  if (!characterIds.length) return { ...empty, skipped: true };

  const key = pairKey(characterIds);
  if (await recentlyIngested(database, key)) return { ...empty, skipped: true };

  // A single-character query is asking what to read *about* someone, and their
  // defining stories are published under their own name rather than scattered
  // through the thousands of issues they guest in. Sampling appearances alone
  // returns the team books they happen to be in.
  const titled =
    characterIds.length === 1
      ? await ingestCharacterTitledVolumes(database, comicVine, characterIds[0])
      : { volumes: 0, issues: [] as ComicVineIssueSummary[] };
  const titledVolumes = titled.volumes;

  const sharedIssueIds = await sharedComicVineIssueIds(database, characterIds);
  if (!sharedIssueIds.length) {
    await recordIngestion(database, key);
    return { ...empty, titledVolumes, skipped: false };
  }

  const targeted = evenlySampled(sharedIssueIds, MAX_CO_APPEARANCE_ISSUES);
  const summaries = await comicVine.getIssueSummaries(targeted);
  if (!summaries.length) {
    await recordIngestion(database, key);
    return { ...empty, sharedIssues: sharedIssueIds.length, titledVolumes, skipped: false };
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
  // Detail is the scarce resource, so it goes first to the self-contained stories
  // published under the character's own name. Those are the books most likely to
  // be recommended, and without detail they have no creative team, no story arcs
  // and no cast — which is what a recommendation is made of.
  const detailedIssues = await enrichIssueDetail(
    database,
    comicVine,
    hydrated,
    volumeIds,
    issueIds,
    titled.issues,
  );

  await recordIngestion(database, key);

  return {
    sharedIssues: sharedIssueIds.length,
    hydratedIssues: hydrated.length,
    enrichedVolumes: volumes.length,
    detailedIssues,
    titledVolumes,
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
  // The sampling happens in SQL: PostgREST caps a result at a thousand rows, and
  // a silent truncation here reads as "this character has a thousand appearances,
  // all of them from 1943".
  const { data, error } = await database.rpc("co_appearance_issue_ids", {
    requested_character_ids: characterIds,
    sample_limit: MAX_CO_APPEARANCE_ISSUES,
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
  prioritised: ComicVineIssueSummary[] = [],
): Promise<number> {
  const byVolume = Map.groupBy(summaries, (issue) => issue.volume.comicvineId);
  const targets: ComicVineIssueSummary[] = [...prioritised];

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

  const budgeted = dedupeByComicVineId(targets).slice(0, MAX_DETAILED_ISSUES);
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
  // Prioritised issues come from character-titled volumes, which are not in the
  // co-appearance volume map, so filter to what this map can actually place.
  const placeable = detailed.filter((issue) => volumeIds.has(issue.volume.comicvineId));
  const detailedIssueIds = await upsertIssues(database, placeable, volumeIds);
  const merged = new Map([...issueIds, ...detailedIssueIds]);

  await upsertRelationships(database, placeable, merged, characterIds, storyArcIds);
  await upsertCreatorLinks(database, placeable, merged, creatorIds);

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
 * Everything when the list fits, otherwise an even spread across it. Taking a
 * contiguous slice would drop one whole era of a character's history — which is
 * exactly the failure that made every Batman recommendation Golden Age filler.
 */
export function evenlySampled<T>(values: T[], limit: number): T[] {
  if (values.length <= limit) return values;
  const step = values.length / limit;
  return Array.from({ length: limit }, (_, index) => values[Math.floor(index * step)]);
}

/** Volumes titled after the character to ingest for a single-character query. */
const MAX_TITLED_VOLUMES = 14;
/**
 * The shape of a story somebody can be handed whole: The Long Halloween is 13
 * issues, Dark Victory 14, The Dark Knight Returns 4. Below this is an annual or
 * a one-shot, above it an ongoing series to sample from rather than a story.
 */
const SELF_CONTAINED_ISSUE_LIMIT = 20;
const MIN_SELF_CONTAINED_ISSUES = 4;

const characterRowSchema = z.object({
  comicvine_id: z.coerce.number().int().positive(),
  name: z.string(),
  publisher_id: z.string().uuid().nullable(),
});

/**
 * Ingests the self-contained stories published under a character's own name.
 *
 * These are the books somebody means when they ask where to start with a
 * character — The Long Halloween, Dark Victory, The Dark Knight Returns — and
 * each is a separate volume of a dozen-odd issues. They cannot be found by
 * sampling ten thousand appearances, but one filtered volumes request lists them
 * all, and their shape is exactly what the ranking already rewards: titled after
 * the character, complete in itself, starting at a first issue.
 *
 * Ongoing series are deliberately excluded — a seven-hundred-issue title is a run
 * to sample from, not a story to hand a newcomer whole.
 */
async function ingestCharacterTitledVolumes(
  database: SupabaseClient,
  comicVine: ComicVineClient,
  characterId: string,
): Promise<{ volumes: number; issues: ComicVineIssueSummary[] }> {
  const { data, error } = await database
    .from("characters")
    .select("comicvine_id,name,publisher_id")
    .eq("id", characterId)
    .maybeSingle();
  const empty = { volumes: 0, issues: [] as ComicVineIssueSummary[] };
  if (error || !data) return empty;

  const character = characterRowSchema.safeParse(data);
  if (!character.success) return empty;

  const candidates = await comicVine.getVolumesNamed(character.data.name);
  const publisherName = await publisherNameFor(database, character.data.publisher_id);

  const qualifying = candidates
    .filter((volume) => {
      // A reprint house's edition of a story is the same story; prefer the
      // publisher who owns the character, matching how editions are ranked.
      if (publisherName && volume.publisher && volume.publisher.name !== publisherName) {
        return false;
      }
      const issueCount = volume.issueCount ?? 0;
      return issueCount >= MIN_SELF_CONTAINED_ISSUES && issueCount <= SELF_CONTAINED_ISSUE_LIMIT;
    })
    .sort((left, right) => (left.startYear ?? 0) - (right.startYear ?? 0));

  // Spread across the character's history rather than taking one end of it.
  // Sorting by year and slicing would have picked whichever era happened to be at
  // the top — newest-first buried The Long Halloween under a run of annuals —
  // and which of these is a landmark is not something this data can tell us.
  // Getting one from each era into the pool and letting the ranking choose is the
  // honest version.
  const selected = evenlySampled(qualifying, MAX_TITLED_VOLUMES);

  if (!selected.length) return empty;

  const publisherIds = await upsertPublishers(database, selected.map(({ publisher }) => publisher));
  const volumeIds = await upsertVolumes(
    database,
    selected.map((volume) => ({ ...volume, characterCounts: [] })),
    publisherIds,
  );

  const ingested: ComicVineIssueSummary[] = [];
  for (const volume of selected) {
    const issues = await comicVine.getVolumeIssues(volume.comicvineId, SELF_CONTAINED_ISSUE_LIMIT);
    if (!issues.length) continue;
    await upsertIssues(database, issues, volumeIds);
    ingested.push(...issues);
  }

  return { volumes: selected.length, issues: ingested };
}

async function publisherNameFor(
  database: SupabaseClient,
  publisherId: string | null,
): Promise<string | null> {
  if (!publisherId) return null;
  const { data } = await database
    .from("publishers")
    .select("name")
    .eq("id", publisherId)
    .maybeSingle();
  return data ? String((data as { name: string }).name) : null;
}
