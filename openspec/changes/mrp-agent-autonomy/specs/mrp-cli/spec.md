## ADDED Requirements

### Requirement: mrp judge Command
`mrp judge <routine_id> <run_id> --status <status> [--reason "<reason>"]` SHALL update a run's authoritative status based on model assessment. Valid statuses: `success`, `failure`, `partial`. The command SHALL output a YAML envelope with `command: "judge"`.

#### Scenario: Judge updates ledger and index
- **WHEN** `mrp judge mrp-build-a1b2 run-001 --status success --reason "warnings only"` is run
- **THEN** the ledger run entry is updated, index reflects the judged status, and the envelope contains the updated run data

### Requirement: Global Help Flag
(existing requirement - add judge to the help definitions)

The help system SHALL include `judge` in the global command list and provide per-command help for `mrp judge --help`.
