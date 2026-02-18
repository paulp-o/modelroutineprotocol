import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { readIndex } from "../core/index.ts";
import { findStoreRoot, routineDir, routineLockPath, runsDir } from "../core/store.ts";
import { errEnvelope, okEnvelope, type Envelope } from "../util/envelope.ts";
import { acquireLock } from "../util/lock.ts";

type DeletedRun = {
  routine_id: string;
  run_id: string;
};

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function isTruthyFlag(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function stringFlag(flags: Record<string, unknown>, key: string): string | undefined {
  const value = flags[key];

  if (Array.isArray(value)) {
    for (let i = value.length - 1; i >= 0; i -= 1) {
      if (typeof value[i] === "string") {
        return value[i];
      }
    }

    return undefined;
  }

  return typeof value === "string" ? value : undefined;
}

function parseKeepLast(value: unknown): number | null {
  if (value === undefined) {
    return null;
  }

  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

export function parseDuration(input: string): number {
  const normalized = input.trim().toLowerCase();
  const match = normalized.match(/^(\d+)([smhdw])$/);
  if (!match) {
    throw new Error(`Invalid duration '${input}'. Use Ns, Nm, Nh, Nd, or Nw.`);
  }

  const amountText = match[1];
  const unit = match[2];
  if (!amountText || !unit) {
    throw new Error(`Invalid duration '${input}'. Use Ns, Nm, Nh, Nd, or Nw.`);
  }

  const amount = Number.parseInt(amountText, 10);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid duration '${input}'. Value must be positive.`);
  }

  const unitMs =
    unit === "s"
      ? 1_000
      : unit === "m"
        ? 60_000
        : unit === "h"
          ? 3_600_000
          : unit === "d"
            ? 86_400_000
            : 604_800_000;

  return amount * unitMs;
}

function parseRunStartedAtMs(runId: string): number | null {
  const [timestamp] = runId.split("#", 1);
  if (!timestamp) {
    return null;
  }

  const tIndex = timestamp.indexOf("T");
  const desanitizedTimestamp =
    tIndex === -1
      ? timestamp
      : timestamp.slice(0, tIndex) + timestamp.slice(tIndex).replace(/-/g, ":");

  const parsed = Date.parse(desanitizedTimestamp);
  return Number.isNaN(parsed) ? null : parsed;
}

function shouldDeleteRun(
  runId: string,
  position: number,
  keepLast: number | null,
  olderThanMs: number | null,
  nowMs: number,
): boolean {
  const beyondKeepLast = keepLast === null ? true : position >= keepLast;

  if (olderThanMs === null) {
    return beyondKeepLast;
  }

  const startedAtMs = parseRunStartedAtMs(runId);
  const olderThanCutoff = startedAtMs === null ? false : nowMs - startedAtMs >= olderThanMs;

  return beyondKeepLast && olderThanCutoff;
}

async function routineExists(root: string, routineId: string): Promise<boolean> {
  try {
    const entry = await stat(routineDir(root, routineId));
    return entry.isDirectory();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function listRunDirectories(root: string, routineId: string): Promise<string[]> {
  try {
    const entries = await readdir(runsDir(root, routineId), { withFileTypes: true, encoding: "utf8" });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

export async function handlePrune(
  _args: string[],
  flags: Record<string, unknown>,
): Promise<Envelope> {
  const olderThanRaw = stringFlag(flags, "older-than") ?? stringFlag(flags, "olderThan");
  const keepLastRaw = flags["keep-last"] ?? flags.keepLast;
  const routineScope = stringFlag(flags, "routine");
  const dryRun = isTruthyFlag(flags["dry-run"]) || isTruthyFlag(flags.dryRun);

  if (olderThanRaw === undefined && keepLastRaw === undefined) {
    return errEnvelope(
      "prune",
      "MISSING_REQUIRED_FLAG",
      "At least one of --older-than <duration> or --keep-last <n> is required",
    );
  }

  let olderThanMs: number | null = null;
  if (olderThanRaw !== undefined) {
    try {
      olderThanMs = parseDuration(olderThanRaw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errEnvelope("prune", "VALIDATION_ERROR", message);
    }
  }

  const keepLast = parseKeepLast(keepLastRaw);
  if (keepLastRaw !== undefined && keepLast === null) {
    return errEnvelope("prune", "VALIDATION_ERROR", "--keep-last must be a non-negative integer");
  }

  try {
    const root = await findStoreRoot(process.cwd());

    const targetRoutineIds = routineScope
      ? [routineScope]
      : (await readIndex(root)).routines.map((entry) => entry.id);

    if (routineScope && !(await routineExists(root, routineScope))) {
      return errEnvelope("prune", "ROUTINE_NOT_FOUND", `Routine '${routineScope}' not found`);
    }

    const deleted: DeletedRun[] = [];
    let runsFound = 0;
    let runsDeleted = 0;
    const nowMs = Date.now();

    for (const routineId of targetRoutineIds) {
      if (!(await routineExists(root, routineId))) {
        continue;
      }

      let releaseRoutineLock: (() => Promise<void>) | undefined;
      try {
        releaseRoutineLock = await acquireLock(routineLockPath(root, routineId));

        const runIds = await listRunDirectories(root, routineId);
        runsFound += runIds.length;

        for (let i = 0; i < runIds.length; i += 1) {
          const runId = runIds[i];
          if (!runId) {
            continue;
          }

          if (!shouldDeleteRun(runId, i, keepLast, olderThanMs, nowMs)) {
            continue;
          }

          deleted.push({ routine_id: routineId, run_id: runId });
          if (dryRun) {
            continue;
          }

          await rm(join(runsDir(root, routineId), runId), { recursive: true, force: true });
          runsDeleted += 1;
        }
      } finally {
        if (releaseRoutineLock) {
          await releaseRoutineLock();
        }
      }
    }

    return okEnvelope("prune", {
      dry_run: dryRun,
      routines_scanned: targetRoutineIds.length,
      runs_found: runsFound,
      runs_deleted: dryRun ? 0 : runsDeleted,
      deleted,
    });
  } catch (error) {
    if (isNodeError(error) && error.code === "STORE_NOT_FOUND") {
      return errEnvelope("prune", "STORE_NOT_FOUND", "No .mrp store found from current directory");
    }

    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      String((error as { code?: string }).code) === "STORE_NOT_FOUND"
    ) {
      const maybeMessage = (error as { message?: unknown }).message;
      const message =
        typeof maybeMessage === "string"
          ? maybeMessage
          : "No .mrp store found from current directory";
      return errEnvelope("prune", "STORE_NOT_FOUND", message);
    }

    const message = error instanceof Error ? error.message : String(error);
    return errEnvelope("prune", "INTERNAL_ERROR", message);
  }
}
