export type ComicVinePublisher = {
  comicvineId: number;
  name: string;
};

export type ComicVineCharacter = {
  comicvineId: number;
  name: string;
  description: string | null;
  imageUrl: string | null;
  publisher: ComicVinePublisher | null;
  issueCredits: Array<{ comicvineId: number }>;
};

export type ComicVineVolume = {
  comicvineId: number;
  name: string;
  startYear: number | null;
  publisher: ComicVinePublisher | null;
};

export type ComicVineCredit = {
  comicvineId: number;
  name: string;
};

export type ComicVineIssue = {
  comicvineId: number;
  volume: ComicVineCredit;
  issueNumber: string;
  name: string | null;
  coverDate: string | null;
  description: string | null;
  imageUrl: string | null;
  characters: ComicVineCredit[];
  storyArcs: ComicVineCredit[];
};

export type ComicVineStoryArc = ComicVineCredit & {
  description: string | null;
};
