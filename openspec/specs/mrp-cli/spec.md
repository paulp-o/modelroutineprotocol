## ADDED Requirements

### Requirement: Universal YAML Response Envelope
Every CLI command SHALL output a YAML envelope with the following structure: `ok` (boolean), `command` (string), `ts` (ISO-8601 timestamp), and either `data` (command-specific payload on success) or `error` (structured error on failure). The `discovery` key SHALL be appended when the discovery footer is emitted.

#### Scenario: Successful command output
- **WHEN** any command succeeds
- **THEN** the output is valid YAML with `ok: true`, `command: <name>`, `ts: <ISO-8601>`, and `data: {...}`

#### Scenario: Failed command output
- **WHEN** any command fails
- **THEN** the output is valid YAML with `ok: false`, `command: <name>`, `ts: <ISO-8601>`, and `error: {code, message, details?}`

#### Scenario: Exit codes
- **WHEN** a command succeeds, the exit code SHALL be 0
- **THEN** when a command fails due to user/validation/runtime error, exit code SHALL be 1; for internal/unhandled errors, exit code SHALL be 2

### Requirement: Error Output Schema
Error responses SHALL include `error.code` (uppercase snake_case string), `error.message` (human-readable string), and optional `error.details` (list of objects with `path`, `expected`, `received` fields for validation errors).

#### Scenario: Validation error format
- **WHEN** a routine creation fails validation
- **THEN** the error includes `code: VALIDATION_ERROR` and `details` list with per-field diagnostics

#### Scenario: Not found error format
- **WHEN** a routine ID is not found
- **THEN** the error includes `code: ROUTINE_NOT_FOUND` and `message` containing the ID

### Requirement: mrp init Command
`mrp init` SHALL create the `.mrp/` store in the current directory. It SHALL auto-detect agent host directories and configure projection hosts.

After successful store creation, `mrp init` SHALL immediately project the `mrp` meta skill to all detected hosts by running the `sync-skills` logic.

#### Scenario: Successful init
- **WHEN** `mrp init` is run in a directory without `.mrp/`
- **THEN** the store is created and output contains `data.store_path`, `data.config_path`, `data.detected_hosts`

#### Scenario: Init projects meta skill to detected hosts
- **WHEN** `mrp init` detects `.cursor/` and `.claude/` directories
- **THEN** after store creation, `mrp/SKILL.md` appears in both `.cursor/skills/mrp/` and `.claude/skills/mrp/`

### Requirement: Global Help Flag
All commands SHALL support the `--help` flag.

When `--help` is present, the CLI SHALL output usage information in YAML envelope format and exit with code 0 without side effects.

#### Scenario: Help output does not execute command
- **WHEN** `mrp prune --help` is run
- **THEN** the output is a YAML help envelope and no run artifacts are deleted

### Requirement: mrp list Command
`mrp list` SHALL output all routines in the store. It SHALL support `--state <state>` filter (repeatable), `--tag <tag>` filter, `--projected` flag, `--include-archived` flag, `--limit <n>`, and `--sort <field>` (values: `updated_at`, `created_at`, `last_run_at`).

#### Scenario: List all active routines
- **WHEN** `mrp list --state active` is run
- **THEN** output `data.routines` contains only routines with `state: active`

#### Scenario: List excludes archived by default
- **WHEN** `mrp list` is run without `--include-archived`
- **THEN** routines with `state: archived` are excluded from `data.routines`

#### Scenario: List with tag filter
- **WHEN** `mrp list --tag build` is run
- **THEN** only routines with `build` in their `tags` list are returned

### Requirement: mrp show Command
`mrp show <routine_id>` SHALL output the full routine definition plus a ledger summary. The ledger summary SHALL include `runs_total`, `last_status`, `last_run_id`, `last_run_ts`.

#### Scenario: Show existing routine
- **WHEN** `mrp show mrp-build-a1b2` is run
- **THEN** `data.routine` contains the full routine.yaml content and `data.ledger_summary` contains run statistics

#### Scenario: Show non-existent routine
- **WHEN** `mrp show mrp-nonexistent-0000` is run
- **THEN** the system returns `error.code: ROUTINE_NOT_FOUND`

### Requirement: mrp create Command
`mrp create` SHALL accept required fields as flags: `--name` (string), `--goal` (string), `--non-goals` (repeatable string), `--success-criteria` (repeatable, format `id:text`). Optional flags: `--tags` (repeatable), `--entrypoint-type` (sh|ts|py, default: sh), `--description` (string). The CLI SHALL construct and validate the routine YAML, generate the ID, create the directory structure, and output the created routine.

#### Scenario: Create with required flags
- **WHEN** `mrp create --name "Build verify" --goal "Ensure build succeeds" --non-goals "Do not modify source" --success-criteria "sc.exit0:Build exits 0"` is run
- **THEN** a new routine directory is created with valid routine.yaml, entrypoint skeleton, empty ledger, and the output contains `data.routine` with the generated ID

#### Scenario: Create with custom entrypoint type
- **WHEN** `mrp create --name "Type check" --goal "Run tsc" --non-goals "No fixes" --success-criteria "sc.exit0:tsc exits 0" --entrypoint-type ts` is run
- **THEN** the entrypoint file is `run.ts` with a TypeScript skeleton

#### Scenario: Create fails on missing required flag
- **WHEN** `mrp create --name "Test"` is run without `--goal`
- **THEN** the system returns `error.code: MISSING_REQUIRED_FLAG` with `message` indicating `--goal` is required

### Requirement: mrp edit Command
`mrp edit <routine_id> --patch` SHALL read partial YAML from stdin, deep-merge it into the existing routine.yaml, validate the result, and write it back. Merge semantics: maps merge recursively, scalars replace, arrays replace whole array, `null` value deletes the field.

#### Scenario: Patch updates a field
- **WHEN** `mrp edit mrp-build-a1b2 --patch` receives `intent:\n  goal: "Updated goal"` on stdin
- **THEN** the routine's `intent.goal` is updated, all other fields preserved, and output contains `data.routine` with the updated state

#### Scenario: Patch deletes a field
- **WHEN** a patch contains `lifecycle:\n  expires_at: null`
- **THEN** the `lifecycle.expires_at` field is removed from the routine

#### Scenario: Patch fails validation
- **WHEN** a patch would set `lifecycle.state` to an invalid value
- **THEN** the routine is NOT modified and the system returns a validation error

### Requirement: mrp run Command
`mrp run <routine_id> [-- <args...>]` SHALL execute the routine's entrypoint, capture output, run verification, generate an outcome, append to ledger, and output the outcome. Optional flags: `--timeout-sec <n>` (override), `--force` (allow archived/quarantine), `--no-artifacts` (skip artifact storage).

#### Scenario: Successful run
- **WHEN** `mrp run mrp-build-a1b2` is executed and the entrypoint exits with code 0
- **THEN** output contains `data.outcome` with `status: success`, evidence for each success criterion, timing information, and artifact paths

#### Scenario: Failed run
- **WHEN** the entrypoint exits with a non-zero code
- **THEN** output contains `data.outcome` with `status: failure` and evidence reflecting the exit code

#### Scenario: Run with passthrough args
- **WHEN** `mrp run mrp-build-a1b2 -- --verbose --no-cache` is executed
- **THEN** the args `--verbose --no-cache` are passed to the entrypoint as positional arguments

#### Scenario: Run times out
- **WHEN** the entrypoint does not complete within `timeout_sec`
- **THEN** the process is killed, output contains `data.outcome` with `status: timeout`

### Requirement: mrp deprecate Command
`mrp deprecate <routine_id>` SHALL transition a routine from `active` to `deprecated` state.

#### Scenario: Deprecate an active routine
- **WHEN** `mrp deprecate mrp-build-a1b2` is run on an active routine
- **THEN** the routine state becomes `deprecated`, `updated_at` is refreshed, and output confirms the transition

#### Scenario: Deprecate a non-active routine
- **WHEN** `mrp deprecate` is run on a routine that is not in `active` state
- **THEN** the system returns `error.code: INVALID_STATE_TRANSITION`

### Requirement: mrp archive Command
`mrp archive <routine_id>` SHALL transition a routine from `deprecated` to `archived` state. If the routine was projected, it SHALL be auto-demoted.

#### Scenario: Archive a deprecated routine
- **WHEN** `mrp archive mrp-build-a1b2` is run on a deprecated routine
- **THEN** the routine state becomes `archived`, projection is set to `projected: false`, and skill wrappers are removed on next sync

### Requirement: mrp promote Command
`mrp promote <routine_id>` SHALL transition a routine from `draft` to `active` state AND mark it as projected if projection is eligible and under the cap.

#### Scenario: Promote a draft routine
- **WHEN** `mrp promote mrp-build-a1b2` is run on a draft routine with `projection.eligible: true`
- **THEN** the routine state becomes `active`, `projection.projected` becomes `true` (if under max cap), and skill wrappers are generated on sync

#### Scenario: Promote when at projection cap
- **WHEN** 15 routines are already projected and a 16th is promoted
- **THEN** the least recently used projected routine is auto-demoted to make room

### Requirement: mrp demote Command
`mrp demote <routine_id>` SHALL remove a routine's projection (set `projection.projected: false`) without changing its lifecycle state.

#### Scenario: Demote a projected routine
- **WHEN** `mrp demote mrp-build-a1b2` is run
- **THEN** `projection.projected` becomes `false` and skill wrappers are removed on next sync

### Requirement: mrp sync-skills Command
`mrp sync-skills` SHALL synchronize projected skill wrappers with the current routine projection state across all configured hosts.

#### Scenario: Sync adds new skill
- **WHEN** a routine has `projected: true` but no skill wrapper exists for a configured host
- **THEN** the skill wrapper directory and SKILL.md are created

#### Scenario: Sync removes stale skill
- **WHEN** a skill wrapper exists but the routine has `projected: false`
- **THEN** the skill wrapper directory is deleted

#### Scenario: Sync output summary
- **WHEN** `mrp sync-skills` completes
- **THEN** output contains `data.added`, `data.removed`, `data.updated` counts and `data.stale_warning` reminding that host skill lists may lag

### Requirement: mrp doctor Command
`mrp doctor` SHALL check store integrity and report/fix issues. Checks SHALL include: version compatibility, orphaned routine directories, stale lockfiles, index consistency, projection consistency.

#### Scenario: Doctor finds stale lock
- **WHEN** a lockfile exists but the PID inside is not running
- **THEN** the doctor reports `issue: stale_lock` and removes it

#### Scenario: Doctor with rebuild-index
- **WHEN** `mrp doctor --rebuild-index` is run
- **THEN** the index is regenerated from routine files on disk

### Requirement: mrp prune Command
`mrp prune` SHALL delete run artifacts based on retention criteria. Required flags: at least one of `--older-than <duration>` or `--keep-last <n>`. Optional: `--routine <id>` to scope to one routine, `--dry-run` to preview.

#### Scenario: Prune scoped to routine
- **WHEN** `mrp prune --keep-last 5 --routine mrp-build-a1b2` is run
- **THEN** only artifacts for that routine are pruned, keeping the 5 most recent

### Requirement: Auto Sync After Mutations
The CLI SHALL automatically run `sync-skills` logic after any command that changes routine state, projection eligibility/status, or routine definition that affects skill wrapper content. The sync summary SHALL be included in the command's response envelope under `data.sync`.

#### Scenario: Create triggers sync
- **WHEN** `mrp create` completes successfully
- **THEN** the response includes `data.sync` with sync results

#### Scenario: Promote triggers sync
- **WHEN** `mrp promote` completes successfully
- **THEN** the response includes `data.sync` and new skill wrappers are written
