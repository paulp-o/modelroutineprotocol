import { readFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

import { sha256File } from "../core/fingerprint.ts";
import { readIndex, routineToIndexEntry, updateIndexEntry } from "../core/index.ts";
import { appendEditEvent } from "../core/ledger.ts";
import { findStoreRoot, ledgerPath, routineDir, routineLockPath } from "../core/store.ts";
import type { EditEvent } from "../schema/ledger.ts";
import { parseRoutine, type Routine } from "../schema/routine.ts";
import { errEnvelope, okEnvelope, type Envelope } from "../util/envelope.ts";
import { acquireLock } from "../util/lock.ts";
import { readYamlFile, stringifyYaml, writeYamlAtomic } from "../util/yaml-io.ts";

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

interface TrackedFile {
  path: string;
  absPath: string;
  exists: boolean;
  sha256: string | null;
  content: string | null;
}

type EditSessionFile = {
  path: string;
  sha256: string | null;
};

type EditSessionBaseline = {
  type: "edit_session";
  routine_id: string;
  created_at: string;
  tracked_files: EditSessionFile[];
};

function trackedPaths(routine: Routine): string[] {
  const tracked = ["routine.yaml", routine.execution.entrypoint];
  if (routine.execution.verifier) {
    tracked.push(routine.execution.verifier);
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const path of tracked) {
    if (!seen.has(path)) {
      seen.add(path);
      unique.push(path);
    }
  }

  return unique;
}

async function getTrackedFiles(
  routineDirPath: string,
  routine: Routine,
  includeContent: boolean,
): Promise<TrackedFile[]> {
  const files: TrackedFile[] = [];

  for (const relPath of trackedPaths(routine)) {
    const absPath = join(routineDirPath, relPath);

    try {
      const fileStat = await stat(absPath);
      if (!fileStat.isFile()) {
        files.push({
          path: relPath,
          absPath,
          exists: false,
          sha256: null,
          content: null,
        });
        continue;
      }

      const [sha256, content] = await Promise.all([
        sha256File(absPath),
        includeContent ? readFile(absPath, "utf8") : Promise.resolve(null),
      ]);

      files.push({
        path: relPath,
        absPath,
        exists: true,
        sha256,
        content,
      });
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        files.push({
          path: relPath,
          absPath,
          exists: false,
          sha256: null,
          content: null,
        });
        continue;
      }

      throw error;
    }
  }

  return files;
}

function parseEditSession(raw: unknown, routineId: string): EditSessionBaseline | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const parsed = raw as {
    type?: unknown;
    routine_id?: unknown;
    created_at?: unknown;
    tracked_files?: unknown;
  };

  if (parsed.type !== "edit_session" || parsed.routine_id !== routineId) {
    return null;
  }

  if (typeof parsed.created_at !== "string") {
    return null;
  }

  if (!Array.isArray(parsed.tracked_files)) {
    return null;
  }

  const trackedFiles: EditSessionFile[] = [];
  for (const file of parsed.tracked_files) {
    if (!file || typeof file !== "object" || Array.isArray(file)) {
      return null;
    }

    const typedFile = file as { path?: unknown; sha256?: unknown };
    if (typeof typedFile.path !== "string") {
      return null;
    }

    if (typedFile.sha256 !== null && typeof typedFile.sha256 !== "string") {
      return null;
    }

    trackedFiles.push({
      path: typedFile.path,
      sha256: typedFile.sha256 ?? null,
    });
  }

  return {
    type: "edit_session",
    routine_id: routineId,
    created_at: parsed.created_at,
    tracked_files: trackedFiles,
  };
}

async function handleInspectMode(
  routineId: string,
  rDir: string,
  routine: Routine,
): Promise<Envelope> {
  const trackedFiles = await getTrackedFiles(rDir, routine, true);
  const createdAt = new Date().toISOString();
  const sessionPath = join(rDir, "edit_session.yaml");

  const session: EditSessionBaseline = {
    type: "edit_session",
    routine_id: routineId,
    created_at: createdAt,
    tracked_files: trackedFiles.map((file) => ({
      path: file.path,
      sha256: file.sha256,
    })),
  };

  await writeYamlAtomic(sessionPath, session);

  return okEnvelope("edit", {
    mode: "inspect",
    routine,
    routine_yaml: stringifyYaml(routine),
    files: trackedFiles.map((file) => ({
      path: file.path,
      abs_path: file.absPath,
      exists: file.exists,
      sha256: file.sha256,
      content: file.content,
    })),
    baseline_path: sessionPath,
    baseline: session,
    instructions: [
      "Edit .mrp routine files directly using your file editing tools.",
      `When done, run: mrp edit ${routineId} --commit --intent \"describe your changes\"`,
    ],
  });
}

async function handleCommitMode(
  root: string,
  routineId: string,
  rDir: string,
  routine: Routine,
  intent: string | undefined,
): Promise<Envelope> {
  const sessionPath = join(rDir, "edit_session.yaml");

  let baselineRaw: unknown;
  try {
    baselineRaw = await readYamlFile<unknown>(sessionPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return errEnvelope(
        "edit",
        "MISSING_BASELINE",
        "Run mrp edit <routine_id> first to create an inspect baseline",
      );
    }

    throw error;
  }

  const baseline = parseEditSession(baselineRaw, routineId);
  if (!baseline) {
    return errEnvelope("edit", "INVALID_BASELINE", "edit_session.yaml is invalid");
  }

  const currentTrackedFiles = await getTrackedFiles(rDir, routine, false);
  const baselineMap = new Map<string, string | null>();
  const currentMap = new Map<string, string | null>();

  for (const file of baseline.tracked_files) {
    baselineMap.set(file.path, file.sha256);
  }

  for (const file of currentTrackedFiles) {
    currentMap.set(file.path, file.sha256);
  }

  const allPaths = new Set<string>([...baselineMap.keys(), ...currentMap.keys()]);
  const changedFiles: Array<{
    path: string;
    sha256Before: string | null;
    sha256After: string | null;
  }> = [];

  for (const path of allPaths) {
    const sha256Before = baselineMap.has(path) ? (baselineMap.get(path) ?? null) : null;
    const sha256After = currentMap.has(path) ? (currentMap.get(path) ?? null) : null;
    if (sha256Before !== sha256After) {
      changedFiles.push({ path, sha256Before, sha256After });
    }
  }

  if (changedFiles.length === 0) {
    return errEnvelope("edit", "NO_CHANGES", "No tracked files have changed since the last inspect");
  }

  const now = new Date().toISOString();
  const editEvent: EditEvent = {
    type: "edit",
    routine_id: routineId,
    edit_id: `${now}#${String(Math.random()).slice(2, 6)}`,
    ...(intent ? { intent } : {}),
    committed_at: now,
    changed_files: changedFiles.map((file) => ({
      path: file.path,
      ...(file.sha256Before ? { sha256_before: file.sha256Before } : {}),
      ...(file.sha256After ? { sha256_after: file.sha256After } : {}),
    })),
  };

  const lockPath = routineLockPath(root, routineId);
  let releaseRoutineLock: (() => Promise<void>) | undefined;
  try {
    releaseRoutineLock = await acquireLock(lockPath);

    await appendEditEvent(ledgerPath(root, routineId), editEvent);

    const routineData = parseRoutine(await readYamlFile<unknown>(join(rDir, "routine.yaml")));
    const entry = routineToIndexEntry(routineData, { last_run_status: null, last_run_ts: null });

    const index = await readIndex(root);
    const existing = index.routines.find((candidate) => candidate.id === routineId);
    if (existing) {
      entry.last_run_status = existing.last_run_status;
      entry.last_run_ts = existing.last_run_ts;
    }

    entry.updated_at = now;
    await updateIndexEntry(root, entry);

    try {
      await unlink(sessionPath);
    } catch (error) {
      if (!(isNodeError(error) && error.code === "ENOENT")) {
        throw error;
      }
    }
  } finally {
    if (releaseRoutineLock) {
      await releaseRoutineLock();
    }
  }

  return okEnvelope("edit", {
    mode: "commit",
    edit_event: editEvent,
  });
}

export async function handleEdit(
  args: string[],
  flags: Record<string, unknown>,
): Promise<Envelope> {
  const routineId = args[0]?.trim();
  if (!routineId) {
    return errEnvelope(
      "edit",
      "MISSING_ARGUMENT",
      "Usage: mrp edit <routine_id> [--commit] [--intent \"...\"]",
    );
  }

  const isCommit = isTruthyFlag(flags.commit);
  const intentRaw = stringFlag(flags, "intent");
  const intent = intentRaw?.trim() ? intentRaw.trim() : undefined;

  try {
    const root = await findStoreRoot(process.cwd());
    const rDir = routineDir(root, routineId);
    const routineYamlPath = join(rDir, "routine.yaml");

    try {
      const routineDirStat = await stat(rDir);
      if (!routineDirStat.isDirectory()) {
        return errEnvelope("edit", "ROUTINE_NOT_FOUND", `Routine not found: ${routineId}`);
      }
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return errEnvelope("edit", "ROUTINE_NOT_FOUND", `Routine not found: ${routineId}`);
      }

      throw error;
    }

    let routine: Routine;
    try {
      routine = parseRoutine(await readYamlFile<unknown>(routineYamlPath));
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return errEnvelope("edit", "ROUTINE_NOT_FOUND", `Routine not found: ${routineId}`);
      }

      throw error;
    }

    if (isCommit) {
      return await handleCommitMode(root, routineId, rDir, routine, intent);
    }

    return await handleInspectMode(routineId, rDir, routine);
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
      const maybeMessage = (error as { message?: unknown }).message;
      const message =
        typeof maybeMessage === "string"
          ? maybeMessage
          : "No .mrp store found from current directory";
      return errEnvelope("edit", "STORE_NOT_FOUND", message);
    }

    const message = error instanceof Error ? error.message : String(error);
    return errEnvelope("edit", "INTERNAL_ERROR", message);
  }
}
