import { readdir, stat, rm, rmdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

import {
  findStoreRoot,
  storePath,
  routinesDir,
  locksDir,
  storeLockPath,
  routineLockPath,
  indexPath,
  versionPath,
} from "../core/store.ts";
import { readIndex, rebuildIndex } from "../core/index.ts";
import { errEnvelope, okEnvelope, type Envelope } from "../util/envelope.ts";
import { readYamlFile } from "../util/yaml-io.ts";

type DoctorIssue = {
  type: string;
  detail: string;
  fixed: boolean;
};

const PID_FILENAME = "pid";
const HOST_SKILLS_DIRS = [
  ".opencode/skills",
  ".claude/skills",
  ".cursor/skills",
  ".windsurf/skills",
] as const;

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function isTruthyFlag(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isNodeError(error)) {
      if (error.code === "ESRCH") {
        return false;
      }
      if (error.code === "EPERM") {
        return true;
      }
    }

    return true;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const entry = await stat(path);
    return entry.isDirectory();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function removeLockDir(lockPath: string): Promise<boolean> {
  const pidPath = join(lockPath, PID_FILENAME);

  try {
    await unlink(pidPath);
  } catch (error) {
    if (!(isNodeError(error) && error.code === "ENOENT")) {
      return false;
    }
  }

  try {
    await rmdir(lockPath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return true;
    }

    try {
      await rm(lockPath, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }
}

async function scanForTmpFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const queue: string[] = [root];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }

    const entries = await readdir(current, { withFileTypes: true, encoding: "utf8" });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(".tmp")) {
        found.push(fullPath);
      }
    }
  }

  return found;
}

async function discoverProjectedWrappers(root: string): Promise<Set<string>> {
  const routineIds = new Set<string>();
  const runPattern = /\bmrp run\s+([^\s`]+)/g;

  for (const relativeSkillsDir of HOST_SKILLS_DIRS) {
    const skillsDir = join(root, relativeSkillsDir);
    let entries;
    try {
      entries = await readdir(skillsDir, { withFileTypes: true, encoding: "utf8" });
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        continue;
      }

      throw error;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("mrp-")) {
        continue;
      }

      const skillFile = join(skillsDir, entry.name, "SKILL.md");
      let content: string;
      try {
        content = await readFile(skillFile, "utf8");
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
          continue;
        }

        throw error;
      }

      for (const match of content.matchAll(runPattern)) {
        const id = match[1];
        if (id) {
          routineIds.add(id);
        }
      }
    }
  }

  return routineIds;
}

async function readStoreVersionNumber(root: string): Promise<number | null> {
  const versionData = await readYamlFile<unknown>(versionPath(root));
  if (!versionData || typeof versionData !== "object") {
    return null;
  }

  const value = (versionData as { store_version?: unknown }).store_version;
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  return null;
}

export async function handleDoctor(
  _args: string[],
  flags: Record<string, unknown>,
): Promise<Envelope> {
  const issues: DoctorIssue[] = [];

  try {
    const root = await findStoreRoot(process.cwd());
    const rebuildRequested =
      isTruthyFlag(flags["rebuild-index"]) || isTruthyFlag(flags.rebuildIndex);

    const storeVersion = await readStoreVersionNumber(root);
    if (storeVersion !== 1) {
      issues.push({
        type: "version_mismatch",
        detail: `Expected store_version 1 but found ${String(storeVersion)}`,
        fixed: false,
      });
    }

    const lockPaths: string[] = [storeLockPath(root)];
    try {
      const routineEntries = await readdir(routinesDir(root), {
        withFileTypes: true,
        encoding: "utf8",
      });
      for (const entry of routineEntries) {
        if (entry.isDirectory()) {
          lockPaths.push(routineLockPath(root, entry.name));
        }
      }
    } catch (error) {
      if (!(isNodeError(error) && error.code === "ENOENT")) {
        throw error;
      }
    }

    for (const lockPath of lockPaths) {
      if (!(await isDirectory(lockPath))) {
        continue;
      }

      const pidPath = join(lockPath, PID_FILENAME);
      let pidText: string;
      try {
        pidText = (await readFile(pidPath, "utf8")).trim();
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
          issues.push({
            type: "stale_lock",
            detail: `Lock directory ${lockPath} is missing pid file`,
            fixed: false,
          });
          continue;
        }

        throw error;
      }

      const pid = Number.parseInt(pidText, 10);
      if (isProcessAlive(pid)) {
        continue;
      }

      const fixed = await removeLockDir(lockPath);
      issues.push({
        type: "stale_lock",
        detail: `Removed stale lock at ${lockPath} (pid=${pidText})`,
        fixed,
      });
    }

    const tmpFiles = await scanForTmpFiles(storePath(root));
    for (const tmpFile of tmpFiles) {
      let fixed = true;
      try {
        await unlink(tmpFile);
      } catch (error) {
        if (!(isNodeError(error) && error.code === "ENOENT")) {
          fixed = false;
        }
      }

      issues.push({
        type: "orphaned_tmp_file",
        detail: `Cleaned tmp file ${tmpFile}`,
        fixed,
      });
    }

    const routinesPath = routinesDir(root);
    const actualRoutineIds = new Set<string>();
    try {
      const entries = await readdir(routinesPath, { withFileTypes: true, encoding: "utf8" });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          actualRoutineIds.add(entry.name);
        }
      }
    } catch (error) {
      if (!(isNodeError(error) && error.code === "ENOENT")) {
        throw error;
      }
    }

    let index: Awaited<ReturnType<typeof readIndex>> | null = null;
    try {
      index = await readIndex(root);
      const indexedIds = new Set<string>();
      for (const item of index.routines) {
        indexedIds.add(item.id);
        if (!actualRoutineIds.has(item.id)) {
          issues.push({
            type: "orphaned_index_entry",
            detail: `Index entry ${item.id} exists but routine directory is missing`,
            fixed: false,
          });
        }
      }

      for (const routineId of actualRoutineIds) {
        if (!indexedIds.has(routineId)) {
          issues.push({
            type: "missing_index_entry",
            detail: `Routine directory ${routineId} exists but index entry is missing`,
            fixed: false,
          });
        }
      }
    } catch (error) {
      if (rebuildRequested) {
        issues.push({
          type: "corrupted_index",
          detail: "Index was corrupted; skipping consistency check before rebuild",
          fixed: true,
        });
      } else {
        const message = error instanceof Error ? error.message : String(error);
        issues.push({
          type: "corrupted_index",
          detail: `Index file is corrupted or unreadable: ${message}`,
          fixed: false,
        });
      }
    }

    if (index) {
      const projectedWrapperIds = await discoverProjectedWrappers(root);
      for (const item of index.routines) {
        if (item.projected && !projectedWrapperIds.has(item.id)) {
          issues.push({
            type: "projection_inconsistent",
            detail: `Projected routine ${item.id} has no detected host skill wrapper`,
            fixed: false,
          });
        }
      }
    }

    let rebuiltIndexData: unknown = undefined;
    if (rebuildRequested) {
      rebuiltIndexData = await rebuildIndex(root);
    }

    const fixedCount = issues.filter((issue) => issue.fixed).length;
    const summary = `doctor completed with ${issues.length} issue(s); ${fixedCount} fixed`;

    return okEnvelope("doctor", {
      store_version: storeVersion,
      issues,
      rebuild_index: rebuildRequested,
      summary,
      ...(rebuildRequested ? { rebuilt_index: rebuiltIndexData, index_path: indexPath(root) } : {}),
      locks_dir: locksDir(root),
    });
  } catch (error) {
    if (isNodeError(error) && error.code === "STORE_NOT_FOUND") {
      return errEnvelope("doctor", "STORE_NOT_FOUND", "No .mrp store found from current directory");
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
      return errEnvelope("doctor", "STORE_NOT_FOUND", message);
    }

    const message = error instanceof Error ? error.message : String(error);
    return errEnvelope("doctor", "INTERNAL_ERROR", message);
  }
}
