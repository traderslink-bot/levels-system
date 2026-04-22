// 2026-04-14 09:28 PM America/Toronto
// Detect monitoring events from state transitions.

import type { FinalLevelZone } from "../levels/level-types.js";
import { deriveZoneTacticalRead } from "../levels/zone-tactical-read.js";
import type { MonitoringConfig } from "./monitoring-config.js";
import type {
  LivePriceUpdate,
  MonitoringDiagnosticEventType,
  MonitoringEvent,
  MonitoringEventContext,
  MonitoringEventDiagnostic,
  MonitoringEventDiagnosticListener,
  SymbolMonitoringState,
  ZoneInteractionState,
} from "./monitoring-types.js";
import {
  buildInteractionEpisodeId,
  deriveBarrierClearanceLabel,
  findNearestRelevantBarrier,
  scoreMonitoringEvent,
  shouldFilterMonitoringEvent,
} from "./monitoring-event-scoring.js";
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

function buildMonitoringEventContext(
  zone: FinalLevelZone,
  symbolState: SymbolMonitoringState,
  update: LivePriceUpdate,
  eventType: MonitoringEvent["eventType"],
  config: MonitoringConfig,
): MonitoringEventContext {
  const zoneContext = symbolState.zoneContexts[zone.id];
  const nearestBarrier = findNearestRelevantBarrier({
    eventType,
    zone,
    symbolState,
    triggerPrice: update.lastPrice,
  });
  const clearanceLabel = deriveBarrierClearanceLabel(
    nearestBarrier?.distancePct ?? null,
    config,
  );
  const tacticalRead = deriveZoneTacticalRead(
    zone,
    zoneContext?.zoneFreshness ?? zone.freshness,
  );

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
      clearanceLabel,
      tacticalRead,
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
    clearanceLabel,
    tacticalRead,
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
    eventContext: buildMonitoringEventContext(zone, symbolState, update, eventType, config),
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
    const fakeBreakout =
      hasRecentBreakAttempt &&
      (returnedInsideResistance ||
        failureReturnFromResistance >= config.failureReturnPct);

    const fakeBreakoutReasons: string[] = [];
    if (!hasRecentBreakAttempt) {
      fakeBreakoutReasons.push("no_recent_break_attempt");
    }
    if (!returnedInsideResistance && failureReturnFromResistance < config.failureReturnPct) {
      fakeBreakoutReasons.push("did_not_fail_back_into_resistance");
    }
    if (previousState.phase !== "breaking") {
      fakeBreakoutReasons.push("zone_not_in_breaking_phase");
    }

    let fakeBreakoutEmitted = false;
    if (previousState.phase === "breaking" && fakeBreakout) {
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
          "Price attempted breakout but failed back into or below resistance.",
        ],
      });
    }
    if (!fakeBreakoutEmitted && previousState.phase === "breaking" && fakeBreakout) {
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
        hasRecentBreakAttempt,
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
        notes: ["Price touched support level and opened a new interaction episode."],
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
