import { z } from "zod";

const SuggestedRoutineSchema = z
  .object({
    last_suggested_ts: z.string().datetime(),
  })
  .strict();

export const DiscoveryStateSchema = z
  .object({
    last_emission_ts: z.string().datetime().nullable(),
    suggested_routines: z.record(z.string(), SuggestedRoutineSchema),
  })
  .strict();

export type DiscoveryState = z.infer<typeof DiscoveryStateSchema>;

export const DEFAULT_DISCOVERY_STATE: DiscoveryState = {
  last_emission_ts: null,
  suggested_routines: {},
};

export function parseDiscoveryState(data: unknown): DiscoveryState {
  return DiscoveryStateSchema.parse(data);
}

export function safeParseDiscoveryState(data: unknown) {
  return DiscoveryStateSchema.safeParse(data);
}
