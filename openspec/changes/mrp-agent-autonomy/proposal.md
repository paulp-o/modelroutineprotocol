## Why

MRP's agent-facing prompts describe commands but never grant autonomy — models ask "should I create a routine?" instead of acting. Entrypoint script edits (run.sh) are invisible to MRP (no hash, no audit). And success/failure is rigidly determined by exit codes, when in practice the model using MRP has the context to judge whether a routine truly succeeded or not. These three gaps undermine the "agent-first" promise: agents should own routine lifecycle end-to-end.

## What Changes

- Add explicit autonomy language to the projected meta skill and AGENTS.md, instructing agents to freely create, modify, run, and evolve routines without asking permission.
- Redesign `mrp edit` from YAML-patch-via-stdin to an inspect + direct-edit + commit flow. Models edit `.mrp` routine files directly; `mrp edit` provides context and records an audit trail.
- Track entrypoint script fingerprints (sha256 hash + mtime) in run outcomes so script changes between runs are visible, not invisible.
- Separate "auto status" (exit-code-derived signal) from "authoritative status" (model judgment) in the outcome model. Exit codes become informational data, not the final word.
- Add `mrp judge` command so the model can override the auto-determined status with its own assessment after reviewing stdout/stderr artifacts and applying contextual reasoning.
- Update the meta skill to instruct agents on the judge-after-run workflow: run → read output → judge success based on the routine's actual goals.

## Capabilities

### New Capabilities
- `mrp-judge`: Post-run model-driven judgment command. The model reads run artifacts and records its own success/failure assessment with optional reasoning, overriding the auto-determined exit-code status.
- `mrp-script-tracking`: Entrypoint script fingerprinting. Each run outcome records the sha256 hash of the entrypoint script at execution time, making script changes between runs visible in the ledger.

### Modified Capabilities
- `mrp-projection`: Meta skill and routine wrapper content updated with agent autonomy instructions and judge-after-run guidance.
- `mrp-store`: AGENTS.md content updated with autonomy language, script editing guidance, and judgment workflow.
- `mrp-edit`: Edit command redesigned for a model-native workflow (inspect + direct edit + commit) with audit trail.
- `mrp-execution`: Outcome model extended with `status_auto` (exit-code signal), `judgment` (model assessment), and `execution_snapshot` (script fingerprint). Existing `status` field becomes the authoritative status — initially set from exit code, updatable via `mrp judge`.
- `mrp-cli`: New `judge` command added to router. Help definitions updated.

## Impact

- Outcome schema changes: `status_auto`, `judgment`, `execution_snapshot` fields added. Backwards-compatible (all optional/additive).
- Ledger schema: run entries gain new optional fields. Existing ledgers remain valid.
- Index: `last_run_status` reflects judged status when available, auto status otherwise.
- Agent-facing text: meta skill, AGENTS.md, and routine wrapper SKILL.md content changes. Requires `mrp sync-skills` to propagate.
- New CLI command: `mrp judge <routine_id> <run_id> --status <status> [--reason "..."]`.
- No breaking changes to existing commands or envelope format.
