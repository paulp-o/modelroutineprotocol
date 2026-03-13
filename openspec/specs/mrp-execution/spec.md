## ADDED Requirements

### Requirement: Execution Protocol — Plan Phase
Before executing a routine, the system SHALL determine how each success criterion will be checked. In MVP, this means: if `execution.verifier` exists, it will be used; otherwise, exit code is the sole evidence.

#### Scenario: Plan with verifier
- **WHEN** a routine has `execution.verifier: verify.sh`
- **THEN** the plan notes that `verify.sh` will run during the Verify phase

#### Scenario: Plan without verifier
- **WHEN** a routine has no `execution.verifier`
- **THEN** the plan notes that only exit code will be used as evidence

### Requirement: Execution Protocol — Execute Phase
The system SHALL run the routine's entrypoint file, capturing stdout and stderr separately. The process SHALL receive the `--` passthrough args. Environment variables `MRP_ROUTINE_ID`, `MRP_RUN_ID`, and `MRP_STORE_DIR` SHALL be injected. CWD SHALL be the project root (directory containing `.mrp/`).

#### Scenario: Execute shell entrypoint
- **WHEN** the entrypoint is `run.sh`
- **THEN** the system runs `bash run.sh <args>` with injected env vars

#### Scenario: Execute TypeScript entrypoint
- **WHEN** the entrypoint is `run.ts`
- **THEN** the system runs `bun run run.ts <args>` with injected env vars

#### Scenario: Execute Python entrypoint
- **WHEN** the entrypoint is `run.py`
- **THEN** the system runs `python3 run.py <args>` with injected env vars

#### Scenario: Execute with shebang
- **WHEN** the entrypoint file has a shebang line and executable bit set
- **THEN** the system executes the file directly instead of using the extension-based runtime

### Requirement: Execution Protocol — Verify Phase
After execution, the system SHALL evaluate success criteria. If `execution.verifier` exists, it MUST be run. If no verifier exists, the system SHALL use only exit code as evidence. In MVP, success criteria text is documentary — the CLI does NOT enforce criteria beyond exit code.

#### Scenario: Verify with verifier script succeeds
- **WHEN** `verify.sh` exits with code 0
- **THEN** verification is considered passed, evidence records verifier result

#### Scenario: Verify with verifier script fails
- **WHEN** `verify.sh` exits with non-zero code
- **THEN** the run status is `failure` even if the entrypoint succeeded

#### Scenario: Verify without verifier — exit code 0
- **WHEN** no verifier exists and entrypoint exits with code 0
- **THEN** status is `success` with evidence `exit_code=0`

#### Scenario: Verify without verifier — exit code non-zero
- **WHEN** no verifier exists and entrypoint exits with code 1
- **THEN** status is `failure` with evidence `exit_code=1`

### Requirement: Execution Protocol — Summarize Phase
After verification, the system SHALL generate an Outcome object and append it to the routine's ledger. The Outcome SHALL also be included in the CLI response envelope.

#### Scenario: Outcome generated on success
- **WHEN** a run completes with all criteria satisfied
- **THEN** an Outcome is created with `status: success`, evidence list, timing, and artifact paths

#### Scenario: Outcome generated on failure
- **WHEN** a run fails
- **THEN** an Outcome is created with `status: failure`, evidence reflecting the failure, and suggested next_actions from failure_modes if applicable

### Requirement: Timeout Enforcement
The system SHALL enforce a timeout on routine execution. The timeout is determined by: (1) `--timeout-sec` flag if provided, (2) `execution.timeout_sec` in routine.yaml if set, (3) `config.execution.default_timeout_sec` as fallback.

#### Scenario: Routine-level timeout
- **WHEN** a routine has `execution.timeout_sec: 60` and no flag override
- **THEN** the process is killed after 60 seconds and status is `timeout`

#### Scenario: Flag timeout overrides routine timeout
- **WHEN** `mrp run --timeout-sec 30` is used on a routine with `timeout_sec: 60`
- **THEN** the 30-second flag value takes precedence

### Requirement: Output Capture Limits
The system SHALL enforce output capture limits. Stdout and stderr captures SHALL be truncated at `policy.output_max_kb` (routine-level) or `config.execution.default_output_max_kb` (fallback). Truncation SHALL be noted in the outcome.

#### Scenario: Output exceeds limit
- **WHEN** stdout exceeds 256KB (default)
- **THEN** the captured file is truncated at 256KB with a `[TRUNCATED]` marker appended, and the outcome records `truncated: true`

### Requirement: Entrypoint Skeleton Generation
When `mrp create` generates a routine, it SHALL create an entrypoint skeleton file based on `--entrypoint-type`.

#### Scenario: Shell skeleton
- **WHEN** `--entrypoint-type sh` (default)
- **THEN** `run.sh` is created with `#!/usr/bin/env bash`, `set -euo pipefail`, and a comment with the routine goal

#### Scenario: TypeScript skeleton
- **WHEN** `--entrypoint-type ts`
- **THEN** `run.ts` is created with a basic TypeScript template including the routine goal as a comment

#### Scenario: Python skeleton
- **WHEN** `--entrypoint-type py`
- **THEN** `run.py` is created with a `#!/usr/bin/env python3` shebang and the routine goal as a docstring

### Requirement: Outcome Schema
Every outcome SHALL contain: `routine_id`, `run_id` (format: `<ISO-8601>#<4-digit-seq>`), `intent_recap` (copy of goal), `status` (enum: success|failure|timeout|blocked), `evidence` (list with `success_criteria_id` and `evidence` string), `risks` (list of strings), `next_actions` (list of strings), `timing` ({started_at, ended_at, duration_ms}), `artifacts` ({stdout_path, stderr_path, notes}), `override` (boolean, true if --force was used).

#### Scenario: Outcome with override flag
- **WHEN** `mrp run --force` is used on an archived routine
- **THEN** the outcome includes `override: true`

#### Scenario: Run ID format
- **WHEN** a run starts at 2026-02-18T19:05:12+09:00 and it's the first run
- **THEN** `run_id` is `2026-02-18T19:05:12+09:00#0001`

### Requirement: Run Outcome Model
The run outcome SHALL include:
- `status_auto`: the exit-code-derived status (what MRP initially inferred: success, failure, timeout)
- `status`: the authoritative status (initially set to `status_auto`, updatable via `mrp judge`)
- `execution_snapshot`: entrypoint script fingerprint at execution time

The `status` field SHALL be the single authoritative indicator used by `mrp list`, `mrp show`, and index summaries.

#### Scenario: Outcome includes auto and authoritative status
- **WHEN** `mrp run` completes and the entrypoint exits with code 0
- **THEN** the outcome has `status: success`, `status_auto: success`, and `execution_snapshot` with the entrypoint hash

#### Scenario: Outcome after judgment override
- **WHEN** a run had `status_auto: failure` and `mrp judge` sets `status: success`
- **THEN** subsequent `mrp list` shows `last_run_status: success` for that routine
