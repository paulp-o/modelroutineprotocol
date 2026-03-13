## ADDED Requirements

### Requirement: Entrypoint Script Fingerprinting
When `mrp run` executes a routine, the system SHALL compute the sha256 hash of the entrypoint script and record it in the outcome as `execution_snapshot`.

The `execution_snapshot` SHALL contain:
- `entrypoint_hash`: sha256 hex string of the entrypoint file content
- `entrypoint_path`: absolute path to the entrypoint file
- `entrypoint_size`: file size in bytes

#### Scenario: Script fingerprint recorded on run
- **WHEN** `mrp run <id>` executes successfully
- **THEN** the outcome includes `execution_snapshot.entrypoint_hash` matching the sha256 of the entrypoint file

### Requirement: Script Change Detection
When a routine is run and a previous run exists in the ledger, the system SHALL compare the current entrypoint hash with the previous run's hash. If they differ, the outcome SHALL include `script_changed: true`.

#### Scenario: Script changed between runs
- **WHEN** the entrypoint script was modified after the last run and `mrp run` is executed
- **THEN** the outcome includes `script_changed: true`

#### Scenario: Script unchanged between runs
- **WHEN** the entrypoint script was NOT modified and `mrp run` is executed
- **THEN** the outcome does NOT include `script_changed` (or includes `script_changed: false`)
