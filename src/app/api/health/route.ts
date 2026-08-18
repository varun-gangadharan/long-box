import type { SupabaseClient } from "@supabase/supabase-js";

import { databaseFromEnv } from "@/lib/db/client";
import { jsonResponse, requestId } from "@/lib/http/response";
import { logError } from "@/lib/observability/logger";

export const maxDuration = 5;

export async function GET(request: Request): Promise<Response> {
  return handleHealthRequest(request, databaseFromEnv);
}

export async function handleHealthRequest(
  request: Request,
  database: SupabaseClient | (() => SupabaseClient),
): Promise<Response> {
  const id = requestId(request);
  try {
    const client = typeof database === "function" ? database() : database;
    const { error } = await client.rpc("search_catalog", {
      search_term: "healthcheck",
      result_limit: 1,
    });
    if (error) throw error;
    return jsonResponse({ status: "ok" }, { requestId: id });
  } catch (error) {
    logError("Readiness check failed", error, { requestId: id });
    return jsonResponse(
      { status: "unavailable" },
      { status: 503, requestId: id },
    );
  }
}
