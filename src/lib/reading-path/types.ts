export type ResolvedCharacter = {
  id: string;
  comicvineId: number;
  name: string;
  description: string | null;
  imageUrl: string | null;
  publisherName: string | null;
  isCanonical?: boolean;
  /** True when the requested name was one of this character's aliases, not their name. */
  matchedAlias?: boolean;
  issueAppearanceCount?: number | null;
  /**
   * False on a stub row created from another issue's credit list rather than
   * fetched in its own right. Such a row can hold a name it does not deserve.
   */
  hasDetails?: boolean;
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

export type CreatorCredit = {
  name: string;
  role: string;
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
    issueCount: number | null;
  };
  characterCount: number;
  requestedCharacterCount: number;
  storyArcs: StoryArcReference[];
  creators: CreatorCredit[];
};

/**
 * How much of one volume the requested characters actually share, from
 * `volume_pair_affinity`. This is what lets the engine tell a book the
 * characters co-star in apart from a book one of them passed through.
 */
export type VolumeAffinity = {
  volumeId: string;
  volumeName: string;
  volumeStartYear: number | null;
  /** Total issues ComicVine reports for the volume; the honest denominator. */
  volumeIssueCount: number | null;
  /** Who published this volume; distinguishes an original run from a reprint. */
  publisherName: string | null;
  localIssueCount: number;
  coIssueCount: number;
  /**
   * Appearances by whichever requested character appears least in this volume.
   * The weakest member decides, so a volume only reads as "about the pair" when
   * every requested character is a regular. Null when ComicVine's per-volume
   * counts have not been fetched.
   */
  minCharacterAppearances: number | null;
  longestCoStreak: number;
  firstCoIssueNumber: string;
  lastCoIssueNumber: string;
  firstCoDate: string | null;
  lastCoDate: string | null;
  topWriter: string | null;
  topArtist: string | null;
};

export type CandidateType = "single_issue" | "issue_run" | "story_arc" | "volume_run";

export type ReadingCandidate = {
  id: string;
  type: CandidateType;
  queryType: "characters" | "story_arc";
  title: string;
  issues: CandidateIssue[];
  storyArc: StoryArcReference | null;
  volumeAffinity: VolumeAffinity | null;
  creators: CreatorCredit[];
};

/** Is this book actually about these characters together? */
export type TogethernessFeatures = {
  /** Share of the volume the weakest requested character appears in. */
  coreCastScore: number;
  /** Longest unbroken stretch of co-appearances, log-scaled. */
  sustainedRunScore: number;
  /** Share of the candidate's own span where every requested character appears. */
  coAppearanceShare: number;
  sharedArcScore: number;
  /** Published by the characters' own publisher rather than a reprint house. */
  publisherAffinity: number;
  /** Volume title names a requested character. */
  titleAffinity: number;
  /**
   * How central one character is to the book, for single-character queries:
   * a book titled after them, or one with a small enough cast that they carry it.
   */
  leadRoleScore: number;
  /** One passing appearance in a book that is not about them. */
  cameoPenalty: number;
};

/** Can somebody who has read nothing start here? */
export type BeginnerFriendlinessFeatures = {
  entryPointScore: number;
  selfContainment: number;
  prerequisiteDepth: number;
  /** Peaks at a few issues; one issue and a hundred issues both score low. */
  commitmentScore: number;
  /**
   * How recent the story is. Newer art and pacing read more easily cold, but
   * recency is not quality, so this is the lightest approachability signal.
   */
  modernityScore: number;
  castManageability: number;
  creativeTeamCohesion: number;
};

export type RankingFeatures = {
  togetherness: number;
  beginnerFriendliness: number;
  /** Data quality, not comic quality: a tiebreaker, never a score component. */
  metadataCompleteness: number;
  together: TogethernessFeatures;
  beginner: BeginnerFriendlinessFeatures;
};

export type RankedRecommendation = ReadingCandidate & {
  score: number;
  features: RankingFeatures;
  reasons: string[];
  /**
   * False when togetherness falls below the gate. Such a candidate may still be
   * listed, but never as the recommended starting point — that is the specific
   * failure this engine exists to prevent.
   */
  eligibleAsStart: boolean;
};

export type ReadingPathResult = {
  query: {
    characters: ResolvedCharacter[];
    storyArc: ResolvedStoryArc | null;
  };
  recommendations: RankedRecommendation[];
};
