// 2026-04-14 09:28 PM America/Toronto
// Downstream alert types for routing and Phase 3 alert intelligence.

import type { FinalLevelZone } from "../levels/level-types.js";
import type { ZoneTacticalRead } from "../levels/zone-tactical-read.js";
import type {
  BarrierClutterLabel,
  BarrierClearanceLabel,
  MonitoringEvent,
  MarketStructureType,
  PathQualityLabel,
  PracticalTradeStructureState,
  RuntimeMarketStructureSnapshot,
  ZoneExhaustionLabel,
} from "../monitoring/monitoring-types.js";
import type {
  CandleMarketStructureConfidence,
  CandleMarketStructureState,
  FormalBreakConfirmation,
  FormalStructureBias,
  FormalStructureConfidenceLabel,
  FormalStructureEventType,
  FormalStructureTimeframe,
  FormalSwingLabel,
} from "../structure/index.js";
import type { VolumeActivityContext } from "../monitoring/volume-activity.js";
import type { SignalCategoryKey } from "../signals/signal-category-config.js";
import type { FirstPostTradePlanContext } from "../trader-context/index.js";
import type {
  AcceptanceContext,
  BehaviorBudgetContext,
  RangeBoxContext,
  SupportImportanceContext,
  TradeStoryState,
} from "../monitoring/trade-story-intelligence.js";
import type { PrimaryTradeAreaContext } from "../monitoring/primary-trade-area.js";
import type { FailedLevelMemoryContext } from "../monitoring/failed-level-memory.js";
import type { LevelImportanceLabel } from "../monitoring/level-importance.js";

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

export type TraderPathQualityLabel = PathQualityLabel;

export type TraderPathQualityContext = {
  label: TraderPathQualityLabel;
  barrierCount: number;
  pathConstraintScore?: number;
  pathWindowDistancePct?: number;
  line: string;
};

export type TraderDipBuyQualityLabel =
  | "actionable"
  | "watch_only"
  | "poor";

export type TraderDipBuyQualityContext = {
  label: TraderDipBuyQualityLabel;
  line: string;
};

export type TraderExhaustionLabel = ZoneExhaustionLabel;

export type TraderExhaustionContext = {
  label: TraderExhaustionLabel;
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

export type TraderMarketStructureLabel =
  | "bullish_building"
  | "compression"
  | "weakening"
  | "repaired"
  | "damaged";

export type TraderMarketStructureContext = {
  label: TraderMarketStructureLabel;
  structureType?: MarketStructureType;
  strength?: number;
  line: string;
};

export type TraderVolumeActivityContext = VolumeActivityContext;

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

export type TraderFollowThroughLabel =
  | "strong"
  | "working"
  | "stalled"
  | "failed"
  | "unknown";

export type TraderFollowThroughContext = {
  label: TraderFollowThroughLabel;
  eventType: string;
  directionalReturnPct: number | null;
  rawReturnPct: number | null;
  line: string;
};

export type AlertPayload = {
  title: string;
  body: string;
  event?: MonitoringEvent;
  symbol?: string;
  timestamp?: number;
  metadata?: {
    eventType?: MonitoringEvent["eventType"];
    messageKind?:
      | "intelligent_alert"
      | "stock_context"
      | "level_clear_update"
      | "follow_through_update"
      | "follow_through_state_update"
      | "continuity_update"
      | "symbol_recap"
      | "ai_signal_commentary"
      | "market_structure_update";
    severity?: AlertSeverity;
    confidence?: AlertConfidence;
    score?: number;
    signalCategory?: SignalCategoryKey;
    signalCategoryLiveEnabled?: boolean;
    supportingSignalCategories?: SignalCategoryKey[];
    postingFamily?: AlertPostingFamily;
    postingDecisionReason?: AlertPostingDecisionReason;
    clearanceLabel?: BarrierClearanceLabel;
    barrierClutterLabel?: BarrierClutterLabel;
    nearbyBarrierCount?: number;
    nextBarrierSide?: "support" | "resistance";
    nextBarrierDistancePct?: number;
    nextBarrierRoleFlipFromSide?: "support" | "resistance";
    continuationBarrierSide?: "support" | "resistance";
    continuationBarrierDistancePct?: number;
    tacticalRead?: TraderZoneTacticalRead;
    movementLabel?: TraderMovementLabel;
    movementPct?: number;
    pressureLabel?: TraderPressureLabel;
    pressureScore?: number;
    triggerQualityLabel?: TraderTriggerQualityLabel;
    pathQualityLabel?: TraderPathQualityLabel;
    pathConstraintScore?: number;
    pathWindowDistancePct?: number;
    dipBuyQualityLabel?: TraderDipBuyQualityLabel;
    exhaustionLabel?: TraderExhaustionLabel;
    setupStateLabel?: TraderSetupStateLabel;
    marketStructureLabel?: TraderMarketStructureLabel;
    marketStructureType?: MarketStructureType;
    marketStructureStrength?: number;
    marketStructureStoryVisible?: boolean;
    marketStructureStoryReason?: string;
    marketStructureStoryKeys?: string[];
    marketStructureStorySource?: string;
    practicalStructureState?: PracticalTradeStructureState;
    practicalStructureKey?: string;
    practicalZoneKey?: string;
    practicalStructureMaterialChange?: boolean;
    stableMarketStructureState?: CandleMarketStructureState;
    stableMarketStructurePreviousState?: CandleMarketStructureState | null;
    stableMarketStructureKey?: string;
    stableMarketStructureMaterialChange?: boolean;
    stableMarketStructureConfidence?: CandleMarketStructureConfidence["label"];
    stableMarketStructureMaterialityScore?: number;
    stableMarketStructureRawState?: CandleMarketStructureState;
    stableMarketStructureReason?: string;
    stableMarketStructureCandleCount?: number;
    stableMarketStructureRawRunLength?: number;
    stableMarketStructureTrendDirection?: string;
    stableMarketStructureHigherLowCount?: number;
    stableMarketStructureLowerHighCount?: number;
    stableMarketStructureHigherHighCount?: number;
    stableMarketStructureLowerLowCount?: number;
    stableMarketStructureLatestSwingLow?: number;
    stableMarketStructureLatestSwingHigh?: number;
    stableMarketStructurePriorSwingLow?: number;
    stableMarketStructurePriorSwingHigh?: number;
    stableMarketStructureActiveRangeLow?: number;
    stableMarketStructureActiveRangeHigh?: number;
    stableMarketStructureActiveRangeWidthPct?: number;
    stableMarketStructureActiveRangeQuality?: string;
    stableMarketStructurePivotEventType?: string;
    stableMarketStructurePivotEventTriggerPrice?: number | null;
    formalStructureTimeframe?: FormalStructureTimeframe;
    formalStructureBias?: FormalStructureBias;
    formalStructurePreviousBias?: FormalStructureBias | null;
    formalStructureEventType?: FormalStructureEventType;
    formalStructureEventFreshness?: MonitoringEvent["eventContext"]["formalStructureEventFreshness"];
    formalStructureTriggerTimestamp?: string | null;
    formalStructureConfirmation?: FormalBreakConfirmation;
    formalStructureConfidence?: FormalStructureConfidenceLabel;
    formalStructureConfidenceScore?: number;
    formalStructureMaterialChange?: boolean;
    formalStructureBrokenSwingPrice?: number | null;
    formalStructureSweptSwingPrice?: number | null;
    formalStructureProtectedHigh?: number | null;
    formalStructureProtectedLow?: number | null;
    formalStructureLatestHigh?: number | null;
    formalStructureLatestLow?: number | null;
    formalStructureSwingSequence?: FormalSwingLabel[];
    formalStructureKey?: string;
    formalStructureTraderLine?: string;
    formalStructureDebugReasons?: string[];
    selectedFormalStructureTimeframe?: FormalStructureTimeframe;
    selectedFormalStructureBias?: FormalStructureBias;
    selectedFormalStructurePreviousBias?: FormalStructureBias | null;
    selectedFormalStructureEventType?: FormalStructureEventType;
    selectedFormalStructureEventFreshness?: MonitoringEvent["eventContext"]["selectedFormalStructureEventFreshness"];
    selectedFormalStructureTriggerTimestamp?: string | null;
    selectedFormalStructureConfirmation?: FormalBreakConfirmation;
    selectedFormalStructureConfidence?: FormalStructureConfidenceLabel;
    selectedFormalStructureConfidenceScore?: number;
    selectedFormalStructureMaterialChange?: boolean;
    selectedFormalStructureBrokenSwingPrice?: number | null;
    selectedFormalStructureSweptSwingPrice?: number | null;
    selectedFormalStructureProtectedHigh?: number | null;
    selectedFormalStructureProtectedLow?: number | null;
    selectedFormalStructureLatestHigh?: number | null;
    selectedFormalStructureLatestLow?: number | null;
    selectedFormalStructureSwingSequence?: FormalSwingLabel[];
    selectedFormalStructureKey?: string;
    selectedFormalStructureTraderLine?: string;
    selectedFormalStructureDebugReasons?: string[];
    runtimeMarketStructure?: RuntimeMarketStructureSnapshot | null;
    volumeActivityLabel?: VolumeActivityContext["label"];
    volumeActivityReliability?: VolumeActivityContext["reliability"];
    volumeActivityRatio?: number | null;
    volumeActivityDirection?: VolumeActivityContext["direction"];
    volumeActivityShown?: boolean;
    volumeActivitySuppressedReason?: string;
    tradeStoryState?: TradeStoryState;
    rangeBoxLabel?: RangeBoxContext["label"];
    rangeBoxWidthPct?: number | null;
    acceptanceLabel?: AcceptanceContext["label"];
    acceptanceBeyondZonePct?: number | null;
    supportImportanceLabel?: SupportImportanceContext["label"];
    behaviorBudgetLabel?: BehaviorBudgetContext["label"];
    behaviorBudgetMaxUsefulPosts?: number;
    primaryTradeAreaLocked?: boolean;
    primaryTradeAreaEscapeSide?: PrimaryTradeAreaContext["escapeSide"];
    primaryTradeAreaEscapeConfidence?: PrimaryTradeAreaContext["escapeConfidence"];
    failedLevelOutcome?: FailedLevelMemoryContext["outcome"];
    failedLevelFailureCount?: number;
    levelImportanceLabel?: LevelImportanceLabel;
    levelImportanceScore?: number;
    failureRiskLabel?: TraderFailureRiskLabel;
    tradeMapLabel?: TraderTradeMapLabel;
    riskPct?: number;
    roomToRiskRatio?: number;
    targetSide?: "support" | "resistance";
    targetPrice?: number;
    targetDistancePct?: number;
    crossedLevels?: number[];
    clusterLow?: number;
    clusterHigh?: number;
    clusteredLevelClear?: boolean;
    followThroughLabel?: TraderFollowThroughLabel;
    progressLabel?: "improving" | "stalling" | "degrading";
    continuityType?: string;
    aiGenerated?: boolean;
    directionalReturnPct?: number | null;
    rawReturnPct?: number | null;
    repeatedOutcomeUpdate?: boolean;
    whyPosted?: string;
    postBudgetSymbolType?: string;
    noLevelReason?: string;
    needsFreshLevelCheck?: boolean;
    suppressEmbeds?: boolean;
  };
};

export type TraderNextBarrierContext = {
  side: "support" | "resistance";
  price: number;
  distancePct: number;
  strengthLabel?: FinalLevelZone["strengthLabel"];
  planningLevels?: Array<{
    price: number;
    distancePct: number;
    strengthLabel?: FinalLevelZone["strengthLabel"];
  }>;
  roleFlipFromSide?: "support" | "resistance";
  clearanceLabel?: BarrierClearanceLabel;
  clutterLabel?: BarrierClutterLabel;
  nearbyBarrierCount?: number;
  pathQualityLabel?: TraderPathQualityLabel;
  pathBarrierCount?: number;
  pathConstraintScore?: number;
  pathWindowDistancePct?: number;
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
  sourceLabel?: string;
};

export type LevelSnapshotAuditOmittedReason =
  | "displayed"
  | "compacted"
  | "wrong_side"
  | "outside_forward_range";

export type LevelSnapshotAuditZone = {
  id: string;
  side: "support" | "resistance";
  bucket: "surfaced" | "extension";
  representativePrice: number;
  zoneLow: number;
  zoneHigh: number;
  strengthLabel: FinalLevelZone["strengthLabel"];
  strengthScore: number;
  confluenceCount: number;
  sourceEvidenceCount: number;
  timeframeBias: FinalLevelZone["timeframeBias"];
  timeframeSources: FinalLevelZone["timeframeSources"];
  sourceTypes: FinalLevelZone["sourceTypes"];
  sourceLabel?: string;
  freshness: FinalLevelZone["freshness"];
  isExtension: boolean;
  displayed: boolean;
  omittedReason: LevelSnapshotAuditOmittedReason;
};

export type LevelSnapshotAudit = {
  referencePrice: number;
  referencePriceSource?: "override" | "live_price" | "level_metadata";
  livePriceAgeMs?: number;
  metadataReferencePrice?: number;
  displayTolerance: number;
  forwardResistanceLimit: number;
  displayedSupportIds: string[];
  displayedResistanceIds: string[];
  supportCandidates: LevelSnapshotAuditZone[];
  resistanceCandidates: LevelSnapshotAuditZone[];
  omittedSupportCount: number;
  omittedResistanceCount: number;
};

export type LevelSnapshotPayload = {
  symbol: string;
  currentPrice: number;
  supportZones: LevelSnapshotDisplayZone[];
  resistanceZones: LevelSnapshotDisplayZone[];
  ladderSupportZones?: LevelSnapshotDisplayZone[];
  ladderResistanceZones?: LevelSnapshotDisplayZone[];
  timestamp: number;
  audit?: LevelSnapshotAudit;
  tradePlan?: FirstPostTradePlanContext;
  marketStructure?: RuntimeMarketStructureSnapshot | null;
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
  continuationBarrier?: TraderNextBarrierContext | null;
  tacticalRead?: TraderZoneTacticalRead;
  movement?: TraderMovementContext | null;
  pressure?: TraderPressureContext | null;
  triggerQuality?: TraderTriggerQualityContext | null;
  pathQuality?: TraderPathQualityContext | null;
  dipBuyQuality?: TraderDipBuyQualityContext | null;
  exhaustion?: TraderExhaustionContext | null;
  setupState?: TraderSetupStateContext | null;
  marketStructure?: TraderMarketStructureContext | null;
  volumeActivity?: TraderVolumeActivityContext | null;
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
