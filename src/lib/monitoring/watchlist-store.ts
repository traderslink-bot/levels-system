// 2026-04-14 09:28 PM America/Toronto
// In-memory watchlist store with manual activate/deactivate operations.

import type {
  TradersLinkAiReadBoundaryState,
  WatchlistEntry,
  WatchlistLifecycleState,
} from "./monitoring-types.js";

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function normalizeFiniteTimestamp(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeAiReadBoundaryState(
  value: TradersLinkAiReadBoundaryState | undefined,
): TradersLinkAiReadBoundaryState | undefined {
  if (
    !value ||
    !Number.isFinite(value.generatedAt) ||
    !Number.isFinite(value.currentPrice) ||
    value.currentPrice <= 0
  ) {
    return undefined;
  }
  const boundary = (price: number | null): number | null =>
    typeof price === "number" && Number.isFinite(price) && price > 0 ? price : null;
  return {
    generatedAt: value.generatedAt,
    currentPrice: value.currentPrice,
    upperBoundary: boundary(value.upperBoundary),
    lowerBoundary: boundary(value.lowerBoundary),
  };
}

export class WatchlistStore {
  private readonly entries = new Map<string, WatchlistEntry>();

  private normalizeEntry(entry: WatchlistEntry): WatchlistEntry {
    const lifecycle = entry.lifecycle ?? (entry.active ? "active" : "inactive");
    const activatedAt = normalizeFiniteTimestamp(entry.activatedAt);
    const lastLevelPostAt = normalizeFiniteTimestamp(entry.lastLevelPostAt);
    const lastExtensionPostAt = normalizeFiniteTimestamp(entry.lastExtensionPostAt);
    const lastPriceUpdateAt = normalizeFiniteTimestamp(entry.lastPriceUpdateAt);
    const lastPrice =
      typeof entry.lastPrice === "number" && Number.isFinite(entry.lastPrice) && entry.lastPrice > 0
        ? entry.lastPrice
        : undefined;
    const lastThreadPostAt = normalizeFiniteTimestamp(entry.lastThreadPostAt);
    const lastError = entry.lastError?.trim() || undefined;
    const operationStatus = entry.operationStatus?.trim() || undefined;
    const lastThreadPostKind = entry.lastThreadPostKind?.trim() || undefined;
    const tradersLinkAiReadBoundaryState = normalizeAiReadBoundaryState(
      entry.tradersLinkAiReadBoundaryState,
    );

    return {
      symbol: normalizeSymbol(entry.symbol),
      active: entry.active,
      priority: entry.priority,
      tags: [...entry.tags],
      note: entry.note?.trim() || undefined,
      discordThreadId: entry.discordThreadId?.trim() || null,
      lifecycle,
      refreshPending: entry.refreshPending ?? false,
      ...(activatedAt !== undefined ? { activatedAt } : {}),
      ...(lastLevelPostAt !== undefined ? { lastLevelPostAt } : {}),
      ...(lastExtensionPostAt !== undefined ? { lastExtensionPostAt } : {}),
      ...(lastPriceUpdateAt !== undefined ? { lastPriceUpdateAt } : {}),
      ...(lastPrice !== undefined ? { lastPrice } : {}),
      ...(lastThreadPostAt !== undefined ? { lastThreadPostAt } : {}),
      ...(lastThreadPostKind !== undefined ? { lastThreadPostKind } : {}),
      ...(lastError !== undefined ? { lastError } : {}),
      ...(operationStatus !== undefined ? { operationStatus } : {}),
      ...(typeof entry.tradersLinkAiReadCardVisible === "boolean"
        ? { tradersLinkAiReadCardVisible: entry.tradersLinkAiReadCardVisible }
        : {}),
      ...(tradersLinkAiReadBoundaryState
        ? { tradersLinkAiReadBoundaryState }
        : {}),
    };
  }

  private getNextPriority(): number {
    const currentMax = [...this.entries.values()].reduce(
      (max, entry) => Math.max(max, entry.priority),
      0,
    );

    return currentMax + 1;
  }

  setEntries(entries: WatchlistEntry[]): void {
    this.entries.clear();
    for (const entry of entries) {
      const normalized = this.normalizeEntry(entry);
      this.entries.set(normalized.symbol, normalized);
    }
  }

  getEntries(): WatchlistEntry[] {
    return [...this.entries.values()]
      .map((entry) => this.normalizeEntry(entry))
      .sort((a, b) => a.priority - b.priority || a.symbol.localeCompare(b.symbol));
  }

  getEntry(symbol: string): WatchlistEntry | undefined {
    const entry = this.entries.get(normalizeSymbol(symbol));
    return entry ? this.normalizeEntry(entry) : undefined;
  }

  upsertManualEntry(input: {
    symbol: string;
    tags?: string[];
    note?: string;
    discordThreadId?: string | null;
    active: boolean;
    lifecycle?: WatchlistLifecycleState;
    activatedAt?: number;
    lastLevelPostAt?: number;
    lastExtensionPostAt?: number;
    lastPriceUpdateAt?: number;
    lastPrice?: number;
    lastThreadPostAt?: number;
    lastThreadPostKind?: string | null;
    refreshPending?: boolean;
    lastError?: string | null;
    operationStatus?: string | null;
    tradersLinkAiReadCardVisible?: boolean;
    tradersLinkAiReadBoundaryState?: TradersLinkAiReadBoundaryState;
  }): WatchlistEntry {
    const symbol = normalizeSymbol(input.symbol);
    const existing = this.entries.get(symbol);

    const entry: WatchlistEntry = {
      symbol,
      active: input.active,
      priority: existing?.priority ?? this.getNextPriority(),
      tags: input.tags
        ? [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))]
        : existing?.tags
          ? [...existing.tags]
          : ["manual"],
      note:
        typeof input.note === "string" && input.note.trim().length > 0
          ? input.note.trim()
          : existing?.note,
      discordThreadId:
        input.discordThreadId !== undefined
          ? input.discordThreadId?.trim() || null
          : existing?.discordThreadId ?? null,
      lifecycle: input.lifecycle ?? existing?.lifecycle ?? (input.active ? "active" : "inactive"),
      activatedAt:
        normalizeFiniteTimestamp(input.activatedAt) ??
        existing?.activatedAt ??
        (input.active ? Date.now() : undefined),
      lastLevelPostAt:
        normalizeFiniteTimestamp(input.lastLevelPostAt) ?? existing?.lastLevelPostAt,
      lastExtensionPostAt:
        normalizeFiniteTimestamp(input.lastExtensionPostAt) ?? existing?.lastExtensionPostAt,
      lastPriceUpdateAt:
        normalizeFiniteTimestamp(input.lastPriceUpdateAt) ?? existing?.lastPriceUpdateAt,
      lastPrice:
        typeof input.lastPrice === "number" && Number.isFinite(input.lastPrice) && input.lastPrice > 0
          ? input.lastPrice
          : existing?.lastPrice,
      lastThreadPostAt:
        normalizeFiniteTimestamp(input.lastThreadPostAt) ?? existing?.lastThreadPostAt,
      lastThreadPostKind:
        input.lastThreadPostKind !== undefined
          ? input.lastThreadPostKind?.trim() || undefined
          : existing?.lastThreadPostKind,
      refreshPending: input.refreshPending ?? existing?.refreshPending ?? false,
      lastError:
        input.lastError !== undefined
          ? input.lastError?.trim() || undefined
          : existing?.lastError,
      operationStatus:
        input.operationStatus !== undefined
          ? input.operationStatus?.trim() || undefined
          : existing?.operationStatus,
      tradersLinkAiReadCardVisible:
        typeof input.tradersLinkAiReadCardVisible === "boolean"
          ? input.tradersLinkAiReadCardVisible
          : existing?.tradersLinkAiReadCardVisible,
      tradersLinkAiReadBoundaryState:
        input.tradersLinkAiReadBoundaryState !== undefined
          ? input.tradersLinkAiReadBoundaryState
          : existing?.tradersLinkAiReadBoundaryState,
    };

    this.entries.set(symbol, entry);
    return this.normalizeEntry(entry);
  }

  patchEntry(
    symbol: string,
    patch: Partial<Omit<WatchlistEntry, "lastError">> & { lastError?: string | null },
  ): WatchlistEntry | null {
    const normalizedSymbol = normalizeSymbol(symbol);
    const existing = this.entries.get(normalizedSymbol);

    if (!existing) {
      return null;
    }

    const merged: WatchlistEntry = {
      ...existing,
      ...patch,
      symbol: normalizedSymbol,
      lastError:
        patch.lastError !== undefined
          ? patch.lastError?.trim() || undefined
          : existing.lastError,
    };
    const updated = this.normalizeEntry(merged);
    this.entries.set(normalizedSymbol, updated);
    return updated;
  }

  deactivateSymbol(symbol: string): WatchlistEntry | null {
    const normalizedSymbol = normalizeSymbol(symbol);
    const existing = this.entries.get(normalizedSymbol);

    if (!existing) {
      return null;
    }

    const updated: WatchlistEntry = {
      ...existing,
      active: false,
      lifecycle: "inactive",
      refreshPending: false,
      operationStatus: undefined,
    };

    this.entries.set(normalizedSymbol, updated);
    return this.normalizeEntry(updated);
  }

  getActiveEntries(): WatchlistEntry[] {
    return this.getEntries().filter((entry) => entry.active);
  }
}
