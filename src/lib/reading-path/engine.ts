import { normalizeEntityName } from "./names";
import type {
  BeginnerFriendlinessFeatures,
  CandidateIssue,
  CreatorCredit,
  RankedRecommendation,
  RankingFeatures,
  ReadingCandidate,
  TogethernessFeatures,
  VolumeAffinity,
} from "./types";

/**
 * Two orthogonal questions decide a recommendation, and a book has to answer
 * both: is this actually *about* these characters together, and can somebody who
 * has read nothing start here? Scoring them separately is what stops a
 * beginner-friendly one-shot in which a character makes a single cameo from
 * winning the top slot.
 */
export const SCORE_WEIGHTS = {
  togetherness: 0.62,
  beginnerFriendliness: 0.38,
} as const;

export const TOGETHERNESS_WEIGHTS = {
  coreCastScore: 0.38,
  coAppearanceShare: 0.18,
  sustainedRunScore: 0.16,
  publisherAffinity: 0.14,
  sharedArcScore: 0.08,
  titleAffinity: 0.06,
  cameoPenalty: 0.3,
} as const;

export const BEGINNER_WEIGHTS = {
  entryPointScore: 0.24,
  commitmentScore: 0.22,
  prerequisiteDepth: 0.18,
  selfContainment: 0.16,
  castManageability: 0.1,
  creativeTeamCohesion: 0.1,
} as const;

/**
 * Below this, a candidate is never offered as the starting point however
 * approachable it looks. This is the guard against the failure the engine was
 * rebuilt for: recommending a book one character merely passes through.
 */
export const TOGETHERNESS_GATE = 0.45;

/** Co-appearances needed before a volume is treated as a run worth naming. */
const MIN_VOLUME_RUN_ISSUES = 4;

/**
 * Used when ComicVine's per-volume counts have not been fetched. Deliberately
 * mid-low: an unproven candidate should rank below one with real evidence
 * without being written off, and it must never be assumed to be a co-starring
 * book just because the only issues on hand happen to be shared ones.
 */
const UNKNOWN_CORE_CAST = 0.3;

export type CandidateOptions = {
  queryType?: ReadingCandidate["queryType"];
  requestedStoryArcId?: string;
  affinities?: VolumeAffinity[];
};

export type RankingOptions = {
  characterNames?: string[];
  /** Publishers of the requested characters, used to prefer original editions. */
  characterPublishers?: string[];
};

export function generateCandidates(
  issues: CandidateIssue[],
  options: CandidateOptions = {},
): ReadingCandidate[] {
  const { queryType = "characters", requestedStoryArcId, affinities = [] } = options;
  const affinityByVolume = new Map(affinities.map((entry) => [entry.volumeId, entry]));

  const volumeRuns = volumeRunCandidates(issues, queryType, affinityByVolume);
  // A volume run covering one unbroken stretch is the same reading as the issue
  // run for that stretch, so only the identical duplicate is dropped. Where the
  // shared issues fall into several stretches the two candidates differ — the
  // whole run, and the shorter pieces inside it — and both are worth offering.
  const coveredRuns = new Set(volumeRuns.map(({ issues: runIssues }) => issueSetKey(runIssues)));

  return [
    ...storyArcCandidates(issues, queryType, affinityByVolume, requestedStoryArcId),
    ...volumeRuns,
    ...issueRunCandidates(issues, queryType, affinityByVolume, coveredRuns),
  ];
}

export function calculateFeatures(
  candidate: ReadingCandidate,
  options: RankingOptions = {},
): RankingFeatures {
  const together = togethernessFeatures(
    candidate,
    options.characterNames ?? [],
    options.characterPublishers ?? [],
  );
  const beginner = beginnerFeatures(candidate);

  return {
    togetherness: combineTogetherness(together),
    beginnerFriendliness: combineBeginner(beginner),
    metadataCompleteness: average(
      candidate.issues.map(
        (issue) =>
          [issue.name, issue.coverDate, issue.imageUrl, issue.volume.startYear].filter(
            (value) => value !== null,
          ).length / 4,
      ),
    ),
    together,
    beginner,
  };
}

export function scoreCandidate(features: RankingFeatures): number {
  return round(
    clamp(
      features.togetherness * SCORE_WEIGHTS.togetherness +
        features.beginnerFriendliness * SCORE_WEIGHTS.beginnerFriendliness,
    ),
  );
}

export function rankCandidates(
  candidates: ReadingCandidate[],
  options: RankingOptions = {},
): RankedRecommendation[] {
  return candidates
    .map((candidate) => {
      const features = calculateFeatures(candidate, options);
      return {
        ...candidate,
        score: scoreCandidate(features),
        features,
        reasons: explainCandidate(candidate, features),
        eligibleAsStart: features.togetherness >= TOGETHERNESS_GATE,
      };
    })
    .sort(
      (left, right) =>
        Number(right.eligibleAsStart) - Number(left.eligibleAsStart) ||
        right.score - left.score ||
        right.features.togetherness - left.features.togetherness ||
        right.features.metadataCompleteness - left.features.metadataCompleteness ||
        earliestDate(left).localeCompare(earliestDate(right)) ||
        left.id.localeCompare(right.id),
    );
}

// --- Togetherness -----------------------------------------------------------

function togethernessFeatures(
  candidate: ReadingCandidate,
  characterNames: string[],
  characterPublishers: string[],
): TogethernessFeatures {
  // A story-arc query has no requested characters, so "together" means staying
  // inside the story that was asked for rather than co-starring.
  if (candidate.queryType === "story_arc") {
    return {
      coreCastScore: candidate.type === "story_arc" ? 1 : 0.4,
      coAppearanceShare: contiguousRatio(candidate.issues),
      sustainedRunScore: streakScore(longestContiguousRun(candidate.issues)),
      sharedArcScore: candidate.type === "story_arc" ? 1 : hasSharedStoryArc(candidate.issues) ? 0.6 : 0,
      publisherAffinity: 1,
      titleAffinity: 0,
      cameoPenalty: 0,
    };
  }

  const affinity = candidate.volumeAffinity;
  const coreCastScore = coreCast(affinity);

  return {
    coreCastScore,
    coAppearanceShare: coAppearanceShare(candidate),
    sustainedRunScore: streakScore(
      affinity?.longestCoStreak ?? longestContiguousRun(candidate.issues),
    ),
    sharedArcScore: candidate.type === "story_arc" ? 1 : hasSharedStoryArc(candidate.issues) ? 0.6 : 0,
    publisherAffinity: publisherAffinity(candidate, characterPublishers),
    titleAffinity: titleAffinity(candidate, characterNames),
    cameoPenalty: cameoPenalty(candidate, coreCastScore),
  };
}

/**
 * The share of a volume that the least-present requested character appears in.
 * ComicVine's per-volume character counts are the honest source; without them
 * the ratio of shared issues to the volume's total length is the next best
 * thing. Falling back to locally ingested issues would be circular — when only
 * shared issues have been ingested, that ratio is 1 by construction.
 */
function coreCast(affinity: VolumeAffinity | null): number {
  if (!affinity?.volumeIssueCount) return UNKNOWN_CORE_CAST;
  const ratio =
    affinity.minCharacterAppearances !== null
      ? affinity.minCharacterAppearances / affinity.volumeIssueCount
      : affinity.coIssueCount / affinity.volumeIssueCount;
  return clamp(ratio * evidenceWeight(affinity.volumeIssueCount));
}

/**
 * How much a core-cast ratio is worth believing.
 *
 * The ratio is degenerate on short volumes: a one-shot crossover in which both
 * characters appear once scores a perfect 1.0, and a company-wide event omnibus
 * then looks exactly like a book about the pair. Being in every issue of forty
 * is evidence of co-starring; being in every issue of one is not.
 */
function evidenceWeight(volumeIssueCount: number): number {
  return 0.35 + 0.65 * clamp(volumeIssueCount / EVIDENCE_SATURATION);
}

/** Issue count above which a core-cast ratio is taken at face value. */
const EVIDENCE_SATURATION = 12;

/**
 * How densely the shared issues sit inside the stretch the candidate covers.
 * A run spanning #1–40 with 38 shared issues is a book about the pair; one
 * spanning #1–400 with two shared issues is a coincidence.
 */
function coAppearanceShare(candidate: ReadingCandidate): number {
  const numbers = candidate.issues
    .map((issue) => integerIssueNumber(issue.issueNumber))
    .filter((value): value is number => value !== null);
  if (numbers.length < 2) return candidate.issues.length ? 1 : 0;
  const span = Math.max(...numbers) - Math.min(...numbers) + 1;
  return clamp(numbers.length / span);
}

/**
 * Prefers the edition the characters' own publisher put out.
 *
 * ComicVine lists foreign-language reprints as separate volumes, and they match
 * an original run on every co-appearance measure because they contain the same
 * stories. Someone asking where to start on two DC characters wants the DC run,
 * not its Dutch or Spanish reprint.
 */
function publisherAffinity(candidate: ReadingCandidate, characterPublishers: string[]): number {
  const volumePublisher = candidate.volumeAffinity?.publisherName;
  if (!volumePublisher || !characterPublishers.length) return 0.3;
  const wanted = new Set(characterPublishers.map((name) => normalizeEntityName(name)));
  return wanted.has(normalizeEntityName(volumePublisher)) ? 1 : 0;
}

function titleAffinity(candidate: ReadingCandidate, characterNames: string[]): number {
  if (!characterNames.length) return 0;
  const volumeKey = normalizeEntityName(candidate.issues[0]?.volume.name ?? "");
  if (!volumeKey) return 0;
  const named = characterNames.filter((name) => {
    const key = normalizeEntityName(name);
    return key.length > 2 && volumeKey.includes(key);
  });
  return named.length ? clamp(named.length / characterNames.length) : 0;
}

/**
 * One passing appearance in a book that is not about these characters. Scaled
 * rather than binary so a borderline case is nudged down instead of erased.
 */
function cameoPenalty(candidate: ReadingCandidate, coreCastScore: number): number {
  const shared = candidate.volumeAffinity?.coIssueCount ?? candidate.issues.length;
  const isBrief = candidate.type === "single_issue" || shared <= 2;
  if (!isBrief) return 0;
  return clamp((0.15 - coreCastScore) / 0.15);
}

function combineTogetherness(features: TogethernessFeatures): number {
  const positive =
    features.coreCastScore * TOGETHERNESS_WEIGHTS.coreCastScore +
    features.coAppearanceShare * TOGETHERNESS_WEIGHTS.coAppearanceShare +
    features.sustainedRunScore * TOGETHERNESS_WEIGHTS.sustainedRunScore +
    features.publisherAffinity * TOGETHERNESS_WEIGHTS.publisherAffinity +
    features.sharedArcScore * TOGETHERNESS_WEIGHTS.sharedArcScore +
    features.titleAffinity * TOGETHERNESS_WEIGHTS.titleAffinity;
  return round(clamp(positive - features.cameoPenalty * TOGETHERNESS_WEIGHTS.cameoPenalty));
}

// --- Beginner friendliness --------------------------------------------------

function beginnerFeatures(candidate: ReadingCandidate): BeginnerFriendlinessFeatures {
  const first = candidate.issues[0];
  const firstNumber = first ? integerIssueNumber(first.issueNumber) : null;
  const affinity = candidate.volumeAffinity;

  const entryPointScore =
    firstNumber === 1
      ? 1
      : candidate.type === "story_arc"
        ? 0.8
        : affinity && first?.issueNumber === affinity.firstCoIssueNumber
          ? 0.75
          : 0.3;

  return {
    entryPointScore,
    commitmentScore: commitmentScore(candidate.issues.length),
    // Starting a hundred issues deep asks a newcomer to carry continuity they
    // do not have.
    prerequisiteDepth: firstNumber === null ? 0.5 : clamp(1 - (firstNumber - 1) / 100),
    selfContainment: selfContainment(candidate),
    castManageability: castManageability(candidate.issues),
    creativeTeamCohesion: creativeTeamCohesion(candidate),
  };
}

/**
 * Deliberately not the old brevity curve, which peaked at a single issue. One
 * issue cannot show a relationship, and a hundred is not a starting point; the
 * useful range is a short arc to a full run.
 */
function commitmentScore(length: number): number {
  if (length <= 1) return 0.35;
  if (length <= 3) return 0.6;
  if (length <= 12) return 1;
  if (length <= 25) return 0.85;
  if (length <= 50) return 0.6;
  if (length <= 100) return 0.4;
  return 0.25;
}

/** Whole stories beat fragments, and a book that sprawls across titles is a tie-in. */
function selfContainment(candidate: ReadingCandidate): number {
  const volumes = new Set(candidate.issues.map((issue) => issue.volume.id));
  const spread = volumes.size > 2 ? 0.2 : volumes.size === 2 ? 0.6 : 1;
  if (candidate.type === "single_issue") return spread * 0.6;
  return clamp(spread * (0.4 + 0.6 * contiguousRatio(candidate.issues)));
}

function castManageability(issues: CandidateIssue[]): number {
  const counts = issues.map((issue) => issue.characterCount).filter((count) => count > 0);
  // Cast size is only known for issues whose detail was fetched; stay neutral
  // rather than rewarding the absence of data.
  if (!counts.length) return 0.7;
  const averageCast = average(counts);
  if (averageCast <= 20) return 1;
  return clamp(1 - (averageCast - 20) / 60);
}

/** A run held by one writer reads as a single story rather than a pile of issues. */
function creativeTeamCohesion(candidate: ReadingCandidate): number {
  const writers = candidate.issues.flatMap((issue) =>
    issue.creators.filter((credit) => credit.role.toLowerCase() === "writer").map(({ name }) => name),
  );
  if (!writers.length) return candidate.volumeAffinity?.topWriter ? 0.6 : 0.35;

  const counts = new Map<string, number>();
  for (const writer of writers) counts.set(writer, (counts.get(writer) ?? 0) + 1);
  const dominant = Math.max(...counts.values());
  return clamp(dominant / candidate.issues.length);
}

function combineBeginner(features: BeginnerFriendlinessFeatures): number {
  return round(
    clamp(
      features.entryPointScore * BEGINNER_WEIGHTS.entryPointScore +
        features.commitmentScore * BEGINNER_WEIGHTS.commitmentScore +
        features.prerequisiteDepth * BEGINNER_WEIGHTS.prerequisiteDepth +
        features.selfContainment * BEGINNER_WEIGHTS.selfContainment +
        features.castManageability * BEGINNER_WEIGHTS.castManageability +
        features.creativeTeamCohesion * BEGINNER_WEIGHTS.creativeTeamCohesion,
    ),
  );
}

// --- Explanations -----------------------------------------------------------

export function explainCandidate(
  candidate: ReadingCandidate,
  features: RankingFeatures,
): string[] {
  const reasons: string[] = [];
  const affinity = candidate.volumeAffinity;

  if (candidate.queryType === "story_arc") {
    reasons.push("This stays inside the story you searched for.");
  } else if (affinity?.volumeIssueCount) {
    reasons.push(
      `Your characters share ${affinity.coIssueCount} of this book's ${affinity.volumeIssueCount} issues.`,
    );
  } else {
    reasons.push(
      `Every character you picked appears in all ${candidate.issues.length} of these issues.`,
    );
  }

  if (features.together.cameoPenalty >= 0.5) {
    reasons.push(
      "Be warned: this is a passing appearance rather than a story about them together.",
    );
  } else if (features.together.coreCastScore >= 0.5) {
    reasons.push("They are core cast here, not guest stars.");
  }

  if (affinity && affinity.longestCoStreak >= 4) {
    reasons.push(
      `They appear together across ${affinity.longestCoStreak} issues in a row, so the relationship actually develops.`,
    );
  }

  const credit = creditLine(candidate.creators);
  if (credit) reasons.push(credit);

  if (candidate.type === "story_arc" && candidate.storyArc) {
    reasons.push(`The issues are tied together by the “${candidate.storyArc.name}” story arc.`);
  }

  if (features.beginner.entryPointScore >= 1) {
    reasons.push("It starts at issue #1, so nothing is assumed.");
  } else if (features.beginner.entryPointScore >= 0.75) {
    reasons.push("This is where they first share a book, so it is a clean way in.");
  }

  if (candidate.issues.length > 1 && features.beginner.commitmentScore >= 0.85) {
    reasons.push(`It is a manageable ${candidate.issues.length}-issue read.`);
  }

  return reasons;
}

function creditLine(creators: CreatorCredit[]): string | null {
  const writer = creators.find((credit) => credit.role.toLowerCase() === "writer");
  const artist = creators.find((credit) => credit.role.toLowerCase() !== "writer");
  if (writer && artist) return `Written by ${writer.name} with art by ${artist.name}.`;
  if (writer) return `Written by ${writer.name}.`;
  if (artist) return `Art by ${artist.name}.`;
  return null;
}

// --- Candidate generation ---------------------------------------------------

function storyArcCandidates(
  issues: CandidateIssue[],
  queryType: ReadingCandidate["queryType"],
  affinityByVolume: Map<string, VolumeAffinity>,
  requestedStoryArcId?: string,
): ReadingCandidate[] {
  const grouped = new Map<
    string,
    { arc: CandidateIssue["storyArcs"][number]; issues: CandidateIssue[] }
  >();
  for (const issue of issues) {
    for (const arc of issue.storyArcs) {
      if (queryType === "story_arc" && arc.id !== requestedStoryArcId) continue;
      const group = grouped.get(arc.id) ?? { arc, issues: [] };
      group.issues.push(issue);
      grouped.set(arc.id, group);
    }
  }

  return [...grouped.values()]
    .filter(({ issues: arcIssues }) => arcIssues.length >= 2)
    .map(({ arc, issues: arcIssues }) => {
      const sorted = sortIssues(arcIssues);
      return {
        id: `arc:${arc.id}`,
        type: "story_arc" as const,
        queryType,
        title: arc.name,
        issues: sorted,
        storyArc: arc,
        volumeAffinity: affinityByVolume.get(sorted[0].volume.id) ?? null,
        creators: dominantCreators(sorted),
      };
    });
}

/**
 * The headline result type: the whole stretch of one book that these characters
 * share. This is what "read The New Teen Titans" looks like as a candidate, and
 * it is the shape a reader actually wants when they ask about a duo.
 */
function volumeRunCandidates(
  issues: CandidateIssue[],
  queryType: ReadingCandidate["queryType"],
  affinityByVolume: Map<string, VolumeAffinity>,
): ReadingCandidate[] {
  if (queryType !== "characters") return [];

  return [...Map.groupBy(issues, (issue) => issue.volume.id).entries()]
    .filter(([, volumeIssues]) => volumeIssues.length >= MIN_VOLUME_RUN_ISSUES)
    .map(([volumeId, volumeIssues]) => {
      const sorted = sortIssues(volumeIssues);
      const first = sorted[0];
      const last = sorted.at(-1) ?? first;
      const year = first.volume.startYear ? ` (${first.volume.startYear})` : "";
      return {
        id: `volume:${volumeId}`,
        type: "volume_run" as const,
        queryType,
        title: `${first.volume.name}${year} #${first.issueNumber}–${last.issueNumber}`,
        issues: sorted,
        storyArc: null,
        volumeAffinity: affinityByVolume.get(volumeId) ?? null,
        creators: dominantCreators(sorted),
      };
    });
}

function issueRunCandidates(
  issues: CandidateIssue[],
  queryType: ReadingCandidate["queryType"],
  affinityByVolume: Map<string, VolumeAffinity>,
  coveredRuns: Set<string>,
): ReadingCandidate[] {
  const byVolume = Map.groupBy(issues, (issue) => issue.volume.id);
  const candidates: ReadingCandidate[] = [];

  for (const volumeIssues of byVolume.values()) {
    const numeric = volumeIssues
      .map((issue) => ({ issue, number: integerIssueNumber(issue.issueNumber) }))
      .filter((entry): entry is { issue: CandidateIssue; number: number } => entry.number !== null)
      .sort((left, right) => left.number - right.number);
    const nonNumeric = volumeIssues.filter(
      (issue) => integerIssueNumber(issue.issueNumber) === null,
    );
    let run: CandidateIssue[] = [];
    let previous: number | null = null;

    const flush = () => {
      if (!run.length) return;
      if (!coveredRuns.has(issueSetKey(run))) {
        candidates.push(candidateForRun(run, queryType, affinityByVolume));
      }
      run = [];
    };

    for (const entry of numeric) {
      if (previous !== null && entry.number !== previous + 1) flush();
      run.push(entry.issue);
      previous = entry.number;
    }
    flush();
    candidates.push(
      ...nonNumeric
        .filter((issue) => !coveredRuns.has(issueSetKey([issue])))
        .map((issue) => candidateForRun([issue], queryType, affinityByVolume)),
    );
  }

  return candidates;
}

function candidateForRun(
  issues: CandidateIssue[],
  queryType: ReadingCandidate["queryType"],
  affinityByVolume: Map<string, VolumeAffinity>,
): ReadingCandidate {
  const sorted =
    issues.length > 1 && issues.every(({ issueNumber }) => integerIssueNumber(issueNumber) !== null)
      ? [...issues].sort(
          (left, right) =>
            (integerIssueNumber(left.issueNumber) ?? 0) -
            (integerIssueNumber(right.issueNumber) ?? 0),
        )
      : sortIssues(issues);
  const first = sorted[0];
  const last = sorted.at(-1) ?? first;
  const type = sorted.length > 1 ? "issue_run" : "single_issue";

  return {
    id:
      type === "issue_run"
        ? `run:${first.volume.id}:${first.comicvineId}-${last.comicvineId}`
        : `issue:${first.id}`,
    type,
    queryType,
    title:
      type === "issue_run"
        ? `${first.volume.name} #${first.issueNumber}–${last.issueNumber}`
        : `${first.volume.name} #${first.issueNumber}`,
    issues: sorted,
    storyArc: null,
    volumeAffinity: affinityByVolume.get(first.volume.id) ?? null,
    creators: dominantCreators(sorted),
  };
}

// --- Helpers ----------------------------------------------------------------

/** The writer and artist credited on the most issues of a candidate. */
function dominantCreators(issues: CandidateIssue[]): CreatorCredit[] {
  const tally = new Map<string, { credit: CreatorCredit; count: number }>();
  for (const issue of issues) {
    for (const credit of issue.creators) {
      const key = `${credit.role.toLowerCase()}:${credit.name}`;
      const entry = tally.get(key) ?? { credit, count: 0 };
      entry.count += 1;
      tally.set(key, entry);
    }
  }

  const ranked = [...tally.values()].sort(
    (left, right) => right.count - left.count || left.credit.name.localeCompare(right.credit.name),
  );
  const writer = ranked.find(({ credit }) => credit.role.toLowerCase() === "writer");
  const artist = ranked.find(({ credit }) => credit.role.toLowerCase() !== "writer");
  return [writer?.credit, artist?.credit].filter((credit): credit is CreatorCredit => Boolean(credit));
}

/** Identity of a set of issues, so an equivalent candidate is not listed twice. */
function issueSetKey(issues: CandidateIssue[]): string {
  return issues
    .map(({ id }) => id)
    .sort()
    .join("|");
}

function sortIssues(issues: CandidateIssue[]): CandidateIssue[] {
  return [...issues].sort(
    (left, right) =>
      (left.coverDate ?? "9999").localeCompare(right.coverDate ?? "9999") ||
      left.issueNumber.localeCompare(right.issueNumber, undefined, { numeric: true }),
  );
}

function integerIssueNumber(value: string): number | null {
  return /^\d+$/.test(value) ? Number(value) : null;
}

function contiguousRatio(issues: CandidateIssue[]): number {
  if (issues.length < 2) return 0.2;
  const sorted = sortIssues(issues);
  let contiguousPairs = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = integerIssueNumber(sorted[index - 1].issueNumber);
    const current = integerIssueNumber(sorted[index].issueNumber);
    if (
      previous !== null &&
      current === previous + 1 &&
      sorted[index - 1].volume.id === sorted[index].volume.id
    ) {
      contiguousPairs += 1;
    }
  }
  return contiguousPairs / (sorted.length - 1);
}

function longestContiguousRun(issues: CandidateIssue[]): number {
  const numbers = issues
    .map((issue) => integerIssueNumber(issue.issueNumber))
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
  if (!numbers.length) return issues.length ? 1 : 0;

  let longest = 1;
  let current = 1;
  for (let index = 1; index < numbers.length; index += 1) {
    current = numbers[index] === numbers[index - 1] + 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
  }
  return longest;
}

/** Log-scaled so the gap between a cameo and a short run matters more than the gap between long runs. */
function streakScore(streak: number): number {
  if (streak <= 0) return 0;
  return clamp(Math.log2(streak + 1) / Math.log2(17));
}

function hasSharedStoryArc(issues: CandidateIssue[]): boolean {
  if (!issues.length) return false;
  const shared = new Set(issues[0].storyArcs.map(({ id }) => id));
  for (const issue of issues.slice(1)) {
    const issueArcs = new Set(issue.storyArcs.map(({ id }) => id));
    for (const id of shared) if (!issueArcs.has(id)) shared.delete(id);
  }
  return shared.size > 0;
}

function earliestDate(candidate: ReadingCandidate): string {
  return candidate.issues.reduce(
    (earliest, issue) =>
      issue.coverDate && issue.coverDate < earliest ? issue.coverDate : earliest,
    "9999",
  );
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Number(value.toFixed(3));
}
