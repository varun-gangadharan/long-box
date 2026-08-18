import type { SupabaseClient } from "@supabase/supabase-js";

import { bestClaim } from "@/lib/characters/identity";
import { ComicVineClient } from "@/lib/comicvine/client";
import type {
  ComicVineCharacter,
  ComicVineIssue,
  ComicVineStoryArc,
  ComicVineVolume,
} from "@/lib/comicvine/types";

import { normalizeEntityName } from "@/lib/reading-path/names";

import {
  dedupeByComicVineId,
  replaceCharacterIssueCredits,
  upsertCanonicalCharacter,
  upsertCharacterStubs,
  upsertCreatorLinks,
  upsertCreators,
  upsertIssues,
  upsertPublishers,
  upsertRelationships,
  upsertStoryArcs,
  upsertVolumes,
} from "./upserts";

export { dedupeByComicVineId };

export type IngestionResult = {
  character: string;
  issues: number;
  volumes: number;
  storyArcs: number;
  relationships: number;
};

/**
 * Ingests one character and a slice of their issues. Whatever `maxIssues`
 * allows, the character's complete appearance list is always cached, so later
 * co-appearance queries see every shared issue rather than only the sampled few.
 */
export async function ingestCharacter(
  database: SupabaseClient,
  comicVine: ComicVineClient,
  requestedName: string,
  maxIssues = 200,
): Promise<IngestionResult> {
  const searchResults = await comicVine.searchCharacters(requestedName, 10);
  const match = selectCharacterMatch(searchResults, requestedName);
  if (!match) {
    const suggestions = searchResults.map(({ name }) => name).join(", ");
    throw new Error(
      `No ComicVine character match for "${requestedName}"${suggestions ? `. Matches: ${suggestions}` : ""}`,
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
  await upsertCanonicalCharacter(database, character, publisherIds);
  const characterIds = await upsertCharacterStubs(database, [
    { comicvineId: character.comicvineId, name: character.name },
    ...issues.flatMap(({ characters }) => characters),
  ]);
  const volumeIds = await upsertVolumes(database, volumes, publisherIds);
  const issueIds = await upsertIssues(database, issues, volumeIds);
  const storyArcIds = await upsertStoryArcs(database, storyArcs);
  const creatorIds = await upsertCreators(database, issues.flatMap(({ creators }) => creators));
  const relationships = await upsertRelationships(
    database,
    issues,
    issueIds,
    characterIds,
    storyArcIds,
  );
  await upsertCreatorLinks(database, issues, issueIds, creatorIds);

  const characterId = characterIds.get(character.comicvineId);
  if (characterId) {
    await replaceCharacterIssueCredits(
      database,
      characterId,
      character.issueCredits.map(({ comicvineId }) => comicvineId),
    );
  }

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

/**
 * Picks which character somebody means by a name, from ComicVine search results.
 * Shares its judgement with catalog lookup so the two cannot disagree.
 */
export function selectCharacterMatch(
  candidates: ComicVineCharacter[],
  requestedName: string,
): ComicVineCharacter | null {
  const requested = normalizeEntityName(requestedName);

  type Claim = {
    candidate: ComicVineCharacter;
    isNameMatch: boolean;
    aliasPosition: number | null;
  };

  const claims = candidates.flatMap((candidate): Claim[] => {
    if (normalizeEntityName(candidate.name) === requested) {
      return [{ candidate, isNameMatch: true, aliasPosition: null }];
    }
    const aliasPosition = candidate.aliases.findIndex(
      (alias) => normalizeEntityName(alias) === requested,
    );
    return aliasPosition === -1
      ? []
      : [{ candidate, isNameMatch: false, aliasPosition }];
  });
  if (!claims.length) return null;
  if (claims.length === 1) return claims[0].candidate;

  const winner = bestClaim(claims, (claim) => ({
    isNameMatch: claim.isNameMatch,
    aliasPosition: claim.aliasPosition,
    appearanceCount: claim.candidate.issueAppearanceCount,
  }));

  // Ingestion has to commit to something, so on a genuine tie take the most
  // published candidate rather than refusing to ingest at all.
  return (
    winner?.candidate ??
    claims.reduce((best, claim) =>
      (claim.candidate.issueAppearanceCount ?? 0) > (best.candidate.issueAppearanceCount ?? 0)
        ? claim
        : best,
    ).candidate
  );
}
