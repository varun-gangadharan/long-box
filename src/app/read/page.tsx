import Link from "next/link";

import { ReadingPathView } from "@/components/reading-path-view";
import { SiteHeader } from "@/components/site-header";
import { databaseFromEnv } from "@/lib/db/client";
import {
  buildReadingPath,
  parseReadingPathQuery,
} from "@/lib/reading-path/service";
import type { ReadingPathResult } from "@/lib/reading-path/types";

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
    return {
      error: error instanceof Error ? error.message : "The reading path is unavailable.",
    };
  }
}
