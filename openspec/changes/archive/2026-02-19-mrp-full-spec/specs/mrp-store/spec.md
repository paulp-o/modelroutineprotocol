## ADDED Requirements

### Requirement: MRP Store Initialization
The system SHALL create a `.mrp/` directory structure when `mrp init` is executed. The store MUST contain `version.yaml`, `config.yaml`, `index.yaml`, empty `routines/`, `projections/`, and `locks/` directories.

#### Scenario: First-time init in a project
- **WHEN** `mrp init` is run in a directory that has no `.mrp/` folder
- **THEN** the system creates `.mrp/` with all required files and directories, outputs a success envelope with `data.store_path` and `data.detected_hosts`

#### Scenario: Init in a directory that already has .mrp/
- **WHEN** `mrp init` is run in a directory that already contains `.mrp/`
- **THEN** the system outputs an error envelope with `code: STORE_ALREADY_EXISTS` and exits with code 1

#### Scenario: Init auto-detects agent hosts
- **WHEN** `mrp init` is run and `.opencode/`, `.claude/`, `.cursor/`, or `.windsurf/` directories exist in the project root
- **THEN** the system populates `config.yaml` `projection.hosts` with the detected host identifiers

### Requirement: Store Version File
The system SHALL maintain a `version.yaml` file at `.mrp/version.yaml` containing the store format version as an integer.

#### Scenario: Version file contents
- **WHEN** a store is initialized
- **THEN** `version.yaml` contains `store_version: 1`

### Requirement: Store Configuration File
The system SHALL maintain a `config.yaml` file at `.mrp/config.yaml` with the following top-level keys: `store_version`, `discovery`, `projection`, `execution`, `policy`.

#### Scenario: Default config after init
- **WHEN** a store is initialized
- **THEN** `config.yaml` contains:
  - `store_version: 1`
  - `discovery.enabled: true`
  - `discovery.max_suggestions: 3`
  - `discovery.suggest_action_preference: show_first`
  - `discovery.recent_window_days: 3`
  - `discovery.cooldown_hours: 12`
  - `discovery.rate_limit_minutes: 30`
  - `projection.enabled: true`
  - `projection.meta_skill_name: mrp`
  - `projection.max_projected_skills: 15`
  - `projection.auto_suggest_threshold_runs: 3`
  - `projection.auto_suggest_window_days: 7`
  - `projection.hosts: []` (or auto-detected list)
  - `execution.default_timeout_sec: 900`
  - `execution.default_output_max_kb: 256`
  - `policy.default_network: off`

### Requirement: Store Index File
The system SHALL maintain an `index.yaml` file at `.mrp/index.yaml` as a denormalized cache of routine metadata for fast listing and search. The index MUST be rebuildable from routines on disk.

#### Scenario: Index contains routine summary
- **WHEN** routines exist in the store
- **THEN** `index.yaml` contains a `routines` list where each entry has `id`, `name`, `state`, `tags`, `projected`, `last_run_status`, `last_run_ts`, `created_at`, `updated_at`

#### Scenario: Index rebuild via doctor
- **WHEN** `mrp doctor --rebuild-index` is run
- **THEN** the index is regenerated from all `routine.yaml` and `ledger.yaml` files on disk

### Requirement: Store Directory Layout
The system SHALL use the following directory structure:
```
.mrp/
  version.yaml
  config.yaml
  index.yaml
  discovery_state.yaml
  routines/
    <routine_id>/
      routine.yaml
      rationale.md
      run.sh|run.ts|run.py
      verify.sh|verify.ts|verify.py  (optional)
      ledger.yaml
      runs/
        <run_id>/
          stdout.txt
          stderr.txt
      routine.lock
  projections/
    projections.yaml
    last_sync.yaml
  locks/
    store.lock
```

#### Scenario: Routine directory created on mrp create
- **WHEN** `mrp create` is executed with valid flags
- **THEN** the system creates `.mrp/routines/<generated_id>/` with `routine.yaml`, an entrypoint skeleton, empty `ledger.yaml` (with `runs: []`), and empty `runs/` directory

### Requirement: Run Artifact Storage
The system SHALL store stdout and stderr captures from routine runs as individual text files under `.mrp/routines/<routine_id>/runs/<run_id>/`.

#### Scenario: Artifacts created after run
- **WHEN** `mrp run <routine_id>` completes
- **THEN** `stdout.txt` and `stderr.txt` are created under `.mrp/routines/<routine_id>/runs/<run_id>/` with captured output, truncated to `output_max_kb` if exceeded

### Requirement: Artifact Retention
The system SHALL keep all run artifacts indefinitely. The system SHALL provide a `mrp prune` command for manual cleanup.

#### Scenario: Prune by age
- **WHEN** `mrp prune --older-than 30d` is run
- **THEN** run artifact directories older than 30 days are deleted, ledger entries are preserved

#### Scenario: Prune with dry-run
- **WHEN** `mrp prune --older-than 30d --dry-run` is run
- **THEN** the system outputs which artifacts would be deleted without deleting them
