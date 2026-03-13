import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

export interface ExecutionSnapshot {
  entrypoint_hash: string;
  entrypoint_path: string;
  entrypoint_size: number;
}

/**
 * Compute sha256 fingerprint of a file.
 * Returns the hash (hex), absolute path, and file size in bytes.
 */
export async function fingerprintFile(
  filePath: string,
): Promise<ExecutionSnapshot> {
  const absPath = resolve(filePath);
  const [content, fileStat] = await Promise.all([
    readFile(absPath),
    stat(absPath),
  ]);
  const hash = createHash("sha256").update(content).digest("hex");
  return {
    entrypoint_hash: hash,
    entrypoint_path: absPath,
    entrypoint_size: fileStat.size,
  };
}

/**
 * Compute sha256 hex hash of a file's content.
 * Useful for fingerprinting individual files in edit tracking.
 */
export async function sha256File(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}
