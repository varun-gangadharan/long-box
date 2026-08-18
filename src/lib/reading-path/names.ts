/**
 * Punctuation- and accent-insensitive entity key. Mirrors the SQL expression
 * `regexp_replace(lower(trim(name)), '[^a-z0-9]+', '', 'g')` used by
 * `resolve_character_names` and `search_catalog`, so "Spider-Man", "spider man",
 * and "spiderman" all resolve alike on both sides of the boundary.
 */
export function normalizeEntityName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
