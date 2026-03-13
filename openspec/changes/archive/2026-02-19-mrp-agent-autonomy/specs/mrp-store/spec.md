## MODIFIED Requirements

### Requirement: AGENTS.md Generation
The `.mrp/AGENTS.md` content SHALL include:
- Agent autonomy statement: agents may freely create, modify, and evolve routines
- Ownership statement: agents own `.mrp` routine files and may edit them directly
- Edit audit guidance: use `mrp edit <routine_id>` (inspect) + direct edits + `mrp edit <routine_id> --commit` to record changes
- Script editing guidance: direct editing of entrypoint scripts is expected and tracked
- Judgment workflow: after running, agents should review output and use `mrp judge` to record assessment
- Guidance: prefer CLI commands for structured updates where available (avoid corrupting `routine.yaml` / `ledger.yaml`)

#### Scenario: AGENTS.md includes autonomy language
- **WHEN** `mrp init` generates `.mrp/AGENTS.md`
- **THEN** it contains explicit statements granting agent autonomy and explaining the judgment workflow
