import { join } from "node:path";

import { findStoreRoot, ledgerPath, routineDir } from "../core/store.ts";
import { parseLedger } from "../schema/ledger.ts";
import { parseRoutine, type Routine } from "../schema/routine.ts";
import { errEnvelope, okEnvelope, type Envelope } from "../util/envelope.ts";
import { readYamlFile } from "../util/yaml-io.ts";

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

type LedgerSummary = {
  runs_total: number;
  last_status: string | null;
  last_run_id: string | null;
  last_run_ts: string | null;
};

const EMPTY_LEDGER_SUMMARY: LedgerSummary = {
  runs_total: 0,
  last_status: null,
  last_run_id: null,
  last_run_ts: null,
};

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

async function readLedgerSummary(root: string, routineId: string): Promise<LedgerSummary> {
  const path = ledgerPath(root, routineId);

  try {
    const raw = await readYamlFile<unknown>(path);
    const ledger = parseLedger(raw);
    const lastRun = ledger.runs[ledger.runs.length - 1];

    return {
      runs_total: ledger.runs.length,
      last_status: lastRun?.status ?? null,
      last_run_id: lastRun?.run_id ?? null,
      last_run_ts: lastRun?.timing.ended_at ?? null,
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { ...EMPTY_LEDGER_SUMMARY };
    }

    throw error;
  }
}

export async function handleShow(
  args: string[],
  _flags: Record<string, unknown>,
): Promise<Envelope> {
  const routineId = args[0]?.trim();
  if (!routineId) {
    return errEnvelope("show", "MISSING_ARGUMENT", "Routine ID required");
  }

  try {
    const root = await findStoreRoot(process.cwd());
    const routine = await readRoutine(root, routineId);
    if (!routine) {
      return errEnvelope("show", "ROUTINE_NOT_FOUND", `Routine '${routineId}' not found`);
    }

    const ledgerSummary = await readLedgerSummary(root, routineId);
    return okEnvelope("show", {
      routine,
      ledger_summary: ledgerSummary,
    });
  } catch (error) {
    if (isNodeError(error) && error.code === "STORE_NOT_FOUND") {
      return errEnvelope("show", "STORE_NOT_FOUND", "No .mrp store found from current directory");
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
      return errEnvelope("show", "STORE_NOT_FOUND", message);
    }

    const message = error instanceof Error ? error.message : String(error);
    return errEnvelope("show", "INTERNAL_ERROR", message);
  }
}
