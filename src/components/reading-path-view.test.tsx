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
  },
  characterCount: 1,
  requestedCharacterCount: 1,
  storyArcs: [],
};

function recommendation(id: string, number = "1"): RankedRecommendation {
  return {
    id,
    type: "single_issue",
    queryType: "characters",
    title: `Daredevil #${number}`,
    issues: [{ ...issue, id: `${issue.id}-${number}`, issueNumber: number }],
    storyArc: null,
    score: 0.7,
    features: {
      requestedCharacterCoverage: 1,
      continuityScore: 0.2,
      arcScore: 0,
      densityScore: 1,
      metadataCompleteness: 1,
      brevityScore: 1,
      isolatedAppearancePenalty: 1,
    },
    reasons: ["The requested character appears in every issue."],
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
