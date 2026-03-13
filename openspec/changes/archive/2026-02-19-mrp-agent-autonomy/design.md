## Context
- MRP is a local TS+Bun CLI. All output is YAML envelope. Append-only ledger tracks runs.
- Current problems: (1) agents aren't told to act autonomously, (2) script edits are untracked, (3) exit code rigidly determines success/failure
- Existing architecture: executor spawns scripts, verifier determines status from exit code, outcome written to ledger

## Goals / Non-Goals
Goals:
- Grant agents explicit autonomy to create/modify/evolve routines without permission
- Track entrypoint script fingerprints so edits between runs are visible
- Decouple "auto status" (exit code signal) from "authoritative status" (model judgment)
- Add `mrp judge` command for post-run model assessment
- Update meta skill + AGENTS.md with autonomy + judgment workflow guidance

Non-Goals:
- Script version history or diff tracking (future)
- Forced "pending_review" default mode (can add config later)
- `mrp edit-script` command (direct editing + fingerprint tracking is sufficient)
- Changing the YAML envelope format or existing exit codes
- Interactive prompts or approval workflows

## Decisions

1. **Backwards-compatible override model for judgment**
   - `mrp run` continues to auto-determine status from exit code as `status_auto`
   - `status` field = authoritative. Initially set to `status_auto` value. Updated via `mrp judge`.
   - Rationale: Non-breaking. Existing behavior preserved. Model can override when needed.
   - Alternative: Default to `pending_review` → rejected (breaking, forces judgment on every run)

2. **`mrp judge` as standalone command (not inline with run)**
   - CLI: `mrp judge <routine_id> <run_id> --status success|failure|partial [--reason "..."]`
   - Model runs routine, reads artifacts, THEN judges in a separate step
   - Rationale: Model needs to SEE the output before judging. Inline `--judge` on `mrp run` would require predicting the outcome.
   - Alternative: `mrp run --judge` → rejected (model hasn't seen output yet when command starts)

3. **Script fingerprinting via sha256 hash at execution time**
   - On `mrp run`, compute sha256 of entrypoint script and record in outcome as `execution_snapshot.entrypoint_hash`
   - Also record `execution_snapshot.entrypoint_path` and `execution_snapshot.entrypoint_size`
   - On subsequent runs, if hash differs from previous run's hash, include `script_changed: true` in outcome
   - Rationale: Minimal tracking that makes script changes visible without full version history
   - Alternative: Audit log per-routine → rejected (overkill for v0.1, hash-in-outcome sufficient)

4. **New `judgment` object in outcome/ledger run entries**
   - Schema: `{ status: string, reason?: string, judged_at: string }`
   - Added to each ledger run entry when `mrp judge` is called
   - `status` at run level updated to match judgment status
   - `status_auto` preserves original exit-code-derived status as provenance
   - Rationale: Clean separation of machine signal vs model assessment

5. **Agent autonomy via meta skill content (primary) + AGENTS.md (secondary)**
   - Meta skill gets a "## Agent authority" section explicitly granting:
     - Free routine creation/modification/evolution
     - Direct script editing (tracked via fingerprints)
     - Post-run judgment responsibility
   - AGENTS.md gets matching language
   - Rationale: Meta skill is what agents see in harness. AGENTS.md is fallback for browsing.
   - Alternative: Per-routine autonomy flags → rejected (too granular, agents need blanket authority)

6. **`partial` as a third judgment status**
   - Allow `--status partial` alongside success/failure
   - Captures "mostly worked but with caveats" — common in real usage
   - Rationale: Binary success/failure doesn't capture nuance the user described
   - Maps to exit code 0 in envelope (not an error)

7. **Model-native edit flow (inspect + direct edit + commit)**
   - `mrp edit <routine_id>` outputs routine context (including `routine.yaml`, entrypoint scripts, and fingerprints) and writes an `edit_session.yaml` baseline
   - The model edits `.mrp` routine files directly using its native file editing tools
   - `mrp edit <routine_id> --commit --intent "..."` diffs fingerprints and records an `EditEvent` in the routine ledger
   - Rationale: Models frequently ignore "never edit directly" rules. Instead of fighting this, we make direct editing the supported path and add an audit trail.
   - Alternative: Keep YAML patch via stdin -> rejected (models cannot realistically patch shell scripts; UX is poor and error-prone)

8. **Separate `edits[]` array in ledger (not a union with runs)**
   - Ledger gains an optional `edits` array of `EditEvent` entries
   - Rationale: Keeps existing `runs` consumers working. Edit events are structurally different from run outcomes.
   - Alternative: Single `events[]` union -> rejected (too much refactoring for v0.1)

## Agent-Facing Messaging Updates

- Remove "source of truth" / "never edit `.mrp/*` directly" language.
- Replace with: agents own `.mrp` routine files, and SHOULD use `mrp edit <id>` (inspect) + direct edits + `mrp edit <id> --commit` to keep an audit trail.
- Keep existing guidance to prefer CLI commands for structured updates where available (to avoid corrupting `routine.yaml` / `ledger.yaml`).

## Risks / Trade-offs

- Models may over-judge as "success" to avoid appearing broken → Meta skill should instruct honest assessment. The routine's success criteria provide a rubric.
- `status_auto` and `status` divergence could confuse consumers of `mrp list` → Always show authoritative `status`; `status_auto` is only visible in `mrp show` detail view.
- Script fingerprinting adds sha256 computation per run → Negligible cost for local scripts (< 1ms).
- Adding `judgment` to ledger increases ledger size → Minimal (one optional object per run).
- Agents may not call `mrp judge` after every run → That's fine. Auto status remains as default. Judgment is opt-in improvement, not required.
