import { z } from "zod";

const RunIdSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})#\d{4}$/,
    "run_id must match <ISO-8601>#<4-digit-seq>",
  );

const OutcomeEvidenceSchema = z.object({
  success_criteria_id: z.string(),
  evidence: z.string(),
});

const OutcomeTimingSchema = z.object({
  started_at: z.string(),
  ended_at: z.string(),
  duration_ms: z.number(),
});

const OutcomeArtifactsSchema = z.object({
  stdout_path: z.string().nullable().optional(),
  stderr_path: z.string().nullable().optional(),
  notes: z.string().optional(),
});

export type ExecutionSnapshot = {
  entrypoint_hash: string;
  entrypoint_path: string;
  entrypoint_size: number;
};

export type Judgment = {
  status: "success" | "failure" | "partial";
  reason?: string;
  judged_at: string;
};

export const OutcomeSchema = z.object({
  routine_id: z.string(),
  run_id: RunIdSchema,
  intent_recap: z.string(),
  status: z.enum(["success", "failure", "timeout", "blocked", "partial"]),
  evidence: z.array(OutcomeEvidenceSchema),
  risks: z.array(z.string()),
  next_actions: z.array(z.string()),
  timing: OutcomeTimingSchema,
  artifacts: OutcomeArtifactsSchema,
  override: z.boolean(),
  truncated: z.boolean().optional(),
  warnings: z.array(z.string()).optional(),
  status_auto: z.enum(["success", "failure", "timeout"]).optional(),
  execution_snapshot: z
    .object({
      entrypoint_hash: z.string(),
      entrypoint_path: z.string(),
      entrypoint_size: z.number(),
    })
    .optional(),
  script_changed: z.boolean().optional(),
  judgment: z
    .object({
      status: z.enum(["success", "failure", "partial"]),
      reason: z.string().optional(),
      judged_at: z.string(),
    })
    .optional(),
});

export type Outcome = z.infer<typeof OutcomeSchema>;

export function parseOutcome(data: unknown): Outcome {
  return OutcomeSchema.parse(data);
}

export function safeParseOutcome(data: unknown) {
  return OutcomeSchema.safeParse(data);
}
