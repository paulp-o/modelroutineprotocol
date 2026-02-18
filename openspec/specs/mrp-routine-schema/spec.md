## ADDED Requirements

### Requirement: Routine Identifier Format
The system SHALL generate routine identifiers in the format `mrp-<slug>-<shortid>` where `<slug>` is lowercase alphanumeric plus hyphens and `<shortid>` is 4-8 lowercase alphanumeric characters. The identifier MUST be filesystem-safe and unique within `.mrp/routines/`.

#### Scenario: ID generated on create
- **WHEN** `mrp create --name "Build verify"` is executed
- **THEN** the system generates an ID like `mrp-build-verify-a1b2` where the slug is derived from the name and shortid is random

#### Scenario: ID uniqueness enforced
- **WHEN** a generated ID collides with an existing routine
- **THEN** the system regenerates the shortid until unique

### Requirement: Routine YAML Schema — Required Fields
The system SHALL require the following fields in every `routine.yaml`: `id`, `name`, `intent.goal`, `intent.non_goals` (list), `intent.success_criteria` (list with `id` and `text`), `execution.entrypoint`, `lifecycle.state`, `lifecycle.created_at`, `lifecycle.updated_at`, `projection.eligible`, `projection.projected`.

#### Scenario: Validation rejects missing required field
- **WHEN** a routine YAML is missing `intent.goal`
- **THEN** the system returns an error with `code: VALIDATION_ERROR` and `details` containing `path: intent.goal`, `expected: string`, `received: null`

### Requirement: Routine YAML Schema — Optional Fields
The system SHALL accept the following optional fields: `description`, `intent.failure_modes` (list with `id`, `text`, `suggested_fix`), `execution.verifier`, `execution.shell`, `execution.timeout_sec`, `tags` (list), `lifecycle.expires_at`, `policy.risk_level` (enum: low|medium|high), `policy.side_effects` (list), `policy.network` (enum: on|off), `policy.output_max_kb`, `projection.skill_name`, `meta.version`, `meta.owner`.

#### Scenario: Optional fields have defaults
- **WHEN** a routine is created without specifying `execution.shell`
- **THEN** the default value `bash` is used

#### Scenario: Optional fields accept valid values
- **WHEN** `policy.risk_level` is set to `medium`
- **THEN** the value is accepted and stored

#### Scenario: Optional fields reject invalid enum values
- **WHEN** `policy.risk_level` is set to `critical`
- **THEN** the system returns a validation error with `expected: low|medium|high`, `received: critical`

### Requirement: Success Criteria Schema
Each success criterion in `intent.success_criteria` SHALL have an `id` (string, unique within the routine) and a `text` (string describing the criterion).

#### Scenario: Success criteria with valid structure
- **WHEN** a routine is created with `--success-criteria "sc.exit0:Build exits code 0"`
- **THEN** the system stores `{id: "sc.exit0", text: "Build exits code 0"}` in `intent.success_criteria`

### Requirement: Failure Modes Schema
Each failure mode in `intent.failure_modes` SHALL have an `id`, `text`, and optional `suggested_fix`.

#### Scenario: Failure mode stored via patch
- **WHEN** `mrp edit <id> --patch` with failure_modes YAML is applied
- **THEN** the failure modes are stored with their ids, text, and suggested_fix fields

### Requirement: Entrypoint Field Validation
The `execution.entrypoint` field SHALL reference a file that exists in the routine directory. The file extension MUST be one of `.sh`, `.ts`, `.py`.

#### Scenario: Invalid entrypoint extension rejected
- **WHEN** `execution.entrypoint` is set to `run.rb`
- **THEN** the system returns a validation error with `expected: .sh|.ts|.py extension`

### Requirement: Routine Rationale
The system SHALL support an optional `rationale.md` file in each routine directory for human-readable context about why the routine exists.

#### Scenario: Rationale created via patch
- **WHEN** `mrp edit <id> --patch` includes a `rationale` field
- **THEN** the system writes the content to `rationale.md` in the routine directory
