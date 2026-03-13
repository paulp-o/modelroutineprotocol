## MODIFIED Requirements

### Requirement: mrp edit Inspect Mode
`mrp edit <routine_id>` (without `--commit`) SHALL operate in **inspect mode**.

In inspect mode, the command SHALL output a YAML envelope that includes:
- The routine's `routine.yaml` content
- The routine entrypoint script paths and their current content (or a clear indication when a file is missing)
- Current fingerprints (sha256) for each included file
- Editing instructions that explicitly describe the supported workflow:
  - Inspect with `mrp edit <routine_id>`
  - Edit `.mrp` routine files directly using the model's native file editing tools
  - Commit and record the change with `mrp edit <routine_id> --commit [--intent "..."]`

In inspect mode, the command SHALL also write an `edit_session.yaml` baseline file for the routine that captures the fingerprints used as the commit baseline.

#### Scenario: Inspect outputs context and writes baseline
- **WHEN** `mrp edit mrp-build-a1b2` is run
- **THEN** the envelope contains the routine context, included file fingerprints, and editing instructions
- **AND** an `edit_session.yaml` baseline is written for the routine

### Requirement: mrp edit Commit Mode
`mrp edit <routine_id> --commit [--intent "..."]` SHALL operate in **commit mode**.

In commit mode, the command SHALL:
- Read the inspect baseline from `edit_session.yaml` when present
- Compute current fingerprints for the same set of files
- Diff fingerprints to detect changed files
- Record the edit in `ledger.yaml` as an `EditEvent` (see Ledger Edit Events requirement)
- Update the routine index entry timestamp to reflect the edit (implementation-defined field, but MUST be monotonically updated)

If `--intent` is provided, it SHALL be recorded in the edit event.

#### Scenario: Commit records changes
- **GIVEN** an inspect baseline exists for routine `mrp-build-a1b2`
- **AND** the entrypoint script content has been modified
- **WHEN** `mrp edit mrp-build-a1b2 --commit --intent "fix flaky build"` is run
- **THEN** the ledger contains an appended `EditEvent` with the changed file list and before/after sha256
- **AND** the routine index timestamp is updated

#### Scenario: Commit with no changes returns error
- **GIVEN** an inspect baseline exists for routine `mrp-build-a1b2`
- **AND** no tracked routine files have changed since the baseline
- **WHEN** `mrp edit mrp-build-a1b2 --commit` is run
- **THEN** the command fails with a machine-readable `NO_CHANGES` error (exit code and envelope error format are implementation-defined)

### Requirement: Ledger Edit Events
The routine `ledger.yaml` SHALL gain an optional `edits` array containing `EditEvent` objects.

`EditEvent` schema:
- `type`: literal string `"edit"`
- `routine_id`: string
- `edit_id`: string
- `intent`: optional string
- `committed_at`: string (ISO-8601 timestamp)
- `changed_files`: array of objects with:
  - `path`: string
  - `sha256_before`: optional string (hex), absent when the file did not exist in baseline
  - `sha256_after`: optional string (hex), absent when the file does not exist at commit time

#### Scenario: Backwards compatibility with existing ledgers
- **GIVEN** an existing `ledger.yaml` that has only `runs` and no `edits`
- **WHEN** the ledger is read by the CLI
- **THEN** it is treated as valid and `edits` is treated as an empty array
- **AND** committing an edit appends an `EditEvent` and writes `edits` into the ledger

### Requirement: Remove YAML Patch Flow
The `mrp edit` command SHALL NOT support YAML patch via stdin.

- The `--patch` flag SHALL be removed.
- The prior behavior of accepting a YAML patch envelope on stdin and applying a deep-merge to `routine.yaml` SHALL be removed.

#### Scenario: Patch flag is rejected
- **WHEN** `mrp edit mrp-build-a1b2 --patch` is invoked
- **THEN** the CLI reports a validation error indicating `--patch` is not a supported flag
