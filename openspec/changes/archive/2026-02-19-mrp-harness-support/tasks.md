## 1. SKILL.md Frontmatter (projection.ts)

- [x] 1.1 Update `src/core/projection.ts` `renderRoutineSkillMd()` to prepend YAML frontmatter (`---`) with `name` (wrapper directory name) and `description` (`routine.description || routine.intent.goal`)
- [x] 1.2 Update `src/core/projection.ts` `renderMetaSkillMd()` to prepend YAML frontmatter (`---`) with `name: mrp` and a brief MRP description

## 2. Meta Skill Content Expansion (projection.ts)

- [x] 2.1 Rewrite `src/core/projection.ts` `renderMetaSkillMd()` body to medium-depth onboarding: detail `init`, `create`, `list`, `show`, `run`, `promote`, `edit` with brief usage/examples
- [x] 2.2 Update `src/core/projection.ts` `renderMetaSkillMd()` body to briefly mention `demote`, `deprecate`, `archive`, `quarantine`, `sync-skills`, `doctor`, `prune` and point to `mrp <command> --help`

## 3. Per-Command --help System (new module + index.ts)

- [x] 3.1 Create `src/cli/help.ts` with structured help definitions for all 14 commands (description, usage, flags, examples) per `openspec/changes/mrp-harness-support/specs/mrp-cli-help/spec.md`
- [x] 3.2 Implement help envelope rendering for `mrp --help` (global command list) and `mrp <command> --help` (per-command detail), using `command: "help"` and exit code 0
- [x] 3.3 Update `src/index.ts` routing and arg parsing to detect `--help` and short-circuit before any command execution or filesystem side effects
- [x] 3.4 Implement unknown-command help behavior: `mrp not-a-command --help` returns an error envelope with `command: "help"`, `error.code: UNKNOWN_COMMAND`, exit code 1

## 4. Store Init Enhancements (init.ts, store.ts)

- [x] 4.1 Generate `.mrp/AGENTS.md` during `mrp init` in `src/cli/init.ts` with the minimal signpost content required by `openspec/changes/mrp-harness-support/specs/mrp-store/spec.md`
- [x] 4.2 Update `src/cli/init.ts` to auto-run the sync logic after store creation so the `mrp` meta skill is projected to all detected hosts

## 5. Index Auto-Rebuild (index.ts)

- [x] 5.1 Update `src/core/index.ts` `readIndex()` to detect missing `.mrp/index.yaml` and silently rebuild the index from routine files on disk (`.mrp/routines/*/routine.yaml` and `.mrp/routines/*/ledger.yaml`)
- [x] 5.2 Verify commands that rely on the index (for example `src/cli/list.ts`, `src/cli/show.ts`) behave correctly when `index.yaml` is missing (rebuild occurs, command proceeds)

## 6. Gitignore Update

- [x] 6.1 Update `.gitignore` to commit routine definitions and store metadata but ignore runtime artifacts: ignore `.mrp/index.yaml`, `.mrp/discovery_state.yaml`, `.mrp/locks/`, `.mrp/projections/`, `.mrp/routines/*/ledger.yaml`, `.mrp/routines/*/routine.lock`, `.mrp/routines/*/runs/`
- [x] 6.2 Verify `.gitignore` allows committing: `.mrp/config.yaml`, `.mrp/version.yaml`, `.mrp/AGENTS.md`, `.mrp/routines/*/routine.yaml`, `.mrp/routines/*/rationale.md`, `.mrp/routines/*/run.*`, `.mrp/routines/*/verify.*`

## 7. Testing & Verification

- [x] 7.1 Add tests asserting projected routine wrapper `SKILL.md` contains YAML frontmatter with required `name` and `description` fields (via `src/core/projection.ts` outputs)
- [x] 7.2 Add tests asserting projected meta skill `mrp/SKILL.md` contains YAML frontmatter and mentions core commands plus the `mrp <command> --help` pointer
- [x] 7.3 Add tests for `--help` output: `mrp --help` global list, `mrp <command> --help` detail, and `mrp not-a-command --help` error envelope (no side effects)
- [x] 7.4 Add tests that `mrp init` creates `.mrp/AGENTS.md` and auto-projects the meta skill to detected hosts
- [x] 7.5 Add tests that missing `.mrp/index.yaml` triggers silent rebuild and commands like `mrp list` still succeed
- [x] 7.6 Run `bun test` and `bun run typecheck` and fix any failures

## 8. README.md

- [x] 8.1 Write `README.md` with overview, installation/build, CLI usage, YAML envelope conventions, typical workflow, and `.mrp/` version-control guidance
- [x] 8.2 Add harness integration guides in `README.md` for Cursor, Claude Code, OpenCode, and Windsurf (using projected `SKILL.md` skills directories; do not instruct editing global harness rules files)
