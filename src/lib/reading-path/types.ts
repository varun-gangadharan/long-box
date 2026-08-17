export type ResolvedCharacter = {
  id: string;
  comicvineId: number;
  name: string;
  description: string | null;
  imageUrl: string | null;
  publisherName: string | null;
};

export type ResolvedStoryArc = {
  id: string;
  comicvineId: number;
  name: string;
  description: string | null;
};

export type StoryArcReference = {
  id: string;
  comicvineId: number;
  name: string;
};

export type CandidateIssue = {
  id: string;
  comicvineId: number;
  issueNumber: string;
  name: string | null;
  coverDate: string | null;
  imageUrl: string | null;
  volume: {
    id: string;
    name: string;
    startYear: number | null;
  };
  characterCount: number;
  requestedCharacterCount: number;
  storyArcs: StoryArcReference[];
};

export type CandidateType = "single_issue" | "issue_run" | "story_arc";

export type ReadingCandidate = {
  id: string;
  type: CandidateType;
  queryType: "characters" | "story_arc";
  title: string;
  issues: CandidateIssue[];
  storyArc: StoryArcReference | null;
};

export type RankingFeatures = {
  requestedCharacterCoverage: number;
  continuityScore: number;
  arcScore: number;
  densityScore: number;
  metadataCompleteness: number;
  brevityScore: number;
  isolatedAppearancePenalty: number;
};

export type RankedRecommendation = ReadingCandidate & {
  score: number;
  features: RankingFeatures;
  reasons: string[];
};

export type ReadingPathResult = {
  query: {
    characters: ResolvedCharacter[];
    storyArc: ResolvedStoryArc | null;
  };
  recommendations: RankedRecommendation[];
};
