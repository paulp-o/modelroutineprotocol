import { join } from "node:path";

import { readIndex, writeIndex } from "../core/index.ts";
import { validateTransition, type LifecycleState } from "../core/lifecycle.ts";
import { pickEvictionCandidate } from "../core/projection.ts";
import {
  configPath,
  findStoreRoot,
  routineDir,
  routineLockPath,
  storeLockPath,
} from "../core/store.ts";
import { parseConfig } from "../schema/config.ts";
import { parseRoutine, type Routine } from "../schema/routine.ts";
import { errEnvelope, okEnvelope, type Envelope } from "../util/envelope.ts";
import { acquireLock } from "../util/lock.ts";
import { readYamlFile, writeYamlAtomic } from "../util/yaml-io.ts";

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function isTruthyFlag(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function routineYamlPath(root: string, routineId: string): string {
  return join(routineDir(root, routineId), "routine.yaml");
}

function asLifecycleState(value: unknown): LifecycleState | null {
  if (
    value === "draft" ||
    value === "active" ||
    value === "deprecated" ||
    value === "archived" ||
    value === "quarantine"
  ) {
    return value;
  }

  return null;
}

async function readRoutine(root: string, routineId: string): Promise<Routine | null> {
  try {
    const raw = await readYamlFile<unknown>(routineYamlPath(root, routineId));
    return parseRoutine(raw);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function handlePromote(
  args: string[],
  flags: Record<string, unknown>,
): Promise<Envelope> {
  const routineId = args[0]?.trim();
  if (!routineId) {
    return errEnvelope("promote", "MISSING_ARGUMENT", "Routine ID required");
  }

  try {
    const root = await findStoreRoot(process.cwd());

    const routine = await readRoutine(root, routineId);
    if (!routine) {
      return errEnvelope("promote", "ROUTINE_NOT_FOUND", `Routine '${routineId}' not found`);
    }

    const fromQuarantine =
      isTruthyFlag(flags["from-quarantine"]) || isTruthyFlag(flags.fromQuarantine);

    const previousState = asLifecycleState(routine.lifecycle.state);
    if (!previousState) {
      return errEnvelope("promote", "INTERNAL_ERROR", "Routine has an invalid lifecycle state");
    }

    const newState: LifecycleState = fromQuarantine ? "draft" : "active";
    const transition = validateTransition(previousState, newState, { fromQuarantine });
    if (!transition.valid) {
      return errEnvelope(
        "promote",
        "INVALID_STATE_TRANSITION",
        transition.error ?? `Cannot transition from '${previousState}' to '${newState}'`,
      );
    }

    const now = new Date().toISOString();
    const promotedRoutine: Routine = {
      ...routine,
      lifecycle: {
        ...routine.lifecycle,
        state: newState,
        updated_at: now,
      },
      projection: {
        ...routine.projection,
      },
    };

    let evictedRoutineId: string | undefined;

    if (newState === "active" && promotedRoutine.projection.eligible) {
      const [index, config] = await Promise.all([
        readIndex(root),
        readYamlFile<unknown>(configPath(root)).then((raw) => parseConfig(raw)),
      ]);

      const projectedEntries = index.routines.filter(
        (entry) => entry.projected && entry.id !== routineId,
      );
      const cap = config.projection.max_projected_skills;
      const evictionCandidateId = pickEvictionCandidate(projectedEntries, cap);

      if (evictionCandidateId) {
        const evictionCandidateRoutine = await readRoutine(root, evictionCandidateId);
        if (!evictionCandidateRoutine) {
          return errEnvelope(
            "promote",
            "ROUTINE_NOT_FOUND",
            `Routine '${evictionCandidateId}' not found for projection eviction`,
          );
        }

        const evictedRoutine: Routine = {
          ...evictionCandidateRoutine,
          projection: {
            ...evictionCandidateRoutine.projection,
            projected: false,
          },
        };

        let releaseEvictedRoutineLock: (() => Promise<void>) | undefined;
        try {
          releaseEvictedRoutineLock = await acquireLock(routineLockPath(root, evictionCandidateId));
          await writeYamlAtomic(routineYamlPath(root, evictionCandidateId), evictedRoutine);
        } finally {
          if (releaseEvictedRoutineLock) {
            await releaseEvictedRoutineLock();
          }
        }
        evictedRoutineId = evictionCandidateId;
      }

      promotedRoutine.projection.projected = true;
    }

    let releaseRoutineLock: (() => Promise<void>) | undefined;
    try {
      releaseRoutineLock = await acquireLock(routineLockPath(root, routineId));
      await writeYamlAtomic(routineYamlPath(root, routineId), promotedRoutine);
    } finally {
      if (releaseRoutineLock) {
        await releaseRoutineLock();
      }
    }

    let releaseStoreLock: (() => Promise<void>) | undefined;
    try {
      releaseStoreLock = await acquireLock(storeLockPath(root));
      const index = await readIndex(root);
      const updatedIndex = {
        routines: index.routines.map((entry) => {
          if (evictedRoutineId && entry.id === evictedRoutineId) {
            return {
              ...entry,
              projected: false,
            };
          }

          if (entry.id === routineId) {
            return {
              ...entry,
              state: promotedRoutine.lifecycle.state,
              projected: promotedRoutine.projection.projected,
              updated_at: promotedRoutine.lifecycle.updated_at,
            };
          }

          return entry;
        }),
      };

      if (!updatedIndex.routines.some((entry) => entry.id === routineId)) {
        updatedIndex.routines.push({
          id: promotedRoutine.id,
          name: promotedRoutine.name,
          state: promotedRoutine.lifecycle.state,
          tags: promotedRoutine.tags ?? [],
          projected: promotedRoutine.projection.projected,
          last_run_status: null,
          last_run_ts: null,
          created_at: promotedRoutine.lifecycle.created_at,
          updated_at: promotedRoutine.lifecycle.updated_at,
        });
      }

      await writeIndex(root, updatedIndex);
    } finally {
      if (releaseStoreLock) {
        await releaseStoreLock();
      }
    }

    return okEnvelope("promote", {
      routine: promotedRoutine,
      previous_state: previousState,
      new_state: newState,
      ...(evictedRoutineId ? { evicted: evictedRoutineId } : {}),
    });
  } catch (error) {
    if (isNodeError(error) && error.code === "STORE_NOT_FOUND") {
      return errEnvelope("promote", "STORE_NOT_FOUND", "No .mrp store found from current directory");
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
      return errEnvelope("promote", "STORE_NOT_FOUND", message);
    }

    const message = error instanceof Error ? error.message : String(error);
    return errEnvelope("promote", "INTERNAL_ERROR", message);
  }
}
