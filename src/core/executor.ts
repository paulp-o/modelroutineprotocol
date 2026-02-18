import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, open, stat } from "node:fs/promises";
import { extname, join } from "node:path";

type StreamCapture = {
  truncated: () => boolean;
  done: Promise<void>;
};

export type ExecutionResult = {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  truncatedStdout: boolean;
  truncatedStderr: boolean;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  stdoutPath: string;
  stderrPath: string;
};

export type ExecutionOptions = {
  entrypointPath: string;
  cwd: string;
  routineId: string;
  runId: string;
  storeDir: string;
  timeoutSec: number;
  outputMaxKb: number;
  passthroughArgs: string[];
  artifactDir: string;
};

async function hasShebang(path: string): Promise<boolean> {
  const handle = await open(path, "r");

  try {
    const buffer = Buffer.alloc(2);
    const { bytesRead } = await handle.read(buffer, 0, 2, 0);
    return bytesRead === 2 && buffer.toString("utf8") === "#!";
  } finally {
    await handle.close();
  }
}

async function hasExecutableBit(path: string): Promise<boolean> {
  const file = await stat(path);
  return (file.mode & 0o111) !== 0;
}

function captureStreamToFile(
  stream: NodeJS.ReadableStream | null,
  outputPath: string,
  limitKb: number,
): StreamCapture {
  const output = createWriteStream(outputPath, { encoding: "utf8" });
  const normalizedLimitKb = Math.max(0, Math.floor(limitKb));
  const limitBytes = normalizedLimitKb * 1024;
  const marker = `[TRUNCATED at ${normalizedLimitKb}KB]`;

  let bytesWritten = 0;
  let truncated = false;
  let closed = false;

  const done = new Promise<void>((resolve, reject) => {
    output.once("finish", resolve);
    output.once("error", reject);
  });

  const closeOutput = (): void => {
    if (!closed) {
      closed = true;
      output.end();
    }
  };

  const writeTruncationMarker = (): void => {
    if (truncated) {
      return;
    }

    truncated = true;
    output.write(marker);
    closeOutput();
  };

  if (!stream) {
    closeOutput();
    return { truncated: () => false, done };
  }

  stream.on("data", (chunk: Buffer | string) => {
    if (truncated || closed) {
      return;
    }

    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = limitBytes - bytesWritten;

    if (remaining <= 0) {
      writeTruncationMarker();
      return;
    }

    if (buffer.length <= remaining) {
      output.write(buffer);
      bytesWritten += buffer.length;

      if (bytesWritten >= limitBytes) {
        writeTruncationMarker();
      }

      return;
    }

    output.write(buffer.subarray(0, remaining));
    bytesWritten += remaining;
    writeTruncationMarker();
  });

  stream.once("end", closeOutput);
  stream.once("error", (error) => {
    output.destroy(error as Error);
  });

  return {
    truncated: () => truncated,
    done,
  };
}

export async function determineRuntime(
  entrypointPath: string,
): Promise<{ command: string; args: string[] }> {
  const [shebang, executable] = await Promise.all([
    hasShebang(entrypointPath),
    hasExecutableBit(entrypointPath),
  ]);

  if (shebang && executable) {
    return {
      command: entrypointPath,
      args: [],
    };
  }

  const extension = extname(entrypointPath).toLowerCase();

  switch (extension) {
    case ".sh":
      return { command: "bash", args: [entrypointPath] };
    case ".ts":
      return { command: "bun", args: ["run", entrypointPath] };
    case ".py":
      return { command: "python3", args: [entrypointPath] };
    default:
      throw new Error(`Unsupported entrypoint extension: ${extension || "<none>"}`);
  }
}

export async function executeEntrypoint(opts: ExecutionOptions): Promise<ExecutionResult> {
  const started = new Date();
  const startedAt = started.toISOString();
  const stdoutPath = join(opts.artifactDir, "stdout.txt");
  const stderrPath = join(opts.artifactDir, "stderr.txt");

  await mkdir(opts.artifactDir, { recursive: true });

  const runtime = await determineRuntime(opts.entrypointPath);
  const args = [...runtime.args, ...opts.passthroughArgs];

  const child = spawn(runtime.command, args, {
    cwd: opts.cwd,
    env: {
      ...process.env,
      MRP_ROUTINE_ID: opts.routineId,
      MRP_RUN_ID: opts.runId,
      MRP_STORE_DIR: opts.storeDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdoutCapture = captureStreamToFile(child.stdout, stdoutPath, opts.outputMaxKb);
  const stderrCapture = captureStreamToFile(child.stderr, stderrPath, opts.outputMaxKb);

  let timedOut = false;
  const timeoutMs = Math.floor(opts.timeoutSec * 1000);
  const timeoutId =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, timeoutMs)
      : null;

  let exitCode: number | null = null;
  let signal: NodeJS.Signals | null = null;

  try {
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, exitSignal) => {
          resolve({ code, signal: exitSignal });
        });
      },
    );

    exitCode = exit.code;
    signal = exit.signal;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    await Promise.all([stdoutCapture.done, stderrCapture.done]);
  }

  const ended = new Date();
  const endedAt = ended.toISOString();

  return {
    exitCode,
    signal,
    timedOut,
    truncatedStdout: stdoutCapture.truncated(),
    truncatedStderr: stderrCapture.truncated(),
    startedAt,
    endedAt,
    durationMs: ended.getTime() - started.getTime(),
    stdoutPath,
    stderrPath,
  };
}
