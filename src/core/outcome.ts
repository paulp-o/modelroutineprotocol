import type { Outcome } from "../schema/outcome.ts";

type SuccessCriterion = {
  id: string;
  text: string;
};

type FailureMode = {
  id: string;
  text: string;
  suggested_fix?: string;
};

type GenerateOutcomeParams = {
  routineId: string;
  runId: string;
  goal: string;
  status: "success" | "failure" | "timeout" | "blocked";
  successCriteria: SuccessCriterion[];
  entrypointExitCode: number | null;
  verifierExitCode?: number | null;
  verifierUsed?: boolean;
  timedOut?: boolean;
  override?: boolean;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  stdoutPath?: string | null;
  stderrPath?: string | null;
  truncated?: boolean;
  failureModes?: FailureMode[];
  warnings?: string[];
};

export function generateRunId(existingRunCount: number): string {
  const sequence = String(existingRunCount + 1).padStart(4, "0");
  return `${new Date().toISOString()}#${sequence}`;
}

function buildEvidenceString(params: GenerateOutcomeParams): string {
  const evidenceParts: string[] = [];

  if (params.entrypointExitCode !== null) {
    evidenceParts.push(`exit_code=${params.entrypointExitCode}`);
  }

  if (params.verifierUsed) {
    if (params.verifierExitCode !== undefined && params.verifierExitCode !== null) {
      evidenceParts.push(`verifier_exit_code=${params.verifierExitCode}`);
    } else {
      evidenceParts.push("verifier_used");
    }
  }

  if (params.timedOut || params.status === "timeout") {
    evidenceParts.push("timed_out");
  }

  if (params.status === "blocked") {
    evidenceParts.push("blocked");
  }

  if (evidenceParts.length === 0) {
    return `status=${params.status}`;
  }

  return evidenceParts.join(", ");
}

function buildNextActions(params: GenerateOutcomeParams): string[] {
  const nextActions: string[] = [];
  const isFailureLike = params.status === "failure" || params.status === "timeout";

  if (!isFailureLike) {
    return nextActions;
  }

  for (const failureMode of params.failureModes ?? []) {
    if (failureMode.suggested_fix) {
      nextActions.push(failureMode.suggested_fix);
    }
  }

  nextActions.push("Inspect stderr artifact");

  return Array.from(new Set(nextActions));
}

export function generateOutcome(params: GenerateOutcomeParams): Outcome {
  const evidenceString = buildEvidenceString(params);
  const notes = params.truncated
    ? "Output truncated due to configured capture limits"
    : undefined;

  return {
    routine_id: params.routineId,
    run_id: params.runId,
    intent_recap: params.goal,
    status: params.status,
    evidence: params.successCriteria.map((criterion) => ({
      success_criteria_id: criterion.id,
      evidence: evidenceString,
    })),
    risks: [],
    next_actions: buildNextActions(params),
    timing: {
      started_at: params.startedAt,
      ended_at: params.endedAt,
      duration_ms: params.durationMs,
    },
    artifacts: {
      stdout_path: params.stdoutPath ?? null,
      stderr_path: params.stderrPath ?? null,
      ...(notes ? { notes } : {}),
    },
    override: Boolean(params.override),
    truncated: Boolean(params.truncated),
    warnings: params.warnings ?? [],
  };
}
