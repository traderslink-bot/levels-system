// 2026-04-14 09:28 PM America/Toronto
// Simple in-memory watchlist store for Phase 2 starter implementation.

import type { WatchlistEntry } from "./monitoring-types.js";

export class WatchlistStore {
  private readonly entries = new Map<string, WatchlistEntry>();

  setEntries(entries: WatchlistEntry[]): void {
    this.entries.clear();
    for (const entry of entries) {
      this.entries.set(entry.symbol.toUpperCase(), {
        ...entry,
        symbol: entry.symbol.toUpperCase(),
      });
    }
  }

  getActiveEntries(): WatchlistEntry[] {
    return [...this.entries.values()]
      .filter((entry) => entry.active)
      .sort((a, b) => a.priority - b.priority || a.symbol.localeCompare(b.symbol));
  }
}
