import { z } from "zod";

export const ProjectionEntrySchema = z
  .object({
    skill_name: z.string(),
    hosts: z.array(z.string()),
    projected_at: z.string().datetime(),
    last_run_ts: z.string().datetime().nullable(),
  })
  .strict();

export const ProjectionsStateSchema = z.record(z.string(), ProjectionEntrySchema);

const LastSyncSummarySchema = z
  .object({
    added: z.number(),
    removed: z.number(),
    updated: z.number(),
  })
  .strict();

export const LastSyncSchema = z
  .object({
    synced_at: z.string().datetime(),
    summary: LastSyncSummarySchema,
  })
  .strict();

export type ProjectionEntry = z.infer<typeof ProjectionEntrySchema>;
export type ProjectionsState = z.infer<typeof ProjectionsStateSchema>;
export type LastSync = z.infer<typeof LastSyncSchema>;

export function parseProjectionsState(data: unknown): ProjectionsState {
  return ProjectionsStateSchema.parse(data);
}

export function safeParseProjectionsState(data: unknown) {
  return ProjectionsStateSchema.safeParse(data);
}

export function parseLastSync(data: unknown): LastSync {
  return LastSyncSchema.parse(data);
}

export function safeParseLastSync(data: unknown) {
  return LastSyncSchema.safeParse(data);
}
