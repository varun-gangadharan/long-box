import { describe, expect, it } from "vitest";

import { calculateFeatures, generateCandidates, rankCandidates, scoreCandidate } from "./engine";
import type { CandidateIssue, VolumeAffinity } from "./types";

/**
 * Invariants that must hold for any dataset. The golden eval in `evals/` checks
 * that real ComicVine data produces good answers; these check that the ranking
 * model itself cannot express the failures we rebuilt it to prevent, whatever
 * the data looks like.
 */

function issueIn(
  volumeId: string,
  volumeName: string,
  issueCount: number,
  number: number,
  options: Partial<CandidateIssue> = {},
): CandidateIssue {
  return {
    id: `${volumeId}-${String(number).padStart(4, "0")}`,
    comicvineId: Number(`${volumeId.length}${number}`),
    issueNumber: String(number),
    name: `Issue ${number}`,
    coverDate: `19${80 + (number % 20)}-01-01`,
    imageUrl: "https://example.com/cover.jpg",
    volume: { id: volumeId, name: volumeName, startYear: 1980, issueCount },
    characterCount: 8,
    requestedCharacterCount: 2,
    storyArcs: [],
    creators: [{ name: "A Writer", role: "writer" }],
    ...options,
  };
}

function affinityFor(
  volumeId: string,
  volumeName: string,
  options: Partial<VolumeAffinity>,
): VolumeAffinity {
  return {
    volumeId,
    volumeName,
    volumeStartYear: 1980,
    volumeIssueCount: 40,
    publisherName: "DC Comics",
    localIssueCount: 40,
    coIssueCount: 40,
    minCharacterAppearances: 40,
    longestCoStreak: 40,
    firstCoIssueNumber: "1",
    lastCoIssueNumber: "40",
    firstCoDate: "1980-01-01",
    lastCoDate: "1984-01-01",
    topWriter: "A Writer",
    topArtist: "An Artist",
    ...options,
  };
}

const teamBookIssues = Array.from({ length: 12 }, (_, index) =>
  issueIn("team", "The Team Book", 40, index + 1),
);
const teamBookAffinity = affinityFor("team", "The Team Book", {
  coIssueCount: 12,
  minCharacterAppearances: 12,
  longestCoStreak: 12,
});

const cameoIssue = issueIn("long", "The Long Title", 700, 415, { characterCount: 26 });
const cameoAffinity = affinityFor("long", "The Long Title", {
  volumeIssueCount: 700,
  localIssueCount: 1,
  coIssueCount: 1,
  minCharacterAppearances: 1,
  longestCoStreak: 1,
  firstCoIssueNumber: "415",
  lastCoIssueNumber: "415",
});

describe("ranking invariants", () => {
  it("ranks a sustained co-starring run above a single guest appearance", () => {
    const ranked = rankCandidates(
      generateCandidates([...teamBookIssues, cameoIssue], {
        affinities: [teamBookAffinity, cameoAffinity],
      }),
    );

    expect(ranked[0].issues[0].volume.id).toBe("team");
    expect(ranked.at(-1)?.issues[0].volume.id).toBe("long");
  });

  it("never offers a guest appearance as a starting point", () => {
    const ranked = rankCandidates(
      generateCandidates([cameoIssue], { affinities: [cameoAffinity] }),
    );
    expect(ranked.every(({ eligibleAsStart }) => !eligibleAsStart)).toBe(true);
  });

  it("prefers the volume the characters appear in more of, at equal run length", () => {
    const dense = generateCandidates(
      Array.from({ length: 6 }, (_, index) => issueIn("dense", "Dense Book", 20, index + 1)),
      {
        affinities: [
          affinityFor("dense", "Dense Book", {
            volumeIssueCount: 20,
            coIssueCount: 6,
            minCharacterAppearances: 19,
            longestCoStreak: 6,
          }),
        ],
      },
    );
    const sparse = generateCandidates(
      Array.from({ length: 6 }, (_, index) => issueIn("sparse", "Sparse Book", 400, index + 1)),
      {
        affinities: [
          affinityFor("sparse", "Sparse Book", {
            volumeIssueCount: 400,
            coIssueCount: 6,
            minCharacterAppearances: 8,
            longestCoStreak: 6,
          }),
        ],
      },
    );

    const [denseRun] = rankCandidates(dense.filter(({ type }) => type === "volume_run"));
    const [sparseRun] = rankCandidates(sparse.filter(({ type }) => type === "volume_run"));
    expect(denseRun.features.togetherness).toBeGreaterThan(sparseRun.features.togetherness);
  });

  it("is monotonic in core-cast strength with everything else held fixed", () => {
    const scores = [1, 5, 10, 20, 40].map((appearances) => {
      const [candidate] = generateCandidates(teamBookIssues, {
        affinities: [affinityFor("team", "The Team Book", {
          coIssueCount: 12,
          minCharacterAppearances: appearances,
          longestCoStreak: 12,
        })],
      }).filter(({ type }) => type === "volume_run");
      return calculateFeatures(candidate).togetherness;
    });

    for (let index = 1; index < scores.length; index += 1) {
      expect(scores[index]).toBeGreaterThanOrEqual(scores[index - 1]);
    }
  });

  it("prefers an entry point near the start of a volume over one deep inside it", () => {
    const early = generateCandidates(
      Array.from({ length: 6 }, (_, index) => issueIn("book", "A Book", 400, index + 1)),
      { affinities: [affinityFor("book", "A Book", { volumeIssueCount: 400, coIssueCount: 6 })] },
    ).filter(({ type }) => type === "volume_run");
    const late = generateCandidates(
      Array.from({ length: 6 }, (_, index) => issueIn("book", "A Book", 400, index + 300)),
      { affinities: [affinityFor("book", "A Book", { volumeIssueCount: 400, coIssueCount: 6 })] },
    ).filter(({ type }) => type === "volume_run");

    expect(calculateFeatures(early[0]).beginnerFriendliness).toBeGreaterThan(
      calculateFeatures(late[0]).beginnerFriendliness,
    );
  });

  it("does not treat a single issue as the most approachable read", () => {
    const [single] = generateCandidates([issueIn("team", "The Team Book", 40, 1)], {
      affinities: [teamBookAffinity],
    });
    const [run] = generateCandidates(teamBookIssues.slice(0, 6), {
      affinities: [teamBookAffinity],
    }).filter(({ type }) => type === "volume_run");

    expect(calculateFeatures(run).beginner.commitmentScore).toBeGreaterThan(
      calculateFeatures(single).beginner.commitmentScore,
    );
  });

  it("orders every eligible candidate above every gated one", () => {
    const ranked = rankCandidates(
      generateCandidates([...teamBookIssues, cameoIssue], {
        affinities: [teamBookAffinity, cameoAffinity],
      }),
    );
    const firstGated = ranked.findIndex(({ eligibleAsStart }) => !eligibleAsStart);
    if (firstGated === -1) return;
    expect(ranked.slice(firstGated).some(({ eligibleAsStart }) => eligibleAsStart)).toBe(false);
  });

  it("produces the same order regardless of input order", () => {
    const issues = [...teamBookIssues, cameoIssue];
    const forward = rankCandidates(
      generateCandidates(issues, { affinities: [teamBookAffinity, cameoAffinity] }),
    ).map(({ id }) => id);
    const reversed = rankCandidates(
      generateCandidates([...issues].reverse(), {
        affinities: [cameoAffinity, teamBookAffinity],
      }),
    ).map(({ id }) => id);

    expect(reversed).toEqual(forward);
  });

  it("keeps every score and feature inside the unit range", () => {
    const ranked = rankCandidates(
      generateCandidates([...teamBookIssues, cameoIssue], {
        affinities: [teamBookAffinity, cameoAffinity],
      }),
    );

    for (const recommendation of ranked) {
      const values = [
        recommendation.score,
        recommendation.features.togetherness,
        recommendation.features.beginnerFriendliness,
        recommendation.features.metadataCompleteness,
        ...Object.values(recommendation.features.together),
        ...Object.values(recommendation.features.beginner),
      ];
      for (const value of values) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("edition preference", () => {
  it("prefers the characters' own publisher over a reprint of the same issues", () => {
    const original = generateCandidates(teamBookIssues, {
      affinities: [teamBookAffinity],
    }).filter(({ type }) => type === "volume_run");
    const reprint = generateCandidates(teamBookIssues, {
      affinities: [{ ...teamBookAffinity, publisherName: "Planeta DeAgostini" }],
    }).filter(({ type }) => type === "volume_run");

    const options = { characterPublishers: ["DC Comics"] };
    expect(calculateFeatures(original[0], options).together.publisherAffinity).toBe(1);
    expect(calculateFeatures(reprint[0], options).together.publisherAffinity).toBe(0);
    expect(calculateFeatures(original[0], options).togetherness).toBeGreaterThan(
      calculateFeatures(reprint[0], options).togetherness,
    );
  });

  it("stays neutral when the publisher is unknown", () => {
    const unknown = generateCandidates(teamBookIssues, {
      affinities: [{ ...teamBookAffinity, publisherName: null }],
    }).filter(({ type }) => type === "volume_run");
    expect(
      calculateFeatures(unknown[0], { characterPublishers: ["DC Comics"] }).together
        .publisherAffinity,
    ).toBe(0.3);
  });
});

describe("evidence weighting", () => {
  it("does not treat a one-shot crossover as a co-starring book", () => {
    const oneShot = generateCandidates([issueIn("event", "A Crossover", 1, 1, { characterCount: 40 })], {
      affinities: [
        affinityFor("event", "A Crossover", {
          volumeIssueCount: 1,
          localIssueCount: 1,
          coIssueCount: 1,
          minCharacterAppearances: 1,
          longestCoStreak: 1,
          firstCoIssueNumber: "1",
          lastCoIssueNumber: "1",
        }),
      ],
    });

    // The ratio is a perfect 1/1, so without evidence weighting this would score
    // as high as a run the pair actually headline.
    const features = calculateFeatures(oneShot[0]);
    expect(features.together.coreCastScore).toBeLessThan(0.6);
    expect(features.togetherness).toBeLessThan(
      calculateFeatures(
        generateCandidates(teamBookIssues, { affinities: [teamBookAffinity] }).filter(
          ({ type }) => type === "volume_run",
        )[0],
      ).togetherness,
    );
  });

  it("takes the ratio at face value once a volume is long enough to prove it", () => {
    const long = generateCandidates(teamBookIssues, {
      affinities: [{ ...teamBookAffinity, volumeIssueCount: 12, minCharacterAppearances: 12 }],
    }).filter(({ type }) => type === "volume_run");
    expect(calculateFeatures(long[0]).together.coreCastScore).toBe(1);
  });
});

describe("modernity as a nudge, not a verdict", () => {
  const modern = { volumeStartYear: 2021, coverYear: 2021 };
  const classic = { volumeStartYear: 1984, coverYear: 1984 };

  function runIn(era: { volumeStartYear: number; coverYear: number }, options: Partial<VolumeAffinity>) {
    const volumeId = `vol-${era.coverYear}-${options.minCharacterAppearances ?? "x"}`;
    const issues = Array.from({ length: 8 }, (_, index) => ({
      ...issueIn(volumeId, `A Book ${era.coverYear}`, 40, index + 1),
      coverDate: `${era.coverYear}-0${(index % 9) + 1}-01`,
    }));
    return generateCandidates(issues, {
      affinities: [
        affinityFor(volumeId, `A Book ${era.coverYear}`, {
          volumeStartYear: era.volumeStartYear,
          coIssueCount: 8,
          longestCoStreak: 8,
          minCharacterAppearances: 40,
          ...options,
        }),
      ],
    }).filter(({ type }) => type === "volume_run");
  }

  it("prefers the newer book when everything else is equal", () => {
    const newer = calculateFeatures(runIn(modern, {})[0]);
    const older = calculateFeatures(runIn(classic, {})[0]);
    expect(newer.beginnerFriendliness).toBeGreaterThan(older.beginnerFriendliness);
  });

  it("cannot outweigh a real difference in how well a book represents the pair", () => {
    // The classic is the book about these characters; the modern one is a book
    // they pass through. Recency must not be able to buy its way past that.
    const classicAboutThem = calculateFeatures(runIn(classic, { minCharacterAppearances: 40 })[0]);
    const modernPassingThrough = calculateFeatures(
      runIn(modern, { volumeIssueCount: 400, minCharacterAppearances: 9 })[0],
    );

    expect(modernPassingThrough.beginnerFriendliness).toBeGreaterThan(
      classicAboutThem.beginnerFriendliness,
    );
    expect(scoreCandidate(classicAboutThem)).toBeGreaterThan(scoreCandidate(modernPassingThrough));
  });

  it("moves a final score by only a few points across six decades", () => {
    const newest = calculateFeatures(runIn({ volumeStartYear: 2025, coverYear: 2025 }, {})[0]);
    const oldest = calculateFeatures(runIn({ volumeStartYear: 1960, coverYear: 1960 }, {})[0]);
    const swing = scoreCandidate(newest) - scoreCandidate(oldest);

    // Enough to settle a tie, nowhere near enough to reorder the list on its own.
    expect(swing).toBeGreaterThan(0);
    expect(swing).toBeLessThan(0.05);
  });

  it("does not punish a book for having no publication dates", () => {
    const undated = generateCandidates(
      Array.from({ length: 8 }, (_, index) => ({
        ...issueIn("undated", "Undated", 40, index + 1),
        coverDate: null,
      })),
      { affinities: [affinityFor("undated", "Undated", { coIssueCount: 8 })] },
    ).filter(({ type }) => type === "volume_run");

    const score = calculateFeatures(undated[0]).beginner.modernityScore;
    expect(score).toBeGreaterThan(0.25);
    expect(score).toBeLessThan(1);
  });
});
