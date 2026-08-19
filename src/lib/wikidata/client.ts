import { z } from "zod";

/**
 * Wikidata as a source of comic notability.
 *
 * The reason this is usable at all is property P5905, "Comic Vine ID", whose
 * values carry ComicVine's own resource prefix — "4050-6822" is a volume,
 * "4000-..." an issue. That makes the join to our catalog an exact id match
 * rather than a fuzzy title match, which is what makes external data safe to
 * trust here.
 *
 * Wikidata is CC0, so the values may be stored and reused without attribution.
 */

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";

/**
 * Wikimedia asks for a descriptive User-Agent identifying the application, so a
 * misbehaving client can be contacted rather than simply blocked.
 */
export const WIKIMEDIA_USER_AGENT =
  "LongBox/0.1 (comic reading-path recommender; https://long-box.vercel.app)";

/**
 * Every ComicVine-linked item, with any awards it has received and its English
 * Wikipedia article. One request covers the whole set — roughly a thousand
 * volumes and two thousand issues — so this is cheap to refresh.
 *
 * Grouped in SPARQL rather than returning a row per award, because an item with
 * eight awards would otherwise dominate the response.
 */
const ACCLAIM_QUERY = `
SELECT ?item ?comicvineId ?article
       (COUNT(DISTINCT ?award) AS ?awardCount)
       (SAMPLE(?awardLabel) AS ?topAward)
WHERE {
  ?item wdt:P5905 ?comicvineId .
  FILTER(STRSTARTS(?comicvineId, "4050-") || STRSTARTS(?comicvineId, "4000-"))
  OPTIONAL {
    ?item wdt:P166 ?award .
    ?award rdfs:label ?awardLabel .
    FILTER(LANG(?awardLabel) = "en")
  }
  OPTIONAL {
    ?article schema:about ?item ;
             schema:isPartOf <https://en.wikipedia.org/> .
  }
}
GROUP BY ?item ?comicvineId ?article
`;

const sparqlResponseSchema = z.object({
  results: z.object({
    bindings: z.array(
      z.object({
        item: z.object({ value: z.string() }),
        comicvineId: z.object({ value: z.string() }),
        article: z.object({ value: z.string() }).optional(),
        awardCount: z.object({ value: z.string() }).optional(),
        topAward: z.object({ value: z.string() }).optional(),
      }),
    ),
  }),
});

export type AcclaimRecord = {
  /** Wikidata item id, e.g. "Q512835". */
  wikidataId: string;
  /** ComicVine resource this describes. */
  resource: "volume" | "issue";
  comicvineId: number;
  /** English Wikipedia article title, already URL-decoded. */
  wikipediaTitle: string | null;
  awardCount: number;
  topAward: string | null;
};

export class WikidataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WikidataError";
  }
}

export type WikidataClientOptions = {
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export class WikidataClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: WikidataClientOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    // The query scans a whole property; the public endpoint allows 60s.
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async getComicAcclaim(): Promise<AcclaimRecord[]> {
    const url = new URL(SPARQL_ENDPOINT);
    url.searchParams.set("format", "json");
    url.searchParams.set("query", ACCLAIM_QUERY);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        headers: { Accept: "application/sparql-results+json", "User-Agent": WIKIMEDIA_USER_AGENT },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new WikidataError(`Wikidata query failed with HTTP ${response.status}`);
      }

      const parsed = sparqlResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new WikidataError(`Wikidata returned an unexpected shape: ${parsed.error.issues[0]?.message}`);
      }
      return parsed.data.results.bindings.flatMap(toRecord);
    } catch (error) {
      if (error instanceof WikidataError) throw error;
      throw new WikidataError(
        `Wikidata query failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function toRecord(
  binding: z.infer<typeof sparqlResponseSchema>["results"]["bindings"][number],
): AcclaimRecord[] {
  const [prefix, rawId] = binding.comicvineId.value.split("-", 2);
  const comicvineId = Number(rawId);
  if (!Number.isInteger(comicvineId) || comicvineId <= 0) return [];

  const resource = prefix === "4050" ? "volume" : prefix === "4000" ? "issue" : null;
  if (!resource) return [];

  return [
    {
      wikidataId: binding.item.value.replace(/^.*\//, ""),
      resource,
      comicvineId,
      wikipediaTitle: articleTitle(binding.article?.value),
      awardCount: Number(binding.awardCount?.value ?? 0) || 0,
      topAward: binding.topAward?.value ?? null,
    },
  ];
}

/** Turns an article URL into the title the pageviews API expects. */
function articleTitle(url?: string): string | null {
  if (!url) return null;
  const slug = url.replace(/^.*\/wiki\//, "");
  try {
    return decodeURIComponent(slug) || null;
  } catch {
    return slug || null;
  }
}
