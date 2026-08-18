import { describe, expect, it } from "vitest";

import {
  calculateFeatures,
  generateCandidates,
  rankCandidates,
  scoreCandidate,
} from "./engine";
import type { CandidateIssue, ReadingCandidate } from "./types";

const arc = { id: "30000000-0000-0000-0000-000000000001", comicvineId: 1, name: "Shared Arc" };

function issue(
  number: string,
  options: Partial<CandidateIssue> = {},
): CandidateIssue {
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
    },
    characterCount: 2,
    requestedCharacterCount: 2,
    storyArcs: [],
    ...options,
  };
}

describe("reading-path candidate generation", () => {
  it("groups consecutive issues and shared story arcs", () => {
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
});

describe("reading-path ranking", () => {
  it("calculates inspectable features and deterministic reasons", () => {
    const [candidate] = generateCandidates([
      issue("1", { storyArcs: [arc] }),
      issue("2", { storyArcs: [arc] }),
    ]).filter(({ type }) => type === "story_arc");
    const [ranked] = rankCandidates([candidate]);

    expect(ranked.features).toEqual({
      requestedCharacterCoverage: 1,
      continuityScore: 1,
      arcScore: 1,
      densityScore: 1,
      metadataCompleteness: 1,
      brevityScore: 1,
      isolatedAppearancePenalty: 0,
    });
    expect(ranked.score).toBe(1);
    expect(ranked.reasons).toContain(
      "Every character you picked appears here, so this is a real crossover path.",
    );
    expect(ranked.reasons).toContain(
      "The issues are tied together by the “Shared Arc” story arc.",
    );
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
    expect(calculateFeatures(candidate).arcScore).toBe(0);
  });

  it("explains only the requested story arc without inventing character coverage", () => {
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
      "story_arc",
      arc.id,
    );
    expect(candidates.filter(({ type }) => type === "story_arc")).toHaveLength(1);
    const candidate = candidates.find(({ type }) => type === "story_arc")!;
    const [ranked] = rankCandidates([candidate]);
    expect(ranked.features.densityScore).toBe(0);
    expect(ranked.reasons[0]).toBe("This stays inside the story you searched for.");
  });

  it("penalizes an isolated appearance", () => {
    const [candidate] = generateCandidates([issue("1", { characterCount: 10 })]);
    const features = calculateFeatures(candidate);
    expect(features.isolatedAppearancePenalty).toBe(1);
    expect(scoreCandidate(features)).toBeLessThan(0.6);
  });

  it("uses a stable ID tie-breaker", () => {
    const base: Omit<ReadingCandidate, "id"> = {
      type: "single_issue",
      queryType: "characters",
      title: "Same",
      issues: [issue("1")],
      storyArc: null,
    };
    expect(rankCandidates([{ ...base, id: "issue:b" }, { ...base, id: "issue:a" }]).map(({ id }) => id)).toEqual([
      "issue:a",
      "issue:b",
    ]);
  });
});
