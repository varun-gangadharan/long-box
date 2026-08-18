import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeCatalogQuery, searchCatalog } from "@/lib/catalog/search";
import { databaseFromEnv } from "@/lib/db/client";
import { jsonResponse, requestId } from "@/lib/http/response";
import { logError, logInfo } from "@/lib/observability/logger";

export const maxDuration = 10;

export async function GET(request: Request): Promise<Response> {
  return handleCatalogSearch(request, databaseFromEnv);
}

export async function handleCatalogSearch(
  request: Request,
  database: SupabaseClient | (() => SupabaseClient),
  search: typeof searchCatalog = searchCatalog,
): Promise<Response> {
  const id = requestId(request);
  const startedAt = performance.now();
  try {
    const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (query.length < 2 || query.length > 80 || !normalizeCatalogQuery(query)) {
      return jsonResponse(
        {
          error: {
            code: "invalid_query",
            message: "Search must contain 2 to 80 letters or numbers.",
          },
        },
        { status: 400, requestId: id },
      );
    }
    const client = typeof database === "function" ? database() : database;
    const results = await search(client, normalizeCatalogQuery(query), 8);
    logInfo("Catalog search completed", {
      requestId: id,
      durationMs: Math.round(performance.now() - startedAt),
      resultCount: results.length,
    });
    return jsonResponse({ results }, { requestId: id, cache: true });
  } catch (error) {
    logError("Catalog search failed", error, { requestId: id });
    return jsonResponse(
      {
        error: {
          code: "internal_error",
          message: "Catalog search is temporarily unavailable.",
        },
      },
      { status: 500, requestId: id },
    );
  }
}
