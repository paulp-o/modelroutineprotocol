## MODIFIED Requirements

### Requirement: Meta Skill
The meta skill SKILL.md body SHALL include an "Agent authority" section that explicitly:
- Grants agents blanket authority to create, modify, run, and evolve routines without asking user permission
- Instructs agents to edit entrypoint scripts directly when needed (changes are tracked via fingerprints)
- Instructs agents to judge run outcomes after reviewing artifacts: run -> read output -> `mrp judge` to record assessment
- Clarifies that exit codes are informational signals, not authoritative success/failure

#### Scenario: Meta skill includes autonomy instructions
- **WHEN** the meta skill SKILL.md is read
- **THEN** it contains an "Agent authority" section instructing agents to freely create/modify routines and judge run outcomes

### Requirement: Projected Skill Wrapper Content
A projected skill SKILL.md body SHALL include a brief note that the model should judge success after running, referencing `mrp judge`.

#### Scenario: Wrapper mentions judgment
- **WHEN** a routine skill wrapper is read
- **THEN** it contains a note about using `mrp judge` to record the model's assessment after running
