import type {
  RawCharacter,
  RawIssue,
  RawStoryArc,
  RawVolume,
} from "./schemas";
import type {
  ComicVineCharacter,
  ComicVineCredit,
  ComicVineIssue,
  ComicVinePublisher,
  ComicVineStoryArc,
  ComicVineVolume,
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

export function normalizeCharacter(raw: RawCharacter): ComicVineCharacter {
  return {
    comicvineId: raw.id,
    name: raw.name.trim(),
    description: cleanText(raw.description) ?? cleanText(raw.deck),
    imageUrl: imageUrl(raw.image),
    publisher: normalizePublisher(raw.publisher),
    issueCredits: (raw.issue_credits ?? []).map(({ id }) => ({ comicvineId: id })),
  };
}

export function normalizeVolume(raw: RawVolume): ComicVineVolume {
  const parsedYear = Number(raw.start_year);

  return {
    comicvineId: raw.id,
    name: raw.name.trim(),
    startYear:
      Number.isInteger(parsedYear) && parsedYear >= 1800 && parsedYear <= 3000
        ? parsedYear
        : null,
    publisher: normalizePublisher(raw.publisher),
  };
}

export function normalizeIssue(raw: RawIssue): ComicVineIssue {
  return {
    comicvineId: raw.id,
    volume: normalizeCredit(raw.volume),
    issueNumber: String(raw.issue_number).trim(),
    name: cleanText(raw.name),
    coverDate: date(raw.cover_date),
    description: cleanText(raw.description) ?? cleanText(raw.deck),
    imageUrl: imageUrl(raw.image),
    characters: (raw.character_credits ?? []).map(normalizeCredit),
    storyArcs: (raw.story_arc_credits ?? []).map(normalizeCredit),
  };
}

export function normalizeStoryArc(raw: RawStoryArc): ComicVineStoryArc {
  return {
    ...normalizeCredit(raw),
    description: cleanText(raw.description) ?? cleanText(raw.deck),
  };
}
