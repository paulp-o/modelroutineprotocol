# MRP – Model Routine Protocol

MRP is a local CLI tool for AI agents to persist, manage, and reuse repeatable automations ("routines"). It is built with TypeScript + Bun and stores everything in a file-based `.mrp/` directory inside your repository.

MRP can also project routines into popular agent harness "skills" directories (Cursor, Claude Code, OpenCode, Windsurf) so the harness can discover and invoke them.

## What is MRP?

- Routines are structured, versioned automations with lifecycle management.
- Routines can be projected as "skills" into agent harness directories.
- All CLI output is machine-readable YAML using a universal envelope format.
- Fully local: no network dependencies and no edits to global harness config files.

## Quick Start

If `mrp` is not on your PATH, replace `mrp` with `bun run src/index.ts` in the commands below.

```bash
bun install
bun run build  # or bun run src/index.ts directly
mrp init
mrp create --name "Build verify" --goal "Ensure the project builds successfully"
mrp promote <routine_id>
mrp run <routine_id>
mrp sync-skills
```

## Installation

Prerequisites:

- Bun runtime

Install dependencies:

```bash
bun install
```

Run the CLI (choose one):

- Run directly from source:

  ```bash
  bun run src/index.ts --help
  bun run src/index.ts init
  ```

- Build a Bun-targeted bundle:

  ```bash
  bun run build
  # output: dist/mrp.js
  bun run dist/mrp.js --help
  ```

- Build a compiled executable:

  ```bash
  bun run compile
  # output: dist/mrp
  ./dist/mrp --help
  ```

## CLI Commands

MRP provides 14 commands:

| Command | Description |
| --- | --- |
| `init` | Initialize `.mrp/`, detect hosts, and prepare projection targets |
| `create` | Create a new routine (draft) |
| `show` | Show a routine's canonical definition |
| `list` | List routines from the store index |
| `edit` | Open/update a routine's editable artifacts (scripts/docs) |
| `run` | Execute a routine and record its outcome |
| `promote` | Move a routine from draft to active |
| `demote` | Move an active routine back to draft |
| `deprecate` | Mark a routine as deprecated (kept for reference/compatibility) |
| `archive` | Archive a routine (no longer used, kept as history) |
| `quarantine` | Isolate a routine that is unsafe or unreliable |
| `sync-skills` | Project routines into harness skill directories |
| `doctor` | Diagnose and repair store issues |
| `prune` | Remove or clean up derived/runtime artifacts |

Help is YAML, not plain text:

- `mrp --help` returns a YAML envelope with the list of commands.
- `mrp <command> --help` returns a YAML envelope with `usage`, `flags`, and `examples` for that command.
- `--help` is side-effect free (it does not create/modify `.mrp/`, rebuild indexes, or project skills).

## YAML Envelope Format

All CLI output is YAML and follows a universal envelope.

```yaml
# Success
ok: true
command: <command>
ts: <ISO-8601>
data:
  ...

# Error
ok: false
command: <command>
ts: <ISO-8601>
error:
  code: <ERROR_CODE>
  message: <human-readable>
```

Exit codes:

- `0`: success
- `1`: user error (invalid input, unknown command, etc.)
- `2`: internal error

## Typical Workflow

1. `mrp init` - initialize the store and auto-detect agent hosts.
2. `mrp create` - create a routine with a name, goal, and success criteria.
3. Edit the generated entrypoint and verification scripts for the routine.
4. `mrp promote <routine_id>` - move the routine from draft to active.
5. `mrp run <routine_id>` - execute the routine.
6. `mrp sync-skills` - project routines as harness skills.
7. Lifecycle management over time: `promote` -> `deprecate` -> `archive` (with `quarantine` for unsafe routines).

## Version Control (.mrp/ in Git)

MRP is designed so routine definitions can be committed to version control, while runtime artifacts remain local and are regenerated as needed.

Commit (shareable routine definitions and config):

- `.mrp/config.yaml`
- `.mrp/version.yaml`
- `.mrp/AGENTS.md`
- `.mrp/routines/*/routine.yaml`
- `.mrp/routines/*/rationale.md`
- `.mrp/routines/*/run.*`
- `.mrp/routines/*/verify.*`

Ignore (derived/runtime artifacts):

- `.mrp/index.yaml`
- `.mrp/discovery_state.yaml`
- `.mrp/locks/`
- `.mrp/projections/`
- `.mrp/routines/*/ledger.yaml`
- `.mrp/routines/*/routine.lock`
- `.mrp/routines/*/runs/`

Note: the index is derived state. If `.mrp/index.yaml` is missing, MRP silently rebuilds it from routine files on disk.

## Agent Harness Integration

MRP integrates with agent harnesses by projecting skills into their local skills directories. `mrp init` detects available hosts, and `mrp sync-skills` writes skill wrappers:

- A permanent meta skill named `mrp` (the main entry point for agents)
- One skill per routine (wrapper name derived from the routine)

Projected `SKILL.md` files include the YAML frontmatter required by harnesses (for example `name` and `description`).

Important constraints:

- Integration is purely through projected skill files.
- MRP never modifies global harness configuration files (for example `.cursorrules`, root `CLAUDE.md`, `.windsurfrules`).

### Cursor

- Skills directory: `.cursor/skills/`
- Meta skill: `.cursor/skills/mrp/SKILL.md`
- Per-routine skills: `.cursor/skills/mrp-<name>/SKILL.md`
- Cursor auto-discovers skills from this directory; required YAML frontmatter is handled by MRP.

### Claude Code

- Skills directory: `.claude/skills/`
- Meta skill: `.claude/skills/mrp/SKILL.md`
- Per-routine skills: `.claude/skills/mrp-<name>/SKILL.md`
- Claude Code hot-reloads skill changes; required YAML frontmatter is handled by MRP.

### OpenCode

- Skills directory: `.opencode/skills/`
- Meta skill: `.opencode/skills/mrp/SKILL.md`
- Per-routine skills: `.opencode/skills/mrp-<name>/SKILL.md`
- OpenCode also scans `.claude/skills/` for compatibility.

### Windsurf

- Skills directory: `.windsurf/skills/`
- Meta skill: `.windsurf/skills/mrp/SKILL.md`
- Per-routine skills: `.windsurf/skills/mrp-<name>/SKILL.md`
- Windsurf auto-discovers skills from this directory; required YAML frontmatter is handled by MRP.

## Development

- Run tests: `bun test`
- Type checking: `bun run typecheck`

Tech stack:

- TypeScript
- Bun
- `yaml` (eemeli/yaml v2+)
- `zod` v4

## License

This repository does not declare a license in `package.json`. If you intend to publish or share MRP broadly, add an explicit license file and metadata.
