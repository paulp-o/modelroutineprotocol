import { join } from "node:path";

import { routineToIndexEntry, updateIndexEntry } from "../core/index.ts";
import { validateTransition } from "../core/lifecycle.ts";
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

export async function handleArchive(
  args: string[],
  _flags: Record<string, unknown>,
): Promise<Envelope> {
  const routineId = args[0]?.trim();
  if (!routineId) {
    return errEnvelope("archive", "MISSING_ARGUMENT", "Routine ID required");
  }

  try {
    const root = await findStoreRoot(process.cwd());
    const routineYamlPath = join(routineDir(root, routineId), "routine.yaml");

    let releaseRoutineLock: (() => Promise<void>) | undefined;
    try {
      releaseRoutineLock = await acquireLock(routineLockPath(root, routineId));

      let routine: Routine;
      try {
        const rawRoutine = await readYamlFile<unknown>(routineYamlPath);
        routine = parseRoutine(rawRoutine);
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
          return errEnvelope("archive", "ROUTINE_NOT_FOUND", `Routine '${routineId}' not found`);
        }
        throw error;
      }

      const previousState = routine.lifecycle.state;
      const transition = validateTransition(previousState, "archived");
      if (!transition.valid) {
        return errEnvelope(
          "archive",
          "INVALID_STATE_TRANSITION",
          transition.error ?? "Cannot transition to archived",
        );
      }

      const now = new Date().toISOString();
      const updatedRoutine: Routine = {
        ...routine,
        lifecycle: {
          ...routine.lifecycle,
          state: "archived",
          updated_at: now,
        },
        projection: {
          ...routine.projection,
          projected: false,
        },
      };

      await writeYamlAtomic(routineYamlPath, updatedRoutine);

      let releaseStoreLock: (() => Promise<void>) | undefined;
      try {
        releaseStoreLock = await acquireLock(storeLockPath(root));
        await updateIndexEntry(root, routineToIndexEntry(updatedRoutine));
      } finally {
        if (releaseStoreLock) {
          await releaseStoreLock();
        }
      }

      return okEnvelope("archive", {
        routine: updatedRoutine,
        previous_state: previousState,
        new_state: "archived",
      });
    } finally {
      if (releaseRoutineLock) {
        await releaseRoutineLock();
      }
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "STORE_NOT_FOUND") {
      return errEnvelope("archive", "STORE_NOT_FOUND", "No .mrp store found from current directory");
    }

    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      String((error as { code?: string }).code) === "STORE_NOT_FOUND"
    ) {
      const message =
        typeof (error as { message?: unknown }).message === "string"
          ? String((error as { message?: unknown }).message)
          : "No .mrp store found from current directory";
      return errEnvelope("archive", "STORE_NOT_FOUND", message);
    }

    const message = error instanceof Error ? error.message : String(error);
    return errEnvelope("archive", "INTERNAL_ERROR", message);
  }
}
