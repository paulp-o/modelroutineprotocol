#!/usr/bin/env bun
import { join } from "node:path";

import { handleArchive } from "./cli/archive.ts";
import { handleCreate } from "./cli/create.ts";
import { handleDemote } from "./cli/demote.ts";
import { handleDeprecate } from "./cli/deprecate.ts";
import { handleDoctor } from "./cli/doctor.ts";
import { handleEdit } from "./cli/edit.ts";
import { handleInit } from "./cli/init.ts";
import { handleJudge } from "./cli/judge.ts";
import { renderCommandHelp, renderGlobalHelp } from "./cli/help.ts";
import { handleList } from "./cli/list.ts";
import { handlePrune } from "./cli/prune.ts";
import { handlePromote } from "./cli/promote.ts";
import { handleQuarantine } from "./cli/quarantine.ts";
import { handleRun } from "./cli/run.ts";
import { handleShow } from "./cli/show.ts";
import { handleSyncSkills } from "./cli/sync-skills.ts";
import { handleUpdate } from "./cli/update.ts";
import { readIndex } from "./core/index.ts";
import { MUTATING_COMMANDS } from "./core/lifecycle.ts";
import { syncSkills } from "./core/projection.ts";
import { configPath, findStoreRoot, ledgerPath, routineDir } from "./core/store.ts";
import { checkProjectionAutoSuggest, generateDiscoveryFooter } from "./core/discovery.ts";
import { readLedger } from "./core/ledger.ts";
import { parseConfig } from "./schema/config.ts";
import { parseRoutine, type Routine } from "./schema/routine.ts";
import { errEnvelope, exitCodeFor, printEnvelope, type Envelope } from "./util/envelope.ts";
import { readYamlFile } from "./util/yaml-io.ts";

type CommandHandler = (args: string[], flags: Record<string, unknown>) => Promise<Envelope>;

type EnvelopeWithDiscovery = Envelope & {
  discovery?: unknown;
};

const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  init: handleInit,
  create: handleCreate,
  show: handleShow,
  list: handleList,
  edit: handleEdit,
  judge: handleJudge,
  run: handleRun,
  promote: handlePromote,
  demote: handleDemote,
  deprecate: handleDeprecate,
  archive: handleArchive,
  quarantine: handleQuarantine,
  "sync-skills": handleSyncSkills,
  update: handleUpdate,
  doctor: handleDoctor,
  prune: handlePrune,
};

const COMMANDS = Object.keys(COMMAND_HANDLERS);

async function loadStoreContext(): Promise<{
  root: string;
  config: ReturnType<typeof parseConfig>;
  index: Awaited<ReturnType<typeof readIndex>>;
} | null> {
  try {
    const root = await findStoreRoot(process.cwd());
    const config = parseConfig(await readYamlFile<unknown>(configPath(root)));
    const index = await readIndex(root);
    return { root, config, index };
  } catch {
    return null;
  }
}

async function buildProjectedRoutinesMap(
  root: string,
  index: Awaited<ReturnType<typeof readIndex>>,
): Promise<Map<string, Routine>> {
  const routines = new Map<string, Routine>();

  for (const entry of index.routines) {
    if (!entry.projected) {
      continue;
    }

    const routine = parseRoutine(
      await readYamlFile<unknown>(join(routineDir(root, entry.id), "routine.yaml")),
    );
    routines.set(entry.id, routine);
  }

  return routines;
}

async function attachAutoSync(envelope: Envelope, commandName: string): Promise<void> {
  if (!envelope.ok || !MUTATING_COMMANDS.has(commandName)) {
    return;
  }

  try {
    const context = await loadStoreContext();
    if (!context) {
      return;
    }

    const projectedRoutines = await buildProjectedRoutinesMap(context.root, context.index);
    const syncResult = await syncSkills({
      root: context.root,
      config: context.config,
      index: context.index,
      routines: projectedRoutines,
    });

    envelope.data.sync = syncResult;
  } catch {
    // best effort middleware: ignore sync failures
  }
}

async function attachProjectionAutoSuggest(
  envelope: Envelope,
  commandName: string,
  commandArgs: string[],
): Promise<void> {
  if (!envelope.ok || commandName !== "run") {
    return;
  }

  try {
    const context = await loadStoreContext();
    if (!context) {
      return;
    }

    const outcome = envelope.data.outcome;
    const routineIdFromOutcome =
      outcome && typeof outcome === "object" && "routine_id" in outcome
        ? (outcome as { routine_id?: unknown }).routine_id
        : undefined;

    const routineId =
      typeof routineIdFromOutcome === "string"
        ? routineIdFromOutcome
        : typeof commandArgs[0] === "string"
          ? commandArgs[0]
          : undefined;

    if (!routineId) {
      return;
    }

    const routine = parseRoutine(
      await readYamlFile<unknown>(join(routineDir(context.root, routineId), "routine.yaml")),
    );
    const ledger = await readLedger(ledgerPath(context.root, routineId));

    const suggestion = checkProjectionAutoSuggest({
      routine,
      ledger,
      config: context.config,
      now: new Date(),
    });

    if (suggestion) {
      envelope.data.projection_suggestion = suggestion;
    }
  } catch {
    // best effort middleware: ignore suggestion failures
  }
}

async function attachDiscoveryFooter(envelope: Envelope, commandName: string): Promise<void> {
  if (!envelope.ok) {
    return;
  }

  try {
    const context = await loadStoreContext();
    if (!context) {
      return;
    }

    const footer = await generateDiscoveryFooter({
      root: context.root,
      commandName,
      isMutating: MUTATING_COMMANDS.has(commandName),
      config: context.config,
      index: context.index,
    });

    if (footer) {
      (envelope as EnvelopeWithDiscovery).discovery = footer.discovery;
    }
  } catch {
    // best effort middleware: ignore discovery failures
  }
}

/**
 * Manually parse CLI args to properly handle --flag value pairs.
 * parseArgs with strict:false doesn't know which flags take values,
 * so --name "Build verify" is misinterpreted. This parser handles:
 * - --flag=value (inline value)
 * - --flag value (next-arg value, unless next arg starts with --)
 * - --flag (boolean, when next arg starts with -- or is absent)
 * - positional args
 * - -- separator for passthrough args
 */
function parseCliArgs(argv: string[]): {
  positionals: string[];
  flags: Record<string, unknown>;
  passthrough: string[];
} {
  const positionals: string[] = [];
  const flags: Record<string, unknown> = {};
  const passthrough: string[] = [];
  let i = 0;
  let hitSeparator = false;

  // Known boolean-only flags (no value expected)
  const BOOLEAN_FLAGS = new Set([
    "help",
    "force", "dry-run", "dryRun", "commit", "projected",
    "include-archived", "includeArchived", "no-artifacts", "noArtifacts",
    "rebuild-index", "rebuildIndex", "from-quarantine", "fromQuarantine",
  ]);

  while (i < argv.length) {
    const arg = argv[i]!;

    if (arg === "--") {
      hitSeparator = true;
      i++;
      break;
    }

    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        // --flag=value
        const key = arg.slice(2, eqIdx);
        const val = arg.slice(eqIdx + 1);
        appendFlag(flags, key, val);
      } else {
        const key = arg.slice(2);
        if (BOOLEAN_FLAGS.has(key)) {
          flags[key] = true;
        } else if (i + 1 < argv.length && !argv[i + 1]!.startsWith("--")) {
          // --flag value
          appendFlag(flags, key, argv[i + 1]!);
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positionals.push(arg);
    }

    i++;
  }

  // Collect passthrough args after --
  if (hitSeparator) {
    while (i < argv.length) {
      passthrough.push(argv[i]!);
      i++;
    }
  }

  return { positionals, flags, passthrough };
}

function appendFlag(flags: Record<string, unknown>, key: string, value: string): void {
  const existing = flags[key];
  if (existing === undefined) {
    flags[key] = value;
  } else if (Array.isArray(existing)) {
    existing.push(value);
  } else {
    flags[key] = [existing, value];
  }
}

async function main(): Promise<Envelope> {
  const argv = typeof Bun !== "undefined" ? Bun.argv.slice(2) : process.argv.slice(2);
  const { positionals, flags, passthrough } = parseCliArgs(argv);

  // Store passthrough args in flags for run command
  if (passthrough.length > 0) {
    flags["--"] = passthrough;
  }

  const helpRequested = flags.help === true;
  if (helpRequested) {
    const helpCommandName = positionals[0];
    if (!helpCommandName) {
      return renderGlobalHelp();
    }
    return renderCommandHelp(helpCommandName);
  }

  const commandName = positionals[0];
  if (!commandName) {
    return renderGlobalHelp();
  }

  const handler = COMMAND_HANDLERS[commandName];
  if (!handler) {
    return errEnvelope("mrp", "UNKNOWN_COMMAND", `Unknown command: ${commandName}`);
  }

  const commandArgs = positionals.slice(1);

  const envelope = await handler(commandArgs, flags);
  if (envelope.ok) {
    await attachAutoSync(envelope, commandName);
    await attachProjectionAutoSuggest(envelope, commandName, commandArgs);
    await attachDiscoveryFooter(envelope, commandName);
  }

  return envelope;
}

async function runCli(): Promise<void> {
  try {
    const envelope = await main();
    printEnvelope(envelope);
    process.exit(exitCodeFor(envelope));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const envelope = errEnvelope("mrp", "INTERNAL_ERROR", message);
    printEnvelope(envelope);
    process.exit(2);
  }
}

await runCli();
