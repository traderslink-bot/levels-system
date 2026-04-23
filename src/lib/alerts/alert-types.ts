// 2026-04-14 09:28 PM America/Toronto
// Downstream alert types for routing and Phase 3 alert intelligence.

import type { FinalLevelZone } from "../levels/level-types.js";
import type { ZoneTacticalRead } from "../levels/zone-tactical-read.js";
import type {
  BarrierClearanceLabel,
  MonitoringEvent,
} from "../monitoring/monitoring-types.js";

export type AlertSeverity = "low" | "medium" | "high" | "critical";

export type AlertConfidence = "low" | "medium" | "high";

export type TraderZoneTacticalRead = ZoneTacticalRead;

export type TraderMovementLabel =
  | "early"
  | "building"
  | "extended"
  | "inside_band"
  | "back_inside"
  | "holding_from_edge";

export type TraderMovementContext = {
  label: TraderMovementLabel;
  movementPct: number;
  line: string;
};

export type TraderPressureLabel =
  | "strong"
  | "moderate"
  | "tentative"
  | "balanced";

export type TraderPressureContext = {
  label: TraderPressureLabel;
  pressureScore: number;
  line: string;
};

export type TraderTriggerQualityLabel =
  | "clean"
  | "workable"
  | "crowded"
  | "late";

export type TraderTriggerQualityContext = {
  label: TraderTriggerQualityLabel;
  line: string;
};

export type TraderSetupStateLabel =
  | "building"
  | "confirmation"
  | "continuation"
  | "weakening"
  | "failed";

export type TraderSetupStateContext = {
  label: TraderSetupStateLabel;
  line: string;
};

export type TraderFailureRiskLabel =
  | "contained"
  | "watchful"
  | "elevated"
  | "high";

export type TraderFailureRiskContext = {
  label: TraderFailureRiskLabel;
  line: string;
  reasons: string[];
};

export type TraderTradeMapLabel =
  | "favorable"
  | "workable"
  | "tight";

export type TraderTradeMapContext = {
  label: TraderTradeMapLabel;
  riskPct: number;
  roomPct: number | null;
  roomToRiskRatio: number | null;
  line: string;
};

export type TraderTargetContext = {
  side: "support" | "resistance";
  price: number;
  distancePct: number;
  line: string;
};

export type AlertPayload = {
  title: string;
  body: string;
  event: MonitoringEvent;
  metadata?: {
    eventType?: MonitoringEvent["eventType"];
    severity?: AlertSeverity;
    confidence?: AlertConfidence;
    score?: number;
    postingFamily?: AlertPostingFamily;
    postingDecisionReason?: AlertPostingDecisionReason;
    clearanceLabel?: BarrierClearanceLabel;
    nextBarrierSide?: "support" | "resistance";
    nextBarrierDistancePct?: number;
    tacticalRead?: TraderZoneTacticalRead;
    movementLabel?: TraderMovementLabel;
    movementPct?: number;
    pressureLabel?: TraderPressureLabel;
    pressureScore?: number;
    triggerQualityLabel?: TraderTriggerQualityLabel;
    setupStateLabel?: TraderSetupStateLabel;
    failureRiskLabel?: TraderFailureRiskLabel;
    tradeMapLabel?: TraderTradeMapLabel;
    riskPct?: number;
    roomToRiskRatio?: number;
    targetSide?: "support" | "resistance";
    targetPrice?: number;
    targetDistancePct?: number;
  };
};

export type TraderNextBarrierContext = {
  side: "support" | "resistance";
  price: number;
  distancePct: number;
  clearanceLabel?: BarrierClearanceLabel;
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
  strengthLabel?: FinalLevelZone["strengthLabel"];
  freshness?: FinalLevelZone["freshness"];
  isExtension?: boolean;
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
  nextBarrier?: TraderNextBarrierContext | null;
  tacticalRead?: TraderZoneTacticalRead;
  movement?: TraderMovementContext | null;
  pressure?: TraderPressureContext | null;
  triggerQuality?: TraderTriggerQualityContext | null;
  setupState?: TraderSetupStateContext | null;
  failureRisk?: TraderFailureRiskContext | null;
  tradeMap?: TraderTradeMapContext | null;
  target?: TraderTargetContext | null;
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
