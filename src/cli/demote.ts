import { join } from "node:path";

import { routineToIndexEntry, updateIndexEntry } from "../core/index.ts";
import {
  findStoreRoot,
  routineDir,
  routineLockPath,
  storeLockPath,
} from "../core/store.ts";
import { parseRoutine, type Routine } from "../schema/routine.ts";
import { errEnvelope, okEnvelope, type Envelope } from "../util/envelope.ts";
import { acquireLock } from "../util/lock.ts";
import { readYamlFile, writeYamlAtomic } from "../util/yaml-io.ts";

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

export async function handleDemote(
  args: string[],
  _flags: Record<string, unknown>,
): Promise<Envelope> {
  const routineId = args[0]?.trim();
  if (!routineId) {
    return errEnvelope("demote", "MISSING_ARGUMENT", "Routine ID required");
  }

  try {
    const root = await findStoreRoot(process.cwd());
    const routineYamlPath = join(routineDir(root, routineId), "routine.yaml");

    let updatedRoutine: Routine;
    let previousProjected: boolean;

    const releaseRoutineLock = await acquireLock(routineLockPath(root, routineId));
    try {
      let rawRoutine: unknown;
      try {
        rawRoutine = await readYamlFile<unknown>(routineYamlPath);
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
          return errEnvelope("demote", "ROUTINE_NOT_FOUND", `Routine not found: ${routineId}`);
        }

        throw error;
      }

      const routine = parseRoutine(rawRoutine);
      previousProjected = routine.projection.projected;
      updatedRoutine = {
        ...routine,
        projection: {
          ...routine.projection,
          projected: false,
        },
        lifecycle: {
          ...routine.lifecycle,
          updated_at: new Date().toISOString(),
        },
      };

      await writeYamlAtomic(routineYamlPath, updatedRoutine);
    } finally {
      await releaseRoutineLock();
    }

    const releaseStoreLock = await acquireLock(storeLockPath(root));
    try {
      await updateIndexEntry(root, routineToIndexEntry(updatedRoutine));
    } finally {
      await releaseStoreLock();
    }

    return okEnvelope("demote", {
      routine: updatedRoutine,
      previous_projected: previousProjected,
    });
  } catch (error) {
    if (isNodeError(error) && error.code === "STORE_NOT_FOUND") {
      return errEnvelope("demote", "STORE_NOT_FOUND", "No .mrp store found from current directory");
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
      return errEnvelope("demote", "STORE_NOT_FOUND", message);
    }

    const message = error instanceof Error ? error.message : String(error);
    return errEnvelope("demote", "INTERNAL_ERROR", message);
  }
}
