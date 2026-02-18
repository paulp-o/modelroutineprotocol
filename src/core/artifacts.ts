import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export function sanitizeRunIdForPath(runId: string): string {
  return runId.replace(/[:+]/g, "-");
}

export async function createArtifactDir(runsDir: string, runId: string): Promise<string> {
  const sanitizedRunId = sanitizeRunIdForPath(runId);
  const artifactDir = join(runsDir, sanitizedRunId);

  await mkdir(artifactDir, { recursive: true });

  return artifactDir;
}
