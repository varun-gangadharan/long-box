import { z } from "zod";

const nullableText = z.string().nullable().optional();

export const rawCreditSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
});

const rawPublisherSchema = rawCreditSchema.nullable().optional();
const rawImageSchema = z
  .object({
    original_url: nullableText,
    super_url: nullableText,
  })
  .nullable()
  .optional();

export const rawCharacterSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  deck: nullableText,
  description: nullableText,
  image: rawImageSchema,
  publisher: rawPublisherSchema,
  // Newline-separated, and the separator varies between \n and \r\n.
  aliases: nullableText,
  count_of_issue_appearances: z.union([z.string(), z.number()]).nullable().optional(),
  issue_credits: z
    .array(z.object({ id: z.number().int().positive(), name: nullableText }))
    .nullable()
    .optional(),
});

// Per-character appearance counts for a volume. The API documentation calls this
// field `character_credits` while live responses have been observed using
// `characters`; both are accepted so a rename on either side cannot silently
// drop the strongest core-cast signal we have.
const rawCharacterCountSchema = z.array(
  z.object({
    id: z.number().int().positive(),
    name: z.string().min(1),
    count: z.union([z.string(), z.number()]).nullable().optional(),
  }),
)
  .nullable()
  .optional();

export const rawVolumeSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  start_year: z.union([z.string(), z.number()]).nullable().optional(),
  count_of_issues: z.union([z.string(), z.number()]).nullable().optional(),
  publisher: rawPublisherSchema,
  characters: rawCharacterCountSchema,
  character_credits: rawCharacterCountSchema,
});

export const rawIssueSchema = z.object({
  id: z.number().int().positive(),
  volume: rawCreditSchema,
  issue_number: z.union([z.string(), z.number()]),
  name: nullableText,
  cover_date: nullableText,
  deck: nullableText,
  description: nullableText,
  image: rawImageSchema,
  character_credits: z.array(rawCreditSchema).nullable().optional(),
  story_arc_credits: z.array(rawCreditSchema).nullable().optional(),
  person_credits: z
    .array(
      z.object({
        id: z.number().int().positive(),
        name: z.string().min(1),
        // A single comma-separated string such as "writer, cover", not an array.
        role: nullableText,
      }),
    )
    .nullable()
    .optional(),
});

// The issues list endpoint never returns credits of any kind, so it gets its own
// schema rather than relying on every credit field being optional.
// The volumes list endpoint carries no character array, so it gets its own
// schema rather than making every field of the detail shape optional.
export const rawVolumeSummarySchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  start_year: z.union([z.string(), z.number()]).nullable().optional(),
  count_of_issues: z.union([z.string(), z.number()]).nullable().optional(),
  publisher: rawPublisherSchema,
});

export const rawIssueSummarySchema = z.object({
  id: z.number().int().positive(),
  volume: rawCreditSchema,
  issue_number: z.union([z.string(), z.number()]),
  name: nullableText,
  cover_date: nullableText,
  deck: nullableText,
  description: nullableText,
  image: rawImageSchema,
});

export const rawStoryArcSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  deck: nullableText,
  description: nullableText,
});

export type RawCharacter = z.infer<typeof rawCharacterSchema>;
export type RawVolume = z.infer<typeof rawVolumeSchema>;
export type RawVolumeSummary = z.infer<typeof rawVolumeSummarySchema>;
export type RawIssue = z.infer<typeof rawIssueSchema>;
export type RawIssueSummary = z.infer<typeof rawIssueSummarySchema>;
export type RawStoryArc = z.infer<typeof rawStoryArcSchema>;

export function responseSchema<T extends z.ZodType>(resultSchema: T) {
  return z.object({
    status_code: z.number(),
    error: z.string().optional(),
    number_of_total_results: z.number().int().nonnegative().default(0),
    number_of_page_results: z.number().int().nonnegative().default(0),
    limit: z.number().int().positive().default(100),
    offset: z.number().int().nonnegative().default(0),
    results: resultSchema,
  });
}
