import { z } from "zod";

export const ConfigSchema = z
  .object({
    store_version: z.number().default(1),
    discovery: z
      .object({
        enabled: z.boolean().default(true),
        max_suggestions: z.number().default(3),
        suggest_action_preference: z.enum(["show_first"]).default("show_first"),
        recent_window_days: z.number().default(3),
        cooldown_hours: z.number().default(12),
        rate_limit_minutes: z.number().default(30),
      })
      .strict(),
    projection: z
      .object({
        enabled: z.boolean().default(true),
        meta_skill_name: z.string().default("mrp"),
        max_projected_skills: z.number().default(15),
        auto_suggest_threshold_runs: z.number().default(3),
        auto_suggest_window_days: z.number().default(7),
        hosts: z.array(z.string()).default([]),
      })
      .strict(),
    execution: z
      .object({
        default_timeout_sec: z.number().default(900),
        default_output_max_kb: z.number().default(256),
      })
      .strict(),
    policy: z
      .object({
        default_network: z.enum(["on", "off"]).default("off"),
      })
      .strict(),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: Config = {
  store_version: 1,
  discovery: {
    enabled: true,
    max_suggestions: 3,
    suggest_action_preference: "show_first",
    recent_window_days: 3,
    cooldown_hours: 12,
    rate_limit_minutes: 30,
  },
  projection: {
    enabled: true,
    meta_skill_name: "mrp",
    max_projected_skills: 15,
    auto_suggest_threshold_runs: 3,
    auto_suggest_window_days: 7,
    hosts: [],
  },
  execution: {
    default_timeout_sec: 900,
    default_output_max_kb: 256,
  },
  policy: {
    default_network: "off",
  },
};

export function parseConfig(data: unknown): Config {
  return ConfigSchema.parse(data);
}

export function safeParseConfig(data: unknown) {
  return ConfigSchema.safeParse(data);
}
