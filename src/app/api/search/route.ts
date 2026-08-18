import type { SupabaseClient } from "@supabase/supabase-js";

import { databaseFromEnv } from "@/lib/db/client";
import { searchCatalog } from "@/lib/catalog/search";

export async function GET(request: Request): Promise<Response> {
  return handleCatalogSearch(request, databaseFromEnv);
}

export async function handleCatalogSearch(
  request: Request,
  database: SupabaseClient | (() => SupabaseClient),
  search: typeof searchCatalog = searchCatalog,
): Promise<Response> {
  try {
    const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (query.length < 2 || query.length > 80) {
      return Response.json(
        {
          error: {
            code: "invalid_query",
            message: "Search must contain 2 to 80 characters.",
          },
        },
        { status: 400 },
      );
    }
    const client = typeof database === "function" ? database() : database;
    return Response.json({ results: await search(client, query, 8) });
  } catch (error) {
    console.error("Catalog search failed", error);
    return Response.json(
      {
        error: {
          code: "internal_error",
          message: "Catalog search is temporarily unavailable.",
        },
      },
      { status: 500 },
    );
  }
}
