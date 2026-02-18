## 1. Schema Changes (outcome.ts, ledger.ts)
- [ ] Update `src/schema/outcome.ts` to add optional `status_auto` field (exit-code-derived signal) while keeping existing `status` as authoritative.
- [ ] Update `src/schema/outcome.ts` to extend `status` enum to include `partial` (keep existing values; backwards-compatible).
- [ ] Update `src/schema/outcome.ts` to add optional `execution_snapshot` object with `entrypoint_hash`, `entrypoint_path`, `entrypoint_size`.
- [ ] Update `src/schema/outcome.ts` to add optional `script_changed` boolean.
- [ ] Update `src/schema/outcome.ts` to add optional `judgment` object `{ status, reason?, judged_at }`.
- [ ] Update `src/schema/ledger.ts` (if needed beyond `OutcomeSchema`) to ensure ledger run entries accept new optional fields; keep all new fields optional for backwards compatibility.

## 2. Script Fingerprinting (new fingerprint.ts + executor changes)
- [ ] Add `src/core/fingerprint.ts` implementing a sha256 hex fingerprint utility for a file path (and returning `entrypoint_hash`, `entrypoint_path`, `entrypoint_size`).
- [ ] Update `src/cli/run.ts` to compute the entrypoint fingerprint before calling `executeEntrypoint()` and pass it through to outcome generation as `execution_snapshot`.
- [ ] Update `src/cli/run.ts` to compare the current entrypoint hash with the previous run's `execution_snapshot.entrypoint_hash` (when available) and set `script_changed` accordingly.
- [ ] Update `src/core/outcome.ts` (`generateOutcome`) to accept and persist `execution_snapshot` and `script_changed` in the returned outcome.

## 3. Status Auto/Authoritative Split (run.ts, verifier.ts, outcome.ts)
- [ ] Update `src/cli/run.ts` to treat `determineStatus(...)` as `status_auto` and set authoritative `status` to the same value on initial run outcomes.
- [ ] Update `src/core/outcome.ts` (`GenerateOutcomeParams`) to accept both `status` and `status_auto` (with `status_auto` optional for backwards compatibility).
- [ ] Update `src/core/verifier.ts` (if needed) to clarify/ensure existing `determineStatus()` logic is used only for `status_auto` (exit-code/verifier-derived), not as the final judged status.

## 4. Judge Command (new judge.ts + routing)
- [ ] Create `src/cli/judge.ts` implementing `mrp judge <routine_id> <run_id> --status <success|failure|partial> [--reason "..."]`.
- [ ] Update `src/index.ts` to register `judge` in `COMMAND_HANDLERS` and include it in the command list.
- [ ] Update `src/cli/help.ts` to add `judge` help definition (usage, required `--status`, optional `--reason`, examples).
- [ ] Update `src/index.ts` CLI arg parsing sets (e.g. `BOOLEAN_FLAGS`) only as needed (judge introduces no new boolean flags; ensure `--status`/`--reason` are parsed as valued flags).
- [ ] Update `src/core/ledger.ts` to add a helper to update an existing run entry by `run_id` and persist via `writeYamlAtomic` (error `RUN_NOT_FOUND` when missing).
- [ ] Implement judge behavior in `src/cli/judge.ts`: read ledger, find run, set `judgment` object, update authoritative `status`, and preserve `status_auto` (if missing, set `status_auto` to the pre-judge `status` before overwriting).
- [ ] Update `src/core/index.ts` and/or `src/cli/judge.ts` to update the routine index entry `last_run_status` when judging the most recent run (leave index unchanged when judging a non-latest run).
- [ ] Update `src/cli/show.ts` to expose judgment information for judged runs (at minimum: include the latest run entry or explicit judgment fields in the `show` response) and ensure summaries reflect authoritative `status`.

## 5. Agent Autonomy Messaging (projection.ts, init.ts)
- [ ] Update `src/core/projection.ts` (`renderMetaSkillMd`) to add an "Agent authority" section granting blanket autonomy (create/modify/evolve routines without permission) and describing the run -> review artifacts -> `mrp judge` workflow; clarify exit codes are informational.
- [ ] Update `src/core/projection.ts` (`renderRoutineSkillMd`) to add a brief note that success is judged by the model after running, referencing `mrp judge`.
- [ ] Update `src/cli/init.ts` (`AGENTS_MD_CONTENT`) to include autonomy + judgment guidance, allow direct editing of routine entrypoint scripts, and explicitly discourage editing `routine.yaml` / `ledger.yaml` directly (use CLI).

## 6. Testing
- [ ] Update `src/__tests__/smoke.test.ts` to cover `mrp judge` success override: run a routine, judge its latest run, and assert `status` updates while `status_auto` preserves the original signal.
- [ ] Update `src/__tests__/smoke.test.ts` to cover `mrp judge` partial: judge a run as `partial` and assert `judgment.status` recorded and index/list reflect authoritative status.
- [ ] Update `src/__tests__/smoke.test.ts` to cover `mrp judge` error cases (non-existent run id -> `RUN_NOT_FOUND`; invalid/missing `--status` -> validation error).
- [ ] Update `src/__tests__/smoke.test.ts` to cover script fingerprinting: `execution_snapshot.entrypoint_hash` recorded on run and `script_changed` becomes true when the entrypoint content changes between runs.
- [ ] Update `src/__tests__/smoke.test.ts` to verify projected meta skill contains the autonomy language (create a host skill dir in a temp project, run `mrp sync-skills`, read the meta skill `SKILL.md`, assert it contains "Agent authority").
- [ ] Run `bun test` and ensure all tests pass.
- [ ] Run `bun run typecheck` and ensure typecheck passes.
