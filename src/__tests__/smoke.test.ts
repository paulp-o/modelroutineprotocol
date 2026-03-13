import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import YAML from "yaml";

type MRPResult = {
  ok: boolean;
  command: string;
  data?: any;
  error?: any;
  discovery?: any;
  exitCode: number;
};

const CLI_ENTRY = join(import.meta.dir, "..", "index.ts");

function deterministicEntrypointScript(): string {
  return `#!/usr/bin/env bash
set -euo pipefail
echo "Build succeeded"
exit 0
`;
}

function toResult(args: string[], exitCode: number, stdout: string, stderr: string): MRPResult {
  let parsed: any;

  try {
    parsed = stdout.trim().length > 0 ? YAML.parse(stdout) : undefined;
  } catch (error) {
    return {
      ok: false,
      command: args[0] ?? "mrp",
      error: {
        code: "INVALID_YAML_OUTPUT",
        message: `Failed parsing YAML output: ${String(error)}\nstderr: ${stderr}`,
      },
      exitCode,
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      ok: false,
      command: args[0] ?? "mrp",
      error: {
        code: "EMPTY_OUTPUT",
        message: `No YAML envelope returned\nstderr: ${stderr}`,
      },
      exitCode,
    };
  }

  return {
    ok: parsed.ok === true,
    command: typeof parsed.command === "string" ? parsed.command : args[0] ?? "mrp",
    data: parsed.data,
    error: parsed.error,
    discovery: parsed.discovery,
    exitCode,
  };
}

async function runMrp(args: string[], cwd: string): Promise<MRPResult> {
  const proc = Bun.spawn(["bun", "run", CLI_ENTRY, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  return toResult(args, exitCode, stdout, stderr);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function expectOk(result: MRPResult, command?: string): void {
  expect(result.ok).toBe(true);
  expect(result.exitCode).toBe(0);
  if (command) {
    expect(result.command).toBe(command);
  }
  expect(result.data).toBeDefined();
}

function expectFail(result: MRPResult, command?: string): void {
  expect(result.ok).toBe(false);
  expect(result.exitCode).toBe(1);
  if (command) {
    expect(result.command).toBe(command);
  }
  expect(result.error).toBeDefined();
}

function parseFrontmatter(md: string): Record<string, unknown> {
  const match = md.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    throw new Error("No YAML frontmatter found");
  }
  return YAML.parse(match[1]!) as Record<string, unknown>;
}

async function initStore(cwd: string): Promise<MRPResult> {
  const result = await runMrp(["init"], cwd);
  expectOk(result, "init");
  return result;
}

async function createRoutine(cwd: string, name: string): Promise<any> {
  const result = await runMrp(
    [
      "create",
      "--name",
      name,
      "--goal",
      "Verify deterministic build behavior",
      "--non-goals",
      "Do not deploy",
      "--success-criteria",
      "sc1:Entrypoint exits zero",
      "--success-criteria",
      "sc2:Output indicates success",
      "--tags",
      "smoke",
    ],
    cwd,
  );

  expectOk(result, "create");
  expect(result.data?.routine).toBeDefined();
  return result.data.routine;
}

async function makeRoutineDeterministic(cwd: string, routine: any): Promise<void> {
  const entrypoint = String(routine.execution.entrypoint);
  const path = join(cwd, ".mrp", "routines", routine.id, entrypoint);
  await writeFile(path, deterministicEntrypointScript(), "utf8");
  await chmod(path, 0o755);
}

describe("MRP Integration", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mrp-integration-"));
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("init creates store", async () => {
    await initStore(tempDir);

    expect(await pathExists(join(tempDir, ".mrp"))).toBe(true);
    expect(await pathExists(join(tempDir, ".mrp", "version.yaml"))).toBe(true);
    expect(await pathExists(join(tempDir, ".mrp", "config.yaml"))).toBe(true);
    expect(await pathExists(join(tempDir, ".mrp", "index.yaml"))).toBe(true);
  });

  test("init fails on existing store", async () => {
    await initStore(tempDir);

    const second = await runMrp(["init"], tempDir);
    expectFail(second, "init");
    expect(second.error.code).toBe("STORE_ALREADY_EXISTS");
  });

  test("create routine", async () => {
    await initStore(tempDir);
    const routine = await createRoutine(tempDir, "Create Routine Test");

    expect(String(routine.id)).toMatch(/^mrp-[a-z0-9-]+-[a-z0-9]{4,8}$/);
    expect(await pathExists(join(tempDir, ".mrp", "routines", routine.id, "routine.yaml"))).toBe(true);
    expect(await pathExists(join(tempDir, ".mrp", "routines", routine.id, "ledger.yaml"))).toBe(true);
    expect(
      await pathExists(join(tempDir, ".mrp", "routines", routine.id, String(routine.execution.entrypoint))),
    ).toBe(true);
  });

  test("show routine", async () => {
    await initStore(tempDir);
    const routine = await createRoutine(tempDir, "Show Routine Test");

    const shown = await runMrp(["show", routine.id], tempDir);
    expectOk(shown, "show");
    expect(shown.data?.routine?.id).toBe(routine.id);
    expect(shown.data?.ledger_summary?.runs_total).toBe(0);
  });

  test("list routines", async () => {
    await initStore(tempDir);
    await createRoutine(tempDir, "List Routine One");
    await createRoutine(tempDir, "List Routine Two");

    const listed = await runMrp(["list"], tempDir);
    expectOk(listed, "list");
    expect(listed.data?.total).toBe(2);
    expect(Array.isArray(listed.data?.routines)).toBe(true);
    expect(listed.data.routines.length).toBe(2);
  });

  test("list with state filter", async () => {
    await initStore(tempDir);
    const draft = await createRoutine(tempDir, "Draft Routine");
    const toPromote = await createRoutine(tempDir, "Active Routine");

    const promoted = await runMrp(["promote", toPromote.id], tempDir);
    expectOk(promoted, "promote");

    const listed = await runMrp(["list", "--state", "active"], tempDir);
    expectOk(listed, "list");
    expect(listed.data?.total).toBe(1);
    expect(listed.data?.routines?.[0]?.id).toBe(toPromote.id);

    const fullList = await runMrp(["list"], tempDir);
    expectOk(fullList, "list");
    expect(fullList.data?.total).toBe(2);
    expect(fullList.data?.routines?.some((entry: any) => entry.id === draft.id)).toBe(true);
  });

  test("edit routine", async () => {
    await initStore(tempDir);
    const routine = await createRoutine(tempDir, "Edit Routine");

    // Inspect mode
    const inspected = await runMrp(["edit", routine.id], tempDir);
    expectOk(inspected, "edit");
    expect(inspected.data?.mode).toBe("inspect");

    // Modify the entrypoint
    const entrypointPath = join(tempDir, ".mrp", "routines", routine.id, "run.sh");
    await writeFile(entrypointPath, "#!/usr/bin/env bash\necho 'modified'\nexit 0\n");

    // Commit
    const committed = await runMrp(["edit", routine.id, "--commit", "--intent", "Updated by smoke test"], tempDir);
    expectOk(committed, "edit");
    expect(committed.data?.mode).toBe("commit");
    expect(committed.data?.edit_event?.intent).toBe("Updated by smoke test");
  });

  test("promote draft to active", async () => {
    await initStore(tempDir);
    const routine = await createRoutine(tempDir, "Promote Routine");

    const promoted = await runMrp(["promote", routine.id], tempDir);
    expectOk(promoted, "promote");
    expect(promoted.data?.routine?.lifecycle?.state).toBe("active");
  });

  test("invalid state transition", async () => {
    await initStore(tempDir);
    const routine = await createRoutine(tempDir, "Archive Invalid Transition");

    const archived = await runMrp(["archive", routine.id], tempDir);
    expectFail(archived, "archive");
    expect(archived.error.code).toBe("INVALID_STATE_TRANSITION");
  });

  test("deprecate and archive", async () => {
    await initStore(tempDir);
    const routine = await createRoutine(tempDir, "Deprecate Then Archive");

    expectOk(await runMrp(["promote", routine.id], tempDir), "promote");
    expectOk(await runMrp(["deprecate", routine.id], tempDir), "deprecate");

    const archived = await runMrp(["archive", routine.id], tempDir);
    expectOk(archived, "archive");
    expect(archived.data?.routine?.lifecycle?.state).toBe("archived");
  });

  test("quarantine from any state", async () => {
    await initStore(tempDir);
    const routine = await createRoutine(tempDir, "Quarantine Routine");

    expectOk(await runMrp(["promote", routine.id], tempDir), "promote");

    const quarantined = await runMrp(["quarantine", routine.id], tempDir);
    expectOk(quarantined, "quarantine");
    expect(quarantined.data?.routine?.lifecycle?.state).toBe("quarantine");
  });

  test("promote from quarantine", async () => {
    await initStore(tempDir);
    const routine = await createRoutine(tempDir, "Promote From Quarantine");

    expectOk(await runMrp(["quarantine", routine.id], tempDir), "quarantine");

    const promoted = await runMrp(["promote", routine.id, "--from-quarantine"], tempDir);
    expectOk(promoted, "promote");
    expect(promoted.data?.routine?.lifecycle?.state).toBe("draft");
  });

  test("run routine", async () => {
    await initStore(tempDir);
    const routine = await createRoutine(tempDir, "Run Routine");
    await makeRoutineDeterministic(tempDir, routine);

    expectOk(await runMrp(["promote", routine.id], tempDir), "promote");

    const run = await runMrp(["run", routine.id], tempDir);
    expectOk(run, "run");
    expect(run.data?.outcome?.status).toBe("success");

    const stdoutPath = String(run.data?.outcome?.artifacts?.stdout_path ?? "");
    const stderrPath = String(run.data?.outcome?.artifacts?.stderr_path ?? "");
    expect(await pathExists(stdoutPath)).toBe(true);
    expect(await pathExists(stderrPath)).toBe(true);

    const ledgerRaw = await readFile(join(tempDir, ".mrp", "routines", routine.id, "ledger.yaml"), "utf8");
    const ledger = YAML.parse(ledgerRaw);
    expect(Array.isArray(ledger.runs)).toBe(true);
    expect(ledger.runs.length).toBe(1);
  });

  test("run blocked for archived", async () => {
    await initStore(tempDir);
    const routine = await createRoutine(tempDir, "Archived Run Blocked");
    await makeRoutineDeterministic(tempDir, routine);

    expectOk(await runMrp(["promote", routine.id], tempDir), "promote");
    expectOk(await runMrp(["deprecate", routine.id], tempDir), "deprecate");
    expectOk(await runMrp(["archive", routine.id], tempDir), "archive");

    const blocked = await runMrp(["run", routine.id], tempDir);
    expectFail(blocked, "run");
    expect(blocked.error.code).toBe("ROUTINE_NOT_RUNNABLE");
  });

  test("doctor checks", async () => {
    await initStore(tempDir);

    const doctor = await runMrp(["doctor"], tempDir);
    expectOk(doctor, "doctor");
  });

  test("doctor rebuild-index", async () => {
    await initStore(tempDir);
    await createRoutine(tempDir, "Doctor Rebuild Index");

    const doctor = await runMrp(["doctor", "--rebuild-index"], tempDir);
    expectOk(doctor, "doctor");
    expect(doctor.data?.rebuild_index).toBe(true);
  });

  test("full pipeline", async () => {
    expectOk(await runMrp(["init"], tempDir), "init");

    const created = await createRoutine(tempDir, "Full Pipeline");
    const routineId = String(created.id);

    expectOk(await runMrp(["show", routineId], tempDir), "show");
    expectOk(await runMrp(["list"], tempDir), "list");

    const inspected = await runMrp(["edit", routineId], tempDir);
    expectOk(inspected, "edit");
    expect(inspected.data?.mode).toBe("inspect");

    const entrypointPath = join(tempDir, ".mrp", "routines", routineId, "run.sh");
    await writeFile(entrypointPath, "#!/usr/bin/env bash\necho 'pipeline edited'\nexit 0\n");

    const committed = await runMrp(["edit", routineId, "--commit", "--intent", "Full pipeline edited"], tempDir);
    expectOk(committed, "edit");
    expect(committed.data?.mode).toBe("commit");

    await makeRoutineDeterministic(tempDir, created);

    expectOk(await runMrp(["promote", routineId], tempDir), "promote");
    expectOk(await runMrp(["run", routineId], tempDir), "run");
    expectOk(await runMrp(["sync-skills"], tempDir), "sync-skills");
    expectOk(await runMrp(["deprecate", routineId], tempDir), "deprecate");
    expectOk(await runMrp(["archive", routineId], tempDir), "archive");
    expectOk(await runMrp(["prune", "--routine", routineId, "--keep-last", "0"], tempDir), "prune");

    const doctor = await runMrp(["doctor"], tempDir);
    expectOk(doctor, "doctor");
  });

  test("projected routine SKILL.md includes YAML frontmatter", async () => {
    await mkdir(join(tempDir, ".cursor"), { recursive: true });
    await initStore(tempDir);

    const routine = await createRoutine(tempDir, "Frontmatter Test");

    expectOk(await runMrp(["promote", routine.id], tempDir), "promote");

    expectOk(await runMrp(["sync-skills"], tempDir), "sync-skills");

    const skillsDir = join(tempDir, ".cursor", "skills");
    const entries = await readdir(skillsDir, { withFileTypes: true });
    const wrapperDir = entries.find((e) => e.isDirectory() && e.name.startsWith("mrp-"));
    expect(wrapperDir).toBeDefined();

    const skillMd = await readFile(join(skillsDir, wrapperDir!.name, "SKILL.md"), "utf8");
    const fm = parseFrontmatter(skillMd);
    expect(fm.name).toBe(wrapperDir!.name);
    expect(typeof fm.description).toBe("string");
    expect((fm.description as string).length).toBeGreaterThan(0);
    expect(skillMd).toContain(`mrp run ${routine.id}`);
  });

  test("projected meta skill has frontmatter and mentions core commands", async () => {
    await mkdir(join(tempDir, ".cursor"), { recursive: true });
    const init = await runMrp(["init"], tempDir);
    expectOk(init, "init");

    const metaPath = join(tempDir, ".cursor", "skills", "mrp", "SKILL.md");
    expect(await pathExists(metaPath)).toBe(true);

    const md = await readFile(metaPath, "utf8");
    const fm = parseFrontmatter(md);
    expect(fm.name).toBe("mrp");
    expect(typeof fm.description).toBe("string");

    expect(md).toContain("mrp init");
    expect(md).toContain("mrp create");
    expect(md).toContain("mrp list");
    expect(md).toContain("mrp show");
    expect(md).toContain("mrp run");
    expect(md).toContain("mrp promote");
    expect(md).toContain("mrp edit");
    expect(md).toContain("mrp <command> --help");
  });

  test("--help returns help envelope without side effects", async () => {
    const global = await runMrp(["--help"], tempDir);
    expectOk(global, "help");
    expect(Array.isArray(global.data?.commands)).toBe(true);
    expect(global.data.commands.length).toBeGreaterThan(0);
    expect(global.data.commands.some((c: any) => c.command === "init")).toBe(true);
    expect(await pathExists(join(tempDir, ".mrp"))).toBe(false);

    const cmdHelp = await runMrp(["create", "--help"], tempDir);
    expectOk(cmdHelp, "help");
    expect(cmdHelp.data?.command).toBe("create");
    expect(typeof cmdHelp.data?.usage).toBe("string");
    expect(Array.isArray(cmdHelp.data?.flags)).toBe(true);
    expect(Array.isArray(cmdHelp.data?.examples)).toBe(true);
    expect(await pathExists(join(tempDir, ".mrp"))).toBe(false);

    const unknown = await runMrp(["not-a-command", "--help"], tempDir);
    expectFail(unknown, "help");
    expect(unknown.error.code).toBe("UNKNOWN_COMMAND");
    expect(await pathExists(join(tempDir, ".mrp"))).toBe(false);

    const initHelp = await runMrp(["init", "--help"], tempDir);
    expectOk(initHelp, "help");
    expect(initHelp.data?.command).toBe("init");
    expect(await pathExists(join(tempDir, ".mrp"))).toBe(false);
  });

  test("init creates AGENTS.md and auto-projects meta skill", async () => {
    await mkdir(join(tempDir, ".cursor"), { recursive: true });
    const init = await runMrp(["init"], tempDir);
    expectOk(init, "init");

    const agentsPath = join(tempDir, ".mrp", "AGENTS.md");
    expect(await pathExists(agentsPath)).toBe(true);
    const agentsContent = await readFile(agentsPath, "utf8");
    expect(agentsContent).toContain("MRP Store");
    expect(agentsContent).toContain("mrp list");
    expect(agentsContent).toContain("Agent authority");

    const metaPath = join(tempDir, ".cursor", "skills", "mrp", "SKILL.md");
    expect(await pathExists(metaPath)).toBe(true);

    expect(init.data?.detected_hosts).toContain("cursor");
  });

  test("missing index.yaml triggers silent rebuild", async () => {
    await initStore(tempDir);
    const routine = await createRoutine(tempDir, "Index Rebuild Test");

    const indexPath = join(tempDir, ".mrp", "index.yaml");
    await rm(indexPath);
    expect(await pathExists(indexPath)).toBe(false);

    const listed = await runMrp(["list"], tempDir);
    expectOk(listed, "list");
    expect(listed.data?.total).toBe(1);
    expect(listed.data?.routines?.[0]?.id).toBe(routine.id);

    expect(await pathExists(indexPath)).toBe(true);
  });

  // ─── mrp-agent-autonomy tests ───

  test("judge overrides latest run status", async () => {
    await initStore(tempDir);
    const routine = await createRoutine(tempDir, "Judge Override");
    const ep = join(tempDir, ".mrp", "routines", routine.id, "run.sh");
    await writeFile(ep, "#!/usr/bin/env bash\necho 'build output'\nexit 1\n");
    await chmod(ep, 0o755);
    await runMrp(["promote", routine.id], tempDir);

    const runRes = await runMrp(["run", routine.id], tempDir);
    expectOk(runRes, "run");
    const runId = runRes.data?.outcome?.run_id;
    expect(runRes.data?.outcome?.status).toBe("failure");
    expect(runRes.data?.outcome?.status_auto).toBe("failure");

    const judgeRes = await runMrp(
      ["judge", routine.id, runId, "--status", "success", "--reason", "warnings only"],
      tempDir,
    );
    expectOk(judgeRes, "judge");
    expect(judgeRes.data?.run?.status).toBe("success");
    expect(judgeRes.data?.run?.status_auto).toBe("failure");
    expect(judgeRes.data?.run?.judgment?.status).toBe("success");
    expect(judgeRes.data?.run?.judgment?.reason).toBe("warnings only");
    expect(judgeRes.data?.run?.judgment?.judged_at).toBeDefined();

    const showRes = await runMrp(["show", routine.id], tempDir);
    expectOk(showRes, "show");
    expect(showRes.data?.ledger_summary?.last_status).toBe("success");

    const listRes = await runMrp(["list"], tempDir);
    expectOk(listRes, "list");
    const entry = listRes.data?.routines?.find((r: any) => r.id === routine.id);
    expect(entry?.last_run_status).toBe("success");
  });

  test("judge sets partial status", async () => {
    await initStore(tempDir);
    const routine = await createRoutine(tempDir, "Partial Judge");
    const ep = join(tempDir, ".mrp", "routines", routine.id, "run.sh");
    await writeFile(ep, "#!/usr/bin/env bash\necho 'ok'\nexit 0\n");
    await chmod(ep, 0o755);
    await runMrp(["promote", routine.id], tempDir);

    const runRes = await runMrp(["run", routine.id], tempDir);
    expectOk(runRes, "run");
    const runId = runRes.data?.outcome?.run_id;

    const judgeRes = await runMrp(
      ["judge", routine.id, runId, "--status", "partial", "--reason", "1 flaky test"],
      tempDir,
    );
    expectOk(judgeRes, "judge");
    expect(judgeRes.data?.run?.status).toBe("partial");
    expect(judgeRes.data?.run?.judgment?.status).toBe("partial");

    const listRes = await runMrp(["list"], tempDir);
    expectOk(listRes, "list");
    const entry = listRes.data?.routines?.find((r: any) => r.id === routine.id);
    expect(entry?.last_run_status).toBe("partial");
  });

  test("judge error cases", async () => {
    await initStore(tempDir);
    const routine = await createRoutine(tempDir, "Judge Errors");
    const ep = join(tempDir, ".mrp", "routines", routine.id, "run.sh");
    await writeFile(ep, "#!/usr/bin/env bash\nexit 0\n");
    await chmod(ep, 0o755);
    await runMrp(["promote", routine.id], tempDir);
    const runRes = await runMrp(["run", routine.id], tempDir);
    const runId = runRes.data?.outcome?.run_id;

    // Non-existent run
    const notFound = await runMrp(
      ["judge", routine.id, "nonexistent-run", "--status", "success"],
      tempDir,
    );
    expectFail(notFound);
    expect(notFound.error?.code).toBe("RUN_NOT_FOUND");

    // Missing --status
    const noStatus = await runMrp(["judge", routine.id, runId], tempDir);
    expectFail(noStatus);

    // Invalid --status value
    const badStatus = await runMrp(
      ["judge", routine.id, runId, "--status", "nope"],
      tempDir,
    );
    expectFail(badStatus);
  });

  test("run records execution_snapshot with entrypoint hash", async () => {
    const { createHash } = await import("node:crypto");
    await initStore(tempDir);
    const routine = await createRoutine(tempDir, "Fingerprint Test");
    const ep = join(tempDir, ".mrp", "routines", routine.id, "run.sh");
    const scriptContent = "#!/usr/bin/env bash\necho 'fingerprint test'\nexit 0\n";
    await writeFile(ep, scriptContent);
    await chmod(ep, 0o755);
    await runMrp(["promote", routine.id], tempDir);

    const result = await runMrp(["run", routine.id], tempDir);
    expectOk(result, "run");

    const snapshot = result.data?.outcome?.execution_snapshot;
    expect(snapshot).toBeDefined();
    expect(snapshot?.entrypoint_hash).toBeDefined();
    expect(snapshot?.entrypoint_hash?.length).toBe(64);
    expect(snapshot?.entrypoint_path).toBeDefined();
    expect(snapshot?.entrypoint_size).toBeGreaterThan(0);

    const expectedHash = createHash("sha256")
      .update(Buffer.from(scriptContent))
      .digest("hex");
    expect(snapshot?.entrypoint_hash).toBe(expectedHash);
  });

  test("script_changed detection between runs", async () => {
    await initStore(tempDir);
    const routine = await createRoutine(tempDir, "Script Change");
    const ep = join(tempDir, ".mrp", "routines", routine.id, "run.sh");
    await writeFile(ep, "#!/usr/bin/env bash\necho v1\nexit 0\n");
    await chmod(ep, 0o755);
    await runMrp(["promote", routine.id], tempDir);

    // First run — no previous, script_changed should be absent
    const run1 = await runMrp(["run", routine.id], tempDir);
    expectOk(run1, "run");
    expect(run1.data?.outcome?.script_changed).toBeUndefined();

    // Modify entrypoint
    await writeFile(ep, "#!/usr/bin/env bash\necho v2\nexit 0\n");

    // Second run — script_changed should be true
    const run2 = await runMrp(["run", routine.id], tempDir);
    expectOk(run2, "run");
    expect(run2.data?.outcome?.script_changed).toBe(true);

    // Third run without changes — script_changed should be false
    const run3 = await runMrp(["run", routine.id], tempDir);
    expectOk(run3, "run");
    expect(run3.data?.outcome?.script_changed).toBeFalsy();
  });

  test("meta skill contains Agent authority section", async () => {
    const hostDir = join(tempDir, ".cursor", "skills");
    await mkdir(hostDir, { recursive: true });

    await runMrp(["init"], tempDir);
    await runMrp(["sync-skills"], tempDir);

    const metaSkillPath = join(hostDir, "mrp", "SKILL.md");
    const content = await readFile(metaSkillPath, "utf8");
    expect(content).toContain("Agent authority");
    expect(content).toContain("mrp judge");
    expect(content).toContain("--commit");
  });

  test("edit inspect mode outputs context and writes baseline", async () => {
    await initStore(tempDir);
    const routine = await createRoutine(tempDir, "Edit Inspect");

    const result = await runMrp(["edit", routine.id], tempDir);
    expectOk(result, "edit");
    expect(result.data?.mode).toBe("inspect");
    expect(result.data?.files).toBeDefined();
    expect(Array.isArray(result.data?.files)).toBe(true);
    expect(result.data?.instructions).toBeDefined();

    const sessionPath = join(
      tempDir, ".mrp", "routines", routine.id, "edit_session.yaml",
    );
    expect(await pathExists(sessionPath)).toBe(true);
  });

  test("edit commit mode records EditEvent in ledger", async () => {
    await initStore(tempDir);
    const routine = await createRoutine(tempDir, "Edit Commit");

    // Inspect to create baseline
    await runMrp(["edit", routine.id], tempDir);

    // Modify entrypoint
    const ep = join(tempDir, ".mrp", "routines", routine.id, "run.sh");
    await writeFile(ep, "#!/usr/bin/env bash\necho 'edited'\nexit 0\n");

    // Commit
    const result = await runMrp(
      ["edit", routine.id, "--commit", "--intent", "test change"],
      tempDir,
    );
    expectOk(result, "edit");
    expect(result.data?.mode).toBe("commit");
    expect(result.data?.edit_event?.intent).toBe("test change");
    expect(result.data?.edit_event?.changed_files?.length).toBeGreaterThan(0);

    // Verify ledger
    const ledgerContent = await readFile(
      join(tempDir, ".mrp", "routines", routine.id, "ledger.yaml"),
      "utf8",
    );
    const ledger = YAML.parse(ledgerContent);
    expect(ledger.edits).toBeDefined();
    expect(ledger.edits.length).toBe(1);
    expect(ledger.edits[0].type).toBe("edit");
    expect(ledger.edits[0].intent).toBe("test change");
  });

  test("edit commit with no changes returns NO_CHANGES", async () => {
    await initStore(tempDir);
    const routine = await createRoutine(tempDir, "Edit No Change");

    // Inspect baseline
    await runMrp(["edit", routine.id], tempDir);

    // Commit immediately without changes
    const result = await runMrp(["edit", routine.id, "--commit"], tempDir);
    expectFail(result);
    expect(result.error?.code).toBe("NO_CHANGES");
  });
});
