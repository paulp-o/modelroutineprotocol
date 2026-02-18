import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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

async function runMrpEditWithStdin(routineId: string, yamlPatch: string, cwd: string): Promise<MRPResult> {
  const args = ["edit", routineId, "--patch"];
  const proc = Bun.spawn(["bun", "run", CLI_ENTRY, ...args], {
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write(yamlPatch);
  proc.stdin.end();

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

    const patch = YAML.stringify({ description: "Updated by smoke test" });
    const edited = await runMrpEditWithStdin(routine.id, patch, tempDir);
    expectOk(edited, "edit");
    expect(edited.data?.routine?.description).toBe("Updated by smoke test");
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

    const edited = await runMrpEditWithStdin(
      routineId,
      YAML.stringify({ description: "Full pipeline patched" }),
      tempDir,
    );
    expectOk(edited, "edit");

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
});
