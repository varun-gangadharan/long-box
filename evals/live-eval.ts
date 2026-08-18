import { loadEnvConfig } from "@next/env";

import { comicVineClientFromEnv } from "../src/lib/comicvine/client";
import { databaseFromEnv } from "../src/lib/db/client";
import { buildReadingPath } from "../src/lib/reading-path/service";

/**
 * Runs the whole pipeline — resolution, on-demand ingestion, retrieval, ranking —
 * against real ComicVine and Supabase, and prints the top results with their
 * full feature vectors. This is the only check that covers retrieval; the
 * offline eval replays fixtures and cannot tell you whether ingestion found the
 * right books in the first place.
 *
 *   npm run eval:live -- "Nightwing+Starfire"
 */

loadEnvConfig(process.cwd());

const query = process.argv[2];
if (!query) {
  console.error('Usage: npm run eval:live -- "Nightwing+Starfire"');
  process.exit(1);
}

async function main(): Promise<void> {
  const startedAt = performance.now();
  const result = await buildReadingPath(
    databaseFromEnv(),
    { type: "characters", names: query.split("+").map((name) => name.trim()) },
    comicVineClientFromEnv(),
  );
  const durationMs = Math.round(performance.now() - startedAt);

  console.log(`\n${result.query.characters.map(({ name }) => name).join(" + ")}`);
  console.log(`${result.recommendations.length} recommendations in ${durationMs}ms\n`);

  if (durationMs > 60_000) {
    console.warn("WARNING: slower than the route's 60s maxDuration.\n");
  }

  for (const [index, recommendation] of result.recommendations.slice(0, 5).entries()) {
    const { features } = recommendation;
    console.log(`${index + 1}. ${recommendation.title}  [${recommendation.type}]`);
    console.log(
      `   score ${recommendation.score.toFixed(3)} · together ${features.togetherness.toFixed(3)} · ` +
        `beginner ${features.beginnerFriendliness.toFixed(3)}` +
        `${recommendation.eligibleAsStart ? "" : " · GATED"}`,
    );
    console.log(`   together: ${JSON.stringify(features.together)}`);
    console.log(`   beginner: ${JSON.stringify(features.beginner)}`);
    if (recommendation.creators.length) {
      console.log(
        `   creators: ${recommendation.creators.map(({ name, role }) => `${name} (${role})`).join(", ")}`,
      );
    }
    for (const reason of recommendation.reasons) console.log(`   - ${reason}`);
    console.log();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
