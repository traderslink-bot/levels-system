// 2026-04-14 09:28 PM America/Toronto
// Shared monitoring types for Phase 2 watchlist monitoring.

import type { FinalLevelZone } from "../levels/level-types.js";

export type MonitoringEventType =
  | "level_touch"
  | "breakout"
  | "breakdown"
  | "rejection"
  | "fake_breakout"
  | "fake_breakdown"
  | "reclaim"
  | "compression";

export type MonitoringAlertType =
  | "level_touch"
  | "breakout"
  | "breakdown"
  | "rejection"
  | "fake_breakout"
  | "fake_breakdown"
  | "reclaim"
  | "consolidation";

export type SymbolBias = "bullish" | "bearish" | "neutral";

export type InteractionPhase =
  | "idle"
  | "approaching"
  | "touching"
  | "testing"
  | "breaking"
  | "confirmed"
  | "rejected"
  | "failed";

export type WatchlistEntry = {
  symbol: string;
  active: boolean;
  priority: number;
  tags: string[];
};

export type LivePriceUpdate = {
  symbol: string;
  timestamp: number;
  lastPrice: number;
  bid?: number;
  ask?: number;
  volume?: number;
};

export type ZoneInteractionState = {
  zoneId: string;
  symbol: string;
  levelKind: "support" | "resistance";
  phase: InteractionPhase;
  nearestDistancePct: number;
  firstTouchedAt?: number;
  lastTouchedAt?: number;
  breakAttemptAt?: number;
  lastBreakPrice?: number;
  updatesNearZone: number;
};

export type SymbolMonitoringState = {
  symbol: string;
  lastPrice?: number;
  previousPrice?: number;
  lastUpdateAt?: number;
  bias?: SymbolBias;
  pressureScore?: number;
  supportZones: FinalLevelZone[];
  resistanceZones: FinalLevelZone[];
  interactions: Record<string, ZoneInteractionState>;
  recentEvents: MonitoringEvent[];
};

export type MonitoringEvent = {
  id: string;
  episodeId: string;
  symbol: string;
  type: MonitoringAlertType;
  eventType: MonitoringEventType;
  zoneId: string;
  zoneKind: "support" | "resistance";
  level: number;
  triggerPrice: number;
  strength: number;
  confidence: number;
  priority: number;
  bias: SymbolBias;
  pressureScore: number;
  memoryWeight?: number;
  timestamp: number;
  notes: string[];
};
