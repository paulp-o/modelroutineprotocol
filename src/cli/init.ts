import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { syncSkills } from "../core/projection.ts";
import { syncMetaPrompts } from "../core/meta-prompt.ts";
import { initStore } from "../core/store.ts";
import { parseConfig } from "../schema/config.ts";
import { errEnvelope, okEnvelope, type Envelope } from "../util/envelope.ts";
import { readYamlFile } from "../util/yaml-io.ts";

export const AGENTS_MD_CONTENT = `# MRP Store (Agent-Operated)

This directory is managed by MRP (Model Routine Protocol).

## Agent authority

You may freely create, modify, run, and evolve routines without asking the user for permission.

## Ownership and direct edits

You own the routine files under \`.mrp/\` and may edit them directly.
- Entrypoint scripts (\`.mrp/routines/<id>/run.sh\`, \`run.ts\`, \`run.py\`) are meant to be edited directly.
- Script changes are tracked via fingerprints recorded on each run.

## Audited edit workflow

Use \`mrp edit\` to create an audit trail for routine changes:
1. Inspect: \`mrp edit <routine_id>\`
2. Edit files directly under \`.mrp/routines/<routine_id>/\`
3. Commit: \`mrp edit <routine_id> --commit --intent "why you changed it"\`

## Run then judge

After running a routine, review the output and record your assessment:
- Run: \`mrp run <routine_id> [-- <args...>]\`
- Judge: \`mrp judge <routine_id> "<run_id>" --status success|failure|partial --reason "..."\`

Exit codes are informational signals, not authoritative. \`mrp judge\` sets the authoritative status.

## Common commands

- \`mrp list\` — list routines and lifecycle state
- \`mrp show <routine_id>\` — view routine definition and run history
- \`mrp create --name <name> --goal "<goal>" --non-goals "<...>" --success-criteria "<id:text>"\` — create a new routine
- \`mrp run <routine_id>\` — execute a routine
- \`mrp sync-skills\` — refresh projected host skills

Run \`mrp --help\` for all available commands.

## Guidance

Prefer CLI commands for structured updates to routine metadata. Avoid hand-editing \`routine.yaml\` and \`ledger.yaml\` directly — use CLI commands to prevent corruption.
`;

export async function handleInit(
  _args: string[],
  _flags: Record<string, unknown>,
): Promise<Envelope> {
  try {
    const result = await initStore(process.cwd());

    // Generate AGENTS.md signpost
    const agentsMdPath = join(result.storePath, "AGENTS.md");
    await writeFile(agentsMdPath, AGENTS_MD_CONTENT, "utf8");

    // Best-effort: inject MRP meta-prompt into project-level agent config files
    try {
      await syncMetaPrompts(process.cwd());
    } catch {
      // Non-fatal: meta-prompt sync failure doesn't invalidate init
    }

    // Auto-sync: project meta skill to detected hosts
    let syncResult = null;
    try {
      const rawConfig = await readYamlFile<unknown>(result.configPath);
      const config = parseConfig(rawConfig);
      syncResult = await syncSkills({
        root: process.cwd(),
        config,
        index: { routines: [] },
        routines: new Map(),
      });
    } catch {
      // Non-fatal: sync failure doesn't invalidate init
    }

    return okEnvelope("init", {
      store_path: result.storePath,
      config_path: result.configPath,
      detected_hosts: result.detectedHosts,
      agents_md: agentsMdPath,
      ...(syncResult ? { sync: syncResult } : {}),
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      const code = String((error as { code?: string }).code);
      if (code === "STORE_ALREADY_EXISTS") {
        const path = String((error as { message?: string }).message ?? "").replace(
          /^Store already exists at\s*/,
          "",
        );

        return errEnvelope("init", "STORE_ALREADY_EXISTS", `Store already exists at ${path}`);
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    return errEnvelope("init", "INTERNAL_ERROR", message);
  }
}
