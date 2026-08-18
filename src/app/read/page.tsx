import Link from "next/link";

import { ReadingPathView } from "@/components/reading-path-view";
import { SiteHeader } from "@/components/site-header";
import { databaseFromEnv } from "@/lib/db/client";
import { logError } from "@/lib/observability/logger";
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
import type { ReadingPathResult } from "@/lib/reading-path/types";

// Matches the API route: a first-time character pair pays for ingestion once.
export const maxDuration = 300;

export default async function ReadPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const values = await searchParams;
  const params = new URLSearchParams();
  if (typeof values.characters === "string") params.set("characters", values.characters);
  if (typeof values.storyArc === "string") params.set("storyArc", values.storyArc);
  const outcome = await loadReadingPath(params);

  if ("error" in outcome) {
    return (
      <>
        <SiteHeader />
        <main className="system-state" role="alert">
          <p className="section-kicker">We could not open that path</p>
          <h1>Try another way in</h1>
          <p>{outcome.error}</p>
          <Link className="primary-button" href="/">
            Back to search
          </Link>
        </main>
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <ReadingPathView result={outcome.result} />
    </>
  );
}

async function loadReadingPath(
  params: URLSearchParams,
): Promise<{ result: ReadingPathResult } | { error: string }> {
  try {
    return {
      result: await buildReadingPath(databaseFromEnv(), parseReadingPathQuery(params)),
    };
  } catch (error) {
    logError("Reading path page failed", error);
    return { error: readerFacingMessage(error) };
  }
}

/**
 * Mirrors the API route's error taxonomy. Only messages we wrote ourselves reach
 * the page; anything else — a database or upstream failure whose text could
 * carry internals — becomes a generic line.
 */
function readerFacingMessage(error: unknown): string {
  if (error instanceof InvalidReadingPathQueryError) return error.message;
  if (error instanceof CharacterNotFoundError) {
    return `I could not find a character called “${error.requestedName}”. Check the spelling, or try another name they go by.`;
  }
  if (error instanceof StoryArcNotFoundError) {
    return `I could not find a story arc called “${error.requestedName}”.`;
  }
  if (error instanceof AmbiguousCharacterError) {
    return `More than one character is called “${error.requestedName}”. Try a more specific name.`;
  }
  if (error instanceof AmbiguousStoryArcError) {
    return `More than one story arc is called “${error.requestedName}”. Try a more specific name.`;
  }
  return "The reading path is unavailable right now. Please try again.";
}
