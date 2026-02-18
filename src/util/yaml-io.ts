import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import YAML from "yaml";

export function parseYaml(text: string): unknown {
  return YAML.parse(text);
}

export function stringifyYaml(data: unknown): string {
  const text = YAML.stringify(data, {
    lineWidth: 0,
  });

  return text.endsWith("\n") ? text : `${text}\n`;
}

export async function readYamlFile<T>(path: string): Promise<T> {
  const text = await readFile(path, "utf8");
  return parseYaml(text) as T;
}

export async function writeYamlAtomic(path: string, data: unknown): Promise<void> {
  const directory = dirname(path);
  const filename = basename(path);
  const tempPath = join(directory, `${filename}.${process.pid}.${Date.now()}.tmp`);

  try {
    await writeFile(tempPath, stringifyYaml(data), "utf8");
    await rename(tempPath, path);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // Best-effort cleanup only.
    }

    throw error;
  }
}
