import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { readIndex, routineToIndexEntry, updateIndexEntry } from "../core/index.ts";
import { generateRoutineId } from "../core/routine.ts";
import { generateEntrypoint } from "../core/skeleton.ts";
import {
  findStoreRoot,
  ledgerPath,
  routineDir,
  runsDir,
  storeLockPath,
} from "../core/store.ts";
import { zodErrorToDetails } from "../schema/error.ts";
import { safeParseRoutine, type Routine } from "../schema/routine.ts";
import { acquireLock } from "../util/lock.ts";
import { errEnvelope, okEnvelope, type Envelope } from "../util/envelope.ts";
import { writeYamlAtomic } from "../util/yaml-io.ts";

type EntrypointType = "sh" | "ts" | "py";

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStringList(value: unknown): string[] {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? [normalized] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }

    const normalized = entry.trim();
    if (normalized.length > 0) {
      items.push(normalized);
    }
  }

  return items;
}

function parseEntrypointType(value: unknown): EntrypointType | null {
  if (value === undefined) {
    return "sh";
  }

  if (typeof value !== "string") {
    return null;
  }

  if (value === "sh" || value === "ts" || value === "py") {
    return value;
  }

  return null;
}

function parseSuccessCriteria(
  rawValues: string[],
): { ok: true; criteria: Array<{ id: string; text: string }> } | { ok: false; message: string } {
  const criteria: Array<{ id: string; text: string }> = [];

  for (const rawValue of rawValues) {
    const separatorIndex = rawValue.indexOf(":");
    if (separatorIndex <= 0 || separatorIndex >= rawValue.length - 1) {
      return {
        ok: false,
        message: `Invalid --success-criteria value '${rawValue}'. Expected format id:text`,
      };
    }

    const id = rawValue.slice(0, separatorIndex).trim();
    const text = rawValue.slice(separatorIndex + 1).trim();
    if (id.length === 0 || text.length === 0) {
      return {
        ok: false,
        message: `Invalid --success-criteria value '${rawValue}'. Expected format id:text`,
      };
    }

    criteria.push({ id, text });
  }

  return { ok: true, criteria };
}

function missingFlagEnvelope(flag: string): Envelope {
  return errEnvelope("create", "MISSING_REQUIRED_FLAG", `${flag} is required`);
}

export async function handleCreate(
  _args: string[],
  flags: Record<string, unknown>,
): Promise<Envelope> {
  try {
    const root = await findStoreRoot(process.cwd());

    const name = asTrimmedString(flags.name);
    if (!name) {
      return missingFlagEnvelope("--name");
    }

    const goal = asTrimmedString(flags.goal);
    if (!goal) {
      return missingFlagEnvelope("--goal");
    }

    const nonGoals = normalizeStringList(flags["non-goals"] ?? flags.nonGoals);
    if (nonGoals.length === 0) {
      return missingFlagEnvelope("--non-goals");
    }

    const successCriteriaRaw = normalizeStringList(
      flags["success-criteria"] ?? flags.successCriteria,
    );
    if (successCriteriaRaw.length === 0) {
      return missingFlagEnvelope("--success-criteria");
    }

    const parsedSuccessCriteria = parseSuccessCriteria(successCriteriaRaw);
    if (!parsedSuccessCriteria.ok) {
      return errEnvelope("create", "VALIDATION_ERROR", parsedSuccessCriteria.message);
    }

    const entrypointType = parseEntrypointType(flags["entrypoint-type"] ?? flags.entrypointType);
    if (!entrypointType) {
      return errEnvelope(
        "create",
        "VALIDATION_ERROR",
        "--entrypoint-type must be one of: sh, ts, py",
      );
    }

    const description = asTrimmedString(flags.description) ?? undefined;
    const tags = normalizeStringList(flags.tags);

    const existingIds = (await readIndex(root)).routines.map((entry) => entry.id);
    const id = generateRoutineId(name, existingIds);

    const now = new Date().toISOString();
    const routine: Routine = {
      id,
      name,
      ...(description ? { description } : {}),
      intent: {
        goal,
        non_goals: nonGoals,
        success_criteria: parsedSuccessCriteria.criteria,
      },
      execution: {
        entrypoint: `run.${entrypointType}`,
        shell: "bash",
      },
      lifecycle: {
        state: "draft",
        created_at: now,
        updated_at: now,
      },
      tags,
      projection: {
        eligible: true,
        projected: false,
      },
      policy: {},
      meta: {},
    };

    const parsedRoutine = safeParseRoutine(routine);
    if (!parsedRoutine.success) {
      return errEnvelope(
        "create",
        "VALIDATION_ERROR",
        "Routine validation failed",
        zodErrorToDetails(parsedRoutine.error),
      );
    }

    const createdRoutine = parsedRoutine.data;
    const createdRoutineDir = routineDir(root, createdRoutine.id);
    await mkdir(createdRoutineDir, { recursive: true });
    await mkdir(runsDir(root, createdRoutine.id), { recursive: true });

    await writeYamlAtomic(join(createdRoutineDir, "routine.yaml"), createdRoutine);

    const entrypoint = generateEntrypoint(entrypointType, goal);
    const entrypointPath = join(createdRoutineDir, entrypoint.filename);
    await writeFile(entrypointPath, entrypoint.content, "utf8");
    if (entrypointType === "sh") {
      await chmod(entrypointPath, 0o755);
    }

    await writeYamlAtomic(ledgerPath(root, createdRoutine.id), { runs: [] });

    const releaseStoreLock = await acquireLock(storeLockPath(root));
    try {
      await updateIndexEntry(root, routineToIndexEntry(createdRoutine));
    } finally {
      await releaseStoreLock();
    }

    return okEnvelope("create", {
      routine: createdRoutine,
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      const code = String((error as { code?: string }).code);
      if (code === "STORE_NOT_FOUND") {
        return errEnvelope("create", "STORE_NOT_FOUND", "No .mrp store found from current directory");
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    return errEnvelope("create", "INTERNAL_ERROR", message);
  }
}
