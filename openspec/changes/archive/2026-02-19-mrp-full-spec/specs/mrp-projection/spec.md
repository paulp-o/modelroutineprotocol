## ADDED Requirements

### Requirement: Meta Skill
The system SHALL provide a permanent meta skill named `mrp` that exists in every configured host's skill directory. The meta skill SKILL.md SHALL document core MRP commands, explain when to use routines, and state that `mrp list` / `mrp show` is the canonical truth source.

#### Scenario: Meta skill always present
- **WHEN** `mrp sync-skills` runs
- **THEN** an `mrp` skill directory with SKILL.md exists in every configured host's skill directory

#### Scenario: Meta skill content
- **WHEN** the meta skill SKILL.md is read
- **THEN** it contains documentation for `mrp list`, `mrp show`, `mrp run`, `mrp create`, and states that `.mrp/` is the canonical source of truth

### Requirement: Multi-Host File Projection
The system SHALL write projected skill SKILL.md wrappers to per-host convention directories based on `projection.hosts` in config. The host-to-directory mapping SHALL be:
- `opencode` → `.opencode/skills/mrp-<skill_name>/SKILL.md`
- `claude` → `.claude/skills/mrp-<skill_name>/SKILL.md`
- `cursor` → `.cursor/skills/mrp-<skill_name>/SKILL.md`
- `windsurf` → `.windsurf/skills/mrp-<skill_name>/SKILL.md`

#### Scenario: Projection to OpenCode
- **WHEN** a routine is projected and `opencode` is in `projection.hosts`
- **THEN** `.opencode/skills/mrp-<skill_name>/SKILL.md` is created

#### Scenario: Projection to multiple hosts
- **WHEN** `projection.hosts` contains `[opencode, claude]` and a routine is projected
- **THEN** SKILL.md wrappers are created in both `.opencode/skills/` and `.claude/skills/`

#### Scenario: Missing host directory
- **WHEN** `claude` is in `projection.hosts` but `.claude/` directory does not exist
- **THEN** the system creates `.claude/skills/` directory and writes the wrapper, and includes a `warnings` entry in the sync output

### Requirement: Projected Skill Wrapper Content
A projected skill SKILL.md SHALL contain: when the routine is relevant (brief), goal, non-goals summary, minimal success criteria, execution command (`mrp run <routine_id>`), and canonical truth reference (`mrp show <routine_id>`).

#### Scenario: Wrapper content matches routine
- **WHEN** a routine with goal "Ensure build succeeds" is projected
- **THEN** the SKILL.md contains the goal, non-goals, and instructions to run via `mrp run <id>`

### Requirement: Projection Auto-Suggest
The system SHALL suggest projection for routines that have been run 3 or more times within the last 7 days (configurable via `projection.auto_suggest_threshold_runs` and `projection.auto_suggest_window_days`). Suggestions SHALL appear in the response envelope as `data.projection_suggestion`.

#### Scenario: Auto-suggest after 3 runs
- **WHEN** a routine has been run 3 times in the last 7 days and is not yet projected
- **THEN** the response includes `data.projection_suggestion` with the routine ID and `mrp promote <id>`

#### Scenario: No suggest for already projected
- **WHEN** a routine with 5 runs in 7 days is already projected
- **THEN** no projection suggestion is emitted

### Requirement: Projection Cap and Auto-Eviction
The system SHALL enforce a maximum number of projected routines (`projection.max_projected_skills`, default: 15). When a new routine is promoted and the cap is reached, the least recently used (by last_run_ts) projected routine SHALL be automatically demoted to make room.

#### Scenario: Auto-eviction at cap
- **WHEN** 15 routines are projected and a 16th is promoted
- **THEN** the projected routine with the oldest `last_run_ts` is automatically demoted, and the new routine is projected. The sync output includes the eviction in `data.sync.evicted`

#### Scenario: Under cap no eviction
- **WHEN** 10 routines are projected and an 11th is promoted
- **THEN** the new routine is projected without any eviction

### Requirement: Projection State Tracking
The system SHALL maintain `.mrp/projections/projections.yaml` with a mapping of routine_id → `{skill_name, hosts, projected_at, last_run_ts}` for all currently projected routines. `.mrp/projections/last_sync.yaml` SHALL record the last sync timestamp and summary.

#### Scenario: Projections file updated on sync
- **WHEN** `mrp sync-skills` completes
- **THEN** `projections.yaml` reflects the current projection state and `last_sync.yaml` records the sync timestamp

### Requirement: Sync Idempotency
`mrp sync-skills` SHALL be idempotent. Running it multiple times without changes SHALL produce no file modifications and report zero adds/removes/updates.

#### Scenario: Idempotent sync
- **WHEN** `mrp sync-skills` is run twice with no changes in between
- **THEN** the second run reports `added: 0`, `removed: 0`, `updated: 0`

### Requirement: Stale Skill Warning
Every sync output SHALL include `data.stale_warning` reminding that host skill lists may lag behind the canonical `.mrp/` state and that `mrp list` / `mrp show` is authoritative.

#### Scenario: Stale warning present
- **WHEN** `mrp sync-skills` completes
- **THEN** `data.stale_warning` contains text about host skill lists potentially being stale
