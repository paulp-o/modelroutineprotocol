import { type EditEvent, type Ledger, parseLedger } from "../schema/ledger.ts";
import type { Outcome } from "../schema/outcome.ts";
import { readYamlFile, writeYamlAtomic } from "../util/yaml-io.ts";

const EMPTY_LEDGER: Ledger = {
  runs: [],
  edits: [],
};

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

export async function readLedger(ledgerPath: string): Promise<Ledger> {
  try {
    const raw = await readYamlFile<unknown>(ledgerPath);
    if (raw === null || raw === undefined) {
      return { ...EMPTY_LEDGER };
    }

    const parsed = parseLedger(raw);
    return {
      ...parsed,
      edits: parsed.edits ?? [],
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { ...EMPTY_LEDGER };
    }

    throw error;
  }
}

export async function appendOutcome(ledgerPath: string, outcome: Outcome): Promise<void> {
  const ledger = await readLedger(ledgerPath);
  const nextLedger: Ledger = {
    ...ledger,
    runs: [...ledger.runs, outcome],
  };

  await writeYamlAtomic(ledgerPath, nextLedger);
}

export async function updateRunEntry(
  ledgerPath: string,
  runId: string,
  updater: (run: Outcome) => Outcome,
): Promise<{ updatedRun: Outcome; isLatest: boolean }> {
  const ledger = await readLedger(ledgerPath);
  const idx = ledger.runs.findIndex((r) => r.run_id === runId);
  if (idx === -1) {
    throw { code: "RUN_NOT_FOUND", message: `Run ${runId} not found in ledger` };
  }

  const existingRun = ledger.runs[idx];
  if (!existingRun) {
    throw { code: "RUN_NOT_FOUND", message: `Run ${runId} not found in ledger` };
  }

  const updatedRun = updater(existingRun);
  const nextRuns = [...ledger.runs];
  nextRuns[idx] = updatedRun;

  await writeYamlAtomic(ledgerPath, { ...ledger, runs: nextRuns });

  return { updatedRun, isLatest: idx === ledger.runs.length - 1 };
}

export async function appendEditEvent(ledgerPath: string, editEvent: EditEvent): Promise<void> {
  const ledger = await readLedger(ledgerPath);
  await writeYamlAtomic(ledgerPath, {
    ...ledger,
    edits: [...(ledger.edits ?? []), editEvent],
  });
}

export function getLedgerSummary(ledger: Ledger): {
  runs_total: number;
  last_status: string | null;
  last_run_id: string | null;
  last_run_ts: string | null;
} {
  const lastRun = ledger.runs[ledger.runs.length - 1];

  return {
    runs_total: ledger.runs.length,
    last_status: lastRun?.status ?? null,
    last_run_id: lastRun?.run_id ?? null,
    last_run_ts: lastRun?.timing.ended_at ?? null,
  };
}
