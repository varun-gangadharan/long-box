// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RankedRecommendation, ReadingPathResult } from "@/lib/reading-path/types";

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} />,
}));

import { ReadingPathView } from "./reading-path-view";

const issue = {
  id: "70000000-0000-4000-8000-000000000001",
  comicvineId: 1,
  issueNumber: "1",
  name: "The Beginning",
  coverDate: "2020-01-01",
  imageUrl: "https://comicvine.gamespot.com/a/uploads/cover.jpg",
  volume: {
    id: "70000000-0000-4000-8000-000000000010",
    name: "Daredevil",
    startYear: 2020,
    issueCount: 12,
  },
  characterCount: 1,
  requestedCharacterCount: 1,
  storyArcs: [],
  creators: [{ name: "Test Writer", role: "writer" }],
};

function recommendation(
  id: string,
  number = "1",
  overrides: Partial<RankedRecommendation> = {},
): RankedRecommendation {
  return {
    id,
    type: "single_issue",
    queryType: "characters",
    title: `Daredevil #${number}`,
    issues: [{ ...issue, id: `${issue.id}-${number}`, issueNumber: number }],
    storyArc: null,
    volumeAffinity: null,
    creators: [{ name: "Test Writer", role: "writer" }],
    score: 0.7,
    eligibleAsStart: true,
    features: {
      togetherness: 0.8,
      beginnerFriendliness: 0.6,
      metadataCompleteness: 1,
      together: {
        coreCastScore: 0.8,
        coAppearanceShare: 1,
        sustainedRunScore: 0.5,
        sharedArcScore: 0,
        publisherAffinity: 1,
        titleAffinity: 1,
        cameoPenalty: 0,
      },
      beginner: {
        entryPointScore: 1,
        selfContainment: 0.6,
        prerequisiteDepth: 1,
        commitmentScore: 0.35,
        castManageability: 1,
        creativeTeamCohesion: 1,
      },
    },
    reasons: ["The requested character appears in every issue."],
    ...overrides,
  };
}

const character = {
  id: "70000000-0000-4000-8000-000000000020",
  comicvineId: 20,
  name: "Daredevil",
  description: null,
  imageUrl: null,
  publisherName: "Marvel",
};

describe("ReadingPathView", () => {
  afterEach(cleanup);

  it("renders the starting point, reasoning, and further branches", () => {
    const result: ReadingPathResult = {
      query: { characters: [character], storyArc: null },
      recommendations: [recommendation("start"), recommendation("next", "2")],
    };
    render(<ReadingPathView result={result} />);
    expect(screen.getByRole("heading", { name: "Start here" })).toBeDefined();
    expect(screen.getAllByText("The requested character appears in every issue.").length).toBeGreaterThan(0);
    expect(screen.getByText("Where do you want to go next?")).toBeDefined();
  });

  it("names the creative team and both scores on the starting pick", () => {
    render(
      <ReadingPathView
        result={{
          query: { characters: [character], storyArc: null },
          recommendations: [recommendation("start")],
        }}
      />,
    );
    expect(screen.getByText("Together 80%")).toBeDefined();
    expect(screen.getByText("Beginner-friendly 60%")).toBeDefined();
    expect(screen.getAllByText("Test Writer (writer)").length).toBeGreaterThan(0);
  });

  it("refuses to present a passing appearance as a starting point", () => {
    render(
      <ReadingPathView
        result={{
          query: { characters: [character], storyArc: null },
          recommendations: [
            recommendation("cameo", "415", { eligibleAsStart: false }),
          ],
        }}
      />,
    );
    expect(screen.getByText("No shared story yet")).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Start here" })).toBeNull();
  });

  it("renders an intentional empty state", () => {
    render(
      <ReadingPathView
        result={{ query: { characters: [character], storyArc: null }, recommendations: [] }}
      />,
    );
    expect(screen.getByText("No shared route yet")).toBeDefined();
    expect(screen.getByRole("link", { name: "Try another search" })).toBeDefined();
  });
});
