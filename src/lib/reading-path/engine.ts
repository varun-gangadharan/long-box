import type {
  CandidateIssue,
  RankedRecommendation,
  RankingFeatures,
  ReadingCandidate,
} from "./types";

export const RANKING_WEIGHTS = {
  requestedCharacterCoverage: 0.25,
  continuityScore: 0.2,
  arcScore: 0.15,
  densityScore: 0.15,
  metadataCompleteness: 0.1,
  brevityScore: 0.15,
  isolatedAppearancePenalty: 0.1,
} as const;

export function generateCandidates(
  issues: CandidateIssue[],
  queryType: ReadingCandidate["queryType"] = "characters",
  requestedStoryArcId?: string,
): ReadingCandidate[] {
  return [
    ...storyArcCandidates(issues, queryType, requestedStoryArcId),
    ...issueRunCandidates(issues, queryType),
  ];
}

export function calculateFeatures(candidate: ReadingCandidate): RankingFeatures {
  const requestedCharacterCoverage = candidate.issues.length ? 1 : 0;
  const densityScore =
    candidate.queryType === "story_arc"
      ? 0
      : average(
          candidate.issues.map((issue) =>
            clamp(issue.requestedCharacterCount / Math.max(issue.characterCount, 1)),
          ),
        );
  const metadataCompleteness = average(
    candidate.issues.map(
      (issue) =>
        [issue.name, issue.coverDate, issue.imageUrl, issue.volume.startYear].filter(
          (value) => value !== null,
        ).length / 4,
    ),
  );

  return {
    requestedCharacterCoverage,
    continuityScore:
      candidate.type === "issue_run"
        ? clamp(candidate.issues.length / 4)
        : candidate.type === "story_arc"
          ? contiguousRatio(candidate.issues)
          : 0.2,
    arcScore:
      candidate.type === "story_arc" ? 1 : hasSharedStoryArc(candidate.issues) ? 0.6 : 0,
    densityScore,
    metadataCompleteness,
    brevityScore: brevityScore(candidate.issues.length),
    isolatedAppearancePenalty:
      candidate.queryType === "characters" &&
      candidate.type === "single_issue" &&
      candidate.issues[0].storyArcs.length === 0
        ? 1
        : 0,
  };
}

export function scoreCandidate(features: RankingFeatures): number {
  const positive =
    features.requestedCharacterCoverage * RANKING_WEIGHTS.requestedCharacterCoverage +
    features.continuityScore * RANKING_WEIGHTS.continuityScore +
    features.arcScore * RANKING_WEIGHTS.arcScore +
    features.densityScore * RANKING_WEIGHTS.densityScore +
    features.metadataCompleteness * RANKING_WEIGHTS.metadataCompleteness +
    features.brevityScore * RANKING_WEIGHTS.brevityScore;
  const score = positive - features.isolatedAppearancePenalty * RANKING_WEIGHTS.isolatedAppearancePenalty;
  return Number(clamp(score).toFixed(3));
}

export function explainCandidate(
  candidate: ReadingCandidate,
  features: RankingFeatures,
): string[] {
  const reasons = [
    candidate.queryType === "story_arc"
      ? "Every issue is attached to the requested story arc."
      : candidate.issues[0].requestedCharacterCount === 1
        ? "The requested character appears in every issue."
        : "All requested characters appear in every issue.",
  ];

  if (candidate.type === "story_arc" && candidate.storyArc) {
    reasons.push(`These issues share the “${candidate.storyArc.name}” story arc.`);
  }
  if (candidate.type === "issue_run") {
    reasons.push(
      `The issues form a consecutive ${candidate.issues.length}-issue run in the same volume.`,
    );
  }
  if (candidate.queryType === "characters" && features.densityScore >= 0.5) {
    reasons.push(
      "Across this option, the requested characters average at least half of the credited cast.",
    );
  }
  if (candidate.issues.length <= 6) {
    reasons.push(`This option contains ${candidate.issues.length} issue${candidate.issues.length === 1 ? "" : "s"}.`);
  }

  return reasons;
}

export function rankCandidates(candidates: ReadingCandidate[]): RankedRecommendation[] {
  return candidates
    .map((candidate) => {
      const features = calculateFeatures(candidate);
      return {
        ...candidate,
        score: scoreCandidate(features),
        features,
        reasons: explainCandidate(candidate, features),
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.issues.length - right.issues.length ||
        latestDate(right).localeCompare(latestDate(left)) ||
        left.id.localeCompare(right.id),
    );
}

function storyArcCandidates(
  issues: CandidateIssue[],
  queryType: ReadingCandidate["queryType"],
  requestedStoryArcId?: string,
): ReadingCandidate[] {
  const grouped = new Map<string, { arc: CandidateIssue["storyArcs"][number]; issues: CandidateIssue[] }>();
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
    .map(({ arc, issues: arcIssues }) => ({
      id: `arc:${arc.id}`,
      type: "story_arc" as const,
      queryType,
      title: arc.name,
      issues: sortIssues(arcIssues),
      storyArc: arc,
    }));
}

function issueRunCandidates(
  issues: CandidateIssue[],
  queryType: ReadingCandidate["queryType"],
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
      candidates.push(candidateForRun(run, queryType));
      run = [];
    };

    for (const entry of numeric) {
      if (previous !== null && entry.number !== previous + 1) flush();
      run.push(entry.issue);
      previous = entry.number;
    }
    flush();
    candidates.push(...nonNumeric.map((issue) => candidateForRun([issue], queryType)));
  }

  return candidates;
}

function candidateForRun(
  issues: CandidateIssue[],
  queryType: ReadingCandidate["queryType"],
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
  };
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

function hasSharedStoryArc(issues: CandidateIssue[]): boolean {
  if (!issues.length) return false;
  const shared = new Set(issues[0].storyArcs.map(({ id }) => id));
  for (const issue of issues.slice(1)) {
    const issueArcs = new Set(issue.storyArcs.map(({ id }) => id));
    for (const id of shared) if (!issueArcs.has(id)) shared.delete(id);
  }
  return shared.size > 0;
}

function brevityScore(length: number): number {
  if (length <= 6) return 1;
  if (length <= 12) return 0.75;
  if (length <= 24) return 0.4;
  return 0.2;
}

function latestDate(candidate: ReadingCandidate): string {
  return candidate.issues.reduce(
    (latest, issue) => (issue.coverDate && issue.coverDate > latest ? issue.coverDate : latest),
    "",
  );
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
