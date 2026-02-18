## MODIFIED Requirements

### Requirement: Meta Skill
The system SHALL provide a permanent meta skill named `mrp` that exists in every configured host's skill directory. The meta skill SKILL.md SHALL include YAML frontmatter and SHALL document core MRP commands, explain when to use routines, and state that `mrp list` / `mrp show` is the canonical truth source.

The meta skill SKILL.md YAML frontmatter SHALL use `---` delimiters and MUST include:
- `name: mrp`
- `description: <brief description of MRP and how agents should use it>`

The meta skill SKILL.md body SHALL:
- Detail the core workflow commands with brief usage: `init`, `create`, `list`, `show`, `run`, `promote`, `edit`
- Briefly mention the remaining commands: `demote`, `deprecate`, `archive`, `quarantine`, `sync-skills`, `doctor`, `prune`
- Instruct agents to run `mrp <command> --help` for extended information

#### Scenario: Meta skill always present
- **WHEN** `mrp sync-skills` runs
- **THEN** an `mrp` skill directory with SKILL.md exists in every configured host's skill directory

#### Scenario: Meta skill content
- **WHEN** the meta skill SKILL.md is read
- **THEN** it contains YAML frontmatter with `name: mrp`, documents the core workflow commands first, mentions remaining commands, and instructs `mrp <command> --help` for details

### Requirement: Projected Skill Wrapper Content
A projected skill SKILL.md SHALL contain YAML frontmatter and routine-derived instructions.

The projected skill SKILL.md YAML frontmatter SHALL use `---` delimiters and MUST include:
- `name`: the projected wrapper directory name (for example `mrp-build-verify`)
- `description`: `routine.description` if set, otherwise `routine.intent.goal`

The body of a projected skill SKILL.md SHALL contain: when the routine is relevant (brief), goal, non-goals summary, minimal success criteria, execution command (`mrp run <routine_id>`), and canonical truth reference (`mrp show <routine_id>`).

#### Scenario: Wrapper content matches routine
- **WHEN** a routine with goal "Ensure build succeeds" is projected
- **THEN** the SKILL.md contains YAML frontmatter with `name: mrp-<skill_name>` and `description` derived from the routine, plus the goal, non-goals, and instructions to run via `mrp run <id>`
