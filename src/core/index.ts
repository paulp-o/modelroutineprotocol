import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { parseIndex, type Index, type IndexEntry } from "../schema/index-schema.ts";
import { parseLedger, type Ledger } from "../schema/ledger.ts";
import { parseRoutine, type Routine } from "../schema/routine.ts";
import { readYamlFile, writeYamlAtomic } from "../util/yaml-io.ts";

const EMPTY_INDEX: Index = { routines: [] };

type LedgerSummary = {
  last_run_status: string | null;
  last_run_ts: string | null;
};

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function getIndexPath(root: string): string {
  return join(root, ".mrp", "index.yaml");
}

function getRoutinesPath(root: string): string {
  return join(root, ".mrp", "routines");
}

export async function readIndex(root: string): Promise<Index> {
  const indexPath = getIndexPath(root);

  try {
    const raw = await readYamlFile<unknown>(indexPath);
    if (raw === null || raw === undefined) {
      return { ...EMPTY_INDEX };
    }

    return parseIndex(raw);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { ...EMPTY_INDEX };
    }

    throw error;
  }
}

export async function writeIndex(root: string, index: Index): Promise<void> {
  const indexPath = getIndexPath(root);
  await writeYamlAtomic(indexPath, index);
}

export async function updateIndexEntry(root: string, entry: IndexEntry): Promise<void> {
  const index = await readIndex(root);
  const existingIndex = index.routines.findIndex((item) => item.id === entry.id);

  if (existingIndex >= 0) {
    index.routines[existingIndex] = entry;
  } else {
    index.routines.push(entry);
  }

  await writeIndex(root, index);
}

export async function removeIndexEntry(root: string, id: string): Promise<void> {
  const index = await readIndex(root);
  const next: Index = {
    routines: index.routines.filter((entry) => entry.id !== id),
  };

  await writeIndex(root, next);
}

export function routineToIndexEntry(
  routine: Routine,
  ledgerSummary?: LedgerSummary,
): IndexEntry {
  return {
    id: routine.id,
    name: routine.name,
    state: routine.lifecycle.state,
    tags: routine.tags ?? [],
    projected: routine.projection.projected,
    last_run_status: ledgerSummary?.last_run_status ?? null,
    last_run_ts: ledgerSummary?.last_run_ts ?? null,
    created_at: routine.lifecycle.created_at,
    updated_at: routine.lifecycle.updated_at,
  };
}

export async function rebuildIndex(root: string): Promise<Index> {
  const routinesPath = getRoutinesPath(root);

  let routineDirs: Dirent[];
  try {
    routineDirs = await readdir(routinesPath, { withFileTypes: true, encoding: "utf8" });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      const empty = { ...EMPTY_INDEX };
      await writeIndex(root, empty);
      return empty;
    }

    throw error;
  }

  const entries: IndexEntry[] = [];

  for (const dirent of routineDirs) {
    if (!dirent.isDirectory()) {
      continue;
    }

    const routineDir = join(routinesPath, dirent.name);
    const routinePath = join(routineDir, "routine.yaml");
    const ledgerPath = join(routineDir, "ledger.yaml");

    let routine: Routine;
    try {
      const rawRoutine = await readYamlFile<unknown>(routinePath);
      routine = parseRoutine(rawRoutine);
    } catch (error) {
      console.error(
        `[mrp] skipping routine at ${routinePath}: failed to read or parse routine.yaml`,
      );
      continue;
    }

    let ledgerSummary: LedgerSummary = {
      last_run_status: null,
      last_run_ts: null,
    };

    try {
      const rawLedger = await readYamlFile<unknown>(ledgerPath);
      const ledger: Ledger = parseLedger(rawLedger);
      const lastRun = ledger.runs[ledger.runs.length - 1];
      if (lastRun) {
        ledgerSummary = {
          last_run_status: lastRun.status,
          last_run_ts: lastRun.timing.ended_at,
        };
      }
    } catch (error) {
      if (!(isNodeError(error) && error.code === "ENOENT")) {
        console.error(
          `[mrp] failed to read or parse ledger at ${ledgerPath}; defaulting run summary to null`,
        );
      }
    }

    entries.push(routineToIndexEntry(routine, ledgerSummary));
  }

  const rebuilt: Index = {
    routines: entries,
  };

  await writeIndex(root, rebuilt);
  return rebuilt;
}
