## Why

AI agents today run automations ephemerally — each session reinvents build scripts, deploy checks, and environment validations from scratch. There is no standard way for an agent to **persist, reuse, and evolve** repeatable automations with explicit intent contracts, verifiable outcomes, and audit history. MRP (Model Routine Protocol) solves this by providing a local, CLI-first system that makes automations first-class entities with semantic contracts rather than disposable shell one-liners.

## What Changes

- Introduce the `mrp` CLI tool (TypeScript + Bun) with 13 commands for full routine lifecycle management.
- Define the `.mrp/` on-disk store format: routine YAML schemas, ledger storage, run artifacts, projection state, and configuration.
- Implement the Plan→Execute→Verify→Summarize execution protocol for every routine run.
- Implement multi-host skill projection (OpenCode, Claude Code, Cursor, Windsurf) via file-based SKILL.md generation.
- Implement discovery footer system to surface unused/new routines to agents.
- Implement per-routine + global lockfiles for multi-agent concurrency safety.
- Define a universal YAML response envelope for all CLI output (pure YAML, no human text).
- Support .sh, .ts, .py entrypoints with runtime auto-detection.

## Capabilities

### New Capabilities
- `mrp-store`: On-disk store format (.mrp/ directory), versioning, config, index, and file layout for routines, projections, and locks.
- `mrp-routine-schema`: Routine YAML schema — intent contract (goal, non-goals, success criteria, failure modes), execution config, lifecycle state, policy metadata, and projection settings.
- `mrp-cli`: CLI command surface — init, list, show, run, create, edit, deprecate, archive, promote, demote, sync-skills, doctor, prune. Universal YAML envelope, exit codes, flag contracts.
- `mrp-execution`: Execution protocol — Plan→Execute→Verify→Summarize semantics, entrypoint dispatch (.sh/.ts/.py), timeout/output limits, outcome generation, ledger append.
- `mrp-lifecycle`: Lifecycle state machine — draft/active/deprecated/archived/quarantine with strict transitions, override flags, and projection coupling rules.
- `mrp-discovery`: Discovery footer system — emission policy (mutating commands + 30min rate-limit), recency/cooldown rules, suggestion format, multi-agent awareness via discovery_state.yaml.
- `mrp-projection`: Skill projection system — multi-host file projection, auto-suggest (usage-frequency), manual promote/demote, auto-eviction at cap, meta skill, sync behavior.
- `mrp-concurrency`: Concurrency and locking — per-routine lockfiles, global store lock, atomic writes via temp+rename.
- `mrp-safety`: Safety and limits — timeout enforcement, output capture limits, quarantine state, documentation-only network/denylist policy in MVP.

### Modified Capabilities
<!-- No existing specs to modify — this is a greenfield project. -->

## Impact

- **New CLI binary**: `mrp` command installed via Bun, entry point for all operations.
- **New on-disk format**: `.mrp/` directory created in project root. Added to project structure.
- **Host skill directories**: Projected SKILL.md files written to `.opencode/skills/`, `.claude/skills/`, `.cursor/skills/`, `.windsurf/skills/` depending on detected hosts.
- **Dependencies**: Bun runtime, `yaml` library (js-yaml or yaml package), `zod` for schema validation.
- **No external services**: Fully local, no network dependencies, no databases.
