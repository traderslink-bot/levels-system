// 2026-04-14 09:28 PM America/Toronto
// Shared monitoring types for Phase 2 watchlist monitoring.

import type { FinalLevelZone, LevelDataFreshness } from "../levels/level-types.js";

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

export type WatchlistLifecycleState =
  | "inactive"
  | "activating"
  | "active"
  | "stale"
  | "refresh_pending"
  | "extension_pending";

export type MonitoredZoneOrigin =
  | "canonical"
  | "extension_inventory"
  | "promoted_extension";

export type MonitoredZoneRemapStatus =
  | "new"
  | "preserved"
  | "merged"
  | "split"
  | "replaced";

export type LadderPositionContext =
  | "inner"
  | "outermost"
  | "extension";

export type MonitoringZoneContext = {
  monitoredZoneId: string;
  canonicalZoneId: string;
  origin: MonitoredZoneOrigin;
  remapStatus: MonitoredZoneRemapStatus;
  remappedFromZoneIds: string[];
  sourceGeneratedAt?: number;
  zoneFreshness: LevelDataFreshness;
  zoneStrengthLabel: FinalLevelZone["strengthLabel"];
  dataQualityDegraded: boolean;
  recentlyRefreshed: boolean;
  recentlyPromotedExtension: boolean;
  ladderPosition: LadderPositionContext;
  activeSince: number;
  lastRemappedAt?: number;
};

export type WatchlistEntry = {
  symbol: string;
  active: boolean;
  priority: number;
  tags: string[];
  note?: string;
  discordThreadId?: string | null;
  lifecycle?: WatchlistLifecycleState;
  activatedAt?: number;
  lastLevelPostAt?: number;
  lastExtensionPostAt?: number;
  refreshPending?: boolean;
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
  levelGeneratedAt?: number;
  levelFreshness?: LevelDataFreshness;
  levelStoreVersion?: number;
  levelDataQualityFlags?: string[];
  supportZones: FinalLevelZone[];
  resistanceZones: FinalLevelZone[];
  zoneContexts: Record<string, MonitoringZoneContext>;
  interactions: Record<string, ZoneInteractionState>;
  recentEvents: MonitoringEvent[];
};

export type MonitoringEventContext = {
  monitoredZoneId: string;
  canonicalZoneId: string;
  zoneFreshness: LevelDataFreshness;
  zoneOrigin: MonitoredZoneOrigin;
  remapStatus: MonitoredZoneRemapStatus;
  remappedFromZoneIds: string[];
  dataQualityDegraded: boolean;
  recentlyRefreshed: boolean;
  recentlyPromotedExtension: boolean;
  ladderPosition: LadderPositionContext;
  zoneStrengthLabel: FinalLevelZone["strengthLabel"];
  sourceGeneratedAt?: number;
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
  eventContext: MonitoringEventContext;
  memoryWeight?: number;
  timestamp: number;
  notes: string[];
};
