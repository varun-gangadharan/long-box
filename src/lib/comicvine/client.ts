import { z } from "zod";

import {
  rawCharacterSchema,
  rawIssueSchema,
  rawIssueSummarySchema,
  rawStoryArcSchema,
  rawVolumeSchema,
  rawVolumeSummarySchema,
  responseSchema,
} from "./schemas";
import {
  normalizeCharacter,
  normalizeIssue,
  normalizeIssueSummary,
  normalizeStoryArc,
  normalizeVolume,
  normalizeVolumeSummary,
} from "./normalize";
import type {
  ComicVineCharacter,
  ComicVineIssue,
  ComicVineIssueSummary,
  ComicVineStoryArc,
  ComicVineVolume,
  ComicVineVolumeSummary,
} from "./types";

const BASE_URL = "https://comicvine.gamespot.com/api";
const DEFAULT_PAGE_SIZE = 100;
// ComicVine answers a rate-limited request with 420, not 429.
const RETRYABLE_STATUSES = new Set([420, 429, 500, 502, 503, 504]);
/** Pipe-separated ID filters are capped at the page size. */
const MAX_IDS_PER_REQUEST = 100;

export class ComicVineError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ComicVineError";
  }
}

type ClientOptions = {
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  sleep?: (milliseconds: number) => Promise<void>;
};

type Page<T> = {
  results: T[];
  total: number;
  offset: number;
  limit: number;
};

export class ComicVineClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(
    private readonly apiKey: string,
    options: ClientOptions = {},
  ) {
    if (!apiKey.trim()) throw new Error("ComicVine API key is required");
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async searchCharacters(query: string, limit = 10): Promise<ComicVineCharacter[]> {
    if (!query.trim()) return [];
    const raw = await this.getAllPages(
      "/search/",
      rawCharacterSchema,
      {
        query,
        resources: "character",
        // Aliases and appearance counts are what let the caller tell the famous
        // owner of a name from an obscure character who merely shares it.
        field_list: "id,name,deck,image,publisher,aliases,count_of_issue_appearances",
      },
      limit,
    );
    return raw.map(normalizeCharacter);
  }

  async getCharacter(comicvineId: number): Promise<ComicVineCharacter> {
    const raw = await this.getOne(
      `/character/4005-${comicvineId}/`,
      rawCharacterSchema,
      {
        field_list:
          "id,name,deck,description,image,publisher,issue_credits,aliases,count_of_issue_appearances",
      },
    );
    return normalizeCharacter(raw);
  }

  /**
   * One volume request carries `count_of_issues` and the per-character appearance
   * counts that tell a co-starring book from a guest spot. Those counts exist
   * nowhere else short of fetching every issue's credits individually, which the
   * 200-requests-per-hour limit makes impossible.
   */
  async getVolume(comicvineId: number): Promise<ComicVineVolume> {
    const raw = await this.getOne(
      `/volume/4050-${comicvineId}/`,
      rawVolumeSchema,
    );
    return normalizeVolume(raw);
  }

  async getStoryArc(comicvineId: number): Promise<ComicVineStoryArc> {
    const raw = await this.getOne(
      `/story_arc/4045-${comicvineId}/`,
      rawStoryArcSchema,
    );
    return normalizeStoryArc(raw);
  }

  /**
   * Full issue detail, including credits. One request per issue, so callers must
   * budget: the issue resource allows roughly 200 requests per hour.
   */
  async getIssues(
    issueCredits: Array<{ comicvineId: number }>,
    maxResults = 200,
  ): Promise<ComicVineIssue[]> {
    const issues: ComicVineIssue[] = [];
    for (const { comicvineId } of issueCredits.slice(0, maxResults)) {
      issues.push(await this.getIssue(comicvineId));
    }
    return issues;
  }

  async getIssue(comicvineId: number): Promise<ComicVineIssue> {
    const raw = await this.getOne(`/issue/4000-${comicvineId}/`, rawIssueSchema, {
      field_list:
        "id,volume,issue_number,name,cover_date,deck,description,image,character_credits,story_arc_credits,person_credits",
    });
    return normalizeIssue(raw);
  }

  /**
   * Volumes whose title contains a name — the books published *about* someone
   * rather than the ones they appear in.
   *
   * This is where a character's defining stories live. The Long Halloween, Dark
   * Victory and The Dark Knight Returns are each their own volume, and no amount
   * of sampling a character's ten thousand appearances reliably finds a thirteen
   * issue miniseries. One request does.
   */
  async getVolumesNamed(name: string, maxResults = 100): Promise<ComicVineVolumeSummary[]> {
    if (!name.trim()) return [];
    const raw = await this.getAllPages(
      "/volumes/",
      rawVolumeSummarySchema,
      {
        filter: `name:${name.trim()}`,
        field_list: "id,name,start_year,count_of_issues,publisher",
      },
      maxResults,
    );
    return raw.map(normalizeVolumeSummary);
  }

  /**
   * Every issue of one volume, 100 per request. Metadata only — the issues list
   * endpoint never returns credits.
   */
  async getVolumeIssues(volumeComicvineId: number, maxResults = 200): Promise<ComicVineIssueSummary[]> {
    const raw = await this.getAllPages(
      "/issues/",
      rawIssueSummarySchema,
      {
        filter: `volume:${volumeComicvineId}`,
        field_list: "id,volume,issue_number,name,cover_date,deck,description,image",
      },
      maxResults,
    );
    return raw.map(normalizeIssueSummary);
  }

  /**
   * Metadata for many issues at once, 100 per request, via a pipe-separated id
   * filter. The list endpoint never returns character, story-arc, or person
   * credits — only `getIssue` has those — so this is for hydrating volume and
   * publication data across a large co-appearance set cheaply.
   *
   * ComicVine silently omits IDs it no longer holds, so the result may be
   * shorter than the request.
   */
  async getIssueSummaries(comicvineIds: number[]): Promise<ComicVineIssueSummary[]> {
    const unique = [...new Set(comicvineIds)];
    const summaries: ComicVineIssueSummary[] = [];

    for (let start = 0; start < unique.length; start += MAX_IDS_PER_REQUEST) {
      const batch = unique.slice(start, start + MAX_IDS_PER_REQUEST);
      const page = await this.getAllPages(
        "/issues/",
        rawIssueSummarySchema,
        {
          filter: `id:${batch.join("|")}`,
          field_list: "id,volume,issue_number,name,cover_date,deck,description,image",
        },
        batch.length,
      );
      summaries.push(...page.map(normalizeIssueSummary));
    }

    return summaries;
  }

  private async getOne<T>(
    path: string,
    schema: z.ZodType<T>,
    params: Record<string, string> = {},
  ): Promise<T> {
    const pageSchema = responseSchema(schema.nullable());
    const payload = await this.request(path, params, pageSchema);
    if (!payload.results) throw new ComicVineError(`No result returned for ${path}`);
    return payload.results;
  }

  private async getAllPages<T>(
    path: string,
    schema: z.ZodType<T>,
    params: Record<string, string>,
    maxResults: number,
  ): Promise<T[]> {
    const results: T[] = [];
    let offset = 0;

    while (results.length < maxResults) {
      const requestedLimit = Math.min(DEFAULT_PAGE_SIZE, maxResults - results.length);
      const page = await this.getPage(path, schema, {
        ...params,
        limit: String(requestedLimit),
        offset: String(offset),
      });
      results.push(...page.results);
      offset += page.results.length;
      if (!page.results.length || offset >= page.total) break;
    }

    return results.slice(0, maxResults);
  }

  private async getPage<T>(
    path: string,
    schema: z.ZodType<T>,
    params: Record<string, string>,
  ): Promise<Page<T>> {
    const payload = await this.request(path, params, responseSchema(z.array(schema)));
    return {
      results: payload.results,
      total: payload.number_of_total_results,
      offset: payload.offset,
      limit: payload.limit,
    };
  }

  private async request<T>(
    path: string,
    params: Record<string, string>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const url = new URL(`${BASE_URL}${path}`);
    url.search = new URLSearchParams({
      api_key: this.apiKey,
      format: "json",
      ...params,
    }).toString();

    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchImpl(url, {
          headers: { Accept: "application/json", "User-Agent": "LongBox/0.1" },
          signal: controller.signal,
        });

        if (!response.ok) {
          if (RETRYABLE_STATUSES.has(response.status) && attempt < this.maxRetries) {
            await this.sleep(this.retryDelay(response, attempt));
            continue;
          }
          throw new ComicVineError(
            `ComicVine request failed with HTTP ${response.status}`,
            response.status,
          );
        }

        const json: unknown = await response.json();
        if (
          typeof json === "object" &&
          json !== null &&
          "status_code" in json &&
          json.status_code !== 1
        ) {
          const message =
            "error" in json && typeof json.error === "string"
              ? json.error
              : "unknown API error";
          throw new ComicVineError(`ComicVine API error: ${message}`);
        }
        const parsed = schema.safeParse(json);
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          throw new ComicVineError(
            `ComicVine returned malformed data at ${issue?.path.join(".") || "response"}: ${issue?.message ?? "unknown schema error"}`,
          );
        }
        return parsed.data;
      } catch (error) {
        if (error instanceof ComicVineError) throw error;
        if (attempt < this.maxRetries) {
          await this.sleep(250 * 2 ** attempt);
          continue;
        }
        const message = error instanceof Error ? error.message : "unknown error";
        throw new ComicVineError(`ComicVine request failed: ${message}`);
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  private retryDelay(response: Response, attempt: number): number {
    const retryAfter = Number(response.headers.get("retry-after"));
    return Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1_000
      : 250 * 2 ** attempt;
  }
}

export function comicVineClientFromEnv(): ComicVineClient {
  const apiKey = process.env.COMICVINE_API_KEY;
  if (!apiKey) throw new Error("COMICVINE_API_KEY is not configured");
  return new ComicVineClient(apiKey);
}
