import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createArtifactDir } from "../core/artifacts.ts";
import { executeEntrypoint } from "../core/executor.ts";
import { readIndex, routineToIndexEntry, updateIndexEntry } from "../core/index.ts";
import { readLedger, appendOutcome } from "../core/ledger.ts";
import { isRunnable } from "../core/lifecycle.ts";
import { generateOutcome, generateRunId } from "../core/outcome.ts";
import {
  configPath,
  findStoreRoot,
  ledgerPath,
  routineDir,
  routineLockPath,
  runsDir,
  storeLockPath,
  storePath,
} from "../core/store.ts";
import { determineStatus, runVerifier } from "../core/verifier.ts";
import { parseConfig } from "../schema/config.ts";
import { parseRoutine } from "../schema/routine.ts";
import { errEnvelope, okEnvelope, type Envelope } from "../util/envelope.ts";
import { acquireLock } from "../util/lock.ts";
import { readYamlFile } from "../util/yaml-io.ts";

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function isTruthyFlag(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function parsePositiveNumberFlag(value: unknown): number | null {
  if (value === undefined) {
    return null;
  }

  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function splitPassthroughArgs(args: string[]): { mainArgs: string[]; passthroughArgs: string[] } {
  const separatorIndex = args.indexOf("--");
  if (separatorIndex < 0) {
    return { mainArgs: args, passthroughArgs: [] };
  }

  return {
    mainArgs: args.slice(0, separatorIndex),
    passthroughArgs: args.slice(separatorIndex + 1),
  };
}

export async function handleRun(
  args: string[],
  flags: Record<string, unknown>,
): Promise<Envelope> {
  const { mainArgs, passthroughArgs } = splitPassthroughArgs(args);
  const routineId = mainArgs[0]?.trim();
  if (!routineId) {
    return errEnvelope("run", "MISSING_ARGUMENT", "Routine ID required");
  }

  const timeoutOverride = parsePositiveNumberFlag(flags["timeout-sec"] ?? flags.timeoutSec);
  if ((flags["timeout-sec"] ?? flags.timeoutSec) !== undefined && timeoutOverride === null) {
    return errEnvelope("run", "VALIDATION_ERROR", "--timeout-sec must be a positive number");
  }

  const force = isTruthyFlag(flags.force);
  const noArtifacts = isTruthyFlag(flags["no-artifacts"]) || isTruthyFlag(flags.noArtifacts);

  try {
    const root = await findStoreRoot(process.cwd());
    const storeDir = storePath(root);
    const routineYamlPath = join(routineDir(root, routineId), "routine.yaml");

    const config = parseConfig(await readYamlFile<unknown>(configPath(root)));

    let routine;
    try {
      routine = parseRoutine(await readYamlFile<unknown>(routineYamlPath));
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return errEnvelope("run", "ROUTINE_NOT_FOUND", `Routine '${routineId}' not found`);
      }

      throw error;
    }

    const warnings: string[] = [];
    const runnable = isRunnable(routine.lifecycle.state);
    let override = false;

    if (!runnable.runnable) {
      if (!force) {
        return errEnvelope(
          "run",
          "ROUTINE_NOT_RUNNABLE",
          `Routine '${routineId}' is in state '${routine.lifecycle.state}'. Re-run with --force to override.`,
        );
      }

      override = true;
    }

    if (runnable.warning) {
      warnings.push(runnable.warning);
    }

    const timeoutSec =
      timeoutOverride ?? routine.execution.timeout_sec ?? config.execution.default_timeout_sec;
    const outputMaxKb = routine.policy?.output_max_kb ?? config.execution.default_output_max_kb;

    let releaseRoutineLock: (() => Promise<void>) | undefined;
    let artifactDir: string | undefined;

    try {
      releaseRoutineLock = await acquireLock(routineLockPath(root, routineId));

      const ledger = await readLedger(ledgerPath(root, routineId));
      const runId = generateRunId(ledger.runs.length);

      if (noArtifacts) {
        artifactDir = await mkdtemp(join(tmpdir(), "mrp-run-"));
      } else {
        artifactDir = await createArtifactDir(runsDir(root, routineId), runId);
      }

      const executionResult = await executeEntrypoint({
        entrypointPath: join(routineDir(root, routineId), routine.execution.entrypoint),
        cwd: root,
        routineId,
        runId,
        storeDir,
        timeoutSec,
        outputMaxKb,
        passthroughArgs,
        artifactDir,
      });

      const verification = routine.execution.verifier
        ? await runVerifier({
            verifierPath: join(routineDir(root, routineId), routine.execution.verifier),
            cwd: root,
            routineId,
            runId,
            storeDir,
            timeoutSec,
          })
        : undefined;

      const status = determineStatus(executionResult.exitCode, executionResult.timedOut, verification);

      const outcome = generateOutcome({
        routineId,
        runId,
        goal: routine.intent.goal,
        status,
        successCriteria: routine.intent.success_criteria,
        entrypointExitCode: executionResult.exitCode,
        verifierExitCode: verification?.verifierExitCode,
        verifierUsed: verification?.verifierUsed,
        timedOut: executionResult.timedOut,
        override,
        startedAt: executionResult.startedAt,
        endedAt: executionResult.endedAt,
        durationMs: executionResult.durationMs,
        stdoutPath: noArtifacts ? null : executionResult.stdoutPath,
        stderrPath: noArtifacts ? null : executionResult.stderrPath,
        truncated: executionResult.truncatedStdout || executionResult.truncatedStderr,
        failureModes: routine.intent.failure_modes,
        warnings,
      });

      await appendOutcome(ledgerPath(root, routineId), outcome);

      let releaseStoreLock: (() => Promise<void>) | undefined;
      try {
        releaseStoreLock = await acquireLock(storeLockPath(root));

        const currentIndex = await readIndex(root);
        const existing = currentIndex.routines.find((entry) => entry.id === routine.id);
        const entry = {
          ...(existing ?? routineToIndexEntry(routine)),
          last_run_status: outcome.status,
          last_run_ts: outcome.timing.ended_at,
        };

        await updateIndexEntry(root, entry);
      } finally {
        if (releaseStoreLock) {
          await releaseStoreLock();
        }
      }

      return okEnvelope("run", {
        outcome,
        warnings,
      });
    } finally {
      if (artifactDir && noArtifacts) {
        await rm(artifactDir, { recursive: true, force: true });
      }

      if (releaseRoutineLock) {
        await releaseRoutineLock();
      }
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "STORE_NOT_FOUND") {
      return errEnvelope("run", "STORE_NOT_FOUND", "No .mrp store found from current directory");
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
      return errEnvelope("run", "STORE_NOT_FOUND", message);
    }

    const message = error instanceof Error ? error.message : String(error);
    return errEnvelope("run", "INTERNAL_ERROR", message);
  }
}
