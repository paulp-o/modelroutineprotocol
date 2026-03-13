import { mkdir, realpath, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DEFAULT_CONFIG } from "../schema/config.ts";
import { DEFAULT_DISCOVERY_STATE } from "../schema/discovery-state.ts";
import { writeYamlAtomic } from "../util/yaml-io.ts";

export const STORE_DIR = ".mrp";

const HOST_DIRECTORY_MAP = [
  [".opencode", "opencode"],
  [".claude", "claude"],
  [".cursor", "cursor"],
  [".windsurf", "windsurf"],
] as const;

function codedError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

async function pathExistsAsDirectory(path: string): Promise<boolean> {
  try {
    const entry = await stat(path);
    return entry.isDirectory();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      const code = String((error as { code?: string }).code);
      if (code === "ENOENT") {
        return false;
      }
    }

    throw error;
  }
}

export function storePath(root: string): string {
  return join(root, STORE_DIR);
}

export function routinesDir(root: string): string {
  return join(storePath(root), "routines");
}

export function routineDir(root: string, id: string): string {
  return join(routinesDir(root), id);
}

export function routineLockPath(root: string, id: string): string {
  return join(routineDir(root, id), "routine.lock");
}

export function storeLockPath(root: string): string {
  return join(locksDir(root), "store.lock");
}

export function configPath(root: string): string {
  return join(storePath(root), "config.yaml");
}

export function agentsMdPath(root: string): string {
  return join(storePath(root), "AGENTS.md");
}

export function indexPath(root: string): string {
  return join(storePath(root), "index.yaml");
}

export function versionPath(root: string): string {
  return join(storePath(root), "version.yaml");
}

export function discoveryStatePath(root: string): string {
  return join(storePath(root), "discovery_state.yaml");
}

export function projectionsDir(root: string): string {
  return join(storePath(root), "projections");
}

export function projectionsPath(root: string): string {
  return join(projectionsDir(root), "projections.yaml");
}

export function lastSyncPath(root: string): string {
  return join(projectionsDir(root), "last_sync.yaml");
}

export function locksDir(root: string): string {
  return join(storePath(root), "locks");
}

export function ledgerPath(root: string, id: string): string {
  return join(routineDir(root, id), "ledger.yaml");
}

export function runsDir(root: string, id: string): string {
  return join(routineDir(root, id), "runs");
}

async function detectHosts(root: string): Promise<string[]> {
  const detected: string[] = [];

  for (const [hostDir, hostName] of HOST_DIRECTORY_MAP) {
    if (await pathExistsAsDirectory(join(root, hostDir))) {
      detected.push(hostName);
    }
  }

  return detected;
}

export async function initStore(
  rootDir: string,
): Promise<{ storePath: string; configPath: string; detectedHosts: string[] }> {
  const resolvedRoot = await realpath(rootDir);
  const storeDir = storePath(resolvedRoot);

  if (await pathExistsAsDirectory(storeDir)) {
    throw codedError("STORE_ALREADY_EXISTS", `Store already exists at ${storeDir}`);
  }

  await mkdir(storeDir, { recursive: true });
  await mkdir(routinesDir(resolvedRoot), { recursive: true });
  await mkdir(projectionsDir(resolvedRoot), { recursive: true });
  await mkdir(locksDir(resolvedRoot), { recursive: true });

  const detectedHosts = await detectHosts(resolvedRoot);
  const config = {
    ...DEFAULT_CONFIG,
    projection: {
      ...DEFAULT_CONFIG.projection,
      hosts: detectedHosts,
    },
  };

  await writeYamlAtomic(versionPath(resolvedRoot), { store_version: 1 });
  await writeYamlAtomic(configPath(resolvedRoot), config);
  await writeYamlAtomic(indexPath(resolvedRoot), { routines: [] });
  await writeYamlAtomic(discoveryStatePath(resolvedRoot), DEFAULT_DISCOVERY_STATE);
  await writeYamlAtomic(projectionsPath(resolvedRoot), {});
  await writeYamlAtomic(lastSyncPath(resolvedRoot), null);

  return {
    storePath: storeDir,
    configPath: configPath(resolvedRoot),
    detectedHosts,
  };
}

export async function findStoreRoot(startDir: string): Promise<string> {
  let current = await realpath(startDir);

  while (true) {
    if (await pathExistsAsDirectory(storePath(current))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      throw codedError("STORE_NOT_FOUND", `No ${STORE_DIR} store found from ${startDir}`);
    }

    current = parent;
  }
}
