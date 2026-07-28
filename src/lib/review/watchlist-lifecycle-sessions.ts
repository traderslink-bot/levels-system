import { existsSync, readFileSync } from "node:fs";

import type { LiveWatchlistAuditArchive } from "../live-watchlist/live-watchlist-audit-archive.js";
import type { ManualWatchlistLifecycleEvent } from "../monitoring/manual-watchlist-runtime-events.js";
import type { WatchlistEntry, WatchlistLifecycleState } from "../monitoring/monitoring-types.js";

export type WatchlistLifecycleSampleScope =
  | "active_window"
  | "restart_restore_window"
  | "archive_only"
  | "outside_active_window"
  | "unknown_lifecycle";

export type WatchlistLifecycleSessionSource = "archive" | "state" | "event_log";

export type WatchlistLifecycleSession = {
  symbol: string;
  startedAt: number;
  endedAt: number | null;
  source: WatchlistLifecycleSessionSource;
  status: string;
  lifecycle?: WatchlistLifecycleState;
  firstPostedAt?: number | null;
};

type PersistedWatchlistStatePayload = {
  entries?: WatchlistEntry[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeSymbol(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const symbol = value.trim().toUpperCase();
  return symbol.length > 0 ? symbol : null;
}

function latestTimestamp(values: unknown[]): number | null {
  return values.reduce<number | null>((latest, value) => {
    const timestamp = finiteTimestamp(value);
    return timestamp === null ? latest : Math.max(latest ?? timestamp, timestamp);
  }, null);
}

function eventTimestamp(event: ManualWatchlistLifecycleEvent): number | null {
  return finiteTimestamp(event.timestamp);
}

function eventSymbol(event: ManualWatchlistLifecycleEvent): string | null {
  return normalizeSymbol(event.symbol);
}

export function buildWatchlistLifecycleSessionsFromArchive(
  archive: LiveWatchlistAuditArchive | null | undefined,
): WatchlistLifecycleSession[] {
  if (!archive?.symbols?.length) {
    return [];
  }

  const sessions: WatchlistLifecycleSession[] = [];
  for (const item of archive.symbols) {
    const symbol = normalizeSymbol(item.symbol);
    const startedAt = finiteTimestamp(item.firstPostedAt) ?? finiteTimestamp(item.firstSeenAt);
    if (!symbol || startedAt === null) {
      continue;
    }

    const status = typeof item.status === "string" ? item.status : "archived";
    const lastSeenAt = finiteTimestamp(item.lastSeenAt) ?? finiteTimestamp(item.updatedAt) ?? finiteTimestamp(item.archivedAt);
    const endedAt = status === "live" ? null : lastSeenAt;
    sessions.push({
      symbol,
      startedAt,
      endedAt,
      source: "archive",
      status,
      firstPostedAt: finiteTimestamp(item.firstPostedAt),
    });
  }
  return sessions;
}

export function buildWatchlistLifecycleSessionsFromState(entries: WatchlistEntry[] | null | undefined): WatchlistLifecycleSession[] {
  if (!entries?.length) {
    return [];
  }

  const sessions: WatchlistLifecycleSession[] = [];
  for (const entry of entries) {
    const symbol = normalizeSymbol(entry.symbol);
    const startedAt = finiteTimestamp(entry.activatedAt);
    if (!symbol || startedAt === null) {
      continue;
    }

    const lifecycle = entry.lifecycle ?? (entry.active ? "active" : "inactive");
    const endedAt = entry.active
      ? null
      : latestTimestamp([
          entry.lastPriceUpdateAt,
          entry.lastThreadPostAt,
          entry.lastLevelPostAt,
          entry.lastExtensionPostAt,
          entry.lastTradeStoryAt,
          entry.activatedAt,
        ]);
    sessions.push({
      symbol,
      startedAt,
      endedAt,
      source: "state",
      status: entry.active ? "live" : "inactive",
      lifecycle,
    });
  }
  return sessions;
}

export function buildWatchlistLifecycleSessionsFromEvents(
  events: ManualWatchlistLifecycleEvent[] | null | undefined,
): WatchlistLifecycleSession[] {
  if (!events?.length) {
    return [];
  }

  const sessions: WatchlistLifecycleSession[] = [];
  const openBySymbol = new Map<string, WatchlistLifecycleSession>();
  const sortedEvents = [...events].sort((left, right) => (eventTimestamp(left) ?? 0) - (eventTimestamp(right) ?? 0));

  for (const event of sortedEvents) {
    const symbol = eventSymbol(event);
    const timestamp = eventTimestamp(event);
    if (!symbol || timestamp === null) {
      continue;
    }

    const existing = openBySymbol.get(symbol);
    if (event.event === "activation_queued" || event.event === "activation_started") {
      if (!existing) {
        openBySymbol.set(symbol, {
          symbol,
          startedAt: timestamp,
          endedAt: null,
          source: "event_log",
          status: "activating",
          lifecycle: "activating",
        });
      }
      continue;
    }

    if (event.event === "activation_completed") {
      const session = existing ?? {
        symbol,
        startedAt: timestamp,
        endedAt: null,
        source: "event_log" as const,
        status: "live",
        lifecycle: "active" as const,
      };
      session.status = "live";
      session.lifecycle = "active";
      session.firstPostedAt = session.firstPostedAt ?? timestamp;
      openBySymbol.set(symbol, session);
      continue;
    }

    if (event.event === "restore_started") {
      openBySymbol.set(symbol, {
        symbol,
        startedAt: existing?.startedAt ?? timestamp,
        endedAt: null,
        source: "event_log",
        status: "restoring",
        lifecycle: "restoring",
        firstPostedAt: existing?.firstPostedAt ?? null,
      });
      continue;
    }

    if (event.event === "restore_completed") {
      const session = existing ?? {
        symbol,
        startedAt: timestamp,
        endedAt: null,
        source: "event_log" as const,
        status: "restoring",
        lifecycle: "restoring" as const,
      };
      session.status = "restoring";
      session.lifecycle = "restoring";
      session.endedAt = timestamp;
      session.firstPostedAt = session.firstPostedAt ?? timestamp;
      sessions.push(session);
      openBySymbol.set(symbol, {
        symbol,
        startedAt: timestamp,
        endedAt: null,
        source: "event_log",
        status: "live",
        lifecycle: "active",
        firstPostedAt: timestamp,
      });
      continue;
    }

    if (event.event === "deactivated") {
      if (existing) {
        existing.endedAt = timestamp;
        if (existing.status !== "live" && existing.status !== "restoring") {
          existing.status = "live";
        }
        sessions.push(existing);
        openBySymbol.delete(symbol);
      }
      continue;
    }

    if (
      event.event === "activation_failed" ||
      event.event === "activation_marked_failed" ||
      event.event === "restore_failed"
    ) {
      if (existing) {
        existing.endedAt = timestamp;
        existing.status = "failed";
        sessions.push(existing);
        openBySymbol.delete(symbol);
      }
    }
  }

  sessions.push(...openBySymbol.values());
  return sessions;
}

export function groupWatchlistLifecycleSessionsBySymbol(
  sessions: WatchlistLifecycleSession[],
): Record<string, WatchlistLifecycleSession[]> {
  const grouped: Record<string, WatchlistLifecycleSession[]> = {};
  for (const session of sessions) {
    const symbol = session.symbol.toUpperCase();
    grouped[symbol] = [...(grouped[symbol] ?? []), session];
  }
  for (const symbol of Object.keys(grouped)) {
    grouped[symbol] = grouped[symbol]!.sort((left, right) => left.startedAt - right.startedAt);
  }
  return grouped;
}

export function classifyWatchlistLifecycleScope(params: {
  symbol: string;
  timestamp: number;
  sessionsBySymbol?: Record<string, WatchlistLifecycleSession[]>;
}): WatchlistLifecycleSampleScope {
  const sessions = params.sessionsBySymbol?.[params.symbol.toUpperCase()] ?? [];
  if (sessions.length === 0) {
    return "unknown_lifecycle";
  }

  const matching = sessions.filter((session) => (
    params.timestamp >= session.startedAt &&
    (session.endedAt === null || params.timestamp <= session.endedAt)
  ));
  if (matching.length === 0) {
    return "outside_active_window";
  }

  if (matching.some((session) => session.lifecycle === "restoring" || session.status === "restoring")) {
    return "restart_restore_window";
  }
  if (matching.some((session) => session.source === "event_log" && session.status === "live")) {
    return "active_window";
  }
  if (matching.some((session) => session.source === "state" && session.status === "live")) {
    return "active_window";
  }
  if (matching.some((session) => session.source === "archive" && session.status === "live")) {
    return "active_window";
  }
  if (matching.some((session) => session.source === "archive")) {
    return "archive_only";
  }
  return "outside_active_window";
}

function readJsonFile(filePath: string): unknown | null {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")) as unknown;
  } catch {
    return null;
  }
}

function readLifecycleEventsFile(filePath: string): ManualWatchlistLifecycleEvent[] {
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    return readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown)
      .filter((value): value is ManualWatchlistLifecycleEvent => (
        isRecord(value) &&
        value.type === "manual_watchlist_lifecycle" &&
        typeof value.event === "string" &&
        typeof value.timestamp === "number"
      ));
  } catch {
    return [];
  }
}

export function readWatchlistLifecycleSessionsFromFiles(options: {
  archivePath?: string | null;
  statePath?: string | null;
  eventLogPath?: string | null;
}): WatchlistLifecycleSession[] {
  const sessions: WatchlistLifecycleSession[] = [];
  if (options.eventLogPath) {
    sessions.push(...buildWatchlistLifecycleSessionsFromEvents(readLifecycleEventsFile(options.eventLogPath)));
  }

  const archivePayload = options.archivePath ? readJsonFile(options.archivePath) : null;
  if (isRecord(archivePayload) && archivePayload.version === 1 && Array.isArray(archivePayload.symbols)) {
    sessions.push(...buildWatchlistLifecycleSessionsFromArchive(archivePayload as LiveWatchlistAuditArchive));
  }

  const statePayload = options.statePath ? readJsonFile(options.statePath) : null;
  if (isRecord(statePayload) && Array.isArray((statePayload as PersistedWatchlistStatePayload).entries)) {
    sessions.push(...buildWatchlistLifecycleSessionsFromState((statePayload as PersistedWatchlistStatePayload).entries));
  }
  return sessions;
}

export function emptyLifecycleScopeCounts(): Record<WatchlistLifecycleSampleScope, number> {
  return {
    active_window: 0,
    restart_restore_window: 0,
    archive_only: 0,
    outside_active_window: 0,
    unknown_lifecycle: 0,
  };
}
