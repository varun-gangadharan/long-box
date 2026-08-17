import type { SupabaseClient } from "@supabase/supabase-js";

import { ComicVineClient } from "@/lib/comicvine/client";
import type {
  ComicVineCharacter,
  ComicVineCredit,
  ComicVineIssue,
  ComicVineStoryArc,
  ComicVineVolume,
} from "@/lib/comicvine/types";

export type IngestionResult = {
  character: string;
  issues: number;
  volumes: number;
  storyArcs: number;
  relationships: number;
};

type DatabaseId = { id: string; comicvine_id: number };

export function dedupeByComicVineId<T extends { comicvineId: number }>(
  values: T[],
): T[] {
  return [...new Map(values.map((value) => [value.comicvineId, value])).values()];
}

export async function ingestCharacter(
  database: SupabaseClient,
  comicVine: ComicVineClient,
  requestedName: string,
  maxIssues = 200,
): Promise<IngestionResult> {
  const searchResults = await comicVine.searchCharacters(requestedName, 10);
  const match = searchResults.find(
    ({ name }) => name.localeCompare(requestedName.trim(), undefined, { sensitivity: "accent" }) === 0,
  );
  if (!match) {
    const suggestions = searchResults.map(({ name }) => name).join(", ");
    throw new Error(
      `No exact ComicVine character match for "${requestedName}"${suggestions ? `. Matches: ${suggestions}` : ""}`,
    );
  }

  const character = await comicVine.getCharacter(match.comicvineId);
  const issues = dedupeByComicVineId(
    await comicVine.getIssues(character.issueCredits, maxIssues),
  );
  const volumes = await resolveVolumes(comicVine, issues);
  const storyArcs = await resolveStoryArcs(comicVine, issues);

  const publisherIds = await upsertPublishers(database, [
    character.publisher,
    ...volumes.map(({ publisher }) => publisher),
  ]);
  const characterIds = await upsertCharacters(database, character, issues, publisherIds);
  const volumeIds = await upsertVolumes(database, volumes, publisherIds);
  const issueIds = await upsertIssues(database, issues, volumeIds);
  const storyArcIds = await upsertStoryArcs(database, storyArcs);
  const relationships = await upsertRelationships(
    database,
    issues,
    issueIds,
    characterIds,
    storyArcIds,
  );

  return {
    character: character.name,
    issues: issues.length,
    volumes: volumes.length,
    storyArcs: storyArcs.length,
    relationships,
  };
}

async function resolveVolumes(
  comicVine: ComicVineClient,
  issues: ComicVineIssue[],
): Promise<ComicVineVolume[]> {
  const credits = dedupeByComicVineId(issues.map(({ volume }) => volume));
  const volumes: ComicVineVolume[] = [];
  for (const credit of credits) {
    volumes.push(await comicVine.getVolume(credit.comicvineId));
  }
  return volumes;
}

async function resolveStoryArcs(
  comicVine: ComicVineClient,
  issues: ComicVineIssue[],
): Promise<ComicVineStoryArc[]> {
  const credits = dedupeByComicVineId(issues.flatMap(({ storyArcs }) => storyArcs));
  const arcs: ComicVineStoryArc[] = [];
  for (const credit of credits) {
    arcs.push(await comicVine.getStoryArc(credit.comicvineId));
  }
  return arcs;
}

async function upsertPublishers(
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

async function upsertCharacters(
  database: SupabaseClient,
  character: ComicVineCharacter,
  issues: ComicVineIssue[],
  publisherIds: Map<number, string>,
): Promise<Map<number, string>> {
  const { error: characterError } = await database.from("characters").upsert(
    {
      comicvine_id: character.comicvineId,
      name: character.name,
      description: character.description,
      image_url: character.imageUrl,
      publisher_id: character.publisher
        ? publisherIds.get(character.publisher.comicvineId)
        : null,
    },
    { onConflict: "comicvine_id" },
  );
  if (characterError) throw new Error(`Character upsert failed: ${characterError.message}`);

  const credits = dedupeByComicVineId(issues.flatMap(({ characters }) => characters));
  if (credits.length) {
    const { error } = await database.from("characters").upsert(
      credits.map(({ comicvineId, name }) => ({ comicvine_id: comicvineId, name })),
      { onConflict: "comicvine_id" },
    );
    if (error) throw new Error(`Character credit upsert failed: ${error.message}`);
  }

  const ids = dedupeByComicVineId<ComicVineCredit>([
    { comicvineId: character.comicvineId, name: character.name },
    ...credits,
  ]).map(({ comicvineId }) => comicvineId);
  const { data, error } = await database
    .from("characters")
    .select("id,comicvine_id")
    .in("comicvine_id", ids);
  if (error) throw new Error(`Character ID lookup failed: ${error.message}`);
  return idMap(data as DatabaseId[]);
}

async function upsertVolumes(
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

async function upsertIssues(
  database: SupabaseClient,
  issues: ComicVineIssue[],
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
  const { data, error } = await database
    .from("issues")
    .upsert(rows, { onConflict: "comicvine_id" })
    .select("id,comicvine_id");
  if (error) throw new Error(`Issue upsert failed: ${error.message}`);
  return idMap(data as DatabaseId[]);
}

async function upsertStoryArcs(
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

async function upsertRelationships(
  database: SupabaseClient,
  issues: ComicVineIssue[],
  issueIds: Map<number, string>,
  characterIds: Map<number, string>,
  storyArcIds: Map<number, string>,
): Promise<number> {
  const ingestedIssueIds = [...issueIds.values()];
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

  if (ingestedIssueIds.length) {
    const { error } = await database.rpc("replace_issue_relationships", {
      p_issue_ids: ingestedIssueIds,
      p_character_links: characterRows,
      p_story_arc_links: storyArcRows,
    });
    if (error) throw new Error(`Issue relationship replacement failed: ${error.message}`);
  }

  return characterRows.length + storyArcRows.length;
}

function idMap(rows: DatabaseId[]): Map<number, string> {
  return new Map(rows.map(({ comicvine_id, id }) => [Number(comicvine_id), id]));
}
