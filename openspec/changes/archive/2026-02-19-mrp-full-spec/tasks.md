## 1. Project Scaffolding & Core Infrastructure

- [x] 1.1 Initialize Bun project with TypeScript: `bun init`, configure `tsconfig.json` with strict mode, set up `src/` directory structure (cli/, core/, schema/, util/, index.ts)
- [x] 1.2 Add dependencies: `yaml` (eemeli/yaml), `zod` for schema validation
- [x] 1.3 Implement CLI entry point (`src/index.ts`): argument parsing with `parseArgs`, command routing to handler functions, global error boundary that outputs YAML error envelope
- [x] 1.4 Implement universal YAML response envelope utility (`src/util/envelope.ts`): `success(command, data)` and `failure(command, error)` functions, ISO-8601 timestamp, exit code mapping (0/1/2)
- [x] 1.5 Implement YAML I/O utilities (`src/util/yaml-io.ts`): atomic write (temp file + rename), read with parse, YAML stringify with consistent formatting
- [x] 1.6 Implement lockfile utilities (`src/util/lock.ts`): acquire (O_CREAT|O_EXCL or mkdir), release, stale detection (PID check), retry with 100ms interval and 10s timeout, per-routine and global store scopes

## 2. Zod Schemas

- [x] 2.1 Define routine schema (`src/schema/routine.ts`): all required and optional fields per mrp-routine-schema spec, including intent, execution, lifecycle, policy, projection, meta sections
- [x] 2.2 Define outcome schema (`src/schema/outcome.ts`): run_id, status enum, evidence list, timing, artifacts, override flag
- [x] 2.3 Define ledger schema (`src/schema/ledger.ts`): `runs` array of outcome objects
- [x] 2.4 Define config schema (`src/schema/config.ts`): discovery, projection, execution, policy sections with all defaults
- [x] 2.5 Define index schema (`src/schema/index.ts`): routines array with denormalized summary fields
- [x] 2.6 Define error detail schema (`src/schema/error.ts`): code, message, details array with path/expected/received
- [x] 2.7 Define discovery state schema (`src/schema/discovery-state.ts`): last_emission_ts, suggested_routines map
- [x] 2.8 Define projection state schemas (`src/schema/projection.ts`): projections.yaml and last_sync.yaml schemas

## 3. Store Management (mrp init, doctor)

- [x] 3.1 Implement store initialization (`src/core/store.ts`): create `.mrp/` directory structure (version.yaml, config.yaml, index.yaml, discovery_state.yaml, routines/, projections/, locks/), auto-detect host directories for projection.hosts
- [x] 3.2 Implement `mrp init` command handler (`src/cli/init.ts`): check for existing store, call store initialization, output success envelope with store_path, config_path, detected_hosts
- [x] 3.3 Implement store locator (`src/core/store.ts`): find `.mrp/` by walking up from CWD, error if not found for non-init commands
- [x] 3.4 Implement `mrp doctor` command handler (`src/cli/doctor.ts`): version check, stale lock detection and removal, orphaned .tmp cleanup, index consistency check, projection consistency check
- [x] 3.5 Implement `mrp doctor --rebuild-index`: regenerate index.yaml from all routine.yaml and ledger.yaml files on disk

## 4. Routine CRUD (create, show, list, edit)

- [x] 4.1 Implement routine ID generator (`src/core/routine.ts`): slugify name, generate 4-8 char shortid, check uniqueness, format as `mrp-<slug>-<shortid>`
- [x] 4.2 Implement `mrp create` command handler (`src/cli/create.ts`): parse required flags (--name, --goal, --non-goals, --success-criteria), optional flags (--tags, --entrypoint-type, --description), construct routine object, validate with Zod, generate ID, create directory structure, write routine.yaml, generate entrypoint skeleton, write empty ledger.yaml, update index
- [x] 4.3 Implement entrypoint skeleton generator (`src/core/skeleton.ts`): shell (.sh with bash shebang + set -euo pipefail), TypeScript (.ts with goal comment), Python (.py with shebang + docstring)
- [x] 4.4 Implement `mrp show` command handler (`src/cli/show.ts`): read routine.yaml, compute ledger summary (runs_total, last_status, last_run_id, last_run_ts), output full routine + summary
- [x] 4.5 Implement `mrp list` command handler (`src/cli/list.ts`): read index.yaml, apply filters (--state, --tag, --projected, --include-archived), apply --sort and --limit, output routine list
- [x] 4.6 Implement `mrp edit --patch` command handler (`src/cli/edit.ts`): read stdin YAML, parse as partial object, deep-merge into existing routine.yaml (maps recursive, scalars replace, arrays replace, null deletes), validate merged result with Zod, atomic write back, update index
- [x] 4.7 Implement deep-merge utility (`src/util/merge.ts`): recursive map merge, scalar replacement, array replacement, null-means-delete semantics

## 5. Lifecycle State Machine (promote, demote, deprecate, archive, quarantine)

- [x] 5.1 Implement state transition validator (`src/core/lifecycle.ts`): define allowed transitions map, validate requested transition, return INVALID_STATE_TRANSITION error for illegal transitions
- [x] 5.2 Implement `mrp promote` command handler (`src/cli/promote.ts`): validate draft→active transition (or quarantine→draft with --from-quarantine), update state, update updated_at, set projection if eligible and under cap, handle auto-eviction if at cap, trigger sync, update index
- [x] 5.3 Implement `mrp demote` command handler (`src/cli/demote.ts`): set projection.projected=false, trigger sync, update index
- [x] 5.4 Implement `mrp deprecate` command handler (`src/cli/deprecate.ts`): validate active→deprecated, update state, update updated_at, update index
- [x] 5.5 Implement `mrp archive` command handler (`src/cli/archive.ts`): validate deprecated→archived, auto-demote projection, update state, trigger sync, update index
- [x] 5.6 Implement `mrp quarantine` command handler (`src/cli/quarantine.ts`): allow any→quarantine, auto-demote projection, update state, trigger sync, update index

## 6. Execution Engine (mrp run)

- [x] 6.1 Implement entrypoint dispatcher (`src/core/executor.ts`): determine runtime from file extension (.sh→bash, .ts→bun run, .py→python3), check shebang+executable for direct execution, set CWD to project root, inject env vars (MRP_ROUTINE_ID, MRP_RUN_ID, MRP_STORE_DIR)
- [x] 6.2 Implement process runner with capture (`src/core/executor.ts`): spawn child process, capture stdout/stderr to buffers and files, enforce timeout (SIGTERM on expiry), enforce output_max_kb truncation with [TRUNCATED] marker, pass through `--` args
- [x] 6.3 Implement verification phase (`src/core/verifier.ts`): if verifier exists, run it after entrypoint; if no verifier, use exit code as sole evidence; combine entrypoint + verifier results into final status
- [x] 6.4 Implement outcome generator (`src/core/outcome.ts`): construct Outcome object with run_id (ISO-8601#seq), status, evidence per success_criteria, timing, artifact paths, override flag, intent_recap, risks, next_actions from failure_modes
- [x] 6.5 Implement ledger append (`src/core/ledger.ts`): read ledger.yaml, push new outcome to runs array, atomic write back (with routine lock)
- [x] 6.6 Implement run artifact storage (`src/core/artifacts.ts`): create runs/<run_id>/ directory, write stdout.txt and stderr.txt
- [x] 6.7 Implement `mrp run` command handler (`src/cli/run.ts`): validate routine is runnable (state check, --force for archived/quarantine), acquire routine lock, run Plan→Execute→Verify→Summarize pipeline, append to ledger, store artifacts, release lock, trigger sync, check projection auto-suggest, emit discovery footer if applicable, output outcome envelope
- [x] 6.8 Implement run restriction checks: block archived/quarantine without --force (ROUTINE_NOT_RUNNABLE), warn on deprecated (add to warnings list)

## 7. Skill Projection (sync-skills, meta skill)

- [x] 7.1 Implement SKILL.md template generator (`src/core/projection.ts`): generate wrapper content from routine (goal, non-goals, success criteria, run command, show command as canonical source)
- [x] 7.2 Implement meta skill generator (`src/core/projection.ts`): static SKILL.md documenting core MRP commands (list, show, run, create) and canonical truth statement
- [x] 7.3 Implement host directory mapper (`src/core/projection.ts`): map host names to directory paths (opencode→.opencode/skills/, claude→.claude/skills/, cursor→.cursor/skills/, windsurf→.windsurf/skills/)
- [x] 7.4 Implement sync engine (`src/core/projection.ts`): compare projected routines vs disk state, add/update/remove skill wrappers per host, handle missing host directories (create with warning), write projections.yaml and last_sync.yaml, report added/removed/updated counts
- [x] 7.5 Implement auto-eviction logic (`src/core/projection.ts`): when projected count >= max, find LRU by last_run_ts, demote it, record eviction
- [x] 7.6 Implement `mrp sync-skills` command handler (`src/cli/sync-skills.ts`): acquire store lock, run sync engine, output sync summary with stale_warning
- [x] 7.7 Implement auto-sync integration: wire sync into all mutating command handlers (create, edit, promote, demote, deprecate, archive, quarantine), include sync results in data.sync

## 8. Discovery System

- [x] 8.1 Implement discovery state manager (`src/core/discovery.ts`): read/write discovery_state.yaml, check rate limit (30 min since last emission), check per-routine cooldown (12h)
- [x] 8.2 Implement discovery suggestion engine (`src/core/discovery.ts`): filter eligible routines (recent within 3 days, not archived/deprecated/quarantine, not in cooldown), sort by created_at/updated_at, limit to max_suggestions (3), assign suggested_actions based on state (show-first for drafts, show+run for active)
- [x] 8.3 Implement discovery footer injection: after each command, check if footer should be emitted (mutating command OR rate limit expired), generate suggestions, append to response envelope as `discovery` key, update discovery_state.yaml
- [x] 8.4 Implement projection auto-suggest check: after runs, check if routine qualifies (3+ runs in 7 days, not projected), append `data.projection_suggestion` if so

## 9. Pruning (mrp prune)

- [x] 9.1 Implement `mrp prune` command handler (`src/cli/prune.ts`): require at least one of --older-than or --keep-last, support --routine for scoping, support --dry-run, delete run artifact directories (NOT ledger entries), output summary of deleted artifacts

## 10. Build & Distribution

- [x] 10.1 Configure `bun build` for single-file bundle, test `bun compile` for standalone binary on macOS arm64
- [x] 10.2 Add `bin` field to package.json pointing to compiled binary or bun entry
- [x] 10.3 Write integration smoke tests: init → create → show → list → edit → promote → run → sync-skills → deprecate → archive → prune → doctor pipeline

## 11. OpenSpec Config Update

- [x] 11.1 Update `openspec/config.yaml` with project context: tech stack (TypeScript, Bun), conventions (YAML-only output, Zod validation, agent-first design), and key domain knowledge
