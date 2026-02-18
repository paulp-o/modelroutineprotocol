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

async function readRoutine(root: string, routineId: string): Promise<Routine | null> {
  const routinePath = join(routineDir(root, routineId), "routine.yaml");

  try {
    const raw = await readYamlFile<unknown>(routinePath);
    return parseRoutine(raw);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function handleDeprecate(
  args: string[],
  _flags: Record<string, unknown>,
): Promise<Envelope> {
  const routineId = args[0]?.trim();
  if (!routineId) {
    return errEnvelope("deprecate", "MISSING_ARGUMENT", "Routine ID required");
  }

  try {
    const root = await findStoreRoot(process.cwd());
    const routine = await readRoutine(root, routineId);
    if (!routine) {
      return errEnvelope("deprecate", "ROUTINE_NOT_FOUND", `Routine '${routineId}' not found`);
    }

    const previousState = routine.lifecycle.state;
    const transition = validateTransition(previousState, "deprecated");
    if (!transition.valid) {
      return errEnvelope(
        "deprecate",
        "INVALID_STATE_TRANSITION",
        transition.error ?? `Cannot transition from '${previousState}' to 'deprecated'.`,
      );
    }

    const updatedRoutine: Routine = {
      ...routine,
      lifecycle: {
        ...routine.lifecycle,
        state: "deprecated",
        updated_at: new Date().toISOString(),
      },
    };

    const routineYamlPath = join(routineDir(root, routineId), "routine.yaml");

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

    return okEnvelope("deprecate", {
      routine: updatedRoutine,
      previous_state: previousState,
      new_state: "deprecated",
    });
  } catch (error) {
    if (isNodeError(error) && error.code === "STORE_NOT_FOUND") {
      return errEnvelope(
        "deprecate",
        "STORE_NOT_FOUND",
        "No .mrp store found from current directory",
      );
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
      return errEnvelope("deprecate", "STORE_NOT_FOUND", message);
    }

    const message = error instanceof Error ? error.message : String(error);
    return errEnvelope("deprecate", "INTERNAL_ERROR", message);
  }
}
