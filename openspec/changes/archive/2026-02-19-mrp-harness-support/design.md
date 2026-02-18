## Context

MRP (Model Routine Protocol) is a local TypeScript + Bun CLI that stores routines under a file-based `.mrp/` store and can project those routines into agent harness “skills” directories so tools like Cursor, Claude Code, OpenCode, and Windsurf can surface them as callable skills.

MRP already implements projection (writes per-routine `SKILL.md` files plus a meta `mrp` skill) to host-specific directories (for example `.cursor/skills/`, `.claude/skills/`, `.opencode/skills/`, `.windsurf/skills/`). However, the projected `SKILL.md` files are plain Markdown and do not include the YAML frontmatter required by those harnesses to index skills. As a result, projection runs successfully but the harnesses do not discover the skills.

In addition, the current CLI does not provide `--help` output in MRP’s YAML-only envelope format, and `mrp init` does not immediately project the meta skill after creating the store. There is also a usability gap around store discovery: `.mrp/` is designed to be managed through the CLI, but agents (and humans) browsing the repo may still encounter `.mrp/` and benefit from a minimal signpost that points them back to the CLI.

Constraints carried forward from the existing MRP architecture:

- All CLI output is YAML-only and uses the universal envelope `{ok, command, ts, data|error}`.
- Integration must remain local: no edits to global harness rules files and no MCP server.
- Projection is filesystem-based and must remain safe/atomic (write temp + rename, avoid partial writes).

## Goals / Non-Goals

**Goals:**

- Make projected skills discoverable by popular agent harnesses by adding required YAML frontmatter (`name`, `description`) to all projected `SKILL.md` files.
- Expand the projected `mrp` meta skill content to provide a “medium-depth” onboarding path that emphasizes the core workflow and points to `mrp <command> --help` for full details.
- Add per-command help for all CLI commands via `mrp <command> --help`, returning YAML-only envelope data that agents can parse (usage, flags, examples).
- Improve first-run experience by having `mrp init` auto-project (at least) the meta skill to all detected hosts immediately after store creation.
- Reduce brittleness by silently rebuilding the index when `index.yaml` is missing (from routine files on disk).
- Clarify repository hygiene so routine definitions can be committed while runtime/index/projection artifacts remain untracked.

**Non-Goals:**

- Do not modify or generate global harness configuration files (for example `.cursorrules`, root `CLAUDE.md`, `.windsurfrules`).
- Do not implement a remote service, plugin marketplace publishing flow, or MCP server.
- Do not change the routine execution model, ledger semantics, exit codes, or the YAML envelope format.
- Do not require interactive prompts or harness-specific UI configuration.

## Decisions

1. Add YAML frontmatter to projected `SKILL.md` files (routine wrappers and meta skill).

   Rationale:
   - Cursor/Claude Code/OpenCode/Windsurf treat skills as a structured artifact discovered via YAML frontmatter. Without it, skills are effectively invisible.
   - Frontmatter keeps the integration local and aligns with existing MRP “agents consume structured data” philosophy.

   Format:
   - `name`: wrapper directory ID (for example `mrp-build-verify`), lowercase alphanumeric with hyphens; matches the wrapper folder name.
   - `description`: `routine.description` if set; otherwise `intent.goal`.

   Alternatives considered:
   - Add harness-specific manifest files: rejected (increases surface area, varies by host, and conflicts with “skills-only local projection”).
   - Add only a meta skill and omit per-routine wrappers: rejected (reduces discoverability and defeats routine-as-skill ergonomics).

2. Expand the meta `mrp` skill to a medium-depth onboarding document.

   Rationale:
   - A meta skill is the best single entry point for agents/humans who have a harness but don’t yet know MRP’s command surface.
   - Medium-depth strikes a balance: enough detail to get started without duplicating the entire CLI reference.

   Content shape:
   - Detailed walkthrough with examples for: `init`, `create`, `list`, `show`, `run`, `promote`, `edit`.
   - Brief mention for: `demote`, `deprecate`, `archive`, `quarantine`, `sync-skills`, `doctor`, `prune`.
   - Explicit pointer: “Run `mrp <command> --help` for detailed usage.”

   Alternatives considered:
   - Minimal meta skill + external docs only: rejected (does not solve in-harness onboarding).
   - Very long meta skill containing full reference: rejected (harder to skim and prone to drift).

3. Implement `mrp <command> --help` as YAML-only data, not plain text.

   Rationale:
   - Agents need machine-readable help to self-correct invocation and flags.
   - YAML envelope preserves MRP’s CLI contract (no plain output) while enabling rich content.

   Response model:
   - Envelope: `{ok: true, command: "help", ts: <iso>, data: {command, usage, flags, examples}}`.
   - `flags` is structured (name(s), type, default, description) rather than freeform prose.

   Architecture:
   - Centralize help definitions in a single module (or table) so routing and docs stay consistent.
   - CLI routing short-circuits `--help` before command validation that would otherwise require positional args.

   Alternatives considered:
   - `mrp help <command>` subcommand: rejected (extra command; harder for harnesses that conventionally use `--help`).
   - Print Markdown help to stdout: rejected (violates YAML-only output contract).

4. Generate `.mrp/AGENTS.md` as a minimal signpost during `mrp init`.

   Rationale:
   - `.mrp/` is intentionally CLI-managed, but agents browsing the repository may still open it.
   - A small, stable file reduces “agent confusion” and discourages manual edits that can break invariants.

   Content:
   - Identify the directory as an MRP store.
   - Direct users/agents to `mrp list`, `mrp show <id>`, `mrp run <id>`.
   - Explicitly warn against editing store files directly.

   Alternatives considered:
   - Put guidance into global harness rules: rejected (out of scope and user constraint).
   - Put guidance only into the meta skill: insufficient when `.mrp/` is committed and discovered first.

5. Auto-sync projection after `mrp init`.

   Rationale:
   - The first-run experience should produce something immediately useful in the harness without requiring a second command.
   - Projection remains safe because it is derived content (skills wrappers) and idempotent.

   Approach:
   - After initializing the store (and detecting hosts), trigger `syncSkills()` for the meta skill (and any default projections required by existing behavior) using the freshly written config.

   Alternatives considered:
   - Require explicit `mrp sync-skills`: rejected (adds friction and makes onboarding look broken).

6. Auto-rebuild index when `index.yaml` is missing.

   Rationale:
   - The index is derived from routine files. If missing, MRP can recover deterministically.
   - Reduces “new clone” and “accidental deletion” footguns, and aligns with doctor’s repair capabilities.

   Approach:
   - On read, detect absence of `index.yaml` and rebuild from disk silently.
   - Continue to treat malformed `index.yaml` as an error unless a repair path is explicitly requested (for example `doctor --rebuild-index`).

   Alternatives considered:
   - Require `mrp doctor --rebuild-index` whenever missing: rejected (unnecessary manual step for derived state).

7. Update `.gitignore` guidance to support committing routine definitions while ignoring runtime artifacts.

   Rationale:
   - Teams want to share routine definitions across clones and CI.
   - Index, locks, projections, ledgers, and run artifacts are mutable runtime state and should remain untracked.

   Approach:
   - Commit: `.mrp/config.yaml`, `.mrp/version.yaml`, `.mrp/AGENTS.md`, `.mrp/routines/*/routine.yaml`, `.mrp/routines/*/rationale.md`, `.mrp/routines/*/run.*`, `.mrp/routines/*/verify.*`.
   - Ignore: `.mrp/index.yaml`, `.mrp/discovery_state.yaml`, `.mrp/locks/`, `.mrp/projections/`, `.mrp/routines/*/ledger.yaml`, `.mrp/routines/*/routine.lock`, `.mrp/routines/*/runs/`.

   Alternatives considered:
   - Ignore all of `.mrp/`: rejected (prevents sharing routine definitions; hurts collaboration).

## Risks / Trade-offs

- Harness frontmatter expectations vary and may evolve → Keep the frontmatter minimal (`name`, `description`) and avoid host-specific fields; add fields only when verified across hosts.
- Two sources of “help” (meta skill vs `--help`) can drift → Generate both from shared help definitions or keep meta skill focused on workflow and defer details to `--help`.
- Auto-rebuilding a missing index can mask accidental deletions → Limit the silent rebuild to the “file missing” case only; keep corruption handling explicit (doctor-driven) and surface issues in `mrp doctor`.
- Committing parts of `.mrp/` increases the chance of manual edits → `.mrp/AGENTS.md` warns against edits; CLI validation remains the gatekeeper.
- Auto-sync on init may create a perception of “writes outside .mrp/” → Make this behavior explicit in `mrp init` output and ensure it only writes into detected host skill directories.
