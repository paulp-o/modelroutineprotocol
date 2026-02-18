import { constants } from "node:fs";
import { access, open } from "node:fs/promises";
import { spawn } from "node:child_process";
import { extname } from "node:path";

export type VerificationResult = {
  verified: boolean;
  verifierExitCode: number | null;
  verifierUsed: boolean;
};

type Dispatch = {
  command: string;
  args: string[];
};

type RunVerifierOptions = {
  verifierPath: string;
  cwd: string;
  routineId: string;
  runId: string;
  storeDir: string;
  timeoutSec: number;
};

async function hasExecutableBit(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function readFilePrefix(path: string, bytes: number): Promise<string> {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await file.read(buffer, 0, bytes, 0);
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    await file.close();
  }
}

async function resolveDispatch(verifierPath: string): Promise<Dispatch> {
  const prefix = await readFilePrefix(verifierPath, 256);
  const firstLine = prefix.split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (firstLine.startsWith("#!") && (await hasExecutableBit(verifierPath))) {
    return {
      command: verifierPath,
      args: [],
    };
  }

  const extension = extname(verifierPath).toLowerCase();

  if (extension === ".sh") {
    return {
      command: "bash",
      args: [verifierPath],
    };
  }

  if (extension === ".ts") {
    return {
      command: "bun",
      args: ["run", verifierPath],
    };
  }

  if (extension === ".py") {
    return {
      command: "python3",
      args: [verifierPath],
    };
  }

  throw new Error(
    `Unsupported verifier runtime for '${verifierPath}'. Expected executable shebang, .sh, .ts, or .py`,
  );
}

async function runProcess(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutSec: number },
): Promise<number | null> {
  return await new Promise<number | null>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "inherit",
    });

    let timedOut = false;
    const timeoutMs = Math.max(0, options.timeoutSec) * 1000;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
          }, timeoutMs)
        : null;

    child.once("error", (error) => {
      if (timer) {
        clearTimeout(timer);
      }
      reject(error);
    });

    child.once("close", (code) => {
      if (timer) {
        clearTimeout(timer);
      }

      if (timedOut && code === 0) {
        resolve(null);
        return;
      }

      resolve(code);
    });
  });
}

export async function runVerifier(opts: RunVerifierOptions): Promise<VerificationResult> {
  const dispatch = await resolveDispatch(opts.verifierPath);
  const verifierExitCode = await runProcess(dispatch.command, dispatch.args, {
    cwd: opts.cwd,
    env: {
      ...process.env,
      MRP_ROUTINE_ID: opts.routineId,
      MRP_RUN_ID: opts.runId,
      MRP_STORE_DIR: opts.storeDir,
    },
    timeoutSec: opts.timeoutSec,
  });

  return {
    verified: verifierExitCode === 0,
    verifierExitCode,
    verifierUsed: true,
  };
}

export function determineStatus(
  entrypointExitCode: number | null,
  timedOut: boolean,
  verification?: VerificationResult,
): "success" | "failure" | "timeout" {
  if (timedOut) {
    return "timeout";
  }

  if (verification?.verifierUsed && !verification.verified) {
    return "failure";
  }

  if (entrypointExitCode !== 0) {
    return "failure";
  }

  return "success";
}
