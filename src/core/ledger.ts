import { type Ledger, parseLedger } from "../schema/ledger.ts";
import type { Outcome } from "../schema/outcome.ts";
import { readYamlFile, writeYamlAtomic } from "../util/yaml-io.ts";

const EMPTY_LEDGER: Ledger = {
  runs: [],
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

    return parseLedger(raw);
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
    runs: [...ledger.runs, outcome],
  };

  await writeYamlAtomic(ledgerPath, nextLedger);
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
