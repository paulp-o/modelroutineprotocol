# ⎔ MRP — Model Routine Protocol

> Your AI agent repeats the same tasks every session. MRP lets it remember, systematize, and self-manage them.

`TypeScript` · `Bun` · `15 commands` · `zero network calls` · `Cursor · Claude Code · OpenCode · Windsurf`

---

## What happens when your agent has MRP

Without MRP, your agent writes `bun test` from scratch every session. With MRP:

1. **Agent notices** it's run `bun test` three times this session
2. **Agent creates** a routine: `mrp create --name "test-suite" --goal "Run and verify all tests pass"`
3. **Agent writes** the entrypoint script, **promotes** the routine to active
4. **Next session** — agent discovers the routine as a skill, runs it instead of reinventing
5. **When tests change**, agent edits the routine and commits the change with an audit trail
6. **When a routine fails repeatedly**, agent quarantines it — no more wasted cycles

The agent does all of this. You watch.

> [!TIP]
> Here's what the agent produces — a structured routine with intent, success criteria, and lifecycle state:
> ```yaml
> routine_id: mrp-test-suite-a1b2
> name: test-suite
> goal: Run and verify all tests pass
> state: active
> success_criteria:
>   - id: sc.exit0
>     description: Exit code is 0
>   - id: sc.output
>     description: Test output contains "passed"
> ```

### The aha moment

The agent runs a build. Exit code is 0. But scrolling through the output, it notices 47 deprecation warnings. The shell says "success" — but that's a lie. The agent records the truth:

```bash
mrp judge mrp-build-a1b2 2026-02-19T10:30:00.000Z#0001 \
    --status partial --reason "Build succeeded but 47 deprecation warnings indicate tech debt"
```

Now the ledger shows `status_auto: success` (what the shell claimed) and `status: partial` (what the model decided). Future sessions see this history. The agent knows: this routine "passes" but needs attention.

This is the core insight: **the model is the authority, not the exit code.**

---

## The paradigm

**Agents are amnesic.** Every new session is day one. They rewrite the same scripts, forget what worked, repeat the same mistakes. You teach, they forget, you teach again.

**Exit codes lie.** A build "fails" with exit code 1 but produces a usable artifact. A test "passes" with exit 0 but had deprecation warnings. Only the model understands context. `mrp judge` lets the agent record what *actually* happened, not what the shell claimed.

**Skills that compound.** MRP routines are projected as agent skills. The more the agent works, the more skills it accumulates. It's compound knowledge — not throwaway scripts, but institutional memory that persists across sessions, projects, and teams.

---

## How it works

```
  Agent notices repetition
        │
        ▼
  mrp create (captures intent + success criteria)
        │
        ▼
  mrp run → mrp judge (execute + evaluate honestly)
        │
        ▼
  mrp promote (proven routine becomes active skill)
        │
        ▼
  mrp sync-skills (projected to .cursor/skills/, .claude/skills/, etc.)
        │
        ▼
  Next session: agent discovers skill, reuses it
        │
        ▼
  mrp deprecate / mrp quarantine (self-cleanup when stale or broken)
```

**The lifecycle:** `draft → active → deprecated → archived`, with `quarantine` as emergency brake. Routines that prove themselves get promoted. Ones that fail get quarantined. Automatically. Systematically.

---

## Key concepts

### Routine
A structured, versioned automation with intent, success criteria, and lifecycle state. Not just a script — a script with *accountability*. The agent defines what success means before running, then judges whether it achieved it.

### Judgment
The model's authoritative assessment. Exit codes say "0" or "1". The model says "partial — compiled but had 3 deprecation warnings." That's the truth that gets recorded in the ledger.

### Ledger
Append-only log of every run, edit, and judgment. SHA256 fingerprints prove which script version ran. Immutable history. The agent is accountable for every decision.

### Projection
Routines rendered as skill files in agent harness directories. The bridge between MRP's internal state and the agent's native skill discovery mechanism. One routine becomes a skill in Cursor, Claude Code, OpenCode, and Windsurf simultaneously.

### Discovery
Smart suggestions that nudge the agent: "You created this routine 2 days ago but never ran it." "This routine succeeded 10 times in a row — consider promoting to active." Cooldowns prevent suggestion fatigue.

### Meta-prompt injection
MRP injects guidance into agent config files (`AGENTS.md`, `CLAUDE.md`) reminding the agent to check `mrp list` before reinventing scripts. The meta-prompt lives in the project, not global config — scoped, versioned, removable.

---

## Why not just...

| If your agent needs... | Without MRP | With MRP |
|------------------------|-------------|----------|
| Run tests repeatedly | Reinvents `bun test` every session | Discovers `mrp test-suite` as a skill |
| Handle flaky builds | Exit 1 = failure, no context | Model judges: "network timeout, retry" |
| Track what worked | Scrolling through terminal history | Immutable ledger with SHA256 fingerprints |
| Share knowledge | Slack threads, PR comments | Projected skills in `.cursor/skills/` |
| Clean up old scripts | Manual `scripts/` archaeology | Auto-deprecate after 30 days no runs |

MRP fills a gap that didn't exist until AI agents started operating codebases. If your agent doesn't need audit trails, lifecycle management, or cross-session memory — you don't need MRP.

## For humans

You don't operate MRP. Your agent does. But you can observe:

```bash
$ mrp list                          # What routines exist?
$ mrp show <routine_id>             # What did the agent create? How many runs?
$ mrp list --state quarantine       # What did the agent flag as broken?
```

You can also intervene (rarely needed):

```bash
$ mrp quarantine <id>               # Force-isolate a routine you don't trust
$ mrp archive <id>                  # Remove a routine permanently
$ mrp doctor                        # Fix store corruption
$ mrp prune --older-than 30d        # Clean up old run artifacts
```

These are observability and override commands — not the primary interface. The primary interface is your agent, acting autonomously.

---

## Installation

> [!IMPORTANT]
> MRP requires [Bun](https://bun.sh). Install: `curl -fsSL https://bun.sh/install | bash`

```bash
git clone <repo-url>
cd mrp
bun install
bun run build
mrp init         # Creates .mrp/ and projects meta-skill to detected agent harnesses
```

After `mrp init`, your agent will discover MRP as a skill and start using it autonomously.

<details>
<summary>Run from source</summary>

```bash
bun install
bun mrp <command>  # Use directly without building
```
</details>

<details>
<summary>Compiled binary</summary>

```bash
bun run compile      # Creates dist/mrp executable
./dist/mrp <command>
```
</details>

---

## Commands reference

### Agent workflow (what the agent calls)

| Command | What the agent does |
|---------|---------------------|
| `init` | Initializes the store, detects host harnesses |
| `create` | Captures a repeating task as a new routine |
| `edit` | Inspects/commits changes to routine scripts |
| `run` | Executes a routine and records the outcome |
| `judge` | Overrides exit-code status with model judgment |
| `promote` | Graduates a proven routine from draft to active |
| `sync-skills` | Refreshes skill projections in all detected hosts |

### Lifecycle (agent self-management)

| Command | State transition |
|---------|-----------------|
| `promote` | draft → active (or quarantine → draft via `--from-quarantine`) |
| `demote` | Remove from projected skills |
| `deprecate` | active → deprecated |
| `archive` | deprecated → archived |
| `quarantine` | Emergency isolation of broken routines (any → quarantine) |

### Observability (for humans or agents)

| Command | Purpose |
|---------|---------|
| `show` | View routine definition + run history |
| `list` | List routines with filters (`--state`, `--tag`, `--projected`) |
| `doctor` | Diagnose and repair store issues (`--rebuild-index`) |
| `update` | Update store artifacts to current version |
| `prune` | Clean up old run artifacts (`--older-than`, `--keep-last`, `--dry-run`) |

**Create flags:** `--name` (required), `--goal` (required), `--non-goals` (repeatable), `--success-criteria "id:text"` (repeatable), `--tags`, `--entrypoint-type sh|ts|py`

**Run flags:** `--timeout-sec`, `--force`, `--no-artifacts`

---

## Output format

All MRP output is structured YAML so agents can parse it reliably.

**Success:**
```yaml
ok: true
command: run
ts: "2026-02-19T14:30:00.000Z"
data: { ... }
```

**Error:**
```yaml
ok: false
command: run
ts: "2026-02-19T14:30:00.000Z"
error:
  code: ROUTINE_NOT_RUNNABLE
  message: "Routine is in draft state. Promote before running."
```

**Exit codes:**
| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | User error |
| `2` | Internal error |

---

## Agent harness integration

When `mrp sync-skills` runs, routines become discoverable skills. The agent finds them via its native skill discovery mechanism.

```
                    mrp sync-skills
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
  .cursor/skills/  .claude/skills/  .opencode/skills/
                                    .windsurf/skills/
```

<details>
<summary>Cursor</summary>

- **Directory:** `.cursor/skills/`
- **Meta:** `.cursor/skills/mrp/SKILL.md`
- **Per-routine:** `.cursor/skills/mrp-<name>/SKILL.md`
</details>

<details>
<summary>Claude Code</summary>

- **Directory:** `.claude/skills/`
- **Meta:** `.claude/skills/mrp/SKILL.md`
- **Per-routine:** `.claude/skills/mrp-<name>/SKILL.md`
</details>

<details>
<summary>OpenCode</summary>

- **Directory:** `.opencode/skills/`
- **Meta:** `.opencode/skills/mrp/SKILL.md`
- **Per-routine:** `.opencode/skills/mrp-<name>/SKILL.md`
</details>

<details>
<summary>Windsurf</summary>

- **Directory:** `.windsurf/skills/`
- **Meta:** `.windsurf/skills/mrp/SKILL.md`
- **Per-routine:** `.windsurf/skills/mrp-<name>/SKILL.md`
</details>

> [!WARNING]
> MRP never modifies `.cursorrules`, root `CLAUDE.md`, or `.windsurfrules`. Skills are scoped and removable. Never touches global config.

---

## Store layout

```
.mrp/
├── config.yaml           # Store config (commit ✓)
├── version.yaml          # Store version (commit ✓)
├── AGENTS.md             # Agent guidance (commit ✓)
├── index.yaml            # Derived index (gitignore)
├── discovery_state.yaml  # Discovery state (gitignore)
├── locks/                # Process locks (gitignore)
├── projections/          # Projection state (gitignore)
└── routines/
    └── mrp-<name>-<hash>/
        ├── routine.yaml    # Definition (commit ✓)
        ├── rationale.md    # Design rationale (commit ✓)
        ├── run.sh          # Entrypoint (commit ✓)
        ├── verify.sh       # Verifier (commit ✓)
        ├── ledger.yaml     # History (gitignore)
        ├── edit_session.yaml (gitignore)
        ├── routine.lock    # Lock (gitignore)
        └── runs/
            └── <run_id>/
                ├── stdout.txt (gitignore)
                └── stderr.txt (gitignore)
```

> [!NOTE]
> `index.yaml` is derived state — auto-rebuilt from `routines/*/routine.yaml`. Commit the source; ignore the cache.

---

## Design principles

### 🧠 Model-driven judgment
The agent decides what "success" means, not the exit code. `mrp judge` records the authoritative assessment.

### 📁 Local-first
No network, no accounts, no external dependencies. The agent's memory stays in the repo, versioned with the code.

### 🔄 Self-governing lifecycle
Routines that prove themselves get promoted. Ones that fail get quarantined. No manual bookkeeping. The system cleans up after itself.

### 📜 Immutable audit trail
Every run fingerprinted. Every judgment recorded. The agent is accountable for every decision.

### 🔮 Skills projection
Routines become discoverable skills. The agent builds its own toolkit, session by session.

### 🎯 Smart discovery
MRP nudges the agent toward routines it should run. Recency, cooldown, rate limits — the right suggestion at the right time.

---

## Development

```bash
bun test           # Run tests
bun run typecheck  # Type check
bun run build      # Build bundle
bun run compile    # Compile executable
```

**Tech stack:** TypeScript · Bun · yaml (eemeli/yaml v2+) · zod v4

**Repository structure:**
```
src/
├── cli/               # CLI command handlers (init, create, run, judge, ...)
├── core/              # Store, executor, projection, lifecycle, discovery, ledger
├── schema/            # Zod schemas (routine, outcome, config, ledger)
├── util/              # YAML I/O, file locking, merge utilities
└── index.ts           # CLI entry point
```

---

## License

License pending. Not yet declared.

---

*Your agent builds. MRP remembers.*
