import { describe, expect, it } from "vitest";

import {
  calculateFeatures,
  generateCandidates,
  rankCandidates,
  scoreCandidate,
  TOGETHERNESS_GATE,
} from "./engine";
import type { CandidateIssue, ReadingCandidate, VolumeAffinity } from "./types";

const arc = { id: "30000000-0000-0000-0000-000000000001", comicvineId: 1, name: "Shared Arc" };

function issue(number: string, options: Partial<CandidateIssue> = {}): CandidateIssue {
  return {
    id: `20000000-0000-0000-0000-${number.padStart(12, "0")}`,
    comicvineId: Number(number.replace(/\D/g, "")) || 99,
    issueNumber: number,
    name: `Issue ${number}`,
    coverDate: `2020-${number.padStart(2, "0")}-01`,
    imageUrl: "https://example.com/cover.jpg",
    volume: {
      id: "20000000-0000-0000-0000-000000000100",
      name: "Daredevil",
      startYear: 2020,
      issueCount: 12,
    },
    characterCount: 2,
    requestedCharacterCount: 2,
    storyArcs: [],
    creators: [],
    ...options,
  };
}

function affinity(options: Partial<VolumeAffinity> = {}): VolumeAffinity {
  return {
    volumeId: "20000000-0000-0000-0000-000000000100",
    volumeName: "Daredevil",
    volumeStartYear: 2020,
    volumeIssueCount: 12,
    publisherName: "DC Comics",
    localIssueCount: 12,
    coIssueCount: 12,
    minCharacterAppearances: 12,
    longestCoStreak: 12,
    firstCoIssueNumber: "1",
    lastCoIssueNumber: "12",
    firstCoDate: "2020-01-01",
    lastCoDate: "2020-12-01",
    topWriter: "Test Writer",
    topArtist: "Test Artist",
    ...options,
  };
}

describe("reading-path candidate generation", () => {
  it("groups a volume the characters share into one named run", () => {
    const candidates = generateCandidates(
      [issue("1"), issue("2"), issue("3"), issue("4")],
      { affinities: [affinity()] },
    );

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "volume_run", title: "Daredevil (2020) #1–4" }),
      ]),
    );
  });

  it("does not repeat an unbroken volume run as an identical issue run", () => {
    const candidates = generateCandidates([issue("1"), issue("2"), issue("3"), issue("4")]);
    expect(candidates.filter(({ type }) => type === "issue_run")).toHaveLength(0);
  });

  it("keeps the shorter stretches when a shared volume has gaps", () => {
    const candidates = generateCandidates([
      issue("1"),
      issue("2"),
      issue("7"),
      issue("8"),
    ]);
    expect(candidates.map(({ type }) => type).sort()).toEqual([
      "issue_run",
      "issue_run",
      "volume_run",
    ]);
  });

  it("groups consecutive issues and shared story arcs below the volume-run threshold", () => {
    const candidates = generateCandidates([
      issue("1", { storyArcs: [arc] }),
      issue("2", { storyArcs: [arc] }),
      issue("4"),
    ]);

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "story_arc", title: "Shared Arc" }),
        expect.objectContaining({ type: "issue_run", title: "Daredevil #1–2" }),
        expect.objectContaining({ type: "single_issue", title: "Daredevil #4" }),
      ]),
    );
  });

  it("keeps numeric reading order when cover dates are missing or out of order", () => {
    const [candidate] = generateCandidates([
      issue("1", { coverDate: "2021-12-01" }),
      issue("2", { coverDate: null }),
    ]).filter(({ type }) => type === "issue_run");
    expect(candidate.title).toBe("Daredevil #1–2");
    expect(candidate.issues.map(({ issueNumber }) => issueNumber)).toEqual(["1", "2"]);
  });

  it("leaves non-consecutive and non-numeric issues separate", () => {
    const candidates = generateCandidates([issue("1"), issue("3"), issue("Annual")]);
    expect(candidates.map(({ type }) => type)).toEqual([
      "single_issue",
      "single_issue",
      "single_issue",
    ]);
  });

  it("returns no candidates when characters have no shared issues", () => {
    expect(generateCandidates([])).toEqual([]);
  });

  it("attaches the dominant creative team to a run", () => {
    const credits = [
      { name: "Marv Wolfman", role: "writer" },
      { name: "George Pérez", role: "penciler" },
    ];
    const [candidate] = generateCandidates(
      [
        issue("1", { creators: credits }),
        issue("2", { creators: credits }),
        issue("3", { creators: credits }),
        issue("4", { creators: credits }),
      ],
      { affinities: [affinity()] },
    ).filter(({ type }) => type === "volume_run");

    expect(candidate.creators).toEqual(credits);
  });
});

describe("reading-path ranking", () => {
  it("scores a co-starring run highly and explains it with real numbers", () => {
    const credits = [
      { name: "Marv Wolfman", role: "writer" },
      { name: "George Pérez", role: "penciler" },
    ];
    const issues = ["1", "2", "3", "4", "5", "6"].map((number) =>
      issue(number, { creators: credits, storyArcs: [arc] }),
    );
    const [ranked] = rankCandidates(
      generateCandidates(issues, { affinities: [affinity({ coIssueCount: 6 })] }).filter(
        ({ type }) => type === "volume_run",
      ),
      { characterNames: ["Daredevil", "Elektra"] },
    );

    expect(ranked.features.together.coreCastScore).toBe(1);
    expect(ranked.eligibleAsStart).toBe(true);
    expect(ranked.score).toBeGreaterThan(0.8);
    expect(ranked.reasons).toContain("Your characters share 6 of this book's 12 issues.");
    expect(ranked.reasons).toContain("They are core cast here, not guest stars.");
    expect(ranked.reasons).toContain("Written by Marv Wolfman with art by George Pérez.");
    expect(ranked.reasons).toContain("It starts at issue #1, so nothing is assumed.");
  });

  it("gates a lone guest appearance out of the starting slot", () => {
    const guest = issue("415", {
      characterCount: 24,
      volume: {
        id: "20000000-0000-0000-0000-000000000200",
        name: "Detective Comics",
        startYear: 1937,
        issueCount: 700,
      },
    });
    const [ranked] = rankCandidates(
      generateCandidates([guest], {
        affinities: [
          affinity({
            volumeId: "20000000-0000-0000-0000-000000000200",
            volumeIssueCount: 700,
            coIssueCount: 1,
            minCharacterAppearances: 1,
            longestCoStreak: 1,
          }),
        ],
      }),
    );

    expect(ranked.features.together.cameoPenalty).toBeGreaterThan(0.95);
    expect(ranked.features.togetherness).toBeLessThan(TOGETHERNESS_GATE);
    expect(ranked.eligibleAsStart).toBe(false);
    expect(ranked.reasons).toContain(
      "Be warned: this is a passing appearance rather than a story about them together.",
    );
  });

  it("ranks every eligible candidate above every gated one regardless of score", () => {
    const shared = generateCandidates(
      [issue("1"), issue("2"), issue("3"), issue("4")],
      { affinities: [affinity({ coIssueCount: 4 })] },
    );
    const cameo = generateCandidates([
      issue("500", {
        volume: {
          id: "20000000-0000-0000-0000-000000000300",
          name: "Action Comics",
          startYear: 1938,
          issueCount: 900,
        },
      }),
    ]);

    const ranked = rankCandidates([...cameo, ...shared]);
    expect(ranked[0].eligibleAsStart).toBe(true);
    expect(ranked.at(-1)?.eligibleAsStart).toBe(false);
  });

  it("does not award arc continuity for unrelated arcs", () => {
    const unrelatedArc = {
      id: "30000000-0000-4000-8000-000000000002",
      comicvineId: 2,
      name: "Other Arc",
    };
    const [candidate] = generateCandidates([
      issue("1", { storyArcs: [arc] }),
      issue("2", { storyArcs: [unrelatedArc] }),
    ]).filter(({ type }) => type === "issue_run");
    expect(calculateFeatures(candidate).together.sharedArcScore).toBe(0);
  });

  it("explains only the requested story arc without claiming character coverage", () => {
    const overlappingArc = {
      id: "30000000-0000-4000-8000-000000000003",
      comicvineId: 3,
      name: "Overlapping Arc",
    };
    const candidates = generateCandidates(
      [
        issue("1", { storyArcs: [arc, overlappingArc], requestedCharacterCount: 0 }),
        issue("2", { storyArcs: [arc, overlappingArc], requestedCharacterCount: 0 }),
      ],
      { queryType: "story_arc", requestedStoryArcId: arc.id },
    );
    expect(candidates.filter(({ type }) => type === "story_arc")).toHaveLength(1);
    const candidate = candidates.find(({ type }) => type === "story_arc")!;
    const [ranked] = rankCandidates([candidate]);
    expect(ranked.features.together.titleAffinity).toBe(0);
    expect(ranked.reasons[0]).toBe("This stays inside the story you searched for.");
  });

  it("credits a volume named after a requested character", () => {
    const [candidate] = generateCandidates([
      issue("1"),
      issue("2"),
      issue("3"),
      issue("4"),
    ]).filter(({ type }) => type === "volume_run");
    expect(calculateFeatures(candidate, { characterNames: ["Daredevil"] }).together.titleAffinity)
      .toBe(1);
    expect(calculateFeatures(candidate, { characterNames: ["Starfire"] }).together.titleAffinity)
      .toBe(0);
  });

  it("uses a stable ID tie-breaker", () => {
    const base: Omit<ReadingCandidate, "id"> = {
      type: "single_issue",
      queryType: "characters",
      title: "Same",
      issues: [issue("1")],
      storyArc: null,
      volumeAffinity: null,
      creators: [],
    };
    expect(
      rankCandidates([
        { ...base, id: "issue:b" },
        { ...base, id: "issue:a" },
      ]).map(({ id }) => id),
    ).toEqual(["issue:a", "issue:b"]);
  });

  it("keeps the score inside the unit range", () => {
    const [candidate] = generateCandidates(
      [issue("1"), issue("2"), issue("3"), issue("4")],
      { affinities: [affinity()] },
    );
    const score = scoreCandidate(calculateFeatures(candidate));
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
