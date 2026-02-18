export type LifecycleState =
  | "draft"
  | "active"
  | "deprecated"
  | "archived"
  | "quarantine";

export const ALLOWED_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  draft: ["active", "quarantine"],
  active: ["deprecated", "quarantine"],
  deprecated: ["archived", "quarantine"],
  archived: ["quarantine"],
  quarantine: ["draft", "quarantine"],
};

const TRANSITION_GRAPH: Record<LifecycleState, LifecycleState[]> = {
  ...ALLOWED_TRANSITIONS,
};

function formatPath(path: LifecycleState[]): string {
  return path.join(" → ");
}

function findValidPath(from: LifecycleState, to: LifecycleState): LifecycleState[] | null {
  if (from === to) {
    return [from];
  }

  const queue: LifecycleState[][] = [[from]];
  const seen = new Set<LifecycleState>([from]);

  while (queue.length > 0) {
    const path = queue.shift();
    if (!path) {
      continue;
    }

    const current = path[path.length - 1];
    if (!current) {
      continue;
    }
    const neighbors = TRANSITION_GRAPH[current] ?? [];

    for (const next of neighbors) {
      if (next === to) {
        return [...path, next];
      }

      if (!seen.has(next)) {
        seen.add(next);
        queue.push([...path, next]);
      }
    }
  }

  return null;
}

export function validateTransition(
  from: LifecycleState,
  to: LifecycleState,
  opts?: { fromQuarantine?: boolean },
): { valid: boolean; error?: string } {
  if (from === "quarantine" && to === "draft" && opts?.fromQuarantine !== true) {
    return {
      valid: false,
      error:
        "Cannot transition from 'quarantine' to 'draft' without the --from-quarantine flag.",
    };
  }

  if (to === "quarantine") {
    return { valid: true };
  }

  const allowedTargets = ALLOWED_TRANSITIONS[from] ?? [];
  if (allowedTargets.includes(to)) {
    return { valid: true };
  }

  const validPath = findValidPath(from, to);
  if (validPath && validPath.length > 1) {
    return {
      valid: false,
      error: `Cannot transition from '${from}' to '${to}'. Valid path: ${formatPath(validPath)}`,
    };
  }

  return {
    valid: false,
    error: `Cannot transition from '${from}' to '${to}'.`,
  };
}

export const MUTATING_COMMANDS = new Set([
  "create",
  "edit",
  "run",
  "promote",
  "demote",
  "deprecate",
  "archive",
  "quarantine",
  "prune",
]);

export function isRunnable(
  state: LifecycleState,
): { runnable: boolean; needsForce: boolean; warning?: string } {
  if (state === "draft" || state === "active") {
    return { runnable: true, needsForce: false };
  }

  if (state === "deprecated") {
    return {
      runnable: true,
      needsForce: false,
      warning: "Routine is deprecated",
    };
  }

  if (state === "archived" || state === "quarantine") {
    return {
      runnable: false,
      needsForce: true,
    };
  }

  return {
    runnable: false,
    needsForce: true,
  };
}
