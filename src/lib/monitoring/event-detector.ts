// 2026-04-14 09:28 PM America/Toronto
// Detect monitoring events from state transitions.

import type { FinalLevelZone } from "../levels/level-types.js";
import { deriveZoneTacticalRead } from "../levels/zone-tactical-read.js";
import { getSupportApproachPct, type MonitoringConfig } from "./monitoring-config.js";
import type {
  LivePriceUpdate,
  FormalMarketStructureRuntimeContext,
  MonitoringDiagnosticEventType,
  MonitoringEvent,
  MonitoringEventContext,
  MonitoringEventDiagnostic,
  MonitoringEventDiagnosticListener,
  SymbolMonitoringState,
  ZoneInteractionState,
} from "./monitoring-types.js";
import type { VolumeActivityContext } from "./volume-activity.js";
import {
  deriveBarrierClutter,
  buildInteractionEpisodeId,
  deriveBarrierClearanceLabel,
  derivePathQuality,
  deriveZoneExhaustion,
  findNearestRelevantBarrier,
  scoreMonitoringEvent,
  shouldFilterMonitoringEvent,
} from "./monitoring-event-scoring.js";
import { derivePracticalTradeStructureContext } from "./practical-trade-structure.js";
import { buildTradeStoryIntelligenceContext } from "./trade-story-intelligence.js";
import { buildSymbolContext } from "./symbol-state.js";
import { isAboveZone, isBelowZone, isInsideZone } from "./zone-utils.js";

function buildBreakAttemptAgeMs(
  state: ZoneInteractionState,
  timestamp: number,
): number | null {
  if (state.breakAttemptAt === undefined) {
    return null;
  }

  return Math.max(0, timestamp - state.breakAttemptAt);
}

function emitMonitoringEventDiagnostic(
  listener: MonitoringEventDiagnosticListener | undefined,
  params: {
    eventType: MonitoringDiagnosticEventType;
    zone: FinalLevelZone;
    update: LivePriceUpdate;
    previousPrice: number | undefined;
    previousState: ZoneInteractionState;
    currentState: ZoneInteractionState;
    decision: "emitted" | "suppressed";
    reasons: string[];
    metrics: Record<string, number | boolean | null>;
  },
): void {
  if (!listener) {
    return;
  }

  const diagnostic: MonitoringEventDiagnostic = {
    type: "monitoring_event_diagnostic",
    symbol: params.zone.symbol,
    zoneId: params.zone.id,
    zoneKind: params.zone.kind,
    eventType: params.eventType,
    decision: params.decision,
    reasons: params.reasons,
    timestamp: params.update.timestamp,
    triggerPrice: params.update.lastPrice,
    previousPrice: params.previousPrice ?? null,
    phaseBefore: params.previousState.phase,
    phaseAfter: params.currentState.phase,
    updatesNearZone: params.currentState.updatesNearZone,
    nearestDistancePct: params.currentState.nearestDistancePct,
    breakAttemptAgeMs: buildBreakAttemptAgeMs(
      params.previousState,
      params.update.timestamp,
    ),
    metrics: params.metrics,
  };

  listener(diagnostic);
}

function hasInteractionBackfill(state: ZoneInteractionState): boolean {
  return (
    state.phase === "touching" ||
    state.phase === "testing" ||
    state.phase === "breaking" ||
    state.updatesNearZone >= 2
  );
}

function hasRecentBreakAttempt(
  state: ZoneInteractionState,
  timestamp: number,
  fakeoutWindowMs: number,
): boolean {
  return (
    state.breakAttemptAt !== undefined &&
    timestamp - state.breakAttemptAt <= fakeoutWindowMs
  );
}

function volumeActivityForEvent(
  symbolState: SymbolMonitoringState,
  eventType: MonitoringEvent["eventType"],
  zoneId: string,
): VolumeActivityContext | undefined {
  const context = symbolState.volumeActivity;
  if (!context) {
    return undefined;
  }

  const repeatedStory = symbolState.recentEvents
    .slice(-8)
    .some(
      (event) =>
        event.zoneId === zoneId &&
        event.eventType === eventType &&
        event.eventContext.volumeActivity?.reliability === context.reliability &&
        event.eventContext.volumeActivity?.label === context.label,
    );

  if (!repeatedStory || !context.traderLine) {
    return context;
  }

  return {
    ...context,
    traderLine: undefined,
    reason: `same volume/activity story already shown for this ${eventType} setup`,
  };
}

function isFormalBosOrChoch(eventType: FormalMarketStructureRuntimeContext["eventType"]): boolean {
  return (
    eventType === "bos_bullish" ||
    eventType === "bos_bearish" ||
    eventType === "choch_bullish" ||
    eventType === "choch_bearish"
  );
}

function isFormalSweepOrFailedBreak(eventType: FormalMarketStructureRuntimeContext["eventType"]): boolean {
  return (
    eventType === "liquidity_sweep_high" ||
    eventType === "liquidity_sweep_low" ||
    eventType === "failed_break_high" ||
    eventType === "failed_break_low"
  );
}

function formalTimeframePriority(timeframe: FormalMarketStructureRuntimeContext["timeframe"]): number {
  if (timeframe === "4h") return 2;
  if (timeframe === "5m") return 1;
  return 0;
}

function selectedFormalPriority(formal: FormalMarketStructureRuntimeContext): number {
  const timeframePriority = formalTimeframePriority(formal.timeframe);
  if (formal.eventFreshness === "fresh" && isFormalBosOrChoch(formal.eventType)) {
    return 500 + timeframePriority;
  }
  if (formal.eventFreshness === "fresh" && isFormalSweepOrFailedBreak(formal.eventType)) {
    return 300 + timeframePriority;
  }
  if (formal.timeframe === "5m") {
    return 100;
  }
  return 80 + timeframePriority;
}

function selectFormalMarketStructureContext(
  symbolState: SymbolMonitoringState,
): FormalMarketStructureRuntimeContext | undefined {
  const candidates = [
    symbolState.runtimeMarketStructure?.timeframes?.["4h"]?.formal,
    symbolState.runtimeMarketStructure?.timeframes?.["5m"]?.formal,
    symbolState.formalMarketStructure,
  ].filter((formal): formal is FormalMarketStructureRuntimeContext => Boolean(formal));

  return candidates.sort((left, right) => selectedFormalPriority(right) - selectedFormalPriority(left))[0];
}

function formalMarketStructureEventFields(
  symbolState: SymbolMonitoringState,
): Partial<MonitoringEventContext> {
  const formal = symbolState.formalMarketStructure;
  const selected = selectFormalMarketStructureContext(symbolState);
  const fields: Partial<MonitoringEventContext> = {};

  if (formal) {
    Object.assign(fields, {
      formalStructureTimeframe: formal.timeframe,
      formalStructureBias: formal.bias,
      formalStructurePreviousBias: formal.previousBias,
      formalStructureEventType: formal.eventType,
      formalStructureEventFreshness: formal.eventFreshness,
      formalStructureTriggerTimestamp: formal.triggerTimestamp,
      formalStructureConfirmation: formal.confirmation,
      formalStructureConfidence: formal.confidence,
      formalStructureConfidenceScore: formal.confidenceScore,
      formalStructureMaterialChange: formal.materialChange,
      formalStructureBrokenSwingPrice: formal.brokenSwingPrice,
      formalStructureSweptSwingPrice: formal.sweptSwingPrice,
      formalStructureProtectedHigh: formal.protectedHigh,
      formalStructureProtectedLow: formal.protectedLow,
      formalStructureLatestHigh: formal.latestHigh,
      formalStructureLatestLow: formal.latestLow,
      formalStructureSwingSequence: formal.swingSequence,
      formalStructureKey: formal.structureKey,
      formalStructureTraderLine: formal.traderLine,
      formalStructureDebugReasons: formal.debug.reasons,
    });
  }

  if (selected) {
    Object.assign(fields, {
      selectedFormalStructureTimeframe: selected.timeframe,
      selectedFormalStructureBias: selected.bias,
      selectedFormalStructurePreviousBias: selected.previousBias,
      selectedFormalStructureEventType: selected.eventType,
      selectedFormalStructureEventFreshness: selected.eventFreshness,
      selectedFormalStructureTriggerTimestamp: selected.triggerTimestamp,
      selectedFormalStructureConfirmation: selected.confirmation,
      selectedFormalStructureConfidence: selected.confidence,
      selectedFormalStructureConfidenceScore: selected.confidenceScore,
      selectedFormalStructureMaterialChange: selected.materialChange,
      selectedFormalStructureBrokenSwingPrice: selected.brokenSwingPrice,
      selectedFormalStructureSweptSwingPrice: selected.sweptSwingPrice,
      selectedFormalStructureProtectedHigh: selected.protectedHigh,
      selectedFormalStructureProtectedLow: selected.protectedLow,
      selectedFormalStructureLatestHigh: selected.latestHigh,
      selectedFormalStructureLatestLow: selected.latestLow,
      selectedFormalStructureSwingSequence: selected.swingSequence,
      selectedFormalStructureKey: selected.structureKey,
      selectedFormalStructureTraderLine: selected.traderLine,
      selectedFormalStructureDebugReasons: selected.debug.reasons,
    });
  }

  return fields;
}

function buildMonitoringEventContext(
  zone: FinalLevelZone,
  symbolState: SymbolMonitoringState,
  update: LivePriceUpdate,
  eventType: MonitoringEvent["eventType"],
  currentState: ZoneInteractionState,
  config: MonitoringConfig,
): MonitoringEventContext {
  const zoneContext = symbolState.zoneContexts[zone.id];
  const symbolContext = buildSymbolContext({
    symbolState,
    zone,
    currentState,
    referenceTimestamp: update.timestamp,
  });
  const nearestBarrier = findNearestRelevantBarrier({
    eventType,
    zone,
    symbolState,
    triggerPrice: update.lastPrice,
  });
  const barrierClutter = deriveBarrierClutter({
    eventType,
    zone,
    symbolState,
    triggerPrice: update.lastPrice,
    config,
  });
  const pathQuality = derivePathQuality({
    eventType,
    zone,
    symbolState,
    triggerPrice: update.lastPrice,
    config,
  });
  const clearanceLabel = deriveBarrierClearanceLabel(
    nearestBarrier?.distancePct ?? null,
    config,
  );
  const tacticalRead = deriveZoneTacticalRead(
    zone,
    zoneContext?.zoneFreshness ?? zone.freshness,
  );
  const exhaustionLabel = deriveZoneExhaustion({
    zone,
    zoneFreshness: zoneContext?.zoneFreshness ?? zone.freshness,
    tacticalRead,
  });
  const tradeStructure = derivePracticalTradeStructureContext({
    symbolState,
    zone,
    eventType,
    price: update.lastPrice,
    timestamp: update.timestamp,
  });
  const volumeActivity = volumeActivityForEvent(symbolState, eventType, zone.id);
  const stableMarketStructure = symbolState.stableMarketStructure;
  const runtimeMarketStructure = symbolState.runtimeMarketStructure;
  const formalMarketStructureFields = formalMarketStructureEventFields(symbolState);
  const tradeStory = buildTradeStoryIntelligenceContext({
    symbolState,
    zone,
    eventType,
    price: update.lastPrice,
    timestamp: update.timestamp,
    tradeStructure,
    stableMaterialChange: stableMarketStructure?.materialChange,
  });

  if (zoneContext) {
    return {
      monitoredZoneId: zoneContext.monitoredZoneId,
      canonicalZoneId: zoneContext.canonicalZoneId,
      zoneFreshness: zoneContext.zoneFreshness,
      zoneOrigin: zoneContext.origin,
      remapStatus: zoneContext.remapStatus,
      remappedFromZoneIds: [...zoneContext.remappedFromZoneIds],
      dataQualityDegraded: zoneContext.dataQualityDegraded,
      recentlyRefreshed: zoneContext.recentlyRefreshed,
      recentlyPromotedExtension: zoneContext.recentlyPromotedExtension,
      ladderPosition: zoneContext.ladderPosition,
      zoneStrengthLabel: zoneContext.zoneStrengthLabel,
      sourceGeneratedAt: zoneContext.sourceGeneratedAt,
      nextBarrierKind: nearestBarrier?.kind,
      nextBarrierLevel: nearestBarrier?.level,
      nextBarrierDistancePct: nearestBarrier?.distancePct,
      nextBarrierStrengthLabel: nearestBarrier?.zone.strengthLabel,
      nextBarrierRoleFlipFromKind: nearestBarrier?.roleFlipFromKind,
      clearanceLabel,
      barrierClutterLabel: barrierClutter?.label,
      nearbyBarrierCount: barrierClutter?.nearbyBarrierCount,
      pathQualityLabel: pathQuality?.label,
      pathBarrierCount: pathQuality?.barrierCount,
      pathConstraintScore: pathQuality?.constraintScore,
      pathWindowDistancePct: pathQuality?.pathWindowDistancePct,
      tacticalRead,
      exhaustionLabel,
      marketStructureType: symbolContext.structureType ?? undefined,
      marketStructureStrength: symbolContext.structureStrength,
      rangeCompressionScore: symbolContext.rangeCompressionScore,
      tradeStructure,
      stableMarketStructureState: stableMarketStructure?.state,
      stableMarketStructurePreviousState: stableMarketStructure?.previousState,
      stableMarketStructureKey: stableMarketStructure?.structureKey,
      stableMarketStructureMaterialChange: stableMarketStructure?.materialChange,
      stableMarketStructureConfidence: stableMarketStructure?.confidence,
      stableMarketStructureMaterialityScore: stableMarketStructure?.materialityScore,
      stableMarketStructureRawState: stableMarketStructure?.rawState,
      stableMarketStructureReason: stableMarketStructure?.reason,
      stableMarketStructureCandleCount: stableMarketStructure?.candleCount,
      stableMarketStructureRawRunLength: stableMarketStructure?.rawRunLength,
      stableMarketStructureTrendDirection: stableMarketStructure?.trendDirection,
      stableMarketStructureHigherLowCount: stableMarketStructure?.higherLowCount,
      stableMarketStructureLowerHighCount: stableMarketStructure?.lowerHighCount,
      stableMarketStructureHigherHighCount: stableMarketStructure?.higherHighCount,
      stableMarketStructureLowerLowCount: stableMarketStructure?.lowerLowCount,
      stableMarketStructureLatestSwingLow: stableMarketStructure?.latestSwingLow,
      stableMarketStructureLatestSwingHigh: stableMarketStructure?.latestSwingHigh,
      stableMarketStructurePriorSwingLow: stableMarketStructure?.priorSwingLow,
      stableMarketStructurePriorSwingHigh: stableMarketStructure?.priorSwingHigh,
      stableMarketStructureActiveRangeLow: stableMarketStructure?.activeRangeLow,
      stableMarketStructureActiveRangeHigh: stableMarketStructure?.activeRangeHigh,
      stableMarketStructureActiveRangeWidthPct: stableMarketStructure?.activeRangeWidthPct,
      stableMarketStructureActiveRangeQuality: stableMarketStructure?.activeRangeQuality,
      stableMarketStructurePivotEventType: stableMarketStructure?.pivotEventType,
      stableMarketStructurePivotEventTriggerPrice: stableMarketStructure?.pivotEventTriggerPrice,
      ...formalMarketStructureFields,
      runtimeMarketStructure,
      volumeActivity,
      tradeStoryState: tradeStory.storyState,
      rangeBox: tradeStory.rangeBox,
      acceptance: tradeStory.acceptance,
      supportImportance: tradeStory.supportImportance,
      behaviorBudget: tradeStory.behaviorBudget,
      primaryTradeArea: tradeStory.primaryTradeArea,
      failedLevelMemory: tradeStory.failedLevelMemory,
    };
  }

  return {
    monitoredZoneId: zone.id,
    canonicalZoneId: zone.id,
    zoneFreshness: zone.freshness,
    zoneOrigin: (zone.isExtension ? "promoted_extension" : "canonical"),
    remapStatus: "new" as const,
    remappedFromZoneIds: [],
    dataQualityDegraded: (symbolState.levelDataQualityFlags?.length ?? 0) > 0,
    recentlyRefreshed: false,
    recentlyPromotedExtension: zone.isExtension,
    ladderPosition: zone.isExtension ? "extension" as const : "inner" as const,
    zoneStrengthLabel: zone.strengthLabel,
    sourceGeneratedAt: symbolState.levelGeneratedAt,
    nextBarrierKind: nearestBarrier?.kind,
    nextBarrierLevel: nearestBarrier?.level,
    nextBarrierDistancePct: nearestBarrier?.distancePct,
    nextBarrierStrengthLabel: nearestBarrier?.zone.strengthLabel,
    nextBarrierRoleFlipFromKind: nearestBarrier?.roleFlipFromKind,
    clearanceLabel,
    barrierClutterLabel: barrierClutter?.label,
    nearbyBarrierCount: barrierClutter?.nearbyBarrierCount,
    pathQualityLabel: pathQuality?.label,
    pathBarrierCount: pathQuality?.barrierCount,
    pathConstraintScore: pathQuality?.constraintScore,
    pathWindowDistancePct: pathQuality?.pathWindowDistancePct,
    tacticalRead,
    exhaustionLabel,
    marketStructureType: symbolContext.structureType ?? undefined,
    marketStructureStrength: symbolContext.structureStrength,
    rangeCompressionScore: symbolContext.rangeCompressionScore,
    tradeStructure,
    stableMarketStructureState: stableMarketStructure?.state,
    stableMarketStructurePreviousState: stableMarketStructure?.previousState,
    stableMarketStructureKey: stableMarketStructure?.structureKey,
    stableMarketStructureMaterialChange: stableMarketStructure?.materialChange,
    stableMarketStructureConfidence: stableMarketStructure?.confidence,
    stableMarketStructureMaterialityScore: stableMarketStructure?.materialityScore,
    stableMarketStructureRawState: stableMarketStructure?.rawState,
    stableMarketStructureReason: stableMarketStructure?.reason,
    stableMarketStructureCandleCount: stableMarketStructure?.candleCount,
    stableMarketStructureRawRunLength: stableMarketStructure?.rawRunLength,
    stableMarketStructureTrendDirection: stableMarketStructure?.trendDirection,
    stableMarketStructureHigherLowCount: stableMarketStructure?.higherLowCount,
    stableMarketStructureLowerHighCount: stableMarketStructure?.lowerHighCount,
    stableMarketStructureHigherHighCount: stableMarketStructure?.higherHighCount,
    stableMarketStructureLowerLowCount: stableMarketStructure?.lowerLowCount,
    stableMarketStructureLatestSwingLow: stableMarketStructure?.latestSwingLow,
    stableMarketStructureLatestSwingHigh: stableMarketStructure?.latestSwingHigh,
    stableMarketStructurePriorSwingLow: stableMarketStructure?.priorSwingLow,
    stableMarketStructurePriorSwingHigh: stableMarketStructure?.priorSwingHigh,
    stableMarketStructureActiveRangeLow: stableMarketStructure?.activeRangeLow,
    stableMarketStructureActiveRangeHigh: stableMarketStructure?.activeRangeHigh,
    stableMarketStructureActiveRangeWidthPct: stableMarketStructure?.activeRangeWidthPct,
    stableMarketStructureActiveRangeQuality: stableMarketStructure?.activeRangeQuality,
    stableMarketStructurePivotEventType: stableMarketStructure?.pivotEventType,
    stableMarketStructurePivotEventTriggerPrice: stableMarketStructure?.pivotEventTriggerPrice,
    ...formalMarketStructureFields,
    runtimeMarketStructure,
    volumeActivity,
    tradeStoryState: tradeStory.storyState,
    rangeBox: tradeStory.rangeBox,
    acceptance: tradeStory.acceptance,
    supportImportance: tradeStory.supportImportance,
    behaviorBudget: tradeStory.behaviorBudget,
    primaryTradeArea: tradeStory.primaryTradeArea,
    failedLevelMemory: tradeStory.failedLevelMemory,
  };
}

function buildEvent(
  symbol: string,
  eventType: MonitoringEvent["eventType"],
  zone: FinalLevelZone,
  update: LivePriceUpdate,
  previousPrice: number | undefined,
  currentState: ZoneInteractionState,
  symbolState: SymbolMonitoringState,
  config: MonitoringConfig,
  notes: string[],
): MonitoringEvent {
  const signal = scoreMonitoringEvent({
    eventType,
    zone,
    update,
    previousPrice,
    currentState,
    symbolState,
    config,
  });

  return {
    id: `${symbol}-${zone.id}-${eventType}-${update.timestamp}`,
    episodeId: buildInteractionEpisodeId(symbol, zone, currentState, update),
    symbol,
    type: signal.type,
    eventType,
    zoneId: zone.id,
    zoneKind: zone.kind,
    level: signal.level,
    triggerPrice: update.lastPrice,
    strength: signal.strength,
    confidence: signal.confidence,
    priority: signal.priority,
    bias: signal.bias ?? "neutral",
    pressureScore: signal.pressureScore,
    eventContext: buildMonitoringEventContext(
      zone,
      symbolState,
      update,
      eventType,
      currentState,
      config,
    ),
    timestamp: update.timestamp,
    notes,
  };
}

function pushEventIfRelevant(
  events: MonitoringEvent[],
  params: {
    symbol: string;
    eventType: MonitoringEvent["eventType"];
    zone: FinalLevelZone;
    update: LivePriceUpdate;
    previousPrice?: number;
    currentState: ZoneInteractionState;
    symbolState: SymbolMonitoringState;
    config: MonitoringConfig;
    notes: string[];
  },
): boolean {
  if (
    shouldFilterMonitoringEvent({
      eventType: params.eventType,
      currentState: params.currentState,
      update: params.update,
      previousPrice: params.previousPrice,
      config: params.config,
      zone: params.zone,
      symbolState: params.symbolState,
    })
  ) {
    return false;
  }

  events.push(
    buildEvent(
      params.symbol,
      params.eventType,
      params.zone,
      params.update,
      params.previousPrice,
      params.currentState,
      params.symbolState,
      params.config,
      params.notes,
    ),
  );

  return true;
}

export function detectMonitoringEvents(params: {
  previousState: ZoneInteractionState;
  currentState: ZoneInteractionState;
  zone: FinalLevelZone;
  update: LivePriceUpdate;
  previousPrice?: number;
  symbolState: SymbolMonitoringState;
  config: MonitoringConfig;
  diagnosticListener?: MonitoringEventDiagnosticListener;
}): MonitoringEvent[] {
  const {
    previousState,
    currentState,
    zone,
    update,
    previousPrice,
    symbolState,
    config,
    diagnosticListener,
  } = params;
  const events: MonitoringEvent[] = [];
  const inside = isInsideZone(update.lastPrice, zone);
  const above = isAboveZone(update.lastPrice, zone);
  const below = isBelowZone(update.lastPrice, zone);

  if (zone.kind === "resistance") {
    const levelTouch =
      inside &&
      previousState.phase !== "touching" &&
      currentState.updatesNearZone >= 1;

    if (levelTouch) {
      pushEventIfRelevant(events, {
        symbol: zone.symbol,
        eventType: "level_touch",
        zone,
        update,
        previousPrice,
        currentState,
        symbolState,
        config,
        notes: ["Price touched resistance level and opened a new interaction episode."],
      });
    }

    const breakoutDistancePct =
      (update.lastPrice - zone.zoneHigh) / Math.max(zone.zoneHigh, 0.0001);
    const freshBreakoutCross =
      previousPrice !== undefined
        ? !isAboveZone(previousPrice, zone)
        : breakoutDistancePct <= config.breakoutConfirmPct * 1.5;
    const forcefulBreakout = breakoutDistancePct >= config.breakoutConfirmPct * 2;
    const breakoutHasBackfill = hasInteractionBackfill(previousState);
    const confirmedBreakout =
      above &&
      freshBreakoutCross &&
      breakoutDistancePct >= config.breakoutConfirmPct &&
      breakoutDistancePct <= config.maxConfirmDistancePct &&
      (breakoutHasBackfill || forcefulBreakout);

    const breakoutReasons: string[] = [];
    if (!above) {
      breakoutReasons.push("price_not_above_zone");
    }
    if (!freshBreakoutCross) {
      breakoutReasons.push("not_a_fresh_breakout_cross");
    }
    if (breakoutDistancePct < config.breakoutConfirmPct) {
      breakoutReasons.push("breakout_distance_below_confirm_threshold");
    }
    if (breakoutDistancePct > config.maxConfirmDistancePct) {
      breakoutReasons.push("breakout_distance_above_max_confirm_threshold");
    }
    if (!breakoutHasBackfill && !forcefulBreakout) {
      breakoutReasons.push("missing_prior_interaction_backfill");
    }
    if (previousState.phase === "confirmed") {
      breakoutReasons.push("zone_already_confirmed");
    }

    let breakoutEmitted = false;
    if (previousState.phase !== "confirmed" && confirmedBreakout) {
      breakoutEmitted = pushEventIfRelevant(events, {
        symbol: zone.symbol,
        eventType: "breakout",
        zone,
        update,
        previousPrice,
        currentState,
        symbolState,
        config,
        notes: [
          "Price confirmed above resistance zone.",
        ],
      });
    }
    if (!breakoutEmitted && previousState.phase !== "confirmed" && confirmedBreakout) {
      breakoutReasons.push("filtered_by_event_relevance_rules");
    }
    emitMonitoringEventDiagnostic(diagnosticListener, {
      eventType: "breakout",
      zone,
      update,
      previousPrice,
      previousState,
      currentState,
      decision: breakoutEmitted ? "emitted" : "suppressed",
      reasons: breakoutEmitted ? ["confirmed_breakout_emitted"] : breakoutReasons,
      metrics: {
        inside,
        above,
        breakoutDistancePct,
        freshBreakoutCross,
        forcefulBreakout,
        hasInteractionBackfill: breakoutHasBackfill,
      },
    });

    const hasRecentBreakAttempt =
      previousState.breakAttemptAt !== undefined &&
      update.timestamp - previousState.breakAttemptAt <= config.fakeoutWindowMs;
    const returnedInsideResistance = inside;
    const failureReturnFromResistance =
      (zone.zoneHigh - update.lastPrice) / Math.max(zone.zoneHigh, 0.0001);
    const acceptedBreakoutFailure =
      previousState.phase === "confirmed" &&
      below &&
      previousPrice !== undefined &&
      !isBelowZone(previousPrice, zone) &&
      failureReturnFromResistance >= config.failureReturnPct;
    const fakeBreakout =
      (hasRecentBreakAttempt &&
        (returnedInsideResistance ||
          failureReturnFromResistance >= config.failureReturnPct)) ||
      acceptedBreakoutFailure;
    const canEmitFakeBreakout = previousState.phase === "breaking" || acceptedBreakoutFailure;

    const fakeBreakoutReasons: string[] = [];
    if (!hasRecentBreakAttempt && !acceptedBreakoutFailure) {
      fakeBreakoutReasons.push("no_recent_break_attempt");
    }
    if (!returnedInsideResistance && failureReturnFromResistance < config.failureReturnPct && !acceptedBreakoutFailure) {
      fakeBreakoutReasons.push("did_not_fail_back_into_resistance");
    }
    if (previousState.phase !== "breaking" && !acceptedBreakoutFailure) {
      fakeBreakoutReasons.push("zone_not_in_breaking_phase");
    }

    let fakeBreakoutEmitted = false;
    if (canEmitFakeBreakout && fakeBreakout) {
      fakeBreakoutEmitted = pushEventIfRelevant(events, {
        symbol: zone.symbol,
        eventType: "fake_breakout",
        zone,
        update,
        previousPrice,
        currentState,
        symbolState,
        config,
        notes: [
          acceptedBreakoutFailure
            ? "Accepted breakout lost the former resistance zone."
            : "Price attempted breakout but failed back into or below resistance.",
        ],
      });
    }
    if (!fakeBreakoutEmitted && canEmitFakeBreakout && fakeBreakout) {
      fakeBreakoutReasons.push("filtered_by_event_relevance_rules");
    }
    emitMonitoringEventDiagnostic(diagnosticListener, {
      eventType: "fake_breakout",
      zone,
      update,
      previousPrice,
      previousState,
      currentState,
      decision: fakeBreakoutEmitted ? "emitted" : "suppressed",
      reasons: fakeBreakoutEmitted ? ["fake_breakout_emitted"] : fakeBreakoutReasons,
      metrics: {
        inside,
        above,
        below,
        hasRecentBreakAttempt,
        acceptedBreakoutFailure,
        failureReturnFromResistance,
      },
    });

    const rejection =
      previousPrice !== undefined &&
      previousPrice <= zone.zoneHigh &&
      previousState.updatesNearZone < 3 &&
      inside &&
      update.lastPrice < previousPrice &&
      currentState.updatesNearZone >= 2;

    if (rejection && previousState.phase !== "rejected") {
      pushEventIfRelevant(events, {
        symbol: zone.symbol,
        eventType: "rejection",
        zone,
        update,
        previousPrice,
        currentState,
        symbolState,
        config,
        notes: [
          "Price tested resistance and reversed away.",
        ],
      });
    }

    const compression =
      currentState.updatesNearZone >= config.compressionMinUpdates &&
      previousState.updatesNearZone < config.compressionMinUpdates &&
      currentState.nearestDistancePct <= config.compressionMaxDistancePct &&
      !above;

    if (compression) {
      pushEventIfRelevant(events, {
        symbol: zone.symbol,
        eventType: "compression",
        zone,
        update,
        previousPrice,
        currentState,
        symbolState,
        config,
        notes: [
          "Price is compressing near resistance.",
        ],
      });
    }
  } else {
    const supportApproach =
      above &&
      currentState.nearestDistancePct <= getSupportApproachPct(config);
    const levelTouch =
      (inside || supportApproach) &&
      previousState.phase !== "touching" &&
      (!supportApproach || previousState.phase !== "testing") &&
      currentState.updatesNearZone >= 1;

    if (levelTouch) {
      pushEventIfRelevant(events, {
        symbol: zone.symbol,
        eventType: "level_touch",
        zone,
        update,
        previousPrice,
        currentState,
        symbolState,
        config,
        notes: [
          supportApproach
            ? "Price approached support and opened a new support reaction watch."
            : "Price touched support level and opened a new interaction episode.",
        ],
      });
    }

    const breakdownDistancePct =
      (zone.zoneLow - update.lastPrice) / Math.max(zone.zoneLow, 0.0001);
    const freshBreakdownCross =
      previousPrice !== undefined
        ? !isBelowZone(previousPrice, zone)
        : breakdownDistancePct <= config.breakoutConfirmPct * 1.5;
    const forcefulBreakdown = breakdownDistancePct >= config.breakoutConfirmPct * 2;
    const breakdownHasBackfill = hasInteractionBackfill(previousState);
    const confirmedBreakdown =
      below &&
      freshBreakdownCross &&
      breakdownDistancePct >= config.breakoutConfirmPct &&
      breakdownDistancePct <= config.maxConfirmDistancePct &&
      (breakdownHasBackfill || forcefulBreakdown);

    const breakdownReasons: string[] = [];
    if (!below) {
      breakdownReasons.push("price_not_below_zone");
    }
    if (!freshBreakdownCross) {
      breakdownReasons.push("not_a_fresh_breakdown_cross");
    }
    if (breakdownDistancePct < config.breakoutConfirmPct) {
      breakdownReasons.push("breakdown_distance_below_confirm_threshold");
    }
    if (breakdownDistancePct > config.maxConfirmDistancePct) {
      breakdownReasons.push("breakdown_distance_above_max_confirm_threshold");
    }
    if (!breakdownHasBackfill && !forcefulBreakdown) {
      breakdownReasons.push("missing_prior_interaction_backfill");
    }
    if (previousState.phase === "confirmed") {
      breakdownReasons.push("zone_already_confirmed");
    }

    let breakdownEmitted = false;
    if (previousState.phase !== "confirmed" && confirmedBreakdown) {
      breakdownEmitted = pushEventIfRelevant(events, {
        symbol: zone.symbol,
        eventType: "breakdown",
        zone,
        update,
        previousPrice,
        currentState,
        symbolState,
        config,
        notes: [
          "Price confirmed below support zone.",
        ],
      });
    }
    if (!breakdownEmitted && previousState.phase !== "confirmed" && confirmedBreakdown) {
      breakdownReasons.push("filtered_by_event_relevance_rules");
    }
    emitMonitoringEventDiagnostic(diagnosticListener, {
      eventType: "breakdown",
      zone,
      update,
      previousPrice,
      previousState,
      currentState,
      decision: breakdownEmitted ? "emitted" : "suppressed",
      reasons: breakdownEmitted ? ["confirmed_breakdown_emitted"] : breakdownReasons,
      metrics: {
        inside,
        below,
        breakdownDistancePct,
        freshBreakdownCross,
        forcefulBreakdown,
        hasInteractionBackfill: breakdownHasBackfill,
      },
    });

    const reclaimedAboveSupport = update.lastPrice > zone.zoneHigh;
    const hasRecentSupportBreakAttempt =
      previousState.breakAttemptAt !== undefined &&
      update.timestamp - previousState.breakAttemptAt <= config.fakeoutWindowMs;
    const failureReturnFromSupport =
      (update.lastPrice - zone.zoneLow) / Math.max(zone.zoneLow, 0.0001);
    const fakeBreakdown =
      hasRecentSupportBreakAttempt &&
      (inside ||
        (!reclaimedAboveSupport &&
          failureReturnFromSupport >= config.failureReturnPct));

    const fakeBreakdownReasons: string[] = [];
    if (!hasRecentSupportBreakAttempt) {
      fakeBreakdownReasons.push("no_recent_break_attempt");
    }
    if (!inside && reclaimedAboveSupport) {
      fakeBreakdownReasons.push("full_reclaim_routes_to_reclaim_logic");
    } else if (!inside && failureReturnFromSupport < config.failureReturnPct) {
      fakeBreakdownReasons.push("did_not_recover_enough_into_support");
    }
    if (previousState.phase !== "breaking") {
      fakeBreakdownReasons.push("zone_not_in_breaking_phase");
    }

    let fakeBreakdownEmitted = false;
    if (previousState.phase === "breaking" && fakeBreakdown) {
      fakeBreakdownEmitted = pushEventIfRelevant(events, {
        symbol: zone.symbol,
        eventType: "fake_breakdown",
        zone,
        update,
        previousPrice,
        currentState,
        symbolState,
        config,
        notes: [
          "Price lost support but quickly reclaimed it.",
        ],
      });
    }
    if (!fakeBreakdownEmitted && previousState.phase === "breaking" && fakeBreakdown) {
      fakeBreakdownReasons.push("filtered_by_event_relevance_rules");
    }
    emitMonitoringEventDiagnostic(diagnosticListener, {
      eventType: "fake_breakdown",
      zone,
      update,
      previousPrice,
      previousState,
      currentState,
      decision: fakeBreakdownEmitted ? "emitted" : "suppressed",
      reasons: fakeBreakdownEmitted ? ["fake_breakdown_emitted"] : fakeBreakdownReasons,
      metrics: {
        inside,
        below,
        reclaimedAboveSupport,
        hasRecentBreakAttempt: hasRecentSupportBreakAttempt,
        failureReturnFromSupport,
      },
    });

    const reclaimDistancePct =
      (update.lastPrice - zone.zoneHigh) / Math.max(zone.zoneHigh, 0.0001);
    const reclaim =
      previousPrice !== undefined &&
      previousPrice < zone.zoneLow &&
      reclaimedAboveSupport &&
      reclaimDistancePct >= config.breakoutConfirmPct &&
      reclaimDistancePct <= config.maxConfirmDistancePct &&
      hasRecentBreakAttempt(previousState, update.timestamp, config.fakeoutWindowMs);

    const reclaimReasons: string[] = [];
    if (previousPrice === undefined) {
      reclaimReasons.push("missing_previous_price");
    } else if (previousPrice >= zone.zoneLow) {
      reclaimReasons.push("previous_price_not_below_support");
    }
    if (!reclaimedAboveSupport) {
      reclaimReasons.push("price_not_reclaimed_above_support");
    }
    if (reclaimDistancePct < config.breakoutConfirmPct) {
      reclaimReasons.push("reclaim_distance_below_confirm_threshold");
    }
    if (reclaimDistancePct > config.maxConfirmDistancePct) {
      reclaimReasons.push("reclaim_distance_above_max_confirm_threshold");
    }
    if (!hasRecentBreakAttempt(previousState, update.timestamp, config.fakeoutWindowMs)) {
      reclaimReasons.push("no_recent_break_attempt");
    }

    let reclaimEmitted = false;
    if (reclaim) {
      reclaimEmitted = pushEventIfRelevant(events, {
        symbol: zone.symbol,
        eventType: "reclaim",
        zone,
        update,
        previousPrice,
        currentState,
        symbolState,
        config,
        notes: [
          "Price reclaimed support zone.",
        ],
      });
    }
    if (!reclaimEmitted && reclaim) {
      reclaimReasons.push("filtered_by_event_relevance_rules");
    }
    emitMonitoringEventDiagnostic(diagnosticListener, {
      eventType: "reclaim",
      zone,
      update,
      previousPrice,
      previousState,
      currentState,
      decision: reclaimEmitted ? "emitted" : "suppressed",
      reasons: reclaimEmitted ? ["reclaim_emitted"] : reclaimReasons,
      metrics: {
        inside,
        below,
        reclaimedAboveSupport,
        reclaimDistancePct,
        hasRecentBreakAttempt: hasRecentBreakAttempt(
          previousState,
          update.timestamp,
          config.fakeoutWindowMs,
        ),
      },
    });

    const compression =
      currentState.updatesNearZone >= config.compressionMinUpdates &&
      previousState.updatesNearZone < config.compressionMinUpdates &&
      currentState.nearestDistancePct <= config.compressionMaxDistancePct &&
      !below;

    if (compression) {
      pushEventIfRelevant(events, {
        symbol: zone.symbol,
        eventType: "compression",
        zone,
        update,
        previousPrice,
        currentState,
        symbolState,
        config,
        notes: [
          "Price is compressing near support.",
        ],
      });
    }
  }

  return events;
}
