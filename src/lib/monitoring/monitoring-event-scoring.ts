import type { FinalLevelZone } from "../levels/level-types.js";
import type { MonitoringConfig } from "./monitoring-config.js";
import type {
  BarrierClearanceLabel,
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

function freshnessImportance(zone: FinalLevelZone): number {
  return zone.freshness === "fresh" ? 1 : zone.freshness === "aging" ? 0.72 : 0.45;
}

export function deriveBarrierClearanceLabel(
  distancePct: number | null,
  config: MonitoringConfig,
): BarrierClearanceLabel | undefined {
  if (distancePct === null || !Number.isFinite(distancePct)) {
    return undefined;
  }

  if (distancePct <= config.tightClearancePct) {
    return "tight";
  }

  if (distancePct <= config.limitedClearancePct) {
    return "limited";
  }

  return "open";
}

function barrierSideForEvent(
  eventType: MonitoringEventType,
  zone: FinalLevelZone,
  bias: SymbolMonitoringState["bias"],
): "support" | "resistance" {
  if (
    eventType === "breakout" ||
    eventType === "reclaim" ||
    eventType === "fake_breakdown"
  ) {
    return "resistance";
  }

  if (
    eventType === "breakdown" ||
    eventType === "fake_breakout" ||
    eventType === "rejection"
  ) {
    return "support";
  }

  if (eventType === "level_touch" || eventType === "compression") {
    return zone.kind === "support" ? "resistance" : "support";
  }

  return bias === "bearish" ? "support" : "resistance";
}

export function findNearestRelevantBarrier(params: {
  eventType: MonitoringEventType;
  zone: FinalLevelZone;
  symbolState: SymbolMonitoringState;
  triggerPrice: number;
}): {
  kind: "support" | "resistance";
  level: number;
  distancePct: number;
} | null {
  const { eventType, zone, symbolState, triggerPrice } = params;
  if (!Number.isFinite(triggerPrice) || triggerPrice <= 0) {
    return null;
  }

  const barrierKind = barrierSideForEvent(eventType, zone, symbolState.bias ?? "neutral");
  const candidateZones =
    barrierKind === "resistance"
      ? symbolState.resistanceZones
      : symbolState.supportZones;
  const candidates = candidateZones
    .filter((candidate) => candidate.id !== zone.id)
    .filter((candidate) =>
      barrierKind === "resistance"
        ? candidate.representativePrice > triggerPrice
        : candidate.representativePrice < triggerPrice,
    )
    .sort((left, right) =>
      barrierKind === "resistance"
        ? left.representativePrice - right.representativePrice
        : right.representativePrice - left.representativePrice,
    );
  const nextBarrier = candidates[0];

  if (!nextBarrier) {
    return null;
  }

  return {
    kind: barrierKind,
    level: nextBarrier.representativePrice,
    distancePct:
      Math.abs(nextBarrier.representativePrice - triggerPrice) /
      Math.max(triggerPrice, 0.0001),
  };
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
  zone: FinalLevelZone;
  symbolState: SymbolMonitoringState;
}): boolean {
  const { eventType, currentState, update, previousPrice, config, zone, symbolState } = params;
  const movePct =
    previousPrice !== undefined
      ? Math.abs(update.lastPrice - previousPrice) / Math.max(Math.abs(previousPrice), 0.0001)
      : 0;
  const zoneContext = symbolState.zoneContexts[zone.id];
  const lowSignalInnerZone =
    zone.strengthLabel === "weak" &&
    (zoneContext?.ladderPosition ?? "inner") === "inner" &&
    !zone.isExtension;
  const staleLowContext =
    (zoneContext?.zoneFreshness ?? zone.freshness) === "stale" &&
    (zoneContext?.ladderPosition ?? "inner") === "inner";

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

  if (
    eventType === "level_touch" &&
    lowSignalInnerZone &&
    currentState.nearestDistancePct > config.nearZonePct * 0.4
  ) {
    return true;
  }

  if (
    eventType === "compression" &&
    (lowSignalInnerZone || staleLowContext) &&
    currentState.updatesNearZone < config.compressionMinUpdates + 1
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
  const zoneContext = symbolState.zoneContexts[zone.id];
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
  const freshnessScore = freshnessImportance(zone);
  const episodeScore = clamp(
    currentState.updatesNearZone / Math.max(config.compressionMinUpdates, 1),
  );
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
  const extensionContext =
    (zoneContext?.origin === "promoted_extension" || zone.isExtension) &&
    (eventType === "breakout" || eventType === "breakdown" || eventType === "level_touch")
      ? 0.06
      : zoneContext?.origin === "promoted_extension" || zone.isExtension
        ? 0.03
        : 0;
  const dataQualityPenalty =
    zoneContext?.dataQualityDegraded || (symbolState.levelDataQualityFlags?.length ?? 0) > 0 ? 0.06 : 0;
  const outermostContext =
    zoneContext?.ladderPosition === "outermost" &&
    (eventType === "level_touch" || eventType === "breakout" || eventType === "breakdown")
      ? 0.05
      : 0;
  const refreshedContext =
    zoneContext?.recentlyRefreshed &&
    (eventType === "level_touch" || eventType === "reclaim" || eventType === "rejection")
      ? 0.03
      : 0;
  const staleContextPenalty =
    zoneContext?.zoneFreshness === "stale" && !zone.isExtension ? 0.05 : 0;
  const weakZonePenalty =
    zoneContext?.zoneStrengthLabel === "weak" &&
    zoneContext.ladderPosition === "inner" &&
    (eventType === "level_touch" || eventType === "compression")
      ? 0.04
      : 0;
  const clearancePenalty =
    clearanceLabel === "tight"
      ? 0.08
      : clearanceLabel === "limited"
        ? 0.03
        : 0;
  const clearanceBonus = clearanceLabel === "open" ? 0.03 : 0;

  const strength = clamp(
    proximityScore * 0.32 +
      speedScore * 0.23 +
      volumeScore * 0.12 +
      zoneStrengthScore * 0.18 +
      timeframeScore * 0.1 +
      freshnessScore * 0.06 +
      eventBias * 0.05 +
      context.pressureScore * 0.08 +
      repeatedTestBoost +
      alignmentAdjustment +
      structureBoost +
      failureAmplification +
      outermostContext +
      refreshedContext +
      extensionContext -
      clearancePenalty +
      clearanceBonus -
      dataQualityPenalty -
      staleContextPenalty -
      weakZonePenalty,
  );

  const confidence = clamp(
    strength * 0.45 +
      timeframeScore * 0.2 +
      freshnessScore * 0.1 +
      zoneStrengthScore * 0.15 +
      episodeScore * 0.1 +
      volumeScore * 0.1 +
      context.pressureScore * 0.08 +
      Math.max(0, alignmentAdjustment) * 0.12 +
      structureBoost * 0.9 +
      failureAmplification * 0.85 +
      outermostContext * 0.9 +
      refreshedContext * 0.8 +
      extensionContext * 0.8 -
      clearancePenalty * 0.7 +
      clearanceBonus * 0.7 -
      dataQualityPenalty * 0.5 -
      staleContextPenalty * 0.75 -
      weakZonePenalty * 0.6,
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
