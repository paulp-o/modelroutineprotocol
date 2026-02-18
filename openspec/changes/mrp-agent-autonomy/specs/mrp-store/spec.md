## MODIFIED Requirements

### Requirement: AGENTS.md Generation
The `.mrp/AGENTS.md` content SHALL include:
- Agent autonomy statement: agents may freely create, modify, and evolve routines
- Script editing guidance: direct editing of entrypoint scripts is expected and tracked
- Judgment workflow: after running, agents should review output and use `mrp judge` to record assessment
- Warning against editing routine.yaml or ledger.yaml directly (use CLI)

#### Scenario: AGENTS.md includes autonomy language
- **WHEN** `mrp init` generates `.mrp/AGENTS.md`
- **THEN** it contains explicit statements granting agent autonomy and explaining the judgment workflow
