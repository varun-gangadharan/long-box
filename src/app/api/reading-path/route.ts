import type { SupabaseClient } from "@supabase/supabase-js";

import { databaseFromEnv } from "@/lib/db/client";
import {
  AmbiguousCharacterError,
  CharacterNotFoundError,
} from "@/lib/reading-path/repository";
import {
  buildReadingPath,
  InvalidReadingPathQueryError,
  parseCharacterQuery,
} from "@/lib/reading-path/service";

export async function GET(request: Request): Promise<Response> {
  return handleReadingPathRequest(request, databaseFromEnv);
}

export async function handleReadingPathRequest(
  request: Request,
  database: SupabaseClient | (() => SupabaseClient),
  build: typeof buildReadingPath = buildReadingPath,
): Promise<Response> {
  try {
    const names = parseCharacterQuery(new URL(request.url).searchParams.get("characters"));
    const client = typeof database === "function" ? database() : database;
    const result = await build(client, names);
    return Response.json(result);
  } catch (error) {
    if (error instanceof InvalidReadingPathQueryError) {
      return errorResponse(400, "invalid_query", error.message);
    }
    if (isCharacterNotFoundError(error)) {
      return errorResponse(404, "character_not_found", error.message, {
        requestedName: error.requestedName,
      });
    }
    if (isAmbiguousCharacterError(error)) {
      return errorResponse(409, "ambiguous_character", error.message, {
        requestedName: error.requestedName,
        matches: error.matches,
      });
    }

    console.error("Reading path request failed", error);
    return errorResponse(500, "internal_error", "The reading path could not be generated.");
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

function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Response {
  return Response.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status },
  );
}
