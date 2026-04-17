// 2026-04-14 09:28 PM America/Toronto
// Downstream alert types for routing and Phase 3 alert intelligence.

import type { FinalLevelZone } from "../levels/level-types.js";
import type { MonitoringEvent } from "../monitoring/monitoring-types.js";

export type AlertSeverity = "low" | "medium" | "high" | "critical";

export type AlertConfidence = "low" | "medium" | "high";

export type AlertPayload = {
  title: string;
  body: string;
  event: MonitoringEvent;
};

export type DiscordThread = {
  id: string;
  name: string;
};

export type DiscordThreadMessageType = "alert" | "level_snapshot" | "level_extension";
export type LevelExtensionSide = "support" | "resistance";

export type DiscordThreadRoutingResult = {
  threadId: string;
  reused: boolean;
  recovered: boolean;
  created: boolean;
};

export type LevelSnapshotDisplayZone = {
  representativePrice: number;
  lowPrice?: number;
  highPrice?: number;
};

export type LevelSnapshotPayload = {
  symbol: string;
  currentPrice: number;
  supportZones: LevelSnapshotDisplayZone[];
  resistanceZones: LevelSnapshotDisplayZone[];
  timestamp: number;
};

export type LevelExtensionPayload = {
  symbol: string;
  side: LevelExtensionSide;
  levels: number[];
  timestamp: number;
};

export type IntelligentAlert = {
  id: string;
  symbol: string;
  title: string;
  body: string;
  severity: AlertSeverity;
  confidence: AlertConfidence;
  score: number;
  shouldNotify: boolean;
  tags: string[];
  scoreComponents: Record<string, number>;
  event: MonitoringEvent;
  zone?: FinalLevelZone;
};

export type AlertPostingFamily =
  | "zone_context"
  | "bullish_resolution"
  | "bearish_resolution"
  | "failure";

export type AlertPostingDecisionReason =
  | "posted"
  | "filtered"
  | "duplicate_context"
  | "lower_value_than_recent"
  | "not_materially_new";

export type AlertPostingDecision = {
  shouldPost: boolean;
  reason: AlertPostingDecisionReason;
  family?: AlertPostingFamily;
  scopeKey?: string;
  stateKey?: string;
  comparedAlertId?: string;
};
