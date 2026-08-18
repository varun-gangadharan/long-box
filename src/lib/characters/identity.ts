/**
 * How strong a claim a character has on a requested name.
 *
 * The same judgement is needed in two places — choosing among ComicVine search
 * results at ingestion time, and choosing among stored rows at lookup time — and
 * they must agree, or a character can be ingested under one identity and
 * resolved as another.
 *
 * Three facts decide it:
 *
 * 1. ComicVine files many characters under a civilian name. Dick Grayson is
 *    "Dick Grayson"; "Nightwing" is an alias. Matching names alone lands on an
 *    unrelated character with a single appearance.
 * 2. Publication volume alone is no better. Superman also lists "Nightwing", his
 *    Kandor identity, and outnumbers Dick Grayson two to one.
 * 3. Alias lists are ordered roughly by prominence. "Nightwing" is Dick
 *    Grayson's second alias and Superman's sixth.
 *
 * So a claim is how published the character is, discounted by how peripheral the
 * name is to them. A character's own name takes the full weight.
 */
export type IdentityClaim = {
  /** The request matched this character's own name rather than an alias. */
  isNameMatch: boolean;
  /** Zero-based position in the alias list; null for a name match. */
  aliasPosition: number | null;
  appearanceCount: number | null;
};

export function identityScore(claim: IdentityClaim): number {
  const appearances = claim.appearanceCount ?? 0;
  if (claim.isNameMatch) return Math.max(appearances, 1);
  return appearances / ((claim.aliasPosition ?? 0) + 1);
}

/** A winner needs to be clearly ahead; anything closer is a genuine collision. */
export const DECISIVE_MARGIN = 1.25;

/**
 * The single best claim, or null when the leaders are too close to call and the
 * caller should report ambiguity rather than guess.
 */
export function bestClaim<T>(
  candidates: T[],
  toClaim: (candidate: T) => IdentityClaim,
): T | null {
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  const ranked = [...candidates]
    .map((candidate) => ({ candidate, score: identityScore(toClaim(candidate)) }))
    .sort((left, right) => right.score - left.score);

  const [best, runnerUp] = ranked;
  if (best.score <= 0) return null;
  return best.score >= runnerUp.score * DECISIVE_MARGIN ? best.candidate : null;
}
