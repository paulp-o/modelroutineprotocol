## 1. Schema Changes (outcome.ts, ledger.ts)
- [x] Update `src/schema/outcome.ts` to add optional `status_auto` field (exit-code-derived signal) while keeping existing `status` as authoritative.
- [x] Update `src/schema/outcome.ts` to extend `status` enum to include `partial` (keep existing values; backwards-compatible).
- [x] Update `src/schema/outcome.ts` to add optional `execution_snapshot` object with `entrypoint_hash`, `entrypoint_path`, `entrypoint_size`.
- [x] Update `src/schema/outcome.ts` to add optional `script_changed` boolean.
- [x] Update `src/schema/outcome.ts` to add optional `judgment` object `{ status, reason?, judged_at }`.
- [x] Update `src/schema/ledger.ts` (if needed beyond `OutcomeSchema`) to ensure ledger run entries accept new optional fields; keep all new fields optional for backwards compatibility.

## 2. Script Fingerprinting (new fingerprint.ts + executor changes)
- [x] Add `src/core/fingerprint.ts` implementing a sha256 hex fingerprint utility for a file path (and returning `entrypoint_hash`, `entrypoint_path`, `entrypoint_size`).
- [x] Update `src/cli/run.ts` to compute the entrypoint fingerprint before calling `executeEntrypoint()` and pass it through to outcome generation as `execution_snapshot`.
- [x] Update `src/cli/run.ts` to compare the current entrypoint hash with the previous run's `execution_snapshot.entrypoint_hash` (when available) and set `script_changed` accordingly.
- [x] Update `src/core/outcome.ts` (`generateOutcome`) to accept and persist `execution_snapshot` and `script_changed` in the returned outcome.

## 3. Status Auto/Authoritative Split (run.ts, verifier.ts, outcome.ts)
- [x] Update `src/cli/run.ts` to treat `determineStatus(...)` as `status_auto` and set authoritative `status` to the same value on initial run outcomes.
- [x] Update `src/core/outcome.ts` (`GenerateOutcomeParams`) to accept both `status` and `status_auto` (with `status_auto` optional for backwards compatibility).
- [x] Update `src/core/verifier.ts` (if needed) to clarify/ensure existing `determineStatus()` logic is used only for `status_auto` (exit-code/verifier-derived), not as the final judged status.

## 4. Judge Command (new judge.ts + routing)
- [x] Create `src/cli/judge.ts` implementing `mrp judge <routine_id> <run_id> --status <success|failure|partial> [--reason "..."]`.
- [x] Update `src/index.ts` to register `judge` in `COMMAND_HANDLERS` and include it in the command list.
- [x] Update `src/cli/help.ts` to add `judge` help definition (usage, required `--status`, optional `--reason`, examples).
- [x] Update `src/index.ts` CLI arg parsing sets (e.g. `BOOLEAN_FLAGS`) only as needed (judge introduces no new boolean flags; ensure `--status`/`--reason` are parsed as valued flags).
- [x] Update `src/core/ledger.ts` to add a helper to update an existing run entry by `run_id` and persist via `writeYamlAtomic` (error `RUN_NOT_FOUND` when missing).
- [x] Implement judge behavior in `src/cli/judge.ts`: read ledger, find run, set `judgment` object, update authoritative `status`, and preserve `status_auto` (if missing, set `status_auto` to the pre-judge `status` before overwriting).
- [x] Update `src/core/index.ts` and/or `src/cli/judge.ts` to update the routine index entry `last_run_status` when judging the most recent run (leave index unchanged when judging a non-latest run).
- [x] Update `src/cli/show.ts` to expose judgment information for judged runs (at minimum: include the latest run entry or explicit judgment fields in the `show` response) and ensure summaries reflect authoritative `status`.

## 5. Agent Autonomy Messaging (projection.ts, init.ts)
- [x] Update `src/core/projection.ts` (`renderMetaSkillMd`) to add an "Agent authority" section granting blanket autonomy (create/modify/evolve routines without permission) and describing the run -> review artifacts -> `mrp judge` workflow; clarify exit codes are informational.
- [x] Update `src/core/projection.ts` (`renderRoutineSkillMd`) to add a brief note that success is judged by the model after running, referencing `mrp judge`.
- [x] Update `src/cli/init.ts` (`AGENTS_MD_CONTENT`) to include autonomy + judgment guidance, allow direct editing of routine entrypoint scripts, and explicitly discourage editing `routine.yaml` / `ledger.yaml` directly (use CLI).

## 6. Testing
- [x] Update `src/__tests__/smoke.test.ts` to cover `mrp judge` success override: run a routine, judge its latest run, and assert `status` updates while `status_auto` preserves the original signal.
- [x] Update `src/__tests__/smoke.test.ts` to cover `mrp judge` partial: judge a run as `partial` and assert `judgment.status` recorded and index/list reflect authoritative status.
- [x] Update `src/__tests__/smoke.test.ts` to cover `mrp judge` error cases (non-existent run id -> `RUN_NOT_FOUND`; invalid/missing `--status` -> validation error).
- [x] Update `src/__tests__/smoke.test.ts` to cover script fingerprinting: `execution_snapshot.entrypoint_hash` recorded on run and `script_changed` becomes true when the entrypoint content changes between runs.
- [x] Update `src/__tests__/smoke.test.ts` to verify projected meta skill contains the autonomy language (create a host skill dir in a temp project, run `mrp sync-skills`, read the meta skill `SKILL.md`, assert it contains "Agent authority").
- [x] Update `src/__tests__/smoke.test.ts` to cover `mrp edit` inspect mode: outputs routine context and writes session file.
- [x] Update `src/__tests__/smoke.test.ts` to cover `mrp edit` commit mode: detects file changes and records an edit event in the ledger.
- [x] Update `src/__tests__/smoke.test.ts` to cover `mrp edit` no-changes case: returns `NO_CHANGES` error.
- [x] Run `bun test` and ensure all tests pass.
- [x] Run `bun run typecheck` and ensure typecheck passes.

## 7. Edit Command Redesign (edit.ts, ledger schema, help)
- [x] Update `src/schema/ledger.ts` to add optional `edits` array with `EditEventSchema` (type, routine_id, edit_id, intent?, committed_at, changed_files[]).
- [x] Update `src/core/ledger.ts` to add `appendEditEvent(ledgerPath, editEvent)` helper and ensure `readLedger` tolerates missing `edits` field.
- [x] Rewrite `src/cli/edit.ts` inspect mode: when `--commit` is NOT set, output routine.yaml content, relevant file paths/content, fingerprints, instructions; write `edit_session.yaml` baseline.
- [x] Rewrite `src/cli/edit.ts` commit mode: when `--commit` IS set, read baseline from edit_session.yaml or last edit event, compute current fingerprints, diff, append EditEvent to ledger, update index timestamp.
- [x] Remove YAML patch behavior from `src/cli/edit.ts` (delete --patch requirement, stdin parsing, deepMerge usage).
- [x] Update `src/index.ts` to add `commit` to `BOOLEAN_FLAGS` and remove `patch` from `BOOLEAN_FLAGS`.
- [x] Update `src/cli/help.ts` edit command definition: new usage, flags (--commit, --intent), examples.
