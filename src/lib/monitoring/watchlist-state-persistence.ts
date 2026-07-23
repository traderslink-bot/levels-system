import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type {
  PendingTradersLinkAiReadGeneration,
  TradersLinkAiReadBoundary,
  TradersLinkAiReadBoundaryState,
  TradersLinkAiReadPendingBoundaryCross,
  WatchlistEntry,
  WatchlistLifecycleState,
  WatchlistTradersLinkAiReadConfidence,
} from "./monitoring-types.js";

export type PersistedWatchlistState = {
  version: 1;
  lastUpdated: number;
  entries: WatchlistEntry[];
};

export type WatchlistStatePersistenceConfig = {
  filePath?: string;
  retentionMs?: number;
  now?: () => number;
};

const WATCHLIST_STATE_VERSION = 1;
export const DEFAULT_INACTIVE_WATCHLIST_RETENTION_MS = 3 * 24 * 60 * 60 * 1_000;
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
    value === "restoring" ||
    value === "activation_failed" ||
    value === "active" ||
    value === "stale" ||
    value === "refresh_pending" ||
    value === "extension_pending"
  );
}

function normalizeAiReadConfidence(value: unknown): WatchlistTradersLinkAiReadConfidence | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}

function normalizeOptionalTimestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeAiReadBoundaryState(value: unknown): TradersLinkAiReadBoundaryState | undefined {
  if (
    !isRecord(value) ||
    typeof value.generatedAt !== "number" ||
    !Number.isFinite(value.generatedAt) ||
    typeof value.currentPrice !== "number" ||
    !Number.isFinite(value.currentPrice) ||
    value.currentPrice <= 0
  ) {
    return undefined;
  }
  const normalizeBoundary = (price: unknown): number | null =>
    typeof price === "number" && Number.isFinite(price) && price > 0 ? price : null;
  const boundaries: TradersLinkAiReadBoundary[] = Array.isArray(value.boundaries)
    ? value.boundaries.flatMap((candidate): TradersLinkAiReadBoundary[] => {
        if (!isRecord(candidate)) {
          return [];
        }
        const role = candidate.role;
        const side = candidate.side;
        const impact = candidate.impact;
        const price = normalizeBoundary(candidate.price);
        if (
          (role !== "needsToHold" && role !== "cautionBelow" && role !== "momentumFailure" &&
            role !== "mustClear" && role !== "breakoutContinuation" && role !== "upsideTarget" &&
            role !== "downsideCheckpoint") ||
          (side !== "upside" && side !== "downside") ||
          (impact !== "hold" && impact !== "caution" && impact !== "invalidates" &&
            impact !== "improves" && impact !== "exhausts") ||
          price === null
        ) {
          return [];
        }
        return [{ role, side, impact, price }];
      })
    : [];
  const normalizePendingBoundaryCross = (
    candidate: unknown,
  ): TradersLinkAiReadPendingBoundaryCross | undefined => {
    if (!isRecord(candidate)) {
      return undefined;
    }
    const regime = typeof candidate.regime === "string" ? candidate.regime.trim() : "";
    const direction = candidate.direction;
    const boundary = normalizeBoundary(candidate.boundary);
    const firstObservedAt = normalizeOptionalTimestamp(candidate.firstObservedAt);
    const lastObservedAt = normalizeOptionalTimestamp(candidate.lastObservedAt);
    const observationCount = normalizeOptionalTimestamp(candidate.observationCount);
    const furthestPrice = normalizeBoundary(candidate.furthestPrice);
    const confirmationBufferPct = normalizeOptionalTimestamp(candidate.confirmationBufferPct);
    if (
      !regime ||
      regime.length > 160 ||
      (direction !== "upper" && direction !== "lower") ||
      boundary === null ||
      firstObservedAt === undefined ||
      lastObservedAt === undefined ||
      lastObservedAt < firstObservedAt ||
      observationCount === undefined ||
      !Number.isInteger(observationCount) ||
      observationCount < 1 ||
      furthestPrice === null ||
      confirmationBufferPct === undefined ||
      confirmationBufferPct <= 0 ||
      confirmationBufferPct > 1
    ) {
      return undefined;
    }
    return {
      regime,
      direction,
      boundary,
      firstObservedAt,
      lastObservedAt,
      observationCount,
      furthestPrice,
      confirmationBufferPct,
    };
  };
  const pendingAutomaticBoundaryCross = normalizePendingBoundaryCross(
    value.pendingAutomaticBoundaryCross,
  );
  const priorCompletePlan = isRecord(value.priorCompletePlan) &&
      isRecord(value.priorCompletePlan.plan) &&
      value.priorCompletePlan.plan.version === 4 &&
      typeof value.priorCompletePlan.plan.generationId === "string" &&
      typeof value.priorCompletePlan.plan.symbol === "string" &&
      typeof value.priorCompletePlan.referencePrice === "number" &&
      Number.isFinite(value.priorCompletePlan.referencePrice) &&
      value.priorCompletePlan.referencePrice > 0 &&
      isRecord(value.priorCompletePlan.horizonStates) &&
      typeof value.priorCompletePlan.publicationAcknowledged === "boolean"
    ? value.priorCompletePlan as unknown as TradersLinkAiReadBoundaryState["priorCompletePlan"]
    : undefined;
  return {
    generatedAt: value.generatedAt,
    currentPrice: value.currentPrice,
    upperBoundary: normalizeBoundary(value.upperBoundary),
    lowerBoundary: normalizeBoundary(value.lowerBoundary),
    ...(boundaries.length > 0 ? { boundaries } : {}),
    ...(pendingAutomaticBoundaryCross ? { pendingAutomaticBoundaryCross } : {}),
    ...(priorCompletePlan ? { priorCompletePlan } : {}),
    lastAutomaticRefreshRegime:
      typeof value.lastAutomaticRefreshRegime === "string" &&
      value.lastAutomaticRefreshRegime.length > 0 &&
      value.lastAutomaticRefreshRegime.length <= 160
        ? value.lastAutomaticRefreshRegime
        : null,
  };
}

function normalizePendingTradersLinkAiReadGeneration(
  value: unknown,
): PendingTradersLinkAiReadGeneration | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const generationId = typeof value.generationId === "string" ? value.generationId.trim() : "";
  const trigger = typeof value.trigger === "string" ? value.trigger.trim() : "";
  const createdAt = typeof value.createdAt === "number" && Number.isFinite(value.createdAt)
    ? value.createdAt
    : null;
  const boundaryState = normalizeAiReadBoundaryState(value.boundaryState);
  if (
    !generationId ||
    generationId.length > 240 ||
    !trigger ||
    trigger.length > 80 ||
    createdAt === null ||
    !boundaryState
  ) {
    return undefined;
  }
  return { generationId, trigger, createdAt, boundaryState };
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

  if (
    value.tradersLinkAiReadCardVisible !== undefined &&
    value.tradersLinkAiReadCardVisible !== null &&
    typeof value.tradersLinkAiReadCardVisible !== "boolean"
  ) {
    return null;
  }

  if (
    value.tradersLinkAiReadDipBuyPlanVisible !== undefined &&
    value.tradersLinkAiReadDipBuyPlanVisible !== null &&
    typeof value.tradersLinkAiReadDipBuyPlanVisible !== "boolean"
  ) {
    return null;
  }

  if (
    value.tradersLinkAiReadConfidence !== undefined &&
    value.tradersLinkAiReadConfidence !== null &&
    normalizeAiReadConfidence(value.tradersLinkAiReadConfidence) === undefined
  ) {
    return null;
  }

  if (
    value.lastError !== undefined &&
    value.lastError !== null &&
    typeof value.lastError !== "string"
  ) {
    return null;
  }

  if (
    value.operationStatus !== undefined &&
    value.operationStatus !== null &&
    typeof value.operationStatus !== "string"
  ) {
    return null;
  }

  if (
    value.lastThreadPostKind !== undefined &&
    value.lastThreadPostKind !== null &&
    typeof value.lastThreadPostKind !== "string"
  ) {
    return null;
  }

  const lastError =
    typeof value.lastError === "string" && value.lastError.trim().length > 0
      ? value.lastError.trim()
      : undefined;
  const operationStatus =
    typeof value.operationStatus === "string" && value.operationStatus.trim().length > 0
      ? value.operationStatus.trim()
      : undefined;
  const lastThreadPostKind =
    typeof value.lastThreadPostKind === "string" && value.lastThreadPostKind.trim().length > 0
      ? value.lastThreadPostKind.trim()
      : undefined;
  const lastTradeStoryState =
    typeof value.lastTradeStoryState === "string" && value.lastTradeStoryState.trim().length > 0
      ? value.lastTradeStoryState.trim()
      : undefined;
  const lastPrice =
    typeof value.lastPrice === "number" && Number.isFinite(value.lastPrice)
      ? value.lastPrice
      : undefined;
  const lastTriggerPrice =
    typeof value.lastTriggerPrice === "number" && Number.isFinite(value.lastTriggerPrice)
      ? value.lastTriggerPrice
      : undefined;
  const tradersLinkAiReadBoundaryState = normalizeAiReadBoundaryState(
    value.tradersLinkAiReadBoundaryState,
  );
  const pendingTradersLinkAiReadGeneration = normalizePendingTradersLinkAiReadGeneration(
    value.pendingTradersLinkAiReadGeneration,
  );

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
    manualDeactivatedAt: normalizeOptionalTimestamp(value.manualDeactivatedAt),
    lastLevelPostAt: normalizeOptionalTimestamp(value.lastLevelPostAt),
    lastExtensionPostAt: normalizeOptionalTimestamp(value.lastExtensionPostAt),
    lastPriceUpdateAt: normalizeOptionalTimestamp(value.lastPriceUpdateAt),
    ...(lastPrice !== undefined ? { lastPrice } : {}),
    lastThreadPostAt: normalizeOptionalTimestamp(value.lastThreadPostAt),
    ...(lastThreadPostKind !== undefined ? { lastThreadPostKind } : {}),
    ...(lastTradeStoryState !== undefined ? { lastTradeStoryState } : {}),
    ...(normalizeOptionalTimestamp(value.lastTradeStoryAt) !== undefined
      ? { lastTradeStoryAt: normalizeOptionalTimestamp(value.lastTradeStoryAt) }
      : {}),
    ...(lastTriggerPrice !== undefined ? { lastTriggerPrice } : {}),
    refreshPending: typeof value.refreshPending === "boolean" ? value.refreshPending : false,
    ...(typeof value.tradersLinkAiReadCardVisible === "boolean"
      ? { tradersLinkAiReadCardVisible: value.tradersLinkAiReadCardVisible }
      : {}),
    ...(typeof value.tradersLinkAiReadDipBuyPlanVisible === "boolean"
      ? { tradersLinkAiReadDipBuyPlanVisible: value.tradersLinkAiReadDipBuyPlanVisible }
      : {}),
    ...(normalizeAiReadConfidence(value.tradersLinkAiReadConfidence)
      ? { tradersLinkAiReadConfidence: normalizeAiReadConfidence(value.tradersLinkAiReadConfidence) }
      : {}),
    ...(typeof value.tradersLinkAiReadAllAttemptsFailed === "boolean"
      ? { tradersLinkAiReadAllAttemptsFailed: value.tradersLinkAiReadAllAttemptsFailed }
      : {}),
    ...(tradersLinkAiReadBoundaryState ? { tradersLinkAiReadBoundaryState } : {}),
    ...(pendingTradersLinkAiReadGeneration ? { pendingTradersLinkAiReadGeneration } : {}),
    ...(lastError !== undefined ? { lastError } : {}),
    ...(operationStatus !== undefined ? { operationStatus } : {}),
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

function latestEntryActivityAt(entry: WatchlistEntry): number | null {
  const timestamps = [
    entry.manualDeactivatedAt,
    entry.lastPriceUpdateAt,
    entry.lastThreadPostAt,
    entry.lastLevelPostAt,
    entry.lastExtensionPostAt,
    entry.activatedAt,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return timestamps.length > 0 ? Math.max(...timestamps) : null;
}

export function pruneExpiredInactiveWatchlistEntries(
  entries: WatchlistEntry[],
  now = Date.now(),
  retentionMs = DEFAULT_INACTIVE_WATCHLIST_RETENTION_MS,
): WatchlistEntry[] {
  const cutoff = now - Math.max(0, retentionMs);
  return entries.filter((entry) => {
    if (entry.active || (entry.lifecycle !== undefined && entry.lifecycle !== "inactive")) {
      return true;
    }
    const lastActivityAt = latestEntryActivityAt(entry);
    return lastActivityAt === null || lastActivityAt >= cutoff;
  });
}

function buildPersistedState(entries: WatchlistEntry[], now = Date.now()): PersistedWatchlistState {
  return {
    version: WATCHLIST_STATE_VERSION,
    lastUpdated: now,
    entries: entries.map((entry) => ({
      symbol: entry.symbol.toUpperCase(),
      active: entry.active,
      priority: entry.priority,
      tags: [...entry.tags],
      note: entry.note?.trim() || undefined,
      discordThreadId: entry.discordThreadId?.trim() || null,
      lifecycle: entry.lifecycle ?? (entry.active ? "active" : "inactive"),
      activatedAt: normalizeOptionalTimestamp(entry.activatedAt),
      manualDeactivatedAt: normalizeOptionalTimestamp(entry.manualDeactivatedAt),
      lastLevelPostAt: normalizeOptionalTimestamp(entry.lastLevelPostAt),
      lastExtensionPostAt: normalizeOptionalTimestamp(entry.lastExtensionPostAt),
      lastPriceUpdateAt: normalizeOptionalTimestamp(entry.lastPriceUpdateAt),
      lastPrice:
        typeof entry.lastPrice === "number" && Number.isFinite(entry.lastPrice) && entry.lastPrice > 0
          ? entry.lastPrice
          : undefined,
      lastThreadPostAt: normalizeOptionalTimestamp(entry.lastThreadPostAt),
      lastThreadPostKind: entry.lastThreadPostKind?.trim() || undefined,
      refreshPending: entry.refreshPending ?? false,
      ...(typeof entry.tradersLinkAiReadCardVisible === "boolean"
        ? { tradersLinkAiReadCardVisible: entry.tradersLinkAiReadCardVisible }
        : {}),
      ...(typeof entry.tradersLinkAiReadDipBuyPlanVisible === "boolean"
        ? { tradersLinkAiReadDipBuyPlanVisible: entry.tradersLinkAiReadDipBuyPlanVisible }
        : {}),
      ...(normalizeAiReadConfidence(entry.tradersLinkAiReadConfidence)
        ? { tradersLinkAiReadConfidence: normalizeAiReadConfidence(entry.tradersLinkAiReadConfidence) }
        : {}),
      ...(typeof entry.tradersLinkAiReadAllAttemptsFailed === "boolean"
        ? { tradersLinkAiReadAllAttemptsFailed: entry.tradersLinkAiReadAllAttemptsFailed }
        : {}),
      ...(normalizeAiReadBoundaryState(entry.tradersLinkAiReadBoundaryState)
        ? { tradersLinkAiReadBoundaryState: normalizeAiReadBoundaryState(entry.tradersLinkAiReadBoundaryState) }
        : {}),
      ...(normalizePendingTradersLinkAiReadGeneration(entry.pendingTradersLinkAiReadGeneration)
        ? {
            pendingTradersLinkAiReadGeneration: normalizePendingTradersLinkAiReadGeneration(
              entry.pendingTradersLinkAiReadGeneration,
            ),
          }
        : {}),
      lastError: entry.lastError?.trim() || undefined,
      operationStatus: entry.operationStatus?.trim() || undefined,
    })),
  };
}

export class WatchlistStatePersistence {
  private readonly filePath: string;
  private readonly retentionMs: number;
  private readonly now: () => number;

  constructor(config: WatchlistStatePersistenceConfig = {}) {
    this.filePath = config.filePath ?? DEFAULT_WATCHLIST_STATE_FILE;
    this.retentionMs = config.retentionMs ?? DEFAULT_INACTIVE_WATCHLIST_RETENTION_MS;
    this.now = config.now ?? Date.now;
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

      return pruneExpiredInactiveWatchlistEntries(validated.entries, this.now(), this.retentionMs);
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
    const now = this.now();
    const persisted = buildPersistedState(
      pruneExpiredInactiveWatchlistEntries(entries, now, this.retentionMs),
      now,
    );

    try {
      mkdirSync(directory, { recursive: true });
      writeFileSync(tempFilePath, `${JSON.stringify(persisted)}\n`, "utf8");
      renameSync(tempFilePath, this.filePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[WatchlistStatePersistence] Failed to save watchlist state to ${this.filePath}: ${message}`,
      );
    }
  }
}
