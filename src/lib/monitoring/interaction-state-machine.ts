// 2026-04-14 09:28 PM America/Toronto
// Stateful interaction updater for support and resistance zones.

import type { FinalLevelZone } from "../levels/level-types.js";
import { getSupportApproachPct, type MonitoringConfig } from "./monitoring-config.js";
import type { LivePriceUpdate, ZoneInteractionState } from "./monitoring-types.js";
import { distancePctFromZone, isAboveZone, isBelowZone, isInsideZone } from "./zone-utils.js";

export function createInitialInteractionState(
  symbol: string,
  zone: FinalLevelZone,
): ZoneInteractionState {
  return {
    zoneId: zone.id,
    symbol,
    levelKind: zone.kind,
    phase: "idle",
    nearestDistancePct: Number.POSITIVE_INFINITY,
    updatesNearZone: 0,
  };
}

export function updateInteractionState(params: {
  previousState: ZoneInteractionState;
  zone: FinalLevelZone;
  update: LivePriceUpdate;
  previousPrice?: number;
  config: MonitoringConfig;
}): ZoneInteractionState {
  const { previousState, zone, update, previousPrice, config } = params;
  const distancePct = distancePctFromZone(update.lastPrice, zone);
  const isNear = distancePct <= config.nearZonePct;
  const inside = isInsideZone(update.lastPrice, zone);
  const above = isAboveZone(update.lastPrice, zone);
  const below = isBelowZone(update.lastPrice, zone);
  const supportApproach =
    zone.kind === "support" &&
    above &&
    distancePct <= getSupportApproachPct(config);

  let phase = previousState.phase;
  let firstTouchedAt = previousState.firstTouchedAt;
  let breakAttemptAt = previousState.breakAttemptAt;
  let lastBreakPrice = previousState.lastBreakPrice;
  let updatesNearZone = (isNear || supportApproach) ? previousState.updatesNearZone + 1 : 0;

  if ((isNear || supportApproach) && !firstTouchedAt) {
    firstTouchedAt = update.timestamp;
  }

  if (!isNear && !supportApproach && !inside) {
    if (phase !== "confirmed" && phase !== "failed") {
      phase = "idle";
    }
  } else if (inside) {
    phase = "touching";
  } else if (isNear || supportApproach) {
    phase = "testing";
  }

  if (zone.kind === "resistance") {
    const crossedAbove =
      previousPrice !== undefined && previousPrice <= zone.zoneHigh && above;

    if (crossedAbove) {
      phase = "breaking";
      breakAttemptAt = update.timestamp;
      lastBreakPrice = update.lastPrice;
    }
  } else {
    const crossedBelow =
      previousPrice !== undefined && previousPrice >= zone.zoneLow && below;

    if (crossedBelow) {
      phase = "breaking";
      breakAttemptAt = update.timestamp;
      lastBreakPrice = update.lastPrice;
    }
  }

  return {
    ...previousState,
    phase,
    nearestDistancePct: distancePct,
    firstTouchedAt,
    lastTouchedAt: isNear || supportApproach || inside ? update.timestamp : previousState.lastTouchedAt,
    breakAttemptAt,
    lastBreakPrice,
    updatesNearZone,
  };
}
