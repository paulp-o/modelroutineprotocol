import { writeFile } from "node:fs/promises";

import { AGENTS_MD_CONTENT } from "../cli/init.ts";
import { syncMetaPrompts } from "../core/meta-prompt.ts";
import { agentsMdPath, findStoreRoot } from "../core/store.ts";
import { errEnvelope, okEnvelope } from "../util/envelope.ts";
import type { Envelope } from "../util/envelope.ts";

export async function handleUpdate(
  _args: string[],
  _flags: Record<string, unknown>,
): Promise<Envelope> {
  const root = await findStoreRoot(process.cwd());
  if (!root) {
    return errEnvelope("update", "STORE_NOT_FOUND", "No MRP store found. Run mrp init first.");
  }

  try {
    await writeFile(agentsMdPath(root), AGENTS_MD_CONTENT, "utf8");
    const metaPromptResults = await syncMetaPrompts(root);

    return okEnvelope("update", {
      updated: ["AGENTS.md"],
      meta_prompts: metaPromptResults.filter((r) => r.action !== "skipped"),
      message: "Store artifacts updated to current MRP version.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return errEnvelope("update", "INTERNAL_ERROR", `Failed to update store artifacts: ${message}`);
  }
}
