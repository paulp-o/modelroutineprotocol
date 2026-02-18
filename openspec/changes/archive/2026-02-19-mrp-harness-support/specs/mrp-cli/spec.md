## MODIFIED Requirements

### Requirement: mrp init Command
`mrp init` SHALL create the `.mrp/` store in the current directory. It SHALL auto-detect agent host directories and configure projection hosts.

After successful store creation, `mrp init` SHALL immediately project the `mrp` meta skill to all detected hosts by running the `sync-skills` logic.

#### Scenario: Successful init
- **WHEN** `mrp init` is run in a directory without `.mrp/`
- **THEN** the store is created and output contains `data.store_path`, `data.config_path`, `data.detected_hosts`

#### Scenario: Init projects meta skill to detected hosts
- **WHEN** `mrp init` detects `.cursor/` and `.claude/` directories
- **THEN** after store creation, `mrp/SKILL.md` appears in both `.cursor/skills/mrp/` and `.claude/skills/mrp/`

## ADDED Requirements

### Requirement: Global Help Flag
All commands SHALL support the `--help` flag.

When `--help` is present, the CLI SHALL output usage information in YAML envelope format and exit with code 0 without side effects.

#### Scenario: Help output does not execute command
- **WHEN** `mrp prune --help` is run
- **THEN** the output is a YAML help envelope and no run artifacts are deleted
