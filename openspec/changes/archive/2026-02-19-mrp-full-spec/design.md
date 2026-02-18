## Context

MRP (Model Routine Protocol) is a greenfield local CLI tool for AI agents to persist, manage, and reuse repeatable automations ("routines"). There is no existing codebase — this is the initial implementation.

The primary consumer is an AI agent operating inside a CLI environment (Claude Code, Cursor, Windsurf, OpenCode). The agent interacts with MRP exclusively through shell commands that output pure YAML. No GUI, no web interface, no interactive prompts.

The project lives in a single repository. The `.mrp/` store is created per-project (not global). Multiple agents may interact with the same `.mrp/` store concurrently.

### Key Constraints
- **Runtime**: TypeScript + Bun. Single binary via `bun compile` for distribution.
- **Output**: Pure YAML always. Universal envelope `{ok, command, ts, data/error}`.
- **Storage**: YAML files on local filesystem. No database.
- **Agent-first**: Every interface decision prioritizes programmatic use by LLMs.
- **Multi-agent safe**: Concurrent access via lockfiles and atomic writes.

## Goals / Non-Goals

**Goals:**
- Implement all 13 CLI commands with full YAML output contracts.
- Define and validate routine schemas with Zod, returning structured errors.
- Support .sh, .ts, .py entrypoints with runtime auto-detection.
- Implement multi-host skill projection (OpenCode, Claude, Cursor, Windsurf).
- Implement discovery footer with rate-limiting for multi-agent awareness.
- Implement per-routine lockfiles for concurrent access safety.

**Non-Goals:**
- No network enforcement or command denylist at runtime (documentation-only in MVP).
- No GUI or interactive prompts.
- No remote/cloud storage.
- No cross-machine sync or team collaboration features.
- No Windows support in MVP (macOS + Linux only).

## Decisions

### D1: Project Structure — Flat CLI with Modular Internals

**Decision**: Single Bun-compiled binary. Internal module structure:
```
src/
  cli/           # Command handlers (one file per command)
  core/          # Business logic (store, routine, ledger, execution, projection)
  schema/        # Zod schemas for all YAML types
  util/          # Lock, YAML I/O, envelope, discovery state
  index.ts       # CLI entry point (argument parsing)
```
**Rationale**: Bun's fast startup + compile makes a single binary viable. Internal modularity keeps logic testable without over-engineering.
**Alternatives considered**: Monorepo with packages — rejected as over-engineering for a single CLI tool.

### D2: YAML Library — `yaml` (eemeli/yaml) over js-yaml

**Decision**: Use the `yaml` package (eemeli/yaml v2+).
**Rationale**: Full YAML 1.2 support, better TypeScript types, supports custom tags if needed, handles multi-doc streams (useful even though we chose single-list ledger — needed for potential future formats). js-yaml only supports YAML 1.1.
**Alternatives considered**: js-yaml — simpler but YAML 1.1 only, less maintained.

### D3: Schema Validation — Zod with Structured Error Output

**Decision**: All YAML inputs (routine creation, patches, ledger entries) are validated through Zod schemas. Validation errors are returned as structured YAML with `path`, `expected`, `received` fields.
**Rationale**: Zod provides excellent TypeScript inference, composable schemas, and `.safeParse()` with rich error objects. Agents can self-repair from structured errors in one retry.
**Alternatives considered**: Ajv (JSON Schema) — more standard but worse TS integration and more verbose schema definitions.

### D4: CLI Argument Parsing — Minimal, No Heavy Framework

**Decision**: Use `parseArgs` (Node.js built-in, available in Bun) for argument parsing. No commander/yargs/clipanion.
**Rationale**: The CLI has 13 commands with simple flag patterns. A heavy framework adds bundle size and startup time for no benefit. `parseArgs` handles `--flag value`, `--flag=value`, positional args, and `--` passthrough.
**Alternatives considered**: Commander.js — popular but adds ~100KB and unnecessary abstraction for this command surface.

### D5: Locking Strategy — Lockfiles with Retry + Timeout

**Decision**: File-based lockfiles using atomic `open(O_CREAT | O_EXCL)` semantics (via `Bun.write` with exclusive flag or `fs.mkdirSync` as lock primitive). Two lock scopes:
- `.mrp/locks/store.lock` — global store operations (index, projections, config, discovery state).
- `.mrp/routines/<id>/routine.lock` — per-routine operations (ledger append, run artifacts).

Locks are acquired with retry (100ms interval, 10s timeout). Stale lock detection via PID-in-lockfile + process-alive check.
**Rationale**: Simplest reliable approach for local CLI. No external dependencies (no flock, no advisory locks). PID staleness check handles crashed processes.
**Alternatives considered**: Advisory file locks (flock) — not portable across macOS/Linux in all edge cases. Database-level locking — over-engineering.

### D6: Entrypoint Dispatch — Extension-Based Runtime Selection

**Decision**: Entrypoint file extension determines the runtime:
- `.sh` → `bash <file>`
- `.ts` → `bun run <file>`
- `.py` → `python3 <file>`

If the file has a shebang and executable bit, use direct execution instead.
CWD is always the project root (directory containing `.mrp/`).
Environment variables injected: `MRP_ROUTINE_ID`, `MRP_RUN_ID`, `MRP_STORE_DIR`.
**Rationale**: Explicit, predictable, no magic. Shebang fallback respects Unix conventions.
**Alternatives considered**: Always use shebang — requires all entrypoints to have shebangs, which is error-prone for agent-generated scripts.

### D7: Projection Sync — Direct File Write per Host

**Decision**: `mrp sync-skills` writes SKILL.md wrappers directly to each configured host's skill directory. No external CLI dependency.
Host directory mapping:
- `opencode` → `.opencode/skills/mrp-<skill_name>/SKILL.md`
- `claude` → `.claude/skills/mrp-<skill_name>/SKILL.md`
- `cursor` → `.cursor/skills/mrp-<skill_name>/SKILL.md`
- `windsurf` → `.windsurf/skills/mrp-<skill_name>/SKILL.md`

**Rationale**: Zero dependencies, deterministic, works offline. The `npx skills` CLI was considered but adds an external dependency and less control over SKILL.md content.
**Alternatives considered**: npx skills CLI integration — external dependency, unpredictable behavior.

### D8: Create Command — Required Flags, CLI Constructs YAML

**Decision**: `mrp create` accepts required fields as flags (`--name`, `--goal`, `--non-goals`, `--success-criteria`). The CLI constructs valid routine.yaml from these flags. Advanced fields are added later via `mrp edit --patch`.
**Rationale**: Research shows flag-based creation is the most reliable method for LLM-generated structured content — zero YAML syntax risk. The agent never authors raw YAML from scratch for creation, only small patches for enrichment.
**Alternatives considered**: Stdin YAML pipe — higher error rate from LLM-generated YAML. Template+fill — placeholder leakage risk.

### D9: Universal YAML Envelope

**Decision**: Every CLI command outputs a standard envelope:
```yaml
ok: true|false
command: <command-name>
ts: "<ISO-8601>"
data:
  # command-specific payload
# OR on failure:
error:
  code: <ERROR_CODE>
  message: "<human-readable>"
  details:
    - path: "<dotted.field.path>"
      expected: "<type or value>"
      received: "<actual>"
```
Exit codes: 0 = success, 1 = user/validation/runtime error, 2 = internal/unhandled error.
**Rationale**: Agents parse one schema for all commands. `ok` boolean is the fastest check. Structured errors enable one-shot self-repair.

### D10: Discovery State — File-Based Timestamp Tracking

**Decision**: Discovery emission state tracked in `.mrp/discovery_state.yaml`:
```yaml
last_emission_ts: "<ISO-8601>"
suggested_routines:
  <routine_id>:
    last_suggested_ts: "<ISO-8601>"
```
Rate-limit check: if >30 minutes since `last_emission_ts`, any command emits the discovery footer. Per-routine cooldown: 12 hours per `suggested_routines[id].last_suggested_ts`.
**Rationale**: Solves the multi-agent problem — even read-only commands trigger discovery if enough time has passed, ensuring all agents eventually see new routines.

## Risks / Trade-offs

- **[Risk] Lockfile staleness from crashes** → Mitigation: PID-in-lockfile + process-alive check. `mrp doctor` can clean stale locks.
- **[Risk] YAML output-only may frustrate human debugging** → Mitigation: YAML is still human-readable. Post-MVP can add `--human` flag for formatted output.
- **[Risk] Bun compile compatibility across OS versions** → Mitigation: Target macOS arm64 + Linux x64 for MVP. Test on CI.
- **[Risk] Discovery footer noise in high-frequency agent workflows** → Mitigation: 30-minute rate limit + 12h per-routine cooldown keeps noise low.
- **[Risk] Multi-host projection directories may not exist** → Mitigation: `mrp init` auto-detects; `sync-skills` skips missing host directories with a warning in output.
- **[Risk] Flag-based create may feel limiting for complex routines** → Mitigation: `mrp edit --patch` covers all advanced fields. Two-step create+patch is the documented pattern.
- **[Trade-off] Single YAML list ledger requires full-file rewrite on append** → Accepted: For a local CLI with moderate run frequency, this is negligible. Atomic write (temp+rename) ensures safety.
- **[Trade-off] No network enforcement in MVP** → Accepted: `policy.network` is metadata only. Agent can reason about it. Runtime sandboxing deferred to post-MVP.
