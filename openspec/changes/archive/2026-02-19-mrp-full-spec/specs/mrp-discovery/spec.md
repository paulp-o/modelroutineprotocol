## ADDED Requirements

### Requirement: Discovery Footer Emission
The system SHALL emit a discovery footer in the response envelope when: (A) the command is a mutating command (create, edit, run, promote, demote, deprecate, archive, quarantine), OR (B) more than 30 minutes have elapsed since the last discovery emission (tracked in `.mrp/discovery_state.yaml`). The footer SHALL appear as a `discovery` key in the YAML response envelope.

#### Scenario: Footer after mutating command
- **WHEN** `mrp create` completes successfully
- **THEN** the response includes a `discovery` key with suggestions

#### Scenario: Footer after 30-minute rate limit
- **WHEN** `mrp list` is run and it has been >30 minutes since the last discovery emission
- **THEN** the response includes a `discovery` key with suggestions

#### Scenario: No footer when under rate limit
- **WHEN** `mrp show` is run and discovery was emitted 10 minutes ago via another command
- **THEN** the response does NOT include a `discovery` key

### Requirement: Discovery State Tracking
The system SHALL track discovery emission state in `.mrp/discovery_state.yaml` with `last_emission_ts` (ISO-8601) and `suggested_routines` (map of routine_id → `last_suggested_ts`).

#### Scenario: State updated after emission
- **WHEN** a discovery footer is emitted
- **THEN** `last_emission_ts` is updated to current time, and each suggested routine's `last_suggested_ts` is updated

### Requirement: Discovery Recency Filter
Discovery SHALL only suggest routines that were created or updated within the `discovery.recent_window_days` config value (default: 3 days).

#### Scenario: Recent routine suggested
- **WHEN** a routine was created 2 days ago and is in `draft` state
- **THEN** it is eligible for discovery suggestion

#### Scenario: Old routine not suggested
- **WHEN** a routine was created 5 days ago (outside 3-day window) and has never been run
- **THEN** it is NOT suggested in discovery

### Requirement: Discovery Cooldown
Discovery SHALL NOT re-suggest the same routine within `discovery.cooldown_hours` (default: 12 hours) of its last suggestion.

#### Scenario: Cooldown prevents repeat
- **WHEN** a routine was suggested 6 hours ago
- **THEN** it is NOT suggested again until 12 hours have elapsed

#### Scenario: Cooldown expired
- **WHEN** a routine was suggested 13 hours ago
- **THEN** it is eligible for suggestion again

### Requirement: Discovery Suggestion Limit
Discovery SHALL suggest at most `discovery.max_suggestions` routines per emission (default: 3).

#### Scenario: Max 3 suggestions
- **WHEN** 5 routines are eligible for discovery
- **THEN** only the 3 most recently created/updated are suggested

### Requirement: Discovery Action Preference
Discovery SHALL suggest actions based on `discovery.suggest_action_preference` (default: `show_first`). For `draft` routines, the primary action SHALL always be `mrp show`. For `active` routines, the primary action MAY be `mrp run`.

#### Scenario: Draft routine suggests show
- **WHEN** a `draft` routine appears in discovery
- **THEN** the suggested action is `mrp show <id>` (not `mrp run`)

#### Scenario: Active routine suggests run
- **WHEN** an `active` routine appears in discovery and preference is `show_first`
- **THEN** the suggested actions include `mrp show <id>` first and `mrp run <id>` second

### Requirement: Discovery Exclusion Rules
Discovery SHALL NEVER suggest routines in `archived` or `deprecated` state. Discovery SHALL NEVER suggest routines in `quarantine` state.

#### Scenario: Archived excluded
- **WHEN** an archived routine was recently updated
- **THEN** it does NOT appear in discovery

### Requirement: Discovery Footer Format
The discovery footer SHALL be a YAML structure under the `discovery` key:
```yaml
discovery:
  suggestions:
    - routine_id: mrp-env-check-z9k1
      name: Env check
      reason: recent_draft_untried
      suggested_actions:
        - "mrp show mrp-env-check-z9k1"
        - "mrp run mrp-env-check-z9k1"
```

#### Scenario: Footer structure is valid YAML
- **WHEN** a discovery footer is emitted
- **THEN** it contains `discovery.suggestions` as a list with `routine_id`, `name`, `reason`, and `suggested_actions` for each entry

### Requirement: No Repo Pattern Matching
Discovery SHALL NOT use git diff, glob matching against changed files, or repository structure heuristics to determine suggestions. Suggestions are based solely on routine metadata (state, timestamps, run history).

#### Scenario: Discovery ignores file changes
- **WHEN** TypeScript files were recently modified in the project
- **THEN** discovery does NOT use this information to suggest routines
