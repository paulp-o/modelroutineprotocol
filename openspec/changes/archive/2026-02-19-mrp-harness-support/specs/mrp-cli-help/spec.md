## ADDED Requirements

### Requirement: Per-Command Help Output
`mrp <command> --help` SHALL output a YAML envelope with command usage information.

When help is requested without a command (`mrp --help`), the CLI SHALL output a YAML envelope with `command: "help"` and `data.commands` listing all available commands with brief descriptions.

The output envelope SHALL follow the standard format:
- `ok: true`
- `command: "help"`
- `ts: <ISO-8601 timestamp>`

For per-command help, `data:` SHALL contain:
- `command: <command_name>`
- `description: <brief description>`
- `usage: <usage string>`
- `flags:` list of flag descriptors
- `examples:` list of example command strings

For global help (`mrp --help`), `data:` SHALL contain:
- `commands:` list of `{command, description}` entries

Help output SHALL exit with code 0.

Each `flags` entry SHALL include:
- `name: <flag name>` (for example `--timeout-sec`)
- `type: <"boolean"|"string"|"repeatable">`
- `required: <boolean>`
- `description: <brief>`

#### Scenario: Help for a specific command
- **WHEN** `mrp create --help` is run
- **THEN** the output contains a YAML envelope with `command: "help"` and `data.command: "create"` including the create command usage, flags, and examples

#### Scenario: Help with no command
- **WHEN** `mrp --help` is run
- **THEN** the output contains a YAML envelope with `command: "help"` and `data.commands` listing all available commands with brief descriptions

#### Scenario: Help for unknown command
- **WHEN** `mrp not-a-command --help` is run
- **THEN** the output contains an error envelope with `command: "help"`, `error.code: UNKNOWN_COMMAND`, and exits with code 1

### Requirement: Help Flag Priority
When `--help` is present, help output SHALL be shown instead of executing the command.

No side effects SHALL occur when `--help` is present. Side effects include (but are not limited to): creating/modifying files under `.mrp/`, executing entrypoints, writing projections, rebuilding indexes, or acquiring persistent locks.

#### Scenario: Init help has no side effects
- **WHEN** `mrp init --help` is run
- **THEN** no `.mrp/` directory is created and only help output is shown

#### Scenario: Run help does not execute routine
- **WHEN** `mrp run mrp-build-a1b2 --help` is run
- **THEN** the routine is NOT executed and only help output is shown
