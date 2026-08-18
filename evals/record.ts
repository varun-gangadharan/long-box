import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadEnvConfig } from "@next/env";

import { comicVineClientFromEnv } from "../src/lib/comicvine/client";
import { databaseFromEnv } from "../src/lib/db/client";
import {
  ensureCreditIndex,
  ingestCoAppearances,
} from "../src/lib/ingestion/ingest-co-appearances";
import {
  findCandidateIssues,
  findVolumeAffinities,
  resolveCharacters,
} from "../src/lib/reading-path/repository";

import { FIXTURES_DIR, loadCases } from "./shared";

/**
 * Captures real retrieval output into `evals/fixtures/` so the offline eval can
 * replay it deterministically in CI. Requires ComicVine and Supabase
 * credentials, ingests on demand, and is never run automatically.
 *
 *   npm run eval:record                 every case
 *   npm run eval:record -- nightwing    one case
 */

loadEnvConfig(process.cwd());

const database = databaseFromEnv();
const comicVine = comicVineClientFromEnv();
const cases = loadCases(process.argv[2]);

if (!cases.length) {
  console.error("No matching cases.");
  process.exit(1);
}

async function main(): Promise<void> {
  for (const evalCase of cases) {
    console.log(`\nRecording ${evalCase.name}: ${evalCase.characters.join(" + ")}`);

    try {
      const characters = await resolveCharacters(database, evalCase.characters);
      const characterIds = characters.map(({ id }) => id);

      // Enrichment is best-effort. Recording is about capturing what retrieval
      // currently returns, and a rate-limited upstream should not stop us
      // snapshotting data that is already in the database.
      try {
        await ensureCreditIndex(database, comicVine, characterIds);
        const ingestion = await ingestCoAppearances(database, comicVine, characterIds);
        console.log(`  ingestion: ${JSON.stringify(ingestion)}`);
      } catch (error) {
        console.log(
          `  ingestion skipped (${error instanceof Error ? error.message : String(error)}); recording what is stored`,
        );
      }

      const [issues, affinities] = await Promise.all([
        findCandidateIssues(database, characterIds),
        findVolumeAffinities(database, characterIds),
      ]);

      if (!issues.length) {
        console.error(`  no shared issues found — fixture not written`);
        continue;
      }

      writeFileSync(
        join(FIXTURES_DIR, `${evalCase.name}.json`),
        JSON.stringify(
          {
            name: evalCase.name,
            source: "recorded",
            recordedAt: new Date().toISOString(),
            note: evalCase.notes,
            characterPublishers: characters.flatMap(({ publisherName }) =>
              publisherName ? [publisherName] : [],
            ),
            issues,
            affinities,
          },
          null,
          2,
        ) + "\n",
      );
      console.log(`  wrote ${issues.length} issues across ${affinities.length} volumes`);
    } catch (error) {
      console.error(`  failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
