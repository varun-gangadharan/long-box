import type { SupabaseClient } from "@supabase/supabase-js";

import { databaseFromEnv } from "@/lib/db/client";
import { jsonResponse, requestId } from "@/lib/http/response";
import { logError, logInfo } from "@/lib/observability/logger";
import {
  AmbiguousCharacterError,
  AmbiguousStoryArcError,
  CharacterNotFoundError,
  StoryArcNotFoundError,
} from "@/lib/reading-path/repository";
import {
  buildReadingPath,
  InvalidReadingPathQueryError,
  parseReadingPathQuery,
} from "@/lib/reading-path/service";

// A pair nobody has searched before triggers a full co-appearance ingestion,
// which measured about 95s for two characters with a thousand shared issues.
// Every later request for that pair is served from the database in ~1s.
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  return handleReadingPathRequest(request, databaseFromEnv);
}

export async function handleReadingPathRequest(
  request: Request,
  database: SupabaseClient | (() => SupabaseClient),
  build: typeof buildReadingPath = buildReadingPath,
): Promise<Response> {
  const id = requestId(request);
  const startedAt = performance.now();
  try {
    const query = parseReadingPathQuery(new URL(request.url).searchParams);
    const client = typeof database === "function" ? database() : database;
    const result = await build(client, query);
    logInfo("Reading path completed", {
      requestId: id,
      durationMs: Math.round(performance.now() - startedAt),
      queryType: query.type,
      recommendationCount: result.recommendations.length,
    });
    return jsonResponse(result, { requestId: id, cache: true });
  } catch (error) {
    if (error instanceof InvalidReadingPathQueryError) {
      return errorResponse(id, 400, "invalid_query", error.message);
    }
    if (isCharacterNotFoundError(error)) {
      return errorResponse(id, 404, "character_not_found", error.message, {
        requestedName: error.requestedName,
      });
    }
    if (isAmbiguousCharacterError(error)) {
      return errorResponse(id, 409, "ambiguous_character", error.message, {
        requestedName: error.requestedName,
        matches: error.matches,
      });
    }
    if (isStoryArcNotFoundError(error)) {
      return errorResponse(id, 404, "story_arc_not_found", error.message, {
        requestedName: error.requestedName,
      });
    }
    if (isAmbiguousStoryArcError(error)) {
      return errorResponse(id, 409, "ambiguous_story_arc", error.message, {
        requestedName: error.requestedName,
        matches: error.matches,
      });
    }

    logError("Reading path request failed", error, { requestId: id });
    return errorResponse(
      id,
      500,
      "internal_error",
      "The reading path could not be generated.",
    );
  }
}

function isCharacterNotFoundError(error: unknown): error is CharacterNotFoundError {
  return (
    error instanceof CharacterNotFoundError ||
    (error instanceof Error &&
      error.name === "CharacterNotFoundError" &&
      "requestedName" in error &&
      typeof error.requestedName === "string")
  );
}

function isAmbiguousCharacterError(error: unknown): error is AmbiguousCharacterError {
  return (
    error instanceof AmbiguousCharacterError ||
    (error instanceof Error &&
      error.name === "AmbiguousCharacterError" &&
      "requestedName" in error &&
      typeof error.requestedName === "string" &&
      "matches" in error &&
      Array.isArray(error.matches))
  );
}

function isStoryArcNotFoundError(error: unknown): error is StoryArcNotFoundError {
  return (
    error instanceof StoryArcNotFoundError ||
    (error instanceof Error &&
      error.name === "StoryArcNotFoundError" &&
      "requestedName" in error &&
      typeof error.requestedName === "string")
  );
}

function isAmbiguousStoryArcError(error: unknown): error is AmbiguousStoryArcError {
  return (
    error instanceof AmbiguousStoryArcError ||
    (error instanceof Error &&
      error.name === "AmbiguousStoryArcError" &&
      "requestedName" in error &&
      typeof error.requestedName === "string" &&
      "matches" in error &&
      Array.isArray(error.matches))
  );
}

function errorResponse(
  requestId: string,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Response {
  return jsonResponse(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status, requestId },
  );
}
