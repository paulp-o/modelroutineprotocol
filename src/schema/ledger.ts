import { z } from "zod";

import { OutcomeSchema } from "./outcome";

export const LedgerSchema = z.object({
  runs: z.array(OutcomeSchema),
});

export type Ledger = z.infer<typeof LedgerSchema>;

export function parseLedger(data: unknown): Ledger {
  return LedgerSchema.parse(data);
}

export function safeParseLedger(data: unknown) {
  return LedgerSchema.safeParse(data);
}
