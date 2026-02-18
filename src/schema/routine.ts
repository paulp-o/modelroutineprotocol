import { z } from "zod";

const ROUTINE_ID_REGEX = /^mrp-[a-z0-9]+(?:-[a-z0-9]+)*-[a-z0-9]{4,8}$/;
const ENTRYPOINT_REGEX = /\.(sh|ts|py)$/;

const SuccessCriterionSchema = z
  .object({
    id: z.string(),
    text: z.string(),
  })
  .strict();

const FailureModeSchema = z
  .object({
    id: z.string(),
    text: z.string(),
    suggested_fix: z.string().optional(),
  })
  .strict();

export const RoutineSchema = z
  .object({
    id: z
      .string()
      .regex(ROUTINE_ID_REGEX, "id must match mrp-<slug>-<shortid>"),
    name: z.string(),
    description: z.string().optional(),
    intent: z
      .object({
        goal: z.string(),
        non_goals: z.array(z.string()),
        success_criteria: z
          .array(SuccessCriterionSchema)
          .superRefine((criteria, ctx) => {
            const seen = new Set<string>();
            for (const item of criteria) {
              if (seen.has(item.id)) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: `duplicate success_criteria id: ${item.id}`,
                });
              }
              seen.add(item.id);
            }
          }),
        failure_modes: z.array(FailureModeSchema).optional(),
      })
      .strict(),
    execution: z
      .object({
        entrypoint: z
          .string()
          .regex(ENTRYPOINT_REGEX, "entrypoint must end with .sh, .ts, or .py"),
        verifier: z.string().optional(),
        shell: z.string().default("bash"),
        timeout_sec: z.number().optional(),
      })
      .strict(),
    tags: z.array(z.string()).optional(),
    lifecycle: z
      .object({
        state: z.enum(["draft", "active", "deprecated", "archived", "quarantine"]),
        created_at: z.string().datetime(),
        updated_at: z.string().datetime(),
        expires_at: z.string().datetime().optional(),
      })
      .strict(),
    policy: z
      .object({
        risk_level: z.enum(["low", "medium", "high"]).optional(),
        side_effects: z.array(z.string()).optional(),
        network: z.enum(["on", "off"]).optional(),
        output_max_kb: z.number().optional(),
      })
      .strict()
      .optional(),
    projection: z
      .object({
        eligible: z.boolean(),
        projected: z.boolean(),
        skill_name: z.string().optional(),
      })
      .strict(),
    meta: z
      .object({
        version: z.string().optional(),
        owner: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type Routine = z.infer<typeof RoutineSchema>;

export function parseRoutine(data: unknown): Routine {
  return RoutineSchema.parse(data);
}

export function safeParseRoutine(data: unknown) {
  return RoutineSchema.safeParse(data);
}
