import { z } from "zod";

import { WIKIMEDIA_USER_AGENT } from "@/lib/wikidata/client";

/**
 * Monthly Wikipedia readership for an article, as a proxy for how much attention
 * a story still gets.
 *
 * This measures attention, not quality — a film adaptation lifts a book's views
 * regardless of whether the book is good — so it belongs as a weak supporting
 * signal and never on its own. Its virtue is coverage: far more comics have a
 * Wikipedia article than have an award recorded in Wikidata.
 *
 * No API key. Wikimedia asks for a descriptive User-Agent, which the shared
 * constant supplies.
 */

const BASE_URL = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article";
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const responseSchema = z.object({
  items: z.array(z.object({ views: z.number().nonnegative() })),
});

export type PageviewsOptions = {
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  sleep?: (milliseconds: number) => Promise<void>;
};

export class WikipediaPageviews {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(options: PageviewsOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.sleep =
      options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * Median monthly views over the trailing year, or null when the article has no
   * data. The median rather than the mean, because a single spike — a film
   * release, a character's death in the news — should not define a book's
   * standing.
   */
  async medianMonthlyViews(articleTitle: string, months = 12): Promise<number | null> {
    const { start, end } = trailingRange(months);
    const path = `${BASE_URL}/en.wikipedia/all-access/all-agents/${encodeURIComponent(articleTitle)}/monthly/${start}/${end}`;

    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(path, {
          headers: { Accept: "application/json", "User-Agent": WIKIMEDIA_USER_AGENT },
          signal: controller.signal,
        });

        // An article with no recorded views is a normal answer, not a failure.
        if (response.status === 404) return null;
        if (!response.ok) {
          if (RETRYABLE_STATUSES.has(response.status) && attempt < this.maxRetries) {
            await this.sleep(250 * 2 ** attempt);
            continue;
          }
          return null;
        }

        const parsed = responseSchema.safeParse(await response.json());
        if (!parsed.success || !parsed.data.items.length) return null;
        return median(parsed.data.items.map(({ views }) => views));
      } catch {
        if (attempt < this.maxRetries) {
          await this.sleep(250 * 2 ** attempt);
          continue;
        }
        // Readership is a supporting signal; failing to get it is not fatal.
        return null;
      } finally {
        clearTimeout(timeout);
      }
    }
  }
}

function trailingRange(months: number): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  start.setMonth(start.getMonth() - months);
  return { start: stamp(start), end: stamp(end) };
}

function stamp(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}0100`;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}
