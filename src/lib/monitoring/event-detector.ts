// 2026-04-14 09:28 PM America/Toronto
// Detect monitoring events from state transitions.

import type { FinalLevelZone } from "../levels/level-types.js";
import type { MonitoringConfig } from "./monitoring-config.js";
import type {
  LivePriceUpdate,
  MonitoringEvent,
  ZoneInteractionState,
} from "./monitoring-types.js";
import { isAboveZone, isBelowZone, isInsideZone } from "./zone-utils.js";

function buildEvent(
  symbol: string,
  eventType: MonitoringEvent["eventType"],
  zone: FinalLevelZone,
  update: LivePriceUpdate,
  notes: string[],
): MonitoringEvent {
  return {
    id: `${symbol}-${zone.id}-${eventType}-${update.timestamp}`,
    symbol,
    eventType,
    zoneId: zone.id,
    zoneKind: zone.kind,
    triggerPrice: update.lastPrice,
    timestamp: update.timestamp,
    notes,
  };
}

export function detectMonitoringEvents(params: {
  previousState: ZoneInteractionState;
  currentState: ZoneInteractionState;
  zone: FinalLevelZone;
  update: LivePriceUpdate;
  previousPrice?: number;
  config: MonitoringConfig;
}): MonitoringEvent[] {
  const { previousState, currentState, zone, update, previousPrice, config } = params;
  const events: MonitoringEvent[] = [];
  const inside = isInsideZone(update.lastPrice, zone);
  const above = isAboveZone(update.lastPrice, zone);
  const below = isBelowZone(update.lastPrice, zone);

  if (zone.kind === "resistance") {
    const breakoutDistancePct =
      (update.lastPrice - zone.zoneHigh) / Math.max(zone.zoneHigh, 0.0001);
    const freshBreakoutCross =
      previousPrice !== undefined
        ? !isAboveZone(previousPrice, zone)
        : breakoutDistancePct <= config.breakoutConfirmPct * 1.5;
    const confirmedBreakout =
      above &&
      freshBreakoutCross &&
      breakoutDistancePct >= config.breakoutConfirmPct &&
      breakoutDistancePct <= config.maxConfirmDistancePct;

    if (previousState.phase !== "confirmed" && confirmedBreakout) {
      events.push(
        buildEvent(zone.symbol, "breakout", zone, update, [
          "Price confirmed above resistance zone.",
        ]),
      );
    }

    const fakeBreakout =
      previousState.breakAttemptAt !== undefined &&
      update.timestamp - previousState.breakAttemptAt <= config.fakeoutWindowMs &&
      (inside ||
        (zone.zoneHigh - update.lastPrice) / Math.max(zone.zoneHigh, 0.0001) >=
          config.failureReturnPct);

    if (previousState.phase === "breaking" && fakeBreakout) {
      events.push(
        buildEvent(zone.symbol, "fake_breakout", zone, update, [
          "Price attempted breakout but failed back into or below resistance.",
        ]),
      );
    }

    const rejection =
      previousPrice !== undefined &&
      previousPrice <= zone.zoneHigh &&
      inside &&
      update.lastPrice < previousPrice &&
      currentState.updatesNearZone >= 2;

    if (rejection && previousState.phase !== "rejected") {
      events.push(
        buildEvent(zone.symbol, "rejection", zone, update, [
          "Price tested resistance and reversed away.",
        ]),
      );
    }

    const compression =
      currentState.updatesNearZone >= config.compressionMinUpdates &&
      previousState.updatesNearZone < config.compressionMinUpdates &&
      currentState.nearestDistancePct <= config.compressionMaxDistancePct &&
      !above;

    if (compression) {
      events.push(
        buildEvent(zone.symbol, "compression", zone, update, [
          "Price is compressing near resistance.",
        ]),
      );
    }
  } else {
    const breakdownDistancePct =
      (zone.zoneLow - update.lastPrice) / Math.max(zone.zoneLow, 0.0001);
    const freshBreakdownCross =
      previousPrice !== undefined
        ? !isBelowZone(previousPrice, zone)
        : breakdownDistancePct <= config.breakoutConfirmPct * 1.5;
    const confirmedBreakdown =
      below &&
      freshBreakdownCross &&
      breakdownDistancePct >= config.breakoutConfirmPct &&
      breakdownDistancePct <= config.maxConfirmDistancePct;

    if (previousState.phase !== "confirmed" && confirmedBreakdown) {
      events.push(
        buildEvent(zone.symbol, "breakdown", zone, update, [
          "Price confirmed below support zone.",
        ]),
      );
    }

    const fakeBreakdown =
      previousState.breakAttemptAt !== undefined &&
      update.timestamp - previousState.breakAttemptAt <= config.fakeoutWindowMs &&
      (inside ||
        (update.lastPrice - zone.zoneLow) / Math.max(zone.zoneLow, 0.0001) >=
          config.failureReturnPct);

    if (previousState.phase === "breaking" && fakeBreakdown) {
      events.push(
        buildEvent(zone.symbol, "fake_breakdown", zone, update, [
          "Price lost support but quickly reclaimed it.",
        ]),
      );
    }

    const reclaim =
      previousPrice !== undefined &&
      previousPrice < zone.zoneLow &&
      update.lastPrice > zone.zoneHigh;

    if (reclaim) {
      events.push(
        buildEvent(zone.symbol, "reclaim", zone, update, [
          "Price reclaimed support zone.",
        ]),
      );
    }

    const compression =
      currentState.updatesNearZone >= config.compressionMinUpdates &&
      previousState.updatesNearZone < config.compressionMinUpdates &&
      currentState.nearestDistancePct <= config.compressionMaxDistancePct &&
      !below;

    if (compression) {
      events.push(
        buildEvent(zone.symbol, "compression", zone, update, [
          "Price is compressing near support.",
        ]),
      );
    }
  }

  return events;
}
