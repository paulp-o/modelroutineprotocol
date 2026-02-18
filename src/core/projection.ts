import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Config } from "../schema/config.ts";
import type { Index, IndexEntry } from "../schema/index-schema.ts";
import type { Routine } from "../schema/routine.ts";
import { readYamlFile, writeYamlAtomic } from "../util/yaml-io.ts";

type RoutineSkillInput = {
  id: string;
  name: string;
  description?: string;
  projection?: {
    skill_name?: string;
  };
  intent: {
    goal: string;
    non_goals: string[];
    success_criteria: Array<{ id: string; text: string }>;
  };
  lifecycle?: { state?: string };
};

type ProjectionStateEntry = {
  skill_name: string;
  hosts: string[];
  projected_at: string;
  last_run_ts: string | null;
};

const STALE_WARNING =
  "Host skill lists may lag behind canonical .mrp state; use `mrp list` and `mrp show` as authoritative truth.";

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function formatList(items: string[]): string {
  if (items.length === 0) {
    return "- None declared";
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function formatCriteria(items: Array<{ id: string; text: string }>): string {
  if (items.length === 0) {
    return "- No success criteria declared";
  }

  return items.map((item) => `- ${item.id}: ${item.text}`).join("\n");
}

function renderFrontmatter(fields: { name: string; description: string }): string {
  const escapedDescription = fields.description.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `---\nname: ${fields.name}\ndescription: "${escapedDescription}"\n---\n\n`;
}

function normalizeProjectionState(raw: unknown): Record<string, ProjectionStateEntry> {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const out: Record<string, ProjectionStateEntry> = {};

  for (const [routineId, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") {
      continue;
    }

    const maybe = value as {
      skill_name?: unknown;
      hosts?: unknown;
      projected_at?: unknown;
      last_run_ts?: unknown;
    };

    if (
      typeof maybe.skill_name !== "string" ||
      !Array.isArray(maybe.hosts) ||
      typeof maybe.projected_at !== "string"
    ) {
      continue;
    }

    const hosts = maybe.hosts.filter((host): host is string => typeof host === "string");
    const lastRunTs = typeof maybe.last_run_ts === "string" ? maybe.last_run_ts : null;

    out[routineId] = {
      skill_name: maybe.skill_name,
      hosts,
      projected_at: maybe.projected_at,
      last_run_ts: lastRunTs,
    };
  }

  return out;
}

async function ensureDirectory(path: string): Promise<boolean> {
  try {
    const entry = await stat(path);
    if (!entry.isDirectory()) {
      throw new Error(`Path exists but is not a directory: ${path}`);
    }

    return false;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      await mkdir(path, { recursive: true });
      return true;
    }

    throw error;
  }
}

function metaSkillPath(host: string, projectRoot: string, metaSkillName: string): string {
  return join(hostSkillDir(host, projectRoot), metaSkillName, "SKILL.md");
}

async function upsertSkillFile(path: string, content: string): Promise<"added" | "updated" | "unchanged"> {
  let existing: string | null = null;

  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if (!(isNodeError(error) && error.code === "ENOENT")) {
      throw error;
    }
  }

  if (existing === content) {
    return "unchanged";
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");

  return existing === null ? "added" : "updated";
}

export function renderRoutineSkillMd(routine: RoutineSkillInput): string {
  const skillName = routine.projection?.skill_name || routine.id;
  const wrapperDirName = `mrp-${skillName}`;
  const description = routine.description || routine.intent.goal;
  const deprecated = routine.lifecycle?.state === "deprecated";
  const deprecatedNotice = deprecated
    ? [
        "> [!WARNING]",
        "> This routine is deprecated. Prefer newer alternatives when available.",
        "",
      ].join("\n")
    : "";

  return [
    renderFrontmatter({
      name: wrapperDirName,
      description,
    }),
    `# ${routine.name}`,
    "",
    deprecatedNotice,
    "## When this routine is relevant",
    `Use this routine when you need to: ${routine.intent.goal}`,
    "",
    "## Goal",
    routine.intent.goal,
    "",
    "## Non-goals",
    formatList(routine.intent.non_goals),
    "",
    "## Success criteria",
    formatCriteria(routine.intent.success_criteria),
    "",
    "## Run",
    `- Command: \`mrp run ${routine.id}\``,
    "",
    "## Canonical truth",
    `- Routine detail: \`mrp show ${routine.id}\``,
    "- Routine list: `mrp list`",
    "",
    "Source of truth: `.mrp/`",
    "",
  ].join("\n");
}

export function renderMetaSkillMd(metaSkillName: string = "mrp"): string {
  return [
    renderFrontmatter({
      name: metaSkillName,
      description: "Model Routine Protocol (MRP) – manage and run repeatable agent routines.",
    }),
    `# ${metaSkillName}`,
    "",
    "Model Routine Protocol (MRP) helps agents capture, discover, and run repeatable workflows from local project state.",
    "",
    "## Core workflow",
    "- `mrp init`: create and initialize the local `.mrp/` store for this project.",
    "- `mrp create --name <name> --goal \"<goal>\"`: create a new routine scaffold you can refine.",
    "- `mrp list`: discover available routines and current lifecycle states.",
    "- `mrp show <routine_id>`: inspect the canonical routine definition and current metadata.",
    "- `mrp run <routine_id>`: execute a routine and record outcomes/artifacts.",
    "- `mrp promote <routine_id>`: mark a routine as preferred for active use.",
    "- `mrp edit <routine_id>`: update routine details such as goal, non-goals, or criteria.",
    "",
    "Run `mrp <command> --help` for detailed usage and flags.",
    "",
    "## Additional lifecycle and maintenance commands",
    "- `mrp demote <routine_id>` and `mrp deprecate <routine_id>` for lifecycle transitions.",
    "- `mrp archive <routine_id>` and `mrp quarantine <routine_id>` for long-term retirement or isolation.",
    "- `mrp sync-skills` to refresh projected host skills.",
    "- `mrp doctor` to validate store health and configuration.",
    "- `mrp prune` to clean stale runtime artifacts.",
    "",
    "## Canonical truth",
    "- `mrp list` and `mrp show` are authoritative over host skill listings.",
    "- `.mrp/` is the canonical source of truth.",
    "",
    "## When to use projected routines",
    "Use projected routine skills for quick discovery, then verify details with `mrp show`.",
    "",
  ].join("\n");
}

export function hostSkillDir(host: string, projectRoot: string): string {
  switch (host) {
    case "opencode":
      return join(projectRoot, ".opencode", "skills");
    case "claude":
      return join(projectRoot, ".claude", "skills");
    case "cursor":
      return join(projectRoot, ".cursor", "skills");
    case "windsurf":
      return join(projectRoot, ".windsurf", "skills");
    default:
      throw new Error(`Unsupported projection host: ${host}`);
  }
}

export function skillWrapperDir(host: string, projectRoot: string, skillName: string): string {
  return join(hostSkillDir(host, projectRoot), `mrp-${skillName}`);
}

export function skillWrapperPath(host: string, projectRoot: string, skillName: string): string {
  return join(skillWrapperDir(host, projectRoot, skillName), "SKILL.md");
}

export type SyncResult = {
  added: number;
  removed: number;
  updated: number;
  warnings: string[];
  evicted?: string[];
  stale_warning: string;
};

export async function syncSkills(params: {
  root: string;
  config: Config;
  index: Index;
  routines: Map<string, Routine>;
}): Promise<SyncResult> {
  const { root, config, index, routines } = params;
  const warnings: string[] = [];
  let added = 0;
  let removed = 0;
  let updated = 0;

  const hosts = Array.from(new Set(config.projection.hosts));
  const now = new Date().toISOString();
  const indexById = new Map(index.routines.map((entry) => [entry.id, entry]));

  const desiredProjected = new Map<string, Routine>();
  for (const [routineId, routine] of routines) {
    if (routineId === routine.id && routine.projection.projected) {
      desiredProjected.set(routineId, routine);
    }
  }

  const projectionsStatePath = join(root, ".mrp", "projections", "projections.yaml");
  const lastSyncStatePath = join(root, ".mrp", "projections", "last_sync.yaml");
  await mkdir(dirname(projectionsStatePath), { recursive: true });

  let previousState: Record<string, ProjectionStateEntry> = {};
  try {
    const raw = await readYamlFile<unknown>(projectionsStatePath);
    previousState = normalizeProjectionState(raw);
  } catch (error) {
    if (!(isNodeError(error) && error.code === "ENOENT")) {
      throw error;
    }
  }

  for (const host of hosts) {
    const hostDir = hostSkillDir(host, root);
    const createdHostDir = await ensureDirectory(hostDir);
    if (createdHostDir) {
      warnings.push(`Created missing host skill directory: ${hostDir}`);
    }

    const metaResult = await upsertSkillFile(
      metaSkillPath(host, root, config.projection.meta_skill_name),
      renderMetaSkillMd(config.projection.meta_skill_name),
    );
    if (metaResult === "added") {
      added += 1;
    } else if (metaResult === "updated") {
      updated += 1;
    }

    const desiredWrapperDirs = new Set<string>();
    const claimedNames = new Map<string, string>();

    for (const [routineId, routine] of desiredProjected) {
      const skillName = routine.projection.skill_name || routine.id;
      const wrapperDirName = `mrp-${skillName}`;
      const priorOwner = claimedNames.get(wrapperDirName);

      if (priorOwner) {
        warnings.push(
          `Host ${host}: duplicate projected skill wrapper ${wrapperDirName} for routines ${priorOwner} and ${routineId}; keeping first`,
        );
        continue;
      }

      claimedNames.set(wrapperDirName, routineId);
      desiredWrapperDirs.add(wrapperDirName);

      const routineResult = await upsertSkillFile(
        skillWrapperPath(host, root, skillName),
        renderRoutineSkillMd(routine),
      );
      if (routineResult === "added") {
        added += 1;
      } else if (routineResult === "updated") {
        updated += 1;
      }
    }

    const hostEntries = await readdir(hostDir, { withFileTypes: true });
    for (const entry of hostEntries) {
      if (!entry.isDirectory() || !entry.name.startsWith("mrp-")) {
        continue;
      }

      if (desiredWrapperDirs.has(entry.name)) {
        continue;
      }

      await rm(join(hostDir, entry.name), { recursive: true, force: true });
      removed += 1;
    }
  }

  const currentProjectionState: Record<string, ProjectionStateEntry> = {};
  for (const [routineId, routine] of desiredProjected) {
    const currentIndexEntry = indexById.get(routineId);
    const prior = previousState[routineId];

    currentProjectionState[routineId] = {
      skill_name: routine.projection.skill_name || routine.id,
      hosts,
      projected_at: prior?.projected_at ?? now,
      last_run_ts: currentIndexEntry?.last_run_ts ?? null,
    };
  }

  await writeYamlAtomic(projectionsStatePath, currentProjectionState);
  await writeYamlAtomic(lastSyncStatePath, {
    synced_at: now,
    summary: {
      added,
      removed,
      updated,
    },
  });

  return {
    added,
    removed,
    updated,
    warnings,
    stale_warning: STALE_WARNING,
  };
}

export function pickEvictionCandidate(projectedEntries: IndexEntry[], max: number): string | null {
  if (projectedEntries.length < max) {
    return null;
  }

  const sorted = [...projectedEntries].sort((a, b) => {
    if (!a.last_run_ts && !b.last_run_ts) {
      return a.id.localeCompare(b.id);
    }

    if (!a.last_run_ts) {
      return -1;
    }

    if (!b.last_run_ts) {
      return 1;
    }

    const left = Date.parse(a.last_run_ts);
    const right = Date.parse(b.last_run_ts);
    if (Number.isNaN(left) && Number.isNaN(right)) {
      return a.id.localeCompare(b.id);
    }
    if (Number.isNaN(left)) {
      return -1;
    }
    if (Number.isNaN(right)) {
      return 1;
    }

    if (left === right) {
      return a.id.localeCompare(b.id);
    }

    return left - right;
  });

  return sorted[0]?.id ?? null;
}
