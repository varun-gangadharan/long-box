import type { SupabaseClient } from "@supabase/supabase-js";

export type IssueLookup = {
  issue_id: string;
  comicvine_id: number;
  issue_number: string;
  issue_name: string | null;
  cover_date: string | null;
  image_url: string | null;
  volume_id: string;
  volume_name: string;
  volume_start_year: number | null;
};

export type StoryArcLookup = {
  story_arc_id: string;
  comicvine_id: number;
  name: string;
  description: string | null;
};

export async function findIssuesForCharacters(
  database: SupabaseClient,
  characterNames: string[],
): Promise<IssueLookup[]> {
  const names = [...new Set(characterNames.map((name) => name.trim()).filter(Boolean))];
  if (!names.length) return [];

  const { data, error } = await database.rpc("issues_for_characters", {
    requested_names: names,
  });
  if (error) throw new Error(`Issue lookup failed: ${error.message}`);
  return (data ?? []) as IssueLookup[];
}

export async function findStoryArcsForCharacter(
  database: SupabaseClient,
  characterName: string,
): Promise<StoryArcLookup[]> {
  if (!characterName.trim()) return [];

  const { data, error } = await database.rpc("story_arcs_for_character", {
    requested_name: characterName.trim(),
  });
  if (error) throw new Error(`Story arc lookup failed: ${error.message}`);
  return (data ?? []) as StoryArcLookup[];
}
