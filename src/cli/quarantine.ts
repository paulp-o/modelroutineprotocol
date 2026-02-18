import { join } from "node:path";

import { routineToIndexEntry, updateIndexEntry } from "../core/index.ts";
import { validateTransition } from "../core/lifecycle.ts";
import { findStoreRoot, routineDir, routineLockPath, storeLockPath } from "../core/store.ts";
import { parseRoutine } from "../schema/routine.ts";
import { errEnvelope, okEnvelope, type Envelope } from "../util/envelope.ts";
import { acquireLock } from "../util/lock.ts";
import { readYamlFile, writeYamlAtomic } from "../util/yaml-io.ts";

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

export async function handleQuarantine(
  args: string[],
  _flags: Record<string, unknown>,
): Promise<Envelope> {
  const routineId = args[0];
  if (!routineId) {
    return errEnvelope("quarantine", "MISSING_ARGUMENT", "Routine ID required");
  }

  try {
    const root = await findStoreRoot(process.cwd());
    const routineYamlPath = join(routineDir(root, routineId), "routine.yaml");

    let routine;
    try {
      const rawRoutine = await readYamlFile<unknown>(routineYamlPath);
      routine = parseRoutine(rawRoutine);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return errEnvelope("quarantine", "ROUTINE_NOT_FOUND", `Routine not found: ${routineId}`);
      }
      throw error;
    }

    const previousState = routine.lifecycle.state;
    const transition = validateTransition(previousState, "quarantine");
    if (!transition.valid) {
      return errEnvelope(
        "quarantine",
        "INVALID_STATE_TRANSITION",
        transition.error ?? `Cannot transition from '${previousState}' to 'quarantine'.`,
      );
    }

    const now = new Date().toISOString();
    const updatedRoutine = {
      ...routine,
      lifecycle: {
        ...routine.lifecycle,
        state: "quarantine" as const,
        updated_at: now,
      },
      projection: {
        ...routine.projection,
        projected: false,
      },
    };

    let releaseRoutineLock: (() => Promise<void>) | undefined;
    try {
      releaseRoutineLock = await acquireLock(routineLockPath(root, routineId));
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
    } finally {
      if (releaseRoutineLock) {
        await releaseRoutineLock();
      }
    }

    return okEnvelope("quarantine", {
      routine: updatedRoutine,
      previous_state: previousState,
      new_state: "quarantine",
    });
  } catch (error) {
    if (isNodeError(error) && error.code === "STORE_NOT_FOUND") {
      return errEnvelope("quarantine", "STORE_NOT_FOUND", "No .mrp store found from current directory");
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
      return errEnvelope("quarantine", "STORE_NOT_FOUND", message);
    }

    const message = error instanceof Error ? error.message : String(error);
    return errEnvelope("quarantine", "INTERNAL_ERROR", message);
  }
}
