import { loadEnvConfig } from "@next/env";

import { comicVineClientFromEnv } from "../src/lib/comicvine/client";
import { databaseFromEnv } from "../src/lib/db/client";
import {
  findIssuesForCharacters,
  findStoryArcsForCharacter,
} from "../src/lib/db/queries";
import { ingestCharacter } from "../src/lib/ingestion/ingest-character";

loadEnvConfig(process.cwd());

const maxIssues = Number(process.argv[2] ?? 100);
if (!Number.isInteger(maxIssues) || maxIssues < 1 || maxIssues > 500) {
  throw new Error("Issue limit must be an integer from 1 to 500");
}

async function main() {
  const database = databaseFromEnv();
  const comicVine = comicVineClientFromEnv();

  // Characters used by the eval cases are seeded alongside the originals so a
  // fresh database can produce fixtures with `npm run eval:record`.
  const characters = [
    "Daredevil",
    "Spider-Man",
    "Nightwing",
    "Starfire",
    "Batman",
    "Superman",
  ];

  for (const name of characters) {
    console.log(`Ingesting ${name}...`);
    console.log(await ingestCharacter(database, comicVine, name, maxIssues));
  }

  const [daredevil, spiderMan, shared, arcs] = await Promise.all([
    findIssuesForCharacters(database, ["Daredevil"]),
    findIssuesForCharacters(database, ["Spider-Man"]),
    findIssuesForCharacters(database, ["Daredevil", "Spider-Man"]),
    findStoryArcsForCharacter(database, "Daredevil"),
  ]);

  console.log({
    daredevilIssues: daredevil.length,
    spiderManIssues: spiderMan.length,
    sharedIssues: shared.length,
    daredevilStoryArcs: arcs.length,
    sampleSharedIssue: shared[0] ?? null,
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
