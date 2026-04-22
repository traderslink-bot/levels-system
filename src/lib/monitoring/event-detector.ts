// 2026-04-14 09:28 PM America/Toronto
// Detect monitoring events from state transitions.

import type { FinalLevelZone } from "../levels/level-types.js";
import type { MonitoringConfig } from "./monitoring-config.js";
import type {
  LivePriceUpdate,
  MonitoringEvent,
  MonitoringEventContext,
  SymbolMonitoringState,
  ZoneInteractionState,
} from "./monitoring-types.js";
import {
  buildInteractionEpisodeId,
  scoreMonitoringEvent,
  shouldFilterMonitoringEvent,
} from "./monitoring-event-scoring.js";
import { isAboveZone, isBelowZone, isInsideZone } from "./zone-utils.js";

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
): MonitoringEventContext {
  const zoneContext = symbolState.zoneContexts[zone.id];

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
    eventContext: buildMonitoringEventContext(zone, symbolState),
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
): void {
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
    return;
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
}

export function detectMonitoringEvents(params: {
  previousState: ZoneInteractionState;
  currentState: ZoneInteractionState;
  zone: FinalLevelZone;
  update: LivePriceUpdate;
  previousPrice?: number;
  symbolState: SymbolMonitoringState;
  config: MonitoringConfig;
}): MonitoringEvent[] {
  const { previousState, currentState, zone, update, previousPrice, symbolState, config } = params;
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
    const confirmedBreakout =
      above &&
      freshBreakoutCross &&
      breakoutDistancePct >= config.breakoutConfirmPct &&
      breakoutDistancePct <= config.maxConfirmDistancePct &&
      (hasInteractionBackfill(previousState) || forcefulBreakout);

    if (previousState.phase !== "confirmed" && confirmedBreakout) {
      pushEventIfRelevant(events, {
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

    const fakeBreakout =
      previousState.breakAttemptAt !== undefined &&
      update.timestamp - previousState.breakAttemptAt <= config.fakeoutWindowMs &&
      (inside ||
        (zone.zoneHigh - update.lastPrice) / Math.max(zone.zoneHigh, 0.0001) >=
          config.failureReturnPct);

    if (previousState.phase === "breaking" && fakeBreakout) {
      pushEventIfRelevant(events, {
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
    const confirmedBreakdown =
      below &&
      freshBreakdownCross &&
      breakdownDistancePct >= config.breakoutConfirmPct &&
      breakdownDistancePct <= config.maxConfirmDistancePct &&
      (hasInteractionBackfill(previousState) || forcefulBreakdown);

    if (previousState.phase !== "confirmed" && confirmedBreakdown) {
      pushEventIfRelevant(events, {
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

    const reclaimedAboveSupport = update.lastPrice > zone.zoneHigh;
    const fakeBreakdown =
      previousState.breakAttemptAt !== undefined &&
      update.timestamp - previousState.breakAttemptAt <= config.fakeoutWindowMs &&
      (inside ||
        (!reclaimedAboveSupport &&
          (update.lastPrice - zone.zoneLow) / Math.max(zone.zoneLow, 0.0001) >=
            config.failureReturnPct));

    if (previousState.phase === "breaking" && fakeBreakdown) {
      pushEventIfRelevant(events, {
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

    const reclaimDistancePct =
      (update.lastPrice - zone.zoneHigh) / Math.max(zone.zoneHigh, 0.0001);
    const reclaim =
      previousPrice !== undefined &&
      previousPrice < zone.zoneLow &&
      reclaimedAboveSupport &&
      reclaimDistancePct >= config.breakoutConfirmPct &&
      reclaimDistancePct <= config.maxConfirmDistancePct &&
      hasRecentBreakAttempt(previousState, update.timestamp, config.fakeoutWindowMs);

    if (reclaim) {
      pushEventIfRelevant(events, {
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
