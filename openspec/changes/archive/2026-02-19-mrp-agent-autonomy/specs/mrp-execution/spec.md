## MODIFIED Requirements

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
