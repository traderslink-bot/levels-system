import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { AdaptiveStabilityState } from "./adaptive-stability.js";

export type AdaptiveStatePersistenceConfig = {
  minMultiplier: number;
  maxMultiplier: number;
  filePath?: string;
};

export type PersistedAdaptiveEventTypeState = {
  multiplier: number;
  disabled: boolean;
  weakStreak: number;
};

export type PersistedAdaptiveState = {
  version: 1;
  lastUpdated: number;
  globalMultiplier: number;
  eventTypes: Record<string, PersistedAdaptiveEventTypeState>;
};

const ADAPTIVE_STATE_VERSION = 1;
const DEFAULT_ADAPTIVE_STATE_FILE = resolve(process.cwd(), "artifacts", "adaptive-state.json");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function buildPersistedState(
  state: AdaptiveStabilityState,
): PersistedAdaptiveState {
  return {
    version: ADAPTIVE_STATE_VERSION,
    lastUpdated: Date.now(),
    globalMultiplier: state.globalMultiplier,
    eventTypes: Object.fromEntries(
      Object.entries(state.eventTypes).map(([eventType, value]) => [
        eventType,
        {
          multiplier: value.multiplier,
          disabled: value.disabled,
          weakStreak: value.weakUpdateStreak,
        },
      ]),
    ),
  };
}

function validatePersistedState(
  value: unknown,
  config: AdaptiveStatePersistenceConfig,
): PersistedAdaptiveState | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.version !== ADAPTIVE_STATE_VERSION || !isFiniteNumber(value.lastUpdated)) {
    return null;
  }

  if (
    !isFiniteNumber(value.globalMultiplier) ||
    value.globalMultiplier < config.minMultiplier ||
    value.globalMultiplier > config.maxMultiplier
  ) {
    return null;
  }

  if (!isRecord(value.eventTypes)) {
    return null;
  }

  const normalizedEventTypes: PersistedAdaptiveState["eventTypes"] = {};

  for (const [eventType, eventValue] of Object.entries(value.eventTypes)) {
    if (!isRecord(eventValue)) {
      return null;
    }

    const multiplier = eventValue.multiplier;
    const disabled = eventValue.disabled;
    const weakStreak = eventValue.weakStreak;

    if (
      !isFiniteNumber(multiplier) ||
      multiplier < config.minMultiplier ||
      multiplier > config.maxMultiplier ||
      typeof disabled !== "boolean" ||
      typeof weakStreak !== "number" ||
      !Number.isInteger(weakStreak) ||
      weakStreak < 0
    ) {
      return null;
    }

    normalizedEventTypes[eventType] = {
      multiplier,
      disabled,
      weakStreak,
    };
  }

  return {
    version: ADAPTIVE_STATE_VERSION,
    lastUpdated: value.lastUpdated,
    globalMultiplier: value.globalMultiplier,
    eventTypes: normalizedEventTypes,
  };
}

function hydrateAdaptiveStabilityState(
  persisted: PersistedAdaptiveState,
): AdaptiveStabilityState {
  return {
    globalMultiplier: persisted.globalMultiplier,
    eventTypes: Object.fromEntries(
      Object.entries(persisted.eventTypes).map(([eventType, value]) => [
        eventType,
        {
          eventType,
          multiplier: value.multiplier,
          disabled: value.disabled,
          disableReason: value.disabled ? "persisted_disabled_state" : null,
          weakUpdateStreak: value.weakStreak,
        },
      ]),
    ),
  };
}

export class AdaptiveStatePersistence {
  private readonly filePath: string;

  constructor(private readonly config: AdaptiveStatePersistenceConfig) {
    this.filePath = config.filePath ?? DEFAULT_ADAPTIVE_STATE_FILE;
  }

  getFilePath(): string {
    return this.filePath;
  }

  load(): AdaptiveStabilityState | null {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      const validated = validatePersistedState(parsed, this.config);

      if (!validated) {
        console.error(`[AdaptiveStatePersistence] Discarded invalid adaptive state file at ${this.filePath}.`);
        return null;
      }

      return hydrateAdaptiveStabilityState(validated);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[AdaptiveStatePersistence] Failed to load adaptive state from ${this.filePath}: ${message}`);
      }

      return null;
    }
  }

  save(state: AdaptiveStabilityState): void {
    const persisted = buildPersistedState(state);
    const directory = dirname(this.filePath);
    const tempFilePath = `${this.filePath}.tmp`;

    try {
      mkdirSync(directory, { recursive: true });
      writeFileSync(tempFilePath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
      renameSync(tempFilePath, this.filePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[AdaptiveStatePersistence] Failed to save adaptive state to ${this.filePath}: ${message}`);
    }
  }
}

export function createAdaptiveStatePersistence(
  config: AdaptiveStatePersistenceConfig,
): AdaptiveStatePersistence {
  return new AdaptiveStatePersistence(config);
}
