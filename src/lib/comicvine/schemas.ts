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
  issue_credits: z
    .array(z.object({ id: z.number().int().positive(), name: nullableText }))
    .nullable()
    .optional(),
});

export const rawVolumeSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  start_year: z.union([z.string(), z.number()]).nullable().optional(),
  publisher: rawPublisherSchema,
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
});

export const rawStoryArcSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  deck: nullableText,
  description: nullableText,
});

export type RawCharacter = z.infer<typeof rawCharacterSchema>;
export type RawVolume = z.infer<typeof rawVolumeSchema>;
export type RawIssue = z.infer<typeof rawIssueSchema>;
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
