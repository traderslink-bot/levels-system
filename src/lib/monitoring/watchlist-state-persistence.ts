import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { WatchlistEntry, WatchlistLifecycleState } from "./monitoring-types.js";

export type PersistedWatchlistState = {
  version: 1;
  lastUpdated: number;
  entries: WatchlistEntry[];
};

export type WatchlistStatePersistenceConfig = {
  filePath?: string;
};

const WATCHLIST_STATE_VERSION = 1;
const DEFAULT_WATCHLIST_STATE_FILE = resolve(
  process.cwd(),
  "artifacts",
  "manual-watchlist-state.json",
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isLifecycle(value: unknown): value is WatchlistLifecycleState {
  return (
    value === "inactive" ||
    value === "activating" ||
    value === "active" ||
    value === "stale" ||
    value === "refresh_pending" ||
    value === "extension_pending"
  );
}

function normalizeOptionalTimestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function validateEntry(value: unknown): WatchlistEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.symbol !== "string" ||
    value.symbol.trim().length === 0 ||
    typeof value.active !== "boolean" ||
    typeof value.priority !== "number" ||
    !Number.isInteger(value.priority) ||
    value.priority < 1 ||
    !isStringArray(value.tags)
  ) {
    return null;
  }

  if (
    value.note !== undefined &&
    value.note !== null &&
    typeof value.note !== "string"
  ) {
    return null;
  }

  if (
    value.discordThreadId !== undefined &&
    value.discordThreadId !== null &&
    typeof value.discordThreadId !== "string"
  ) {
    return null;
  }

  if (value.lifecycle !== undefined && value.lifecycle !== null && !isLifecycle(value.lifecycle)) {
    return null;
  }

  if (
    value.refreshPending !== undefined &&
    value.refreshPending !== null &&
    typeof value.refreshPending !== "boolean"
  ) {
    return null;
  }

  return {
    symbol: value.symbol.trim().toUpperCase(),
    active: value.active,
    priority: value.priority,
    tags: [...value.tags],
    note:
      typeof value.note === "string" && value.note.trim().length > 0
        ? value.note.trim()
        : undefined,
    discordThreadId:
      typeof value.discordThreadId === "string" && value.discordThreadId.trim().length > 0
        ? value.discordThreadId.trim()
        : null,
    lifecycle:
      typeof value.lifecycle === "string"
        ? value.lifecycle
        : value.active
          ? "active"
          : "inactive",
    activatedAt: normalizeOptionalTimestamp(value.activatedAt),
    lastLevelPostAt: normalizeOptionalTimestamp(value.lastLevelPostAt),
    lastExtensionPostAt: normalizeOptionalTimestamp(value.lastExtensionPostAt),
    refreshPending: typeof value.refreshPending === "boolean" ? value.refreshPending : false,
  };
}

function validatePersistedState(value: unknown): PersistedWatchlistState | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.version !== WATCHLIST_STATE_VERSION ||
    typeof value.lastUpdated !== "number" ||
    !Number.isFinite(value.lastUpdated) ||
    !Array.isArray(value.entries)
  ) {
    return null;
  }

  const entries: WatchlistEntry[] = [];
  const seenSymbols = new Set<string>();

  for (const item of value.entries) {
    const entry = validateEntry(item);
    if (!entry || seenSymbols.has(entry.symbol)) {
      return null;
    }

    seenSymbols.add(entry.symbol);
    entries.push(entry);
  }

  return {
    version: WATCHLIST_STATE_VERSION,
    lastUpdated: value.lastUpdated,
    entries,
  };
}

function buildPersistedState(entries: WatchlistEntry[]): PersistedWatchlistState {
  return {
    version: WATCHLIST_STATE_VERSION,
    lastUpdated: Date.now(),
    entries: entries.map((entry) => ({
      symbol: entry.symbol.toUpperCase(),
      active: entry.active,
      priority: entry.priority,
      tags: [...entry.tags],
      note: entry.note?.trim() || undefined,
      discordThreadId: entry.discordThreadId?.trim() || null,
      lifecycle: entry.lifecycle ?? (entry.active ? "active" : "inactive"),
      activatedAt: normalizeOptionalTimestamp(entry.activatedAt),
      lastLevelPostAt: normalizeOptionalTimestamp(entry.lastLevelPostAt),
      lastExtensionPostAt: normalizeOptionalTimestamp(entry.lastExtensionPostAt),
      refreshPending: entry.refreshPending ?? false,
    })),
  };
}

export class WatchlistStatePersistence {
  private readonly filePath: string;

  constructor(config: WatchlistStatePersistenceConfig = {}) {
    this.filePath = config.filePath ?? DEFAULT_WATCHLIST_STATE_FILE;
  }

  getFilePath(): string {
    return this.filePath;
  }

  load(): WatchlistEntry[] | null {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      const validated = validatePersistedState(parsed);

      if (!validated) {
        console.error(
          `[WatchlistStatePersistence] Discarded invalid watchlist state file at ${this.filePath}.`,
        );
        return null;
      }

      return validated.entries;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `[WatchlistStatePersistence] Failed to load watchlist state from ${this.filePath}: ${message}`,
        );
      }

      return null;
    }
  }

  save(entries: WatchlistEntry[]): void {
    const directory = dirname(this.filePath);
    const tempFilePath = `${this.filePath}.tmp`;
    const persisted = buildPersistedState(entries);

    try {
      mkdirSync(directory, { recursive: true });
      writeFileSync(tempFilePath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
      renameSync(tempFilePath, this.filePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[WatchlistStatePersistence] Failed to save watchlist state to ${this.filePath}: ${message}`,
      );
    }
  }
}
