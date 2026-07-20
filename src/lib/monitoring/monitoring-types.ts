// 2026-04-14 09:28 PM America/Toronto
// Shared monitoring types for Phase 2 watchlist monitoring.

import type { FinalLevelZone, LevelDataFreshness } from "../levels/level-types.js";
import type { ZoneTacticalRead } from "../levels/zone-tactical-read.js";
import type {
  CandleMarketStructureConfidence,
  CandleMarketStructureState,
  FormalBreakConfirmation,
  FormalStructureBias,
  FormalStructureConfidenceLabel,
  FormalStructureEventType,
  FormalStructureTimeframe,
  FormalSwingLabel,
  StableMarketStructureDecisionReason,
} from "../structure/index.js";
import type { VolumeActivityContext } from "./volume-activity.js";
import type {
  AcceptanceContext,
  BehaviorBudgetContext,
  RangeBoxContext,
  SupportImportanceContext,
  TradeStoryState,
} from "./trade-story-intelligence.js";
import type { PrimaryTradeAreaContext } from "./primary-trade-area.js";
import type { FailedLevelMemoryContext } from "./failed-level-memory.js";

export type MonitoringEventType =
  | "level_touch"
  | "breakout"
  | "breakdown"
  | "rejection"
  | "fake_breakout"
  | "fake_breakdown"
  | "reclaim"
  | "compression";

export type MonitoringDiagnosticEventType =
  | "breakout"
  | "breakdown"
  | "fake_breakout"
  | "fake_breakdown"
  | "reclaim";

export type MonitoringDiagnosticDecision = "emitted" | "suppressed";

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

export type MarketStructureType =
  | "compression"
  | "breakout_setup"
  | "rejection_setup";

export type PracticalTradeStructureState =
  | "range_bound"
  | "building_base"
  | "pressing_resistance"
  | "breakout_attempt"
  | "breakout_holding"
  | "breakout_failed"
  | "pullback_to_support"
  | "support_holding"
  | "support_failing"
  | "structure_broken"
  | "reclaim_attempt"
  | "reclaim_holding";

export type PracticalTradeArea = {
  side: "support" | "resistance";
  low: number;
  high: number;
  representative: number;
  strengthLabel?: FinalLevelZone["strengthLabel"];
  sourceLabel?: string;
  zoneCount: number;
};

export type PracticalTradeStructureContext = {
  state: PracticalTradeStructureState;
  previousState?: PracticalTradeStructureState;
  supportArea?: PracticalTradeArea;
  resistanceArea?: PracticalTradeArea;
  momentumSupportArea?: PracticalTradeArea;
  structureKey: string;
  practicalZoneKey: string;
  traderLine: string;
  reason: string;
  isMaterialStateChange: boolean;
};

export type IntradayPriceStructureContext = {
  bucketMs: number;
  bucketCount: number;
  baseLow: number;
  baseHigh: number;
  lastClose: number;
  rangePct: number;
  higherLowCount: number;
  lowerHighCount: number;
  direction: "building" | "fading" | "flat" | "unknown";
};

export type StableMarketStructureRuntimeContext = {
  state: CandleMarketStructureState;
  previousState: CandleMarketStructureState | null;
  structureKey: string;
  materialChange: boolean;
  confidence: CandleMarketStructureConfidence["label"];
  materialityScore: number;
  rawState: CandleMarketStructureState;
  reason: StableMarketStructureDecisionReason;
  candleCount: number;
  rawRunLength?: number;
  trendDirection?: "building" | "fading" | "uptrend" | "damaged" | "range" | "unknown";
  higherLowCount?: number;
  lowerHighCount?: number;
  higherHighCount?: number;
  lowerLowCount?: number;
  latestSwingLow?: number;
  latestSwingHigh?: number;
  priorSwingLow?: number;
  priorSwingHigh?: number;
  activeRangeLow?: number;
  activeRangeHigh?: number;
  activeRangeWidthPct?: number;
  activeRangeQuality?: "clean" | "loose" | "choppy";
  pivotEventType?: "reclaim" | "loss" | "failed_reclaim" | "none";
  pivotEventTriggerPrice?: number | null;
};

export type FormalMarketStructureRuntimeContext = {
  timeframe: FormalStructureTimeframe;
  bias: FormalStructureBias;
  previousBias: FormalStructureBias | null;
  eventType: FormalStructureEventType;
  eventFreshness?: "fresh" | "prior" | "context";
  triggerTimestamp?: string | null;
  confirmation: FormalBreakConfirmation;
  confidence: FormalStructureConfidenceLabel;
  confidenceScore: number;
  materialChange: boolean;
  brokenSwingPrice?: number | null;
  sweptSwingPrice?: number | null;
  protectedHigh?: number | null;
  protectedLow?: number | null;
  latestHigh?: number | null;
  latestLow?: number | null;
  swingSequence: FormalSwingLabel[];
  structureKey: string;
  traderLine: string;
  debug: {
    candleCount: number;
    reasons: string[];
  };
};

export type RuntimeMarketStructureTimeframeSnapshot = {
  stable?: StableMarketStructureRuntimeContext;
  formal?: FormalMarketStructureRuntimeContext;
};

export type RuntimeMarketStructureByTimeframe = Partial<
  Record<FormalStructureTimeframe, RuntimeMarketStructureTimeframeSnapshot>
>;

export type RuntimeMarketStructureSnapshot = RuntimeMarketStructureTimeframeSnapshot & {
  timeframes?: RuntimeMarketStructureByTimeframe;
};

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
  | "restoring"
  | "activation_failed"
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

export type BarrierClearanceLabel =
  | "tight"
  | "limited"
  | "open";

export type BarrierClutterLabel =
  | "clear"
  | "stacked"
  | "dense";

export type PathQualityLabel =
  | "clean"
  | "layered"
  | "choppy";

export type ZoneExhaustionLabel =
  | "fresh"
  | "tested"
  | "worn"
  | "spent";

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

export type TradersLinkAiReadBoundaryRole =
  | "needsToHold"
  | "cautionBelow"
  | "momentumFailure"
  | "mustClear"
  | "breakoutContinuation"
  | "upsideTarget"
  | "downsideCheckpoint";

export type TradersLinkAiReadBoundaryImpact =
  | "hold"
  | "caution"
  | "invalidates"
  | "improves"
  | "exhausts";

export type TradersLinkAiReadBoundary = {
  role: TradersLinkAiReadBoundaryRole;
  side: "upside" | "downside";
  price: number;
  impact: TradersLinkAiReadBoundaryImpact;
};

export type TradersLinkAiReadPendingBoundaryCross = {
  regime: string;
  direction: "upper" | "lower";
  boundary: number;
  firstObservedAt: number;
  lastObservedAt: number;
  observationCount: number;
  furthestPrice: number;
  confirmationBufferPct: number;
};

export type TradersLinkAiReadBoundaryState = {
  generatedAt: number;
  currentPrice: number;
  upperBoundary: number | null;
  lowerBoundary: number | null;
  /**
   * The published tactical levels, kept independently from the outer map
   * edges so a decisive internal invalidation cannot be hidden by a farther
   * target or checkpoint.
   */
  boundaries?: TradersLinkAiReadBoundary[];
  /**
   * A small move outside the map waits here for either a material excursion or
   * sustained confirmation. Re-entry clears it without buying another read.
   */
  pendingAutomaticBoundaryCross?: TradersLinkAiReadPendingBoundaryCross;
  /**
   * The exact automatic boundary event already serviced by this map.
   * Keeping it with the published map prevents a stale re-cross from buying a
   * duplicate read after price whipsaws back through an old boundary.
   */
  lastAutomaticRefreshRegime?: string | null;
};

export type PendingTradersLinkAiReadGeneration = {
  generationId: string;
  createdAt: number;
  trigger: string;
  boundaryState: TradersLinkAiReadBoundaryState;
};

export type WatchlistTradersLinkAiReadConfidence = "low" | "medium" | "high";

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
  lastPriceUpdateAt?: number;
  lastPrice?: number;
  lastThreadPostAt?: number;
  lastThreadPostKind?: string;
  lastTradeStoryState?: string;
  lastTradeStoryAt?: number;
  lastTriggerPrice?: number;
  refreshPending?: boolean;
  tradersLinkAiReadCardVisible?: boolean;
  tradersLinkAiReadDipBuyPlanVisible?: boolean;
  tradersLinkAiReadConfidence?: WatchlistTradersLinkAiReadConfidence;
  tradersLinkAiReadBoundaryState?: TradersLinkAiReadBoundaryState;
  pendingTradersLinkAiReadGeneration?: PendingTradersLinkAiReadGeneration;
  lastError?: string;
  operationStatus?: string;
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
  intradayStructure?: IntradayPriceStructureContext;
  stableMarketStructure?: StableMarketStructureRuntimeContext;
  formalMarketStructure?: FormalMarketStructureRuntimeContext;
  marketStructureByTimeframe?: RuntimeMarketStructureByTimeframe;
  runtimeMarketStructure?: RuntimeMarketStructureSnapshot;
  volumeActivity?: VolumeActivityContext;
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
  nextBarrierKind?: "support" | "resistance";
  nextBarrierLevel?: number;
  nextBarrierDistancePct?: number;
  nextBarrierStrengthLabel?: FinalLevelZone["strengthLabel"];
  nextBarrierRoleFlipFromKind?: "support" | "resistance";
  clearanceLabel?: BarrierClearanceLabel;
  barrierClutterLabel?: BarrierClutterLabel;
  nearbyBarrierCount?: number;
  pathQualityLabel?: PathQualityLabel;
  pathBarrierCount?: number;
  pathConstraintScore?: number;
  pathWindowDistancePct?: number;
  tacticalRead?: ZoneTacticalRead;
  exhaustionLabel?: ZoneExhaustionLabel;
  marketStructureType?: MarketStructureType;
  marketStructureStrength?: number;
  rangeCompressionScore?: number;
  tradeStructure?: PracticalTradeStructureContext;
  stableMarketStructureState?: CandleMarketStructureState;
  stableMarketStructurePreviousState?: CandleMarketStructureState | null;
  stableMarketStructureKey?: string;
  stableMarketStructureMaterialChange?: boolean;
  stableMarketStructureConfidence?: CandleMarketStructureConfidence["label"];
  stableMarketStructureMaterialityScore?: number;
  stableMarketStructureRawState?: CandleMarketStructureState;
  stableMarketStructureReason?: StableMarketStructureDecisionReason;
  stableMarketStructureCandleCount?: number;
  stableMarketStructureRawRunLength?: number;
  stableMarketStructureTrendDirection?: StableMarketStructureRuntimeContext["trendDirection"];
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
  stableMarketStructureActiveRangeQuality?: StableMarketStructureRuntimeContext["activeRangeQuality"];
  stableMarketStructurePivotEventType?: StableMarketStructureRuntimeContext["pivotEventType"];
  stableMarketStructurePivotEventTriggerPrice?: number | null;
  formalStructureTimeframe?: FormalStructureTimeframe;
  formalStructureBias?: FormalStructureBias;
  formalStructurePreviousBias?: FormalStructureBias | null;
  formalStructureEventType?: FormalStructureEventType;
  formalStructureEventFreshness?: FormalMarketStructureRuntimeContext["eventFreshness"];
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
  selectedFormalStructureEventFreshness?: FormalMarketStructureRuntimeContext["eventFreshness"];
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
  runtimeMarketStructure?: RuntimeMarketStructureSnapshot;
  volumeActivity?: VolumeActivityContext;
  tradeStoryState?: TradeStoryState;
  rangeBox?: RangeBoxContext;
  acceptance?: AcceptanceContext;
  supportImportance?: SupportImportanceContext;
  behaviorBudget?: BehaviorBudgetContext;
  primaryTradeArea?: PrimaryTradeAreaContext;
  failedLevelMemory?: FailedLevelMemoryContext;
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

export type MonitoringEventDiagnostic = {
  type: "monitoring_event_diagnostic";
  symbol: string;
  zoneId: string;
  zoneKind: "support" | "resistance";
  eventType: MonitoringDiagnosticEventType;
  decision: MonitoringDiagnosticDecision;
  reasons: string[];
  timestamp: number;
  triggerPrice: number;
  previousPrice: number | null;
  phaseBefore: InteractionPhase;
  phaseAfter: InteractionPhase;
  updatesNearZone: number;
  nearestDistancePct: number;
  breakAttemptAgeMs: number | null;
  metrics: Record<string, number | boolean | null>;
};

export type MonitoringEventDiagnosticListener = (
  diagnostic: MonitoringEventDiagnostic,
) => void;
