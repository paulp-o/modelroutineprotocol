## ADDED Requirements

### Requirement: Lifecycle States
The system SHALL support the following lifecycle states for routines: `draft`, `active`, `deprecated`, `archived`, `quarantine`.

#### Scenario: New routine starts as draft
- **WHEN** `mrp create` is run
- **THEN** the routine's `lifecycle.state` is `draft`

### Requirement: Strict State Transitions
The system SHALL enforce strict state transitions. The allowed transitions are:
- `draft` → `active` (via `mrp promote`)
- `active` → `deprecated` (via `mrp deprecate`)
- `deprecated` → `archived` (via `mrp archive`)
- Any state → `quarantine` (via `mrp quarantine`)
- `quarantine` → `draft` (via `mrp promote --from-quarantine`)

Any other transition SHALL be rejected with `error.code: INVALID_STATE_TRANSITION`.

#### Scenario: Valid transition draft to active
- **WHEN** `mrp promote` is run on a `draft` routine
- **THEN** the state changes to `active` and `lifecycle.updated_at` is refreshed

#### Scenario: Invalid transition draft to archived
- **WHEN** `mrp archive` is run on a `draft` routine
- **THEN** the system returns `error.code: INVALID_STATE_TRANSITION` with message indicating the valid path (draft → active → deprecated → archived)

#### Scenario: Any state to quarantine
- **WHEN** `mrp quarantine mrp-build-a1b2` is run on an `active` routine
- **THEN** the state changes to `quarantine`

#### Scenario: Quarantine to draft
- **WHEN** `mrp promote --from-quarantine` is run on a `quarantine` routine
- **THEN** the state changes to `draft`

### Requirement: State Behavior — Run Restrictions
The system SHALL refuse to run `archived` and `quarantine` routines unless the `--force` flag is provided.

#### Scenario: Run archived without force
- **WHEN** `mrp run` is called on an `archived` routine without `--force`
- **THEN** the system returns `error.code: ROUTINE_NOT_RUNNABLE` with message indicating the state and suggesting `--force`

#### Scenario: Run quarantine with force
- **WHEN** `mrp run --force` is called on a `quarantine` routine
- **THEN** the run proceeds and the outcome records `override: true`

#### Scenario: Run deprecated with warning
- **WHEN** `mrp run` is called on a `deprecated` routine
- **THEN** the run proceeds but the response envelope includes a `warnings` list with a deprecation notice

### Requirement: State Behavior — Discovery Exclusion
Routines in `archived` or `deprecated` state SHALL NEVER appear in discovery suggestions.

#### Scenario: Archived excluded from discovery
- **WHEN** discovery footer is generated
- **THEN** no routine with `state: archived` or `state: deprecated` appears in suggestions

### Requirement: Projection Coupling on State Change
When a routine transitions to `archived` or `quarantine`, its projection SHALL be automatically removed (`projection.projected: false`). When a routine is `deprecated`, its projection MAY remain but discovery SHALL NOT suggest it.

#### Scenario: Archive auto-demotes projection
- **WHEN** a projected routine is archived
- **THEN** `projection.projected` is set to `false` and skill wrappers are removed on next sync

#### Scenario: Quarantine auto-demotes projection
- **WHEN** a projected routine is quarantined
- **THEN** `projection.projected` is set to `false` and skill wrappers are removed on next sync

#### Scenario: Deprecated keeps projection
- **WHEN** a projected routine is deprecated
- **THEN** `projection.projected` remains `true` and skill wrappers are kept (with a deprecation note in SKILL.md)

### Requirement: mrp quarantine Command
`mrp quarantine <routine_id>` SHALL transition any routine to `quarantine` state. This is a safety mechanism for blocking unstable or dangerous routines.

#### Scenario: Quarantine an active routine
- **WHEN** `mrp quarantine mrp-build-a1b2` is run on an active routine
- **THEN** the state becomes `quarantine`, projection is auto-demoted, and output confirms the action

### Requirement: Updated At Refresh
Any state transition SHALL update the `lifecycle.updated_at` timestamp to the current time.

#### Scenario: Timestamp updated on promote
- **WHEN** `mrp promote` changes state from draft to active
- **THEN** `lifecycle.updated_at` is set to the current ISO-8601 timestamp
