import type {
  RawCharacter,
  RawIssue,
  RawIssueSummary,
  RawVolumeSummary,
  RawStoryArc,
  RawVolume,
} from "./schemas";
import type {
  ComicVineCharacter,
  ComicVineCreatorCredit,
  ComicVineCredit,
  ComicVineIssue,
  ComicVineIssueSummary,
  ComicVinePublisher,
  ComicVineStoryArc,
  ComicVineVolume,
  ComicVineVolumeSummary,
} from "./types";

function cleanText(value?: string | null): string | null {
  const cleaned = value?.trim();
  return cleaned || null;
}

function date(value?: string | null): string | null {
  const cleaned = cleanText(value);
  return cleaned && /^\d{4}-\d{2}-\d{2}$/.test(cleaned) ? cleaned : null;
}

function imageUrl(image?: {
  original_url?: string | null;
  super_url?: string | null;
} | null): string | null {
  return cleanText(image?.original_url) ?? cleanText(image?.super_url);
}

function normalizeCredit(raw: { id: number; name: string }): ComicVineCredit {
  return { comicvineId: raw.id, name: raw.name.trim() };
}

function normalizePublisher(
  raw?: { id: number; name: string } | null,
): ComicVinePublisher | null {
  return raw ? normalizeCredit(raw) : null;
}

function count(value?: string | number | null): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function normalizeCharacter(raw: RawCharacter): ComicVineCharacter {
  return {
    comicvineId: raw.id,
    name: raw.name.trim(),
    description: cleanText(raw.description) ?? cleanText(raw.deck),
    imageUrl: imageUrl(raw.image),
    publisher: normalizePublisher(raw.publisher),
    issueCredits: (raw.issue_credits ?? []).map(({ id }) => ({ comicvineId: id })),
    aliases: splitAliases(raw.aliases),
    issueAppearanceCount: count(raw.count_of_issue_appearances),
  };
}

/** ComicVine packs aliases into one string, separated by \n or \r\n. */
function splitAliases(value?: string | null): string[] {
  return (value ?? "")
    .split(/\r?\n/)
    .map((alias) => alias.trim())
    .filter(Boolean);
}

export function normalizeVolume(raw: RawVolume): ComicVineVolume {
  const parsedYear = Number(raw.start_year);
  const characterCounts = raw.characters ?? raw.character_credits ?? [];

  return {
    comicvineId: raw.id,
    name: raw.name.trim(),
    startYear:
      Number.isInteger(parsedYear) && parsedYear >= 1800 && parsedYear <= 3000
        ? parsedYear
        : null,
    issueCount: count(raw.count_of_issues),
    publisher: normalizePublisher(raw.publisher),
    characterCounts: characterCounts.flatMap((entry) => {
      const appearances = count(entry.count);
      return appearances === null
        ? []
        : [{ comicvineId: entry.id, name: entry.name.trim(), appearances }];
    }),
  };
}

export function normalizeVolumeSummary(raw: RawVolumeSummary): ComicVineVolumeSummary {
  const parsedYear = Number(raw.start_year);
  return {
    comicvineId: raw.id,
    name: raw.name.trim(),
    startYear:
      Number.isInteger(parsedYear) && parsedYear >= 1800 && parsedYear <= 3000
        ? parsedYear
        : null,
    issueCount: count(raw.count_of_issues),
    publisher: normalizePublisher(raw.publisher),
  };
}

export function normalizeIssueSummary(raw: RawIssueSummary): ComicVineIssueSummary {
  return {
    comicvineId: raw.id,
    volume: normalizeCredit(raw.volume),
    issueNumber: String(raw.issue_number).trim(),
    name: cleanText(raw.name),
    coverDate: date(raw.cover_date),
    description: cleanText(raw.description) ?? cleanText(raw.deck),
    imageUrl: imageUrl(raw.image),
  };
}

export function normalizeIssue(raw: RawIssue): ComicVineIssue {
  return {
    ...normalizeIssueSummary(raw),
    characters: (raw.character_credits ?? []).map(normalizeCredit),
    storyArcs: (raw.story_arc_credits ?? []).map(normalizeCredit),
    creators: normalizeCreatorCredits(raw.person_credits),
  };
}

/**
 * ComicVine packs every role a person had on an issue into one comma-separated
 * string ("writer, cover"), so one credit becomes one row per role.
 */
function normalizeCreatorCredits(
  raw: RawIssue["person_credits"],
): ComicVineCreatorCredit[] {
  return (raw ?? []).flatMap((credit) =>
    (cleanText(credit.role) ?? "")
      .split(",")
      .map((role) => role.trim().toLowerCase())
      .filter(Boolean)
      .map((role) => ({ comicvineId: credit.id, name: credit.name.trim(), role })),
  );
}

export function normalizeStoryArc(raw: RawStoryArc): ComicVineStoryArc {
  return {
    ...normalizeCredit(raw),
    description: cleanText(raw.description) ?? cleanText(raw.deck),
  };
}
