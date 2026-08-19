import { readFileSync } from "node:fs";
import { join } from "node:path";

import { loadEnvConfig } from "@next/env";
import { z } from "zod";

import { comicVineClientFromEnv } from "../src/lib/comicvine/client";
import { databaseFromEnv } from "../src/lib/db/client";
import { chunk, upsertIssues, upsertPublishers, upsertVolumes } from "../src/lib/ingestion/upserts";
import { WikidataClient, type AcclaimRecord } from "../src/lib/wikidata/client";
import { WikipediaPageviews } from "../src/lib/wikipedia/pageviews";

/**
 * Fills in what the outside world thinks of the books in the catalog.
 *
 * Deliberately offline. A cold reading path already spends up to ninety seconds
 * in ComicVine, and acclaim changes on the timescale of awards seasons, so it has
 * no business on the request path. Run it manually or from a cron; the engine
 * only ever reads the rows it leaves behind.
 *
 *   npm run enrich:acclaim -- --dry-run
 *   npm run enrich:acclaim
 */

loadEnvConfig(process.cwd());

const REFRESH_AFTER_DAYS = 30;

const curatedSchema = z.object({
  stories: z.array(
    z.object({
      name: z.string(),
      tier: z.number().int().min(1).max(3),
      volume: z.object({ name: z.string(), startYear: z.number().int() }),
      issueRange: z.tuple([z.number().int(), z.number().int()]).optional(),
      note: z.string(),
    }),
  ),
});

type VolumeRow = { id: string; comicvine_id: number; name: string; start_year: number | null };

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const database = databaseFromEnv();

  console.log(dryRun ? "Dry run — nothing will be written.\n" : "Enriching acclaim.\n");

  // --- Wikidata: awards and articles, joined by exact ComicVine id ---
  const records = await new WikidataClient().getComicAcclaim();
  console.log(`Wikidata: ${records.length} ComicVine-linked items`);

  const volumeRecords = new Map<number, AcclaimRecord>();
  const issueRecords = new Map<number, AcclaimRecord>();
  for (const record of records) {
    (record.resource === "volume" ? volumeRecords : issueRecords).set(record.comicvineId, record);
  }

  const volumes = await allRows<VolumeRow>(database, "volumes", "id,comicvine_id,name,start_year");
  const issues = await allRows<{ id: string; comicvine_id: number }>(
    database,
    "issues",
    "id,comicvine_id",
  );
  console.log(`Catalog: ${volumes.length} volumes, ${issues.length} issues`);

  const volumeMatches = volumes.flatMap((volume) => {
    const record = volumeRecords.get(Number(volume.comicvine_id));
    return record ? [{ volume, record }] : [];
  });
  const issueMatches = issues.flatMap((issue) => {
    const record = issueRecords.get(Number(issue.comicvine_id));
    return record ? [{ issue, record }] : [];
  });
  console.log(
    `Matched by exact id: ${volumeMatches.length} volumes, ${issueMatches.length} issues`,
  );

  // --- Wikipedia readership for the matched articles ---
  const fresh = await recentlyRefreshed(database);
  const pageviews = new WikipediaPageviews();
  const views = new Map<string, number | null>();
  const titles = [
    ...new Set(
      [...volumeMatches, ...issueMatches]
        .map(({ record }) => record.wikipediaTitle)
        .filter((title): title is string => Boolean(title)),
    ),
  ].filter((title) => !fresh.has(title));

  console.log(`Wikipedia: fetching readership for ${titles.length} articles`);
  for (const [index, title] of titles.entries()) {
    views.set(title, await pageviews.medianMonthlyViews(title));
    if ((index + 1) % 100 === 0) console.log(`  ${index + 1}/${titles.length}`);
  }

  // --- Curated list, resolved against the catalog rather than trusted blindly ---
  const curated = curatedSchema.parse(
    JSON.parse(readFileSync(join(process.cwd(), "data/acclaimed-stories.json"), "utf8")),
  );

  // A curated entry is useless if the book it names is not in the catalog, and
  // the catalog only holds what previous searches happened to pull in. Naming a
  // landmark is therefore also a reason to go and fetch it.
  if (!dryRun && !process.argv.includes("--no-backfill")) {
    await backfillCurated(database, curated.stories, volumes);
  }

  const volumesAfterBackfill = await allRows<VolumeRow>(
    database,
    "volumes",
    "id,comicvine_id,name,start_year",
  );
  const { volumeRows: curatedVolumes, issueRows: curatedIssues, unresolved } =
    await resolveCurated(database, curated.stories, volumesAfterBackfill);

  console.log(
    `\nCurated: ${curated.stories.length} entries — ` +
      `${curatedVolumes.length} volumes, ${curatedIssues.length} issues resolved`,
  );
  for (const entry of unresolved) console.log(`  UNRESOLVED  ${entry}`);

  // --- Merge and write ---
  const volumePayload = mergeVolume(volumeMatches, views, curatedVolumes);
  const issuePayload = mergeIssue(issueMatches, views, curatedIssues);

  console.log(
    `\nWriting ${volumePayload.length} volume rows and ${issuePayload.length} issue rows`,
  );
  if (dryRun) {
    for (const row of volumePayload.slice(0, 10)) console.log("  ", JSON.stringify(row));
    return;
  }

  for (const batch of chunk(volumePayload, 200)) {
    const { error } = await database.rpc("replace_volume_acclaim", { p_rows: batch });
    if (error) throw new Error(`Volume acclaim write failed: ${error.message}`);
  }
  for (const batch of chunk(issuePayload, 200)) {
    const { error } = await database.rpc("replace_issue_acclaim", { p_rows: batch });
    if (error) throw new Error(`Issue acclaim write failed: ${error.message}`);
  }
  console.log("Done.");
}

/** PostgREST caps a response at 1000 rows, so every table read has to page. */
async function allRows<T>(
  database: ReturnType<typeof databaseFromEnv>,
  table: string,
  columns: string,
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await database
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Reading ${table} failed: ${error.message}`);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

/** Articles whose readership was measured recently enough to leave alone. */
async function recentlyRefreshed(
  database: ReturnType<typeof databaseFromEnv>,
): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - REFRESH_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const fresh = new Set<string>();
  for (const table of ["volume_acclaim", "issue_acclaim"]) {
    const { data } = await database
      .from(table)
      .select("wikipedia_title")
      .gte("refreshed_at", cutoff)
      .not("monthly_pageviews", "is", null);
    for (const row of (data ?? []) as Array<{ wikipedia_title: string | null }>) {
      if (row.wikipedia_title) fresh.add(row.wikipedia_title);
    }
  }
  return fresh;
}

type CuratedStory = z.infer<typeof curatedSchema>["stories"][number];
type CuratedVolume = { volumeId: string; tier: number; story: string };
type CuratedIssue = { issueId: string; tier: number; story: string };

/**
 * Turns editorial entries into rows, by looking each one up in the catalog.
 *
 * Entries name a volume and an issue range rather than carrying ids, so a
 * mistake surfaces as an unresolved warning instead of silently decorating the
 * wrong book — which is the failure mode that makes curated data untrustworthy.
 */
async function resolveCurated(
  database: ReturnType<typeof databaseFromEnv>,
  stories: CuratedStory[],
  volumes: VolumeRow[],
): Promise<{ volumeRows: CuratedVolume[]; issueRows: CuratedIssue[]; unresolved: string[] }> {
  const volumeRows: CuratedVolume[] = [];
  const issueRows: CuratedIssue[] = [];
  const unresolved: string[] = [];

  for (const story of stories) {
    const matches = volumes.filter(
      (volume) =>
        normalize(volume.name) === normalize(story.volume.name) &&
        volume.start_year === story.volume.startYear,
    );
    if (matches.length !== 1) {
      unresolved.push(
        `${story.name} — ${matches.length === 0 ? "no" : `${matches.length}`} catalog match for "${story.volume.name}" (${story.volume.startYear})`,
      );
      continue;
    }
    const volume = matches[0];

    if (!story.issueRange) {
      volumeRows.push({ volumeId: volume.id, tier: story.tier, story: story.name });
      continue;
    }

    const [from, to] = story.issueRange;
    const { data, error } = await database
      .from("issues")
      .select("id,issue_number")
      .eq("volume_id", volume.id);
    if (error) throw new Error(`Reading issues failed: ${error.message}`);

    const inRange = ((data ?? []) as Array<{ id: string; issue_number: string }>).filter((issue) => {
      const number = Number(issue.issue_number);
      return Number.isInteger(number) && number >= from && number <= to;
    });
    if (!inRange.length) {
      unresolved.push(`${story.name} — ${story.volume.name} #${from}-${to} not ingested yet`);
      continue;
    }
    for (const issue of inRange) {
      issueRows.push({ issueId: issue.id, tier: story.tier, story: story.name });
    }
  }

  return { volumeRows, issueRows, unresolved };
}

function mergeVolume(
  matches: Array<{ volume: VolumeRow; record: AcclaimRecord }>,
  views: Map<string, number | null>,
  curated: CuratedVolume[],
): Array<Record<string, unknown>> {
  const rows = new Map<string, Record<string, unknown>>();
  for (const { volume, record } of matches) {
    rows.set(volume.id, {
      volume_id: volume.id,
      wikidata_id: record.wikidataId,
      wikipedia_title: record.wikipediaTitle,
      monthly_pageviews: record.wikipediaTitle ? (views.get(record.wikipediaTitle) ?? null) : null,
      award_count: record.awardCount,
      top_award: record.topAward,
    });
  }
  for (const entry of curated) {
    rows.set(entry.volumeId, {
      ...(rows.get(entry.volumeId) ?? { volume_id: entry.volumeId, award_count: 0 }),
      curated_tier: entry.tier,
      curated_story: entry.story,
    });
  }
  return [...rows.values()];
}

function mergeIssue(
  matches: Array<{ issue: { id: string; comicvine_id: number }; record: AcclaimRecord }>,
  views: Map<string, number | null>,
  curated: CuratedIssue[],
): Array<Record<string, unknown>> {
  const rows = new Map<string, Record<string, unknown>>();
  for (const { issue, record } of matches) {
    rows.set(issue.id, {
      issue_id: issue.id,
      wikidata_id: record.wikidataId,
      wikipedia_title: record.wikipediaTitle,
      monthly_pageviews: record.wikipediaTitle ? (views.get(record.wikipediaTitle) ?? null) : null,
      award_count: record.awardCount,
      top_award: record.topAward,
    });
  }
  for (const entry of curated) {
    rows.set(entry.issueId, {
      ...(rows.get(entry.issueId) ?? { issue_id: entry.issueId, award_count: 0 }),
      curated_tier: entry.tier,
      curated_story: entry.story,
    });
  }
  return [...rows.values()];
}

/**
 * Fetches the books the curated list names but the catalog does not have.
 *
 * Best effort by design: ComicVine allows roughly 200 requests an hour, so a
 * long list will not complete in one run. Whatever arrives is written, the rest
 * resolves on a later run, and a failure here never stops the sourced data from
 * being saved.
 */
async function backfillCurated(
  database: ReturnType<typeof databaseFromEnv>,
  stories: CuratedStory[],
  volumes: VolumeRow[],
): Promise<void> {
  const comicVine = comicVineClientFromEnv();
  const byKey = new Map(volumes.map((volume) => [volumeKey(volume.name, volume.start_year), volume]));

  for (const story of stories) {
    const key = volumeKey(story.volume.name, story.volume.startYear);
    const known = byKey.get(key);

    try {
      if (!known) {
        // The volume itself is missing. Find it by name and year, then take it.
        const candidates = await comicVine.getVolumesNamed(story.volume.name);
        const match = candidates.find(
          (candidate) =>
            volumeKey(candidate.name, candidate.startYear) === key,
        );
        if (!match) {
          console.log(`  backfill: no ComicVine volume for ${story.name}`);
          continue;
        }
        const publisherIds = await upsertPublishers(database, [match.publisher]);
        const volumeIds = await upsertVolumes(
          database,
          [{ ...match, characterCounts: [] }],
          publisherIds,
        );
        const issues = await comicVine.getVolumeIssues(match.comicvineId, 1000);
        if (issues.length) await upsertIssues(database, issues, volumeIds);
        console.log(`  backfill: ${story.name} — ${issues.length} issues`);
        continue;
      }

      if (!story.issueRange) continue;

      // The volume is known but the specific issues are not, because ingestion
      // samples across a long run rather than taking all of it.
      const [from, to] = story.issueRange;
      const { count } = await database
        .from("issues")
        .select("*", { count: "exact", head: true })
        .eq("volume_id", known.id);
      const issues = await comicVine.getVolumeIssues(Number(known.comicvine_id), 1200);
      const wanted = issues.filter((issue) => {
        const number = Number(issue.issueNumber);
        return Number.isInteger(number) && number >= from && number <= to;
      });
      if (!wanted.length) {
        console.log(`  backfill: ComicVine has no ${story.volume.name} #${from}-${to}`);
        continue;
      }
      const publisherIds = await upsertPublishers(database, []);
      const volumeIds = new Map([[Number(known.comicvine_id), known.id]]);
      void publisherIds;
      await upsertIssues(database, wanted, volumeIds);
      console.log(
        `  backfill: ${story.name} — ${wanted.length} issues (volume had ${count ?? 0})`,
      );
    } catch (error) {
      console.log(
        `  backfill skipped for ${story.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return; // Upstream is unhappy; stop asking rather than burning the budget.
    }
  }
}

function volumeKey(name: string, startYear: number | null): string {
  return `${normalize(name)}|${startYear ?? ""}`;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
