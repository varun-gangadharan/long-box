import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import type { CandidateIssue, VolumeAffinity } from "../src/lib/reading-path/types";

export const EVALS_DIR = join(import.meta.dirname, ".");
export const CASES_DIR = join(EVALS_DIR, "cases");
export const FIXTURES_DIR = join(EVALS_DIR, "fixtures");

/**
 * A recommendation is right or wrong for reasons a person can state, so every
 * case names what a good answer looks like and — just as importantly — the
 * specific wrong answer we have seen the engine give.
 */
export const evalCaseSchema = z.object({
  name: z.string(),
  characters: z.array(z.string()).min(1),
  notes: z.string(),
  expect: z.object({
    /** The top result must match one of these. */
    top1AnyOf: z.array(z.string()).default([]),
    /** These should show up somewhere in the top three. */
    top3AnyOf: z.array(z.string()).default([]),
    /** Known bad answers. Any of these in the top three is a trap hit. */
    mustNotAppearTop3: z.array(z.string()).default([]),
    /** Floor for the top result's togetherness score. */
    minTogetherness: z.number().min(0).max(1).optional(),
    /**
     * Ceiling for the top result's togetherness score. For pairs whose only
     * shared books are crossovers: surfacing the crossover is right, claiming it
     * is a book about them is not.
     */
    maxTogetherness: z.number().min(0).max(1).optional(),
    /**
     * True for pairs that genuinely have no shared book. The right behaviour is
     * to say so, not to promote a cameo, so the top result must fail the gate.
     */
    expectNoStrongMatch: z.boolean().default(false),
  }),
});

export type EvalCase = z.infer<typeof evalCaseSchema>;

export const fixtureSchema = z.object({
  name: z.string(),
  /**
   * `recorded` fixtures are real RPC output captured by `npm run eval:record`.
   * `authored` fixtures encode known facts about well-documented comics so the
   * suite can gate CI before anyone has database credentials. Authored fixtures
   * test the ranking model; recorded ones also test retrieval.
   */
  source: z.enum(["recorded", "authored"]),
  recordedAt: z.string().optional(),
  /** Publishers of the resolved characters; the engine uses them to prefer original editions. */
  characterPublishers: z.array(z.string()).default([]),
  issues: z.array(z.custom<CandidateIssue>()),
  affinities: z.array(z.custom<VolumeAffinity>()),
});

export type Fixture = z.infer<typeof fixtureSchema>;

export function loadCases(filter?: string): EvalCase[] {
  return readdirSync(CASES_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => evalCaseSchema.parse(JSON.parse(readFileSync(join(CASES_DIR, file), "utf8"))))
    .filter((entry) => !filter || entry.name.includes(filter))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function loadFixture(name: string): Fixture | null {
  try {
    return fixtureSchema.parse(
      JSON.parse(readFileSync(join(FIXTURES_DIR, `${name}.json`), "utf8")),
    );
  } catch {
    return null;
  }
}

/**
 * Titles are compared loosely on purpose. A case says "The New Teen Titans
 * (1980)" while a candidate is titled "The New Teen Titans (1980) #1–40", and
 * pinning the exact rendered string would make the suite fail on wording changes
 * rather than on ranking changes.
 */
export function matches(candidateTitle: string, expected: string): boolean {
  return normalize(candidateTitle).includes(normalize(expected));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
