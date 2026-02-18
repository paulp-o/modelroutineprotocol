import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { syncSkills } from "../core/projection.ts";
import { initStore } from "../core/store.ts";
import { parseConfig } from "../schema/config.ts";
import { errEnvelope, okEnvelope, type Envelope } from "../util/envelope.ts";
import { readYamlFile } from "../util/yaml-io.ts";

const AGENTS_MD_CONTENT = `# MRP Store

This directory is managed by [MRP](https://github.com/modelroutineprotocol/mrp) (Model Routine Protocol).

## How to interact

Use the MRP CLI — do not edit files in this directory manually.

- \`mrp list\` — list all routines and their states
- \`mrp show <routine_id>\` — view a routine's full definition
- \`mrp run <routine_id>\` — execute a routine

Run \`mrp --help\` for all available commands.

## Warning

Do not edit, move, or delete files in \`.mrp/\` directly. Use MRP CLI commands to manage routines and store state. Manual edits may corrupt the store.
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
