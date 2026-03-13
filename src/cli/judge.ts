import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { readIndex, routineToIndexEntry, updateIndexEntry } from "../core/index.ts";
import { updateRunEntry } from "../core/ledger.ts";
import {
  findStoreRoot,
  ledgerPath,
  routineDir,
  routineLockPath,
  storeLockPath,
} from "../core/store.ts";
import { parseRoutine } from "../schema/routine.ts";
import { errEnvelope, okEnvelope, type Envelope } from "../util/envelope.ts";
import { acquireLock, releaseLock } from "../util/lock.ts";
import { readYamlFile } from "../util/yaml-io.ts";

type JudgeStatus = "success" | "failure" | "partial";

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function isJudgeStatus(value: string): value is JudgeStatus {
  return value === "success" || value === "failure" || value === "partial";
}

function pickLastFlagString(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const last = value[value.length - 1];
    return typeof last === "string" ? last : undefined;
  }

  return typeof value === "string" ? value : undefined;
}

function toStatusAuto(value: string): "success" | "failure" | "timeout" | undefined {
  if (value === "success" || value === "failure" || value === "timeout") {
    return value;
  }

  return undefined;
}

export async function handleJudge(
  args: string[],
  flags: Record<string, unknown>,
): Promise<Envelope> {
  const routineId = args[0]?.trim();
  const runId = args[1]?.trim();

  if (!routineId || !runId) {
    return errEnvelope(
      "judge",
      "MISSING_ARGUMENT",
      'Usage: mrp judge <routine_id> <run_id> --status <status> [--reason "..."]',
    );
  }

  const statusFlag = pickLastFlagString(flags.status);
  const reason = pickLastFlagString(flags.reason);

  if (!statusFlag || !isJudgeStatus(statusFlag)) {
    return errEnvelope(
      "judge",
      "VALIDATION_ERROR",
      "Invalid or missing --status. Must be one of: success, failure, partial",
    );
  }

  let root: string;
  let routineLockAcquired = false;

  try {
    root = await findStoreRoot(process.cwd());
    if (!root) {
      return errEnvelope("judge", "STORE_NOT_FOUND", "No .mrp store found from current directory");
    }

    const routinePath = routineDir(root, routineId);
    const routineYamlPath = join(routinePath, "routine.yaml");

    try {
      await readFile(routineYamlPath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return errEnvelope("judge", "ROUTINE_NOT_FOUND", `Routine '${routineId}' not found`);
      }

      throw error;
    }

    await acquireLock(routineLockPath(root, routineId));
    routineLockAcquired = true;

    const { updatedRun, isLatest } = await updateRunEntry(
      ledgerPath(root, routineId),
      runId,
      (run) => ({
        ...run,
        status_auto: run.status_auto ?? toStatusAuto(run.status),
        status: statusFlag,
        judgment: {
          status: statusFlag,
          ...(reason ? { reason } : {}),
          judged_at: new Date().toISOString(),
        },
      }),
    );

    if (isLatest) {
      let storeLockAcquired = false;
      try {
        await acquireLock(storeLockPath(root));
        storeLockAcquired = true;

        const routineData = parseRoutine(await readYamlFile(join(routinePath, "routine.yaml")));
        const currentIndex = await readIndex(root);
        const existing = currentIndex.routines.find((entry) => entry.id === routineData.id);
        const entry = {
          ...(existing ?? routineToIndexEntry(routineData)),
          last_run_status: updatedRun.status,
          last_run_ts: updatedRun.timing.ended_at,
        };

        await updateIndexEntry(root, entry);
      } finally {
        if (storeLockAcquired) {
          await releaseLock(storeLockPath(root));
        }
      }
    }

    return okEnvelope("judge", { run: updatedRun });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      String((error as { code?: string }).code) === "RUN_NOT_FOUND"
    ) {
      const message =
        typeof (error as { message?: unknown }).message === "string"
          ? String((error as { message?: unknown }).message)
          : `Run '${runId}' not found`;
      return errEnvelope("judge", "RUN_NOT_FOUND", message);
    }

    if (isNodeError(error) && error.code === "ENOENT") {
      return errEnvelope("judge", "ROUTINE_NOT_FOUND", `Routine '${routineId}' not found`);
    }

    if (isNodeError(error) && error.code === "STORE_NOT_FOUND") {
      return errEnvelope("judge", "STORE_NOT_FOUND", "No .mrp store found from current directory");
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
      return errEnvelope("judge", "STORE_NOT_FOUND", message);
    }

    const message = error instanceof Error ? error.message : String(error);
    return errEnvelope("judge", "INTERNAL_ERROR", message);
  } finally {
    if (routineLockAcquired) {
      await releaseLock(routineLockPath(root!, routineId));
    }
  }
}
