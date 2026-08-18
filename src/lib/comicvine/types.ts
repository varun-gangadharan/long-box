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
  /** Other names this character is published under, e.g. Dick Grayson is "Nightwing". */
  aliases: string[];
  /** Total issues ComicVine has them in; the basis for picking between same-named characters. */
  issueAppearanceCount: number | null;
};

export type ComicVineVolume = {
  comicvineId: number;
  name: string;
  startYear: number | null;
  /** Total issues published, the honest denominator for core-cast share. */
  issueCount: number | null;
  publisher: ComicVinePublisher | null;
  /** How many issues of this volume each character appears in. */
  characterCounts: Array<{ comicvineId: number; name: string; appearances: number }>;
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
  creators: ComicVineCreatorCredit[];
};

/** One person on one issue. ComicVine's comma-separated roles are split apart. */
export type ComicVineCreatorCredit = {
  comicvineId: number;
  name: string;
  role: string;
};

/** The issues list endpoint returns metadata only — never credits. */
export type ComicVineIssueSummary = Omit<
  ComicVineIssue,
  "characters" | "storyArcs" | "creators"
>;

export type ComicVineStoryArc = ComicVineCredit & {
  description: string | null;
};
