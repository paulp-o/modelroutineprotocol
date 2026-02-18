## ADDED Requirements

### Requirement: Timeout Enforcement
The system SHALL enforce a timeout on every routine run. The timeout precedence is: `--timeout-sec` flag > `execution.timeout_sec` in routine.yaml > `config.execution.default_timeout_sec` (default: 900 seconds).

#### Scenario: Default timeout
- **WHEN** a routine is run without a timeout flag and no routine-level timeout is set
- **THEN** the process is killed after 900 seconds if not completed

#### Scenario: Timeout kills process
- **WHEN** a routine exceeds its timeout
- **THEN** the process receives SIGTERM, status is `timeout`, and the outcome is recorded in the ledger

### Requirement: Output Capture Limits
The system SHALL truncate captured stdout and stderr at the configured `output_max_kb` limit. Precedence: `policy.output_max_kb` in routine.yaml > `config.execution.default_output_max_kb` (default: 256 KB).

#### Scenario: Output truncated
- **WHEN** stdout exceeds 256KB
- **THEN** the file is truncated with a `[TRUNCATED at 256KB]` marker and the outcome includes `truncated: true`

### Requirement: Quarantine Blocks Execution
Routines in `quarantine` state SHALL NOT be runnable without the `--force` flag. This is the primary safety mechanism for blocking unstable or dangerous routines.

#### Scenario: Quarantine without force
- **WHEN** `mrp run` targets a quarantined routine without `--force`
- **THEN** the system returns `error.code: ROUTINE_NOT_RUNNABLE`

### Requirement: Override Logging
When `--force` is used to run an `archived` or `quarantine` routine, the outcome SHALL include `override: true` to provide an audit trail.

#### Scenario: Force run logged
- **WHEN** `mrp run --force` is used on a quarantined routine
- **THEN** the ledger entry includes `override: true`

### Requirement: Policy Metadata — Documentation Only
The `policy.network`, `policy.side_effects`, and `policy.risk_level` fields in routine.yaml SHALL be treated as documentation-only metadata in MVP. The system SHALL NOT enforce network restrictions or command denylists at runtime.

#### Scenario: Network policy not enforced
- **WHEN** a routine has `policy.network: off` but the entrypoint makes network calls
- **THEN** the system does NOT block the network calls — the policy is informational only

#### Scenario: Risk level is metadata
- **WHEN** a routine has `policy.risk_level: high`
- **THEN** the system stores and displays the value but does not alter execution behavior

### Requirement: Ledger Append Only
The ledger (`ledger.yaml`) SHALL be append-only in normal operation. The system SHALL NOT delete or modify existing ledger entries. Only `mrp prune` may delete run artifact files (not ledger entries themselves).

#### Scenario: Ledger grows monotonically
- **WHEN** 10 runs have been recorded
- **THEN** the ledger contains exactly 10 entries in chronological order

#### Scenario: Prune preserves ledger
- **WHEN** `mrp prune --older-than 7d` deletes artifact files
- **THEN** the corresponding ledger entries remain in ledger.yaml with artifact paths that may no longer exist
