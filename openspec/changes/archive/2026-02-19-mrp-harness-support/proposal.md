## Why

MRP already projects routines into popular agent harness “skills” directories, but the generated `SKILL.md` files are missing required YAML frontmatter, making projected skills invisible in Cursor, Claude Code, OpenCode, and Windsurf. Fixing this closes the onboarding gap and makes “routines as skills” usable in real agent workflows without relying on global rules files or network services.

## What Changes

- Add required YAML frontmatter to all projected `SKILL.md` files so host harnesses can discover and index them.
- Enhance the projected `mrp` meta skill to provide a medium-depth onboarding path (core workflow first, with pointers to `mrp <command> --help` for details).
- Add `mrp <command> --help` output for all 14 commands, following MRP’s YAML-only envelope conventions.
- Generate a minimal `.mrp/AGENTS.md` signpost on `mrp init` to direct agents and humans to the CLI interface (and discourage direct file edits).
- Make `mrp init` auto-project the meta skill to all detected harness hosts immediately after store creation.
- If `index.yaml` is missing, commands that require it rebuild the index silently from routine files on disk.
- Update `.gitignore` guidance so routine definitions can be committed while runtime/index/projection artifacts remain untracked.
- Explicitly keep harness integration local: no edits to global harness rules files and no MCP server.

## Capabilities

### New Capabilities
- `mrp-cli-help`: Provide machine-readable, YAML-only per-command help (`mrp <command> --help`) that agents can use for self-serve usage, flags, and examples.

### Modified Capabilities
- `mrp-projection`: Projected skills include required YAML frontmatter and an expanded `mrp` meta skill suitable for harness onboarding.
- `mrp-store`: `mrp init` generates `.mrp/AGENTS.md` and the store behavior supports index auto-rebuild when `index.yaml` is missing.
- `mrp-cli`: All commands support `--help` in YAML envelope form; `mrp init` triggers an immediate meta-skill projection to detected hosts.

## Impact

- Affects skill projection outputs under `.cursor/skills/`, `.claude/skills/`, `.opencode/skills/`, `.windsurf/skills/` (format compatibility and onboarding content).
- Affects CLI UX surface area by standardizing `--help` responses for agent consumption (exit codes and YAML envelope unchanged).
- Affects store initialization artifacts by adding `.mrp/AGENTS.md` and adjusting index behavior when `index.yaml` is absent.
- Affects repository hygiene by clarifying which `.mrp/` files are intended to be committed vs ignored (no changes to global harness rule files; no new network dependencies).
