import { z } from "zod";

export const IndexEntrySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    state: z.string(),
    tags: z.array(z.string()),
    projected: z.boolean(),
    last_run_status: z.string().nullable(),
    last_run_ts: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict();

export const IndexSchema = z
  .object({
    routines: z.array(IndexEntrySchema),
  })
  .strict();

export type IndexEntry = z.infer<typeof IndexEntrySchema>;
export type Index = z.infer<typeof IndexSchema>;

export function parseIndex(data: unknown): Index {
  return IndexSchema.parse(data);
}

export function safeParseIndex(data: unknown) {
  return IndexSchema.safeParse(data);
}
