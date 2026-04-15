import type { FinalLevelZone } from "../levels/level-types.js";
import type { MonitoringConfig } from "./monitoring-config.js";
import type {
  LivePriceUpdate,
  MonitoringAlertType,
  MonitoringEventType,
  SymbolMonitoringState,
  ZoneInteractionState,
} from "./monitoring-types.js";
import { buildSymbolContext } from "./symbol-state.js";

function clamp(value: number, min: number = 0, max: number = 1): number {
  return Math.max(min, Math.min(max, value));
}

function timeframeImportance(zone: FinalLevelZone): number {
  if (zone.timeframeSources.includes("daily")) {
    return 1;
  }

  if (zone.timeframeSources.includes("4h")) {
    return 0.75;
  }

  return 0.5;
}

function standardizedTypeForEvent(eventType: MonitoringEventType): MonitoringAlertType {
  if (eventType === "compression") {
    return "consolidation";
  }

  return eventType;
}

export function buildInteractionEpisodeId(
  symbol: string,
  zone: FinalLevelZone,
  currentState: ZoneInteractionState,
  update: LivePriceUpdate,
): string {
  const anchorTimestamp =
    currentState.firstTouchedAt ??
    currentState.breakAttemptAt ??
    currentState.lastTouchedAt ??
    update.timestamp;

  return `${symbol}-${zone.id}-episode-${anchorTimestamp}`;
}

export function shouldFilterMonitoringEvent(params: {
  eventType: MonitoringEventType;
  currentState: ZoneInteractionState;
  update: LivePriceUpdate;
  previousPrice?: number;
  config: MonitoringConfig;
}): boolean {
  const { eventType, currentState, update, previousPrice, config } = params;
  const movePct =
    previousPrice !== undefined
      ? Math.abs(update.lastPrice - previousPrice) / Math.max(Math.abs(previousPrice), 0.0001)
      : 0;

  if (
    eventType !== "level_touch" &&
    movePct > 0 &&
    movePct < Math.max(config.breakoutConfirmPct * 0.18, 0.0002)
  ) {
    return true;
  }

  if (
    (eventType === "compression" || eventType === "level_touch") &&
    currentState.nearestDistancePct > config.nearZonePct
  ) {
    return true;
  }

  return false;
}

export function scoreMonitoringEvent(params: {
  eventType: MonitoringEventType;
  zone: FinalLevelZone;
  update: LivePriceUpdate;
  previousPrice?: number;
  currentState: ZoneInteractionState;
  symbolState: SymbolMonitoringState;
  config: MonitoringConfig;
}): {
  type: MonitoringAlertType;
  level: number;
  strength: number;
  confidence: number;
  priority: number;
  bias: SymbolMonitoringState["bias"];
  pressureScore: number;
} {
  const { eventType, zone, update, previousPrice, currentState, symbolState, config } = params;
  const context = buildSymbolContext({
    symbolState,
    zone,
    currentState,
    referenceTimestamp: update.timestamp,
  });
  const movePct =
    previousPrice !== undefined
      ? Math.abs(update.lastPrice - previousPrice) / Math.max(Math.abs(previousPrice), 0.0001)
      : 0;
  const volumeScore =
    update.volume !== undefined && update.volume > 0
      ? clamp(Math.log10(update.volume + 1) / 6)
      : 0.35;
  const proximityScore = clamp(
    1 - currentState.nearestDistancePct / Math.max(config.nearZonePct, 0.0001),
  );
  const speedScore = clamp(movePct / Math.max(config.breakoutConfirmPct, 0.0001));
  const zoneStrengthScore = clamp(zone.strengthScore / 100);
  const timeframeScore = timeframeImportance(zone);
  const episodeScore = clamp(
    currentState.updatesNearZone / Math.max(config.compressionMinUpdates, 1),
  );
  const directionAlignment =
    (eventType === "breakout" || eventType === "reclaim" || eventType === "fake_breakdown") &&
    context.bias === "bullish"
      ? 1
      : (eventType === "breakdown" || eventType === "rejection" || eventType === "fake_breakout") &&
          context.bias === "bearish"
        ? 1
        : (eventType === "breakout" || eventType === "reclaim" || eventType === "fake_breakdown") &&
            context.bias === "bearish"
          ? -1
          : (eventType === "breakdown" || eventType === "rejection" || eventType === "fake_breakout") &&
              context.bias === "bullish"
            ? -1
            : 0;

  const eventBias =
    eventType === "breakout" || eventType === "breakdown"
      ? 0.95
      : eventType === "rejection" || eventType === "fake_breakout" || eventType === "fake_breakdown"
        ? 0.8
        : eventType === "level_touch"
          ? 0.45
          : 0.55;
  const repeatedTestBoost =
    eventType === "breakout" || eventType === "breakdown"
      ? clamp(context.repeatedTests / 4) * 0.14
      : eventType === "rejection" && zone.kind === "resistance"
        ? clamp(context.failedBreakoutCount / 3) * 0.16
        : eventType === "reclaim" && zone.kind === "support"
          ? clamp(context.failedBreakdownCount / 3) * 0.16
          : 0;
  const alignmentAdjustment = directionAlignment * 0.12;
  const structureBoost =
    context.structureType === "breakout_setup" &&
    (eventType === "breakout" || eventType === "reclaim")
      ? context.structureStrength * 0.14
      : context.structureType === "rejection_setup" &&
          (eventType === "rejection" || eventType === "fake_breakout")
        ? context.structureStrength * 0.16
        : context.structureType === "compression" && eventType === "compression"
          ? context.structureStrength * 0.08
          : 0;
  const failureAmplification =
    eventType === "rejection" &&
    context.failedBreakoutCount > 0 &&
    context.pressureScore >= 0.65
      ? context.failedBreakoutCount * context.pressureScore * 0.22
      : eventType === "fake_breakout" &&
          context.failedBreakoutCount > 0 &&
          context.pressureScore >= 0.65
        ? context.failedBreakoutCount * context.pressureScore * 0.16
        : 0;

  const strength = clamp(
    proximityScore * 0.32 +
      speedScore * 0.23 +
      volumeScore * 0.12 +
      zoneStrengthScore * 0.18 +
      timeframeScore * 0.1 +
      eventBias * 0.05 +
      context.pressureScore * 0.08 +
      repeatedTestBoost +
      alignmentAdjustment +
      structureBoost +
      failureAmplification,
  );

  const confidence = clamp(
    strength * 0.45 +
      timeframeScore * 0.2 +
      zoneStrengthScore * 0.15 +
      episodeScore * 0.1 +
      volumeScore * 0.1 +
      context.pressureScore * 0.08 +
      Math.max(0, alignmentAdjustment) * 0.12 +
      structureBoost * 0.9 +
      failureAmplification * 0.85,
  );

  const priority = Math.max(
    1,
    Math.round(strength * 45 + confidence * 35 + timeframeScore * 15 + zoneStrengthScore * 5),
  );

  return {
    type: standardizedTypeForEvent(eventType),
    level: zone.representativePrice,
    strength: Number(strength.toFixed(4)),
    confidence: Number(confidence.toFixed(4)),
    priority,
    bias: context.bias,
    pressureScore: context.pressureScore,
  };
}
