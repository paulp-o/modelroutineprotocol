import { readIndex } from "../core/index.ts";
import { findStoreRoot } from "../core/store.ts";
import type { IndexEntry } from "../schema/index-schema.ts";
import { errEnvelope, okEnvelope, type Envelope } from "../util/envelope.ts";

type SortField = "updated_at" | "created_at" | "last_run_at";

const DEFAULT_SORT_FIELD: SortField = "updated_at";
const VALID_SORT_FIELDS: Set<SortField> = new Set(["updated_at", "created_at", "last_run_at"]);

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function isTruthyFlag(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function valuesForFlag(flags: Record<string, unknown>, key: string): string[] {
  const value = flags[key];

  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string") {
    return [value];
  }

  return [];
}

function stringFlag(flags: Record<string, unknown>, key: string): string | undefined {
  const values = valuesForFlag(flags, key);
  return values[values.length - 1];
}

function parseLimit(flags: Record<string, unknown>): number | null {
  const raw = stringFlag(flags, "limit");
  if (!raw) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function isSortField(value: string): value is SortField {
  return VALID_SORT_FIELDS.has(value as SortField);
}

function getSortKey(entry: IndexEntry, sortField: SortField): string {
  if (sortField === "created_at") {
    return entry.created_at;
  }

  if (sortField === "last_run_at") {
    return entry.last_run_ts ?? "";
  }

  return entry.updated_at;
}

function sortEntries(entries: IndexEntry[], sortField: SortField): IndexEntry[] {
  return [...entries].sort((a, b) => {
    const aKey = getSortKey(a, sortField);
    const bKey = getSortKey(b, sortField);

    return bKey.localeCompare(aKey);
  });
}

export async function handleList(
  _args: string[],
  flags: Record<string, unknown>,
): Promise<Envelope> {
  try {
    const root = await findStoreRoot(process.cwd());
    const index = await readIndex(root);

    const states = new Set(valuesForFlag(flags, "state"));
    const tags = valuesForFlag(flags, "tag");
    const projectedOnly = isTruthyFlag(flags.projected);
    const includeArchived =
      isTruthyFlag(flags["include-archived"]) || isTruthyFlag(flags.includeArchived);

    let filtered = index.routines.filter((routine) => {
      if (!includeArchived && routine.state === "archived") {
        return false;
      }

      if (states.size > 0 && !states.has(routine.state)) {
        return false;
      }

      if (projectedOnly && !routine.projected) {
        return false;
      }

      if (tags.length > 0 && !tags.every((tag) => routine.tags.includes(tag))) {
        return false;
      }

      return true;
    });

    const sortRaw = stringFlag(flags, "sort");
    const sortField: SortField = sortRaw && isSortField(sortRaw) ? sortRaw : DEFAULT_SORT_FIELD;

    filtered = sortEntries(filtered, sortField);

    const total = filtered.length;
    const limit = parseLimit(flags);
    const routines = limit === null ? filtered : filtered.slice(0, limit);

    return okEnvelope("list", {
      routines,
      total,
    });
  } catch (error) {
    if (isNodeError(error) && error.code === "STORE_NOT_FOUND") {
      return errEnvelope("list", "STORE_NOT_FOUND", "No .mrp store found from current directory");
    }

    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      String((error as { code?: string }).code) === "STORE_NOT_FOUND"
    ) {
      const maybeMessage = (error as { message?: unknown }).message;
      const message =
        typeof maybeMessage === "string"
          ? maybeMessage
          : "No .mrp store found from current directory";
      return errEnvelope("list", "STORE_NOT_FOUND", message);
    }

    const message = error instanceof Error ? error.message : String(error);
    return errEnvelope("list", "INTERNAL_ERROR", message);
  }
}
