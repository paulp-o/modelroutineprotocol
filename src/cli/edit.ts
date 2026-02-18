import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { routineToIndexEntry, updateIndexEntry } from "../core/index.ts";
import {
  findStoreRoot,
  routineDir,
  routineLockPath,
  storeLockPath,
} from "../core/store.ts";
import { zodErrorToDetails } from "../schema/error.ts";
import { safeParseRoutine } from "../schema/routine.ts";
import { errEnvelope, okEnvelope, type Envelope } from "../util/envelope.ts";
import { acquireLock } from "../util/lock.ts";
import { deepMerge } from "../util/merge.ts";
import { parseYaml, readYamlFile, writeYamlAtomic } from "../util/yaml-io.ts";

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasPatchFlag(flags: Record<string, unknown>): boolean {
  return flags.patch === true;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function handleEdit(
  args: string[],
  flags: Record<string, unknown>,
): Promise<Envelope> {
  const routineId = args[0];
  if (!routineId) {
    return errEnvelope("edit", "MISSING_ARGUMENT", "Routine ID required");
  }

  if (!hasPatchFlag(flags)) {
    return errEnvelope("edit", "MISSING_REQUIRED_FLAG", "--patch flag is required");
  }

  try {
    const root = await findStoreRoot(process.cwd());
    const dir = routineDir(root, routineId);
    const routineYamlPath = join(dir, "routine.yaml");
    const rationalePath = join(dir, "rationale.md");

    try {
      const routineDirStat = await stat(dir);
      if (!routineDirStat.isDirectory()) {
        return errEnvelope("edit", "ROUTINE_NOT_FOUND", `Routine not found: ${routineId}`);
      }
      await stat(routineYamlPath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return errEnvelope("edit", "ROUTINE_NOT_FOUND", `Routine not found: ${routineId}`);
      }
      throw error;
    }

    const stdinText = await readStdin();

    let patchRaw: unknown;
    try {
      patchRaw = parseYaml(stdinText);
    } catch {
      return errEnvelope("edit", "INVALID_PATCH", "Failed to parse stdin YAML");
    }

    if (!isRecord(patchRaw)) {
      return errEnvelope("edit", "INVALID_PATCH", "Patch must be a YAML mapping");
    }

    const patch = { ...patchRaw };

    let rationaleContent: string | undefined;
    if ("rationale" in patch) {
      const rationale = patch.rationale;
      if (typeof rationale === "string") {
        rationaleContent = rationale;
      }
      delete patch.rationale;
    }

    const currentRoutineRaw = await readYamlFile<unknown>(routineYamlPath);
    if (!isRecord(currentRoutineRaw)) {
      return errEnvelope("edit", "VALIDATION_ERROR", "Existing routine.yaml is not an object");
    }

    const merged = deepMerge(currentRoutineRaw, patch);

    const lifecycleValue = merged.lifecycle;
    if (isRecord(lifecycleValue)) {
      merged.lifecycle = {
        ...lifecycleValue,
        updated_at: new Date().toISOString(),
      };
    }

    const validated = safeParseRoutine(merged);
    if (!validated.success) {
      return errEnvelope(
        "edit",
        "VALIDATION_ERROR",
        "Routine patch failed validation",
        zodErrorToDetails(validated.error),
      );
    }

    let releaseRoutineLock: (() => Promise<void>) | undefined;
    try {
      releaseRoutineLock = await acquireLock(routineLockPath(root, routineId));

      if (rationaleContent !== undefined) {
        await writeFile(rationalePath, rationaleContent, "utf8");
      }

      await writeYamlAtomic(routineYamlPath, validated.data);

      let releaseStoreLock: (() => Promise<void>) | undefined;
      try {
        releaseStoreLock = await acquireLock(storeLockPath(root));
        await updateIndexEntry(root, routineToIndexEntry(validated.data));
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

    return okEnvelope("edit", { routine: validated.data });
  } catch (error) {
    if (isNodeError(error) && error.code === "STORE_NOT_FOUND") {
      return errEnvelope("edit", "STORE_NOT_FOUND", "No .mrp store found from current directory");
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
      return errEnvelope("edit", "STORE_NOT_FOUND", message);
    }

    const message = error instanceof Error ? error.message : String(error);
    return errEnvelope("edit", "INTERNAL_ERROR", message);
  }
}
