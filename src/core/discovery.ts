import {
  DEFAULT_DISCOVERY_STATE,
  parseDiscoveryState,
  type DiscoveryState,
} from "../schema/discovery-state.ts";
import type { Config } from "../schema/config.ts";
import type { Index, IndexEntry } from "../schema/index-schema.ts";
import { discoveryStatePath } from "./store.ts";
import { MUTATING_COMMANDS } from "./lifecycle.ts";
import { readYamlFile, writeYamlAtomic } from "../util/yaml-io.ts";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type DiscoverySuggestion = {
  routine_id: string;
  name: string;
  reason: string;
  suggested_actions: string[];
};

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function parseTimestamp(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function newestRoutineTimestamp(entry: IndexEntry): number {
  const createdTs = parseTimestamp(entry.created_at) ?? 0;
  const updatedTs = parseTimestamp(entry.updated_at) ?? 0;
  return Math.max(createdTs, updatedTs);
}

function isDiscoveryExcludedState(state: string): boolean {
  return state === "archived" || state === "deprecated" || state === "quarantine";
}

export async function readDiscoveryState(root: string): Promise<DiscoveryState> {
  try {
    const raw = await readYamlFile<unknown>(discoveryStatePath(root));
    if (raw === null || raw === undefined) {
      return { ...DEFAULT_DISCOVERY_STATE, suggested_routines: {} };
    }

    return parseDiscoveryState(raw);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { ...DEFAULT_DISCOVERY_STATE, suggested_routines: {} };
    }

    throw error;
  }
}

export async function writeDiscoveryState(root: string, state: DiscoveryState): Promise<void> {
  await writeYamlAtomic(discoveryStatePath(root), state);
}

export function isRateLimitExpired(
  lastEmissionTs: string | null,
  now: Date,
  rateLimitMinutes: number,
): boolean {
  const last = parseTimestamp(lastEmissionTs);
  if (last === null) {
    return true;
  }

  return now.getTime() - last >= rateLimitMinutes * MINUTE_MS;
}

export function isRoutineCooldownExpired(
  lastSuggestedTs: string,
  now: Date,
  cooldownHours: number,
): boolean {
  const last = parseTimestamp(lastSuggestedTs);
  if (last === null) {
    return true;
  }

  return now.getTime() - last >= cooldownHours * HOUR_MS;
}

export function generateDiscoverySuggestions(params: {
  now: Date;
  config: Config;
  discoveryState: DiscoveryState;
  index: Index;
}): DiscoverySuggestion[] {
  const { now, config, discoveryState, index } = params;
  const recentCutoff = now.getTime() - config.discovery.recent_window_days * DAY_MS;

  const eligible = index.routines.filter((entry) => {
    if (isDiscoveryExcludedState(entry.state)) {
      return false;
    }

    if (entry.state !== "draft" && entry.state !== "active") {
      return false;
    }

    if (newestRoutineTimestamp(entry) < recentCutoff) {
      return false;
    }

    const lastSuggested = discoveryState.suggested_routines[entry.id]?.last_suggested_ts;
    if (!lastSuggested) {
      return true;
    }

    return isRoutineCooldownExpired(lastSuggested, now, config.discovery.cooldown_hours);
  });

  const sorted = eligible.sort((a, b) => {
    return newestRoutineTimestamp(b) - newestRoutineTimestamp(a);
  });

  return sorted.slice(0, config.discovery.max_suggestions).map((entry) => {
    const untried = entry.last_run_ts === null;

    if (entry.state === "draft") {
      return {
        routine_id: entry.id,
        name: entry.name,
        reason: untried ? "recent_draft_untried" : "recent_draft",
        suggested_actions: [`mrp show ${entry.id}`],
      };
    }

    return {
      routine_id: entry.id,
      name: entry.name,
      reason: untried ? "recent_active_untried" : "recent_active",
      suggested_actions: [`mrp show ${entry.id}`, `mrp run ${entry.id}`],
    };
  });
}

export function shouldEmitDiscovery(params: {
  commandName: string;
  isMutating: boolean;
  discoveryState: DiscoveryState;
  config: Config;
  now: Date;
}): boolean {
  const { commandName, isMutating, discoveryState, config, now } = params;

  if (!config.discovery.enabled) {
    return false;
  }

  const mutating = isMutating || MUTATING_COMMANDS.has(commandName);
  if (mutating) {
    return true;
  }

  return isRateLimitExpired(
    discoveryState.last_emission_ts,
    now,
    config.discovery.rate_limit_minutes,
  );
}

export async function generateDiscoveryFooter(params: {
  root: string;
  commandName: string;
  isMutating: boolean;
  config: Config;
  index: Index;
}): Promise<{ discovery: { suggestions: DiscoverySuggestion[] } } | null> {
  const { root, commandName, isMutating, config, index } = params;
  const discoveryState = await readDiscoveryState(root);
  const now = new Date();

  if (!shouldEmitDiscovery({ commandName, isMutating, discoveryState, config, now })) {
    return null;
  }

  const suggestions = generateDiscoverySuggestions({ now, config, discoveryState, index });
  const emittedAt = now.toISOString();
  const nextState: DiscoveryState = {
    last_emission_ts: emittedAt,
    suggested_routines: { ...discoveryState.suggested_routines },
  };

  for (const suggestion of suggestions) {
    nextState.suggested_routines[suggestion.routine_id] = {
      last_suggested_ts: emittedAt,
    };
  }

  await writeDiscoveryState(root, nextState);

  return {
    discovery: {
      suggestions,
    },
  };
}

export function checkProjectionAutoSuggest(params: {
  routine: {
    id: string;
    projection: { projected: boolean; eligible: boolean };
    lifecycle: { state: string };
  };
  ledger: { runs: Array<{ timing: { started_at: string } }> };
  config: Config;
  now: Date;
}): { routine_id: string; suggested_command: string; reason: string } | null {
  const { routine, ledger, config, now } = params;

  if (!config.projection.enabled) {
    return null;
  }

  if (routine.projection.projected || !routine.projection.eligible) {
    return null;
  }

  if (routine.lifecycle.state !== "active") {
    return null;
  }

  const windowCutoff = now.getTime() - config.projection.auto_suggest_window_days * DAY_MS;
  const runsInWindow = ledger.runs.filter((run) => {
    const startedTs = parseTimestamp(run.timing.started_at);
    return startedTs !== null && startedTs >= windowCutoff;
  }).length;

  if (runsInWindow < config.projection.auto_suggest_threshold_runs) {
    return null;
  }

  return {
    routine_id: routine.id,
    suggested_command: `mrp promote ${routine.id}`,
    reason: "frequent_recent_runs",
  };
}
