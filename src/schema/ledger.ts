import { z } from "zod";

import { OutcomeSchema } from "./outcome";

const ChangedFileSchema = z.object({
  path: z.string(),
  sha256_before: z.string().optional(),
  sha256_after: z.string().optional(),
});

export const EditEventSchema = z.object({
  type: z.literal("edit"),
  routine_id: z.string(),
  edit_id: z.string(),
  intent: z.string().optional(),
  committed_at: z.string(),
  changed_files: z.array(ChangedFileSchema),
});

export type EditEvent = z.infer<typeof EditEventSchema>;

export const LedgerSchema = z.object({
  runs: z.array(OutcomeSchema),
  edits: z.array(EditEventSchema).optional().default([]),
});

export type Ledger = z.infer<typeof LedgerSchema>;

export function parseLedger(data: unknown): Ledger {
  return LedgerSchema.parse(data);
}

export function safeParseLedger(data: unknown) {
  return LedgerSchema.safeParse(data);
}
