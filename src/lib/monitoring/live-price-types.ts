// 2026-04-14 09:28 PM America/Toronto
// Provider interfaces for live price monitoring.

import type { LivePriceUpdate, WatchlistEntry } from "./monitoring-types.js";

export type LivePriceListener = (update: LivePriceUpdate) => void;

export interface LivePriceProvider {
  start(entries: WatchlistEntry[], onUpdate: LivePriceListener): Promise<void>;
  stop(): Promise<void>;
}
