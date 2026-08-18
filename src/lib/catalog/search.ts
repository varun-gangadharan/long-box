import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const searchResultSchema = z.object({
  entity_type: z.enum(["character", "story_arc"]),
  id: z.string().uuid(),
  comicvine_id: z.coerce.number().int().positive(),
  name: z.string(),
  description: z.string().nullable(),
  image_url: z.string().nullable(),
  context: z.string().nullable(),
});

export function normalizeCatalogQuery(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export type CatalogSearchResult = {
  type: "character" | "story_arc";
  id: string;
  comicvineId: number;
  name: string;
  description: string | null;
  imageUrl: string | null;
  context: string | null;
};

export async function searchCatalog(
  database: SupabaseClient,
  query: string,
  limit = 8,
): Promise<CatalogSearchResult[]> {
  const { data, error } = await database.rpc("search_catalog", {
    search_term: query,
    result_limit: limit,
  });
  if (error) throw new Error(`Catalog search failed: ${error.message}`);
  return z.array(searchResultSchema).parse(data ?? []).map((row) => ({
    type: row.entity_type,
    id: row.id,
    comicvineId: row.comicvine_id,
    name: row.name,
    description: row.description,
    imageUrl: row.image_url,
    context: row.context,
  }));
}
