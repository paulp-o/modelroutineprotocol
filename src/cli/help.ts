import { errEnvelope, okEnvelope, type Envelope } from "../util/envelope.ts";

type HelpFlagType = "boolean" | "string" | "repeatable";

type HelpFlag = {
  name: string;
  type: HelpFlagType;
  required: boolean;
  description: string;
};

type HelpCommand = {
  command: string;
  description: string;
  usage: string;
  flags: HelpFlag[];
  examples: string[];
};

export const HELP_COMMANDS: Record<string, HelpCommand> = {
  init: {
    command: "init",
    description: "Initialize a new MRP store in the current directory",
    usage: "mrp init",
    flags: [],
    examples: ["mrp init"],
  },
  create: {
    command: "create",
    description: "Create a new routine",
    usage: "mrp create --name <name> --goal <goal> [flags]",
    flags: [
      { name: "--name", type: "string", required: true, description: "Routine name" },
      { name: "--goal", type: "string", required: true, description: "Routine goal" },
      {
        name: "--non-goals",
        type: "repeatable",
        required: false,
        description: "Non-goal statement",
      },
      {
        name: "--success-criteria",
        type: "repeatable",
        required: false,
        description: "Success criterion in id:text format",
      },
      {
        name: "--entrypoint-type",
        type: "string",
        required: false,
        description: "Entrypoint type",
      },
      {
        name: "--description",
        type: "string",
        required: false,
        description: "Routine description",
      },
      { name: "--tags", type: "repeatable", required: false, description: "Routine tag" },
    ],
    examples: ["mrp create --name \"Build verify\" --goal \"Ensure build succeeds\""],
  },
  show: {
    command: "show",
    description: "Show full routine definition and ledger summary",
    usage: "mrp show <routine_id>",
    flags: [],
    examples: ["mrp show mrp-build-verify-a1b2"],
  },
  list: {
    command: "list",
    description: "List routines with optional filters",
    usage: "mrp list [flags]",
    flags: [
      { name: "--state", type: "repeatable", required: false, description: "Filter by state" },
      { name: "--tag", type: "repeatable", required: false, description: "Filter by tag" },
      {
        name: "--projected",
        type: "boolean",
        required: false,
        description: "Only include projected routines",
      },
      {
        name: "--include-archived",
        type: "boolean",
        required: false,
        description: "Include archived routines",
      },
      { name: "--sort", type: "string", required: false, description: "Sort order" },
      { name: "--limit", type: "string", required: false, description: "Maximum results" },
    ],
    examples: ["mrp list", "mrp list --state active --tag smoke"],
  },
  edit: {
    command: "edit",
    description: "Inspect routine context for editing, or commit tracked file changes with an audit trail.",
    usage: "mrp edit <routine_id> [--commit] [--intent \"<intent>\"]",
    flags: [
      {
        name: "--commit",
        type: "boolean",
        required: false,
        description: "Commit mode: diff tracked files and record an EditEvent in the ledger",
      },
      {
        name: "--intent",
        type: "string",
        required: false,
        description: "Description of the edit intent (used with --commit)",
      },
    ],
    examples: ["mrp edit mrp-build-a1b2", "mrp edit mrp-build-a1b2 --commit --intent \"fix flaky build step\""],
  },
  judge: {
    command: "judge",
    description: "Record model judgment on a completed run, overriding the auto-determined status.",
    usage: "mrp judge <routine_id> <run_id> --status <status> [--reason \"<reason>\"]",
    flags: [
      { name: "--status", type: "string", required: true, description: "Judged status: success, failure, or partial" },
      { name: "--reason", type: "string", required: false, description: "Reason for the judgment" },
    ],
    examples: [
      "mrp judge mrp-build-a1b2 \"2026-01-15T10:30:45Z#0001\" --status success --reason \"warnings only, build artifact produced\"",
      "mrp judge mrp-test-c3d4 \"2026-01-15T11:00:00Z#0001\" --status partial --reason \"1 flaky test, main changes verified\"",
    ],
  },
  run: {
    command: "run",
    description: "Execute a routine's entrypoint",
    usage: "mrp run <routine_id> [flags] [-- passthrough...]",
    flags: [
      {
        name: "--timeout-sec",
        type: "string",
        required: false,
        description: "Execution timeout in seconds",
      },
      { name: "--force", type: "boolean", required: false, description: "Force execution" },
      {
        name: "--no-artifacts",
        type: "boolean",
        required: false,
        description: "Skip artifact persistence",
      },
    ],
    examples: ["mrp run mrp-build-a1b2", "mrp run mrp-build-a1b2 --timeout-sec 120"],
  },
  promote: {
    command: "promote",
    description: "Promote routine to next lifecycle state",
    usage: "mrp promote <routine_id> [flags]",
    flags: [
      {
        name: "--from-quarantine",
        type: "boolean",
        required: false,
        description: "Allow promotion from quarantine",
      },
    ],
    examples: ["mrp promote mrp-build-a1b2"],
  },
  demote: {
    command: "demote",
    description: "Demote routine to previous lifecycle state",
    usage: "mrp demote <routine_id>",
    flags: [],
    examples: ["mrp demote mrp-build-a1b2"],
  },
  deprecate: {
    command: "deprecate",
    description: "Mark routine as deprecated",
    usage: "mrp deprecate <routine_id>",
    flags: [],
    examples: ["mrp deprecate mrp-build-a1b2"],
  },
  archive: {
    command: "archive",
    description: "Archive a deprecated routine",
    usage: "mrp archive <routine_id>",
    flags: [],
    examples: ["mrp archive mrp-build-a1b2"],
  },
  quarantine: {
    command: "quarantine",
    description: "Quarantine a routine (from any state)",
    usage: "mrp quarantine <routine_id>",
    flags: [],
    examples: ["mrp quarantine mrp-build-a1b2"],
  },
  "sync-skills": {
    command: "sync-skills",
    description: "Project routines to detected host skill directories",
    usage: "mrp sync-skills",
    flags: [],
    examples: ["mrp sync-skills"],
  },
  update: {
    command: "update",
    description: "Update store artifacts (e.g. AGENTS.md) to the current MRP version.",
    usage: "mrp update",
    flags: [],
    examples: ["mrp update"],
  },
  doctor: {
    command: "doctor",
    description: "Run health checks on the MRP store",
    usage: "mrp doctor [flags]",
    flags: [
      {
        name: "--rebuild-index",
        type: "boolean",
        required: false,
        description: "Rebuild index before checks",
      },
    ],
    examples: ["mrp doctor", "mrp doctor --rebuild-index"],
  },
  prune: {
    command: "prune",
    description: "Remove old run artifacts",
    usage: "mrp prune [flags]",
    flags: [
      {
        name: "--routine",
        type: "string",
        required: false,
        description: "Prune artifacts for a single routine",
      },
      {
        name: "--older-than",
        type: "string",
        required: false,
        description: "Age threshold duration",
      },
      {
        name: "--keep-last",
        type: "string",
        required: false,
        description: "Keep this many recent runs",
      },
      {
        name: "--dry-run",
        type: "boolean",
        required: false,
        description: "Show what would be removed",
      },
    ],
    examples: ["mrp prune --routine mrp-build-a1b2 --keep-last 5"],
  },
};

export function renderGlobalHelp(): Envelope {
  const commands = Object.values(HELP_COMMANDS).map((help) => ({
    command: help.command,
    description: help.description,
  }));
  return okEnvelope("help", { commands });
}

export function renderCommandHelp(command: string): Envelope {
  const help = HELP_COMMANDS[command];
  if (!help) {
    return errEnvelope("help", "UNKNOWN_COMMAND", `Unknown command: ${command}`);
  }
  return okEnvelope("help", { ...help });
}
