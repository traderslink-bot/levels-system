import type { FinalLevelZone } from "../levels/level-types.js";
import {
  deriveZoneTacticalRead,
  resolveZoneTacticalBias,
} from "../levels/zone-tactical-read.js";
import type { MonitoringConfig } from "./monitoring-config.js";
import type {
  BarrierClutterLabel,
  BarrierClearanceLabel,
  LivePriceUpdate,
  MonitoringAlertType,
  MonitoringEventType,
  PathQualityLabel,
  SymbolMonitoringState,
  ZoneExhaustionLabel,
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

function relevantBarriers(params: {
  eventType: MonitoringEventType;
  zone: FinalLevelZone;
  symbolState: SymbolMonitoringState;
  triggerPrice: number;
}): Array<{
  kind: "support" | "resistance";
  level: number;
  distancePct: number;
}> {
  const { eventType, zone, symbolState, triggerPrice } = params;
  if (!Number.isFinite(triggerPrice) || triggerPrice <= 0) {
    return [];
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
    )
    .map((candidate) => ({
      kind: barrierKind,
      level: candidate.representativePrice,
      distancePct:
        Math.abs(candidate.representativePrice - triggerPrice) /
        Math.max(triggerPrice, 0.0001),
    }));

  return candidates;
}

export function derivePathQuality(params: {
  eventType: MonitoringEventType;
  zone: FinalLevelZone;
  symbolState: SymbolMonitoringState;
  triggerPrice: number;
  config: MonitoringConfig;
}): {
  label: PathQualityLabel;
  barrierCount: number;
} | null {
  const barriers = relevantBarriers(params);
  if (barriers.length === 0) {
    return null;
  }

  const pathWindowPct = Math.max(params.config.limitedClearancePct * 3, 0.1);
  const pathBarriers = barriers.filter((barrier) => barrier.distancePct <= pathWindowPct);
  const barrierCount = pathBarriers.length;

  if (barrierCount <= 1) {
    return {
      label: "clean",
      barrierCount,
    };
  }

  const considered = pathBarriers.slice(0, Math.min(barrierCount, 4));
  const gaps = considered
    .slice(1)
    .map((barrier, index) => barrier.distancePct - considered[index]!.distancePct);
  const averageGap =
    gaps.length === 0
      ? considered[0]!.distancePct
      : gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;

  if (barrierCount >= 3 && averageGap <= Math.max(params.config.tightClearancePct, 0.015)) {
    return {
      label: "choppy",
      barrierCount,
    };
  }

  if (barrierCount >= 2 && averageGap <= Math.max(params.config.limitedClearancePct, 0.03)) {
    return {
      label: "layered",
      barrierCount,
    };
  }

  return {
    label: "clean",
    barrierCount,
  };
}

export function deriveZoneExhaustion(params: {
  zone: FinalLevelZone;
  zoneFreshness: FinalLevelZone["freshness"];
  tacticalRead: ReturnType<typeof deriveZoneTacticalRead>;
}): ZoneExhaustionLabel {
  const { zone, zoneFreshness, tacticalRead } = params;
  const touchCount = zone.touchCount;
  const weakReaction =
    zone.followThroughScore < 0.45 ||
    zone.reactionQualityScore < 0.42;
  const stale = zoneFreshness === "stale";

  if ((touchCount >= 8 && (stale || tacticalRead === "tired")) || (touchCount >= 6 && stale && weakReaction)) {
    return "spent";
  }

  if (touchCount >= 5 || tacticalRead === "tired" || stale) {
    return "worn";
  }

  if (touchCount >= 3) {
    return "tested";
  }

  return "fresh";
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
  return relevantBarriers(params)[0] ?? null;
}

export function deriveBarrierClutter(params: {
  eventType: MonitoringEventType;
  zone: FinalLevelZone;
  symbolState: SymbolMonitoringState;
  triggerPrice: number;
  config: MonitoringConfig;
}): {
  label: BarrierClutterLabel;
  nearbyBarrierCount: number;
} | null {
  const barriers = relevantBarriers(params);
  if (barriers.length === 0) {
    return null;
  }

  const clusteredDistancePct = Math.max(params.config.limitedClearancePct * 2, 0.06);
  const nearbyBarrierCount = barriers.filter((barrier) => barrier.distancePct <= clusteredDistancePct).length;

  if (nearbyBarrierCount >= 3) {
    return {
      label: "dense",
      nearbyBarrierCount,
    };
  }

  if (nearbyBarrierCount >= 2) {
    return {
      label: "stacked",
      nearbyBarrierCount,
    };
  }

  return {
    label: "clear",
    nearbyBarrierCount: 1,
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
  const tacticalBias = resolveZoneTacticalBias({
    zoneKind: zone.kind,
    eventType,
    tacticalRead,
  });
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
  const clutterPenalty =
    barrierClutter?.label === "dense"
      ? 0.07
      : barrierClutter?.label === "stacked"
        ? 0.03
        : 0;
  const clutterTailwind =
    barrierClutter?.label === "dense" &&
    ((zone.kind === "resistance" && eventType === "breakout") ||
      (zone.kind === "support" && eventType === "breakdown"))
      ? 0.02
      : 0;
  const pathQualityPenalty =
    pathQuality?.label === "choppy"
      ? 0.08
      : pathQuality?.label === "layered"
        ? 0.04
        : 0;
  const pathQualityBonus = pathQuality?.label === "clean" ? 0.02 : 0;
  const tacticalScale =
    eventType === "level_touch" || eventType === "compression" ? 0.75 : 1;
  const tacticalTailwindBonus = tacticalBias === "tailwind" ? 0.02 * tacticalScale : 0;
  const tacticalHeadwindPenalty = tacticalBias === "headwind" ? 0.03 * tacticalScale : 0;
  const exhaustionPenalty =
    (exhaustionLabel === "worn" || exhaustionLabel === "spent") &&
    ((zone.kind === "support" &&
      (eventType === "level_touch" || eventType === "reclaim" || eventType === "fake_breakdown")) ||
      (zone.kind === "resistance" &&
        (eventType === "level_touch" || eventType === "rejection" || eventType === "fake_breakout")))
      ? exhaustionLabel === "spent"
        ? 0.08
        : 0.05
      : 0;
  const exhaustionTailwind =
    (exhaustionLabel === "worn" || exhaustionLabel === "spent") &&
    ((zone.kind === "resistance" && eventType === "breakout") ||
      (zone.kind === "support" && eventType === "breakdown"))
      ? exhaustionLabel === "spent"
        ? 0.05
        : 0.03
      : 0;

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
      clutterPenalty +
      clutterTailwind -
      pathQualityPenalty +
      pathQualityBonus -
      tacticalHeadwindPenalty +
      tacticalTailwindBonus -
      exhaustionPenalty +
      exhaustionTailwind -
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
      clutterPenalty * 0.85 +
      clutterTailwind * 0.75 -
      pathQualityPenalty * 0.8 +
      pathQualityBonus * 0.7 -
      tacticalHeadwindPenalty * 0.85 +
      tacticalTailwindBonus * 0.75 -
      exhaustionPenalty * 0.9 +
      exhaustionTailwind * 0.75 -
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
