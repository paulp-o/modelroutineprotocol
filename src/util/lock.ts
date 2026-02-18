import { mkdir, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

type AcquireLockOptions = {
  timeoutMs?: number;
  retryMs?: number;
};

const PID_FILENAME = "pid";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      const code = String((error as { code?: string }).code);
      if (code === "ESRCH") {
        return false;
      }
      if (code === "EPERM") {
        return true;
      }
    }

    return true;
  }
}

async function readPidText(lockPath: string): Promise<string | null> {
  try {
    return (await readFile(join(lockPath, PID_FILENAME), "utf8")).trim();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      const code = String((error as { code?: string }).code);
      if (code === "ENOENT") {
        return null;
      }
    }

    throw error;
  }
}

async function removeStaleLock(lockPath: string): Promise<boolean> {
  const firstRead = await readPidText(lockPath);
  if (!firstRead) {
    return false;
  }

  const pid = Number.parseInt(firstRead, 10);
  if (isProcessAlive(pid)) {
    return false;
  }

  const secondRead = await readPidText(lockPath);
  if (!secondRead || secondRead !== firstRead) {
    return false;
  }

  try {
    await unlink(join(lockPath, PID_FILENAME));
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && String((error as { code?: string }).code) === "ENOENT")) {
      return false;
    }
  }

  try {
    await rmdir(lockPath);
    return true;
  } catch {
    return false;
  }
}

export async function acquireLock(
  lockPath: string,
  opts: AcquireLockOptions = {},
): Promise<() => Promise<void>> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const retryMs = opts.retryMs ?? 100;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    try {
      await mkdir(lockPath);
      try {
        await writeFile(join(lockPath, PID_FILENAME), `${process.pid}\n`, "utf8");
      } catch (error) {
        try {
          await rmdir(lockPath);
        } catch {
          // Best-effort cleanup if pid file write fails.
        }

        throw error;
      }

      let released = false;
      return async () => {
        if (released) {
          return;
        }

        released = true;
        await releaseLock(lockPath);
      };
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && String((error as { code?: string }).code) === "EEXIST")) {
        throw error;
      }
    }

    await removeStaleLock(lockPath);

    if (Date.now() >= deadline) {
      const timeoutError = new Error(`Timed out acquiring lock: ${lockPath}`) as Error & { code: string };
      timeoutError.code = "LOCK_TIMEOUT";
      throw timeoutError;
    }

    await delay(retryMs);
  }

  const timeoutError = new Error(`Timed out acquiring lock: ${lockPath}`) as Error & { code: string };
  timeoutError.code = "LOCK_TIMEOUT";
  throw timeoutError;
}

export async function releaseLock(lockPath: string): Promise<void> {
  const pidPath = join(lockPath, PID_FILENAME);

  try {
    await unlink(pidPath);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && String((error as { code?: string }).code) === "ENOENT")) {
      throw error;
    }
  }

  try {
    await rmdir(lockPath);
  } catch (error) {
    if (
      !(
        error &&
        typeof error === "object" &&
        "code" in error &&
        (String((error as { code?: string }).code) === "ENOENT" ||
          String((error as { code?: string }).code) === "ENOTEMPTY")
      )
    ) {
      throw error;
    }
  }
}
