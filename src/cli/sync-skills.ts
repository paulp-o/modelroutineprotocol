import { join } from "node:path";

import { syncSkills } from "../core/projection.ts";
import { configPath, findStoreRoot, indexPath, routineDir, storeLockPath } from "../core/store.ts";
import { parseConfig } from "../schema/config.ts";
import { parseIndex } from "../schema/index-schema.ts";
import { parseRoutine, type Routine } from "../schema/routine.ts";
import { errEnvelope, okEnvelope, type Envelope } from "../util/envelope.ts";
import { acquireLock } from "../util/lock.ts";
import { readYamlFile } from "../util/yaml-io.ts";

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function routineYamlPath(root: string, routineId: string): string {
  return join(routineDir(root, routineId), "routine.yaml");
}

export async function handleSyncSkills(
  _args: string[],
  _flags: Record<string, unknown>,
): Promise<Envelope> {
  try {
    const root = await findStoreRoot(process.cwd());

    const config = parseConfig(await readYamlFile<unknown>(configPath(root)));
    const index = parseIndex(await readYamlFile<unknown>(indexPath(root)));

    const projectedRoutines = new Map<string, Routine>();
    for (const entry of index.routines) {
      if (!entry.projected) {
        continue;
      }

      const routine = parseRoutine(await readYamlFile<unknown>(routineYamlPath(root, entry.id)));
      projectedRoutines.set(entry.id, routine);
    }

    let releaseStoreLock: (() => Promise<void>) | undefined;
    try {
      releaseStoreLock = await acquireLock(storeLockPath(root));
      const result = await syncSkills({
        root,
        config,
        index,
        routines: projectedRoutines,
      });

      return okEnvelope("sync-skills", {
        added: result.added,
        removed: result.removed,
        updated: result.updated,
        warnings: result.warnings,
        stale_warning: result.stale_warning,
      });
    } finally {
      if (releaseStoreLock) {
        await releaseStoreLock();
      }
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "STORE_NOT_FOUND") {
      return errEnvelope(
        "sync-skills",
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
      return errEnvelope("sync-skills", "STORE_NOT_FOUND", message);
    }

    const message = error instanceof Error ? error.message : String(error);
    return errEnvelope("sync-skills", "INTERNAL_ERROR", message);
  }
}
