## ADDED Requirements

### Requirement: Model-Driven Judgment Command
`mrp judge <routine_id> <run_id> --status <status> [--reason "<reason>"]` SHALL update the authoritative status of a completed run based on the model's assessment.

Valid `--status` values SHALL be: `success`, `failure`, `partial`.

The command SHALL:
- Find the run entry in the routine's ledger
- Update the run's `status` to the judged value
- Record `judgment: { status, reason?, judged_at }` on the run entry
- Preserve `status_auto` (the original exit-code-derived status) as provenance
- Update the store index `last_run_status` if this is the most recent run
- Output a YAML envelope with `command: "judge"` and `data` containing the updated run entry

#### Scenario: Judge a run as successful despite non-zero exit
- **WHEN** `mrp judge <id> <run_id> --status success --reason "warnings only, build artifact produced"` is run
- **THEN** the run's `status` becomes `success`, `status_auto` remains `failure`, and `judgment.reason` is recorded

#### Scenario: Judge a run as partial
- **WHEN** `mrp judge <id> <run_id> --status partial --reason "1 flaky test, main changes verified"` is run
- **THEN** the run's `status` becomes `partial` and `judgment` is recorded

#### Scenario: Judge non-existent run
- **WHEN** `mrp judge <id> nonexistent-run --status success` is run
- **THEN** the system returns `error.code: RUN_NOT_FOUND`

### Requirement: Judgment Visibility
`mrp show <routine_id>` SHALL display judgment information for runs that have been judged. The ledger summary SHALL reflect the judged status (not status_auto) as the authoritative `last_status`.

#### Scenario: Show reflects judgment
- **WHEN** a run was auto-determined as `failure` but judged as `success`
- **THEN** `mrp show` displays `last_status: success` in the ledger summary and the individual run shows both `status: success` and `status_auto: failure`
